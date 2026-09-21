import type { SupabaseClient } from './types.ts';
import { logMessage, logError } from './db-helpers.ts';

// ── LINE API helpers ────────────────────────────────────────────────────────

export async function verifySignature(rawBody: string, signature: string, secret: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return computed === signature;
}

export async function reply(replyToken: string, messages: object[], accessToken: string): Promise<{ ok: boolean; status?: number; body?: string }> {
  console.log("[reply] sending reply, token=", replyToken?.slice(0, 10) + "...", "msgs count=", messages.length);
  try {
    const payload = JSON.stringify({ replyToken, messages });
    console.log("[reply] payload length=", payload.length);
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: payload,
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error(`[reply] LINE reply failed ${res.status}: ${body}`);
      return { ok: false, status: res.status, body };
    }
    console.log(`[reply] LINE reply success ${res.status}`);
    return { ok: true, status: res.status };
  } catch (err) {
    console.error("[reply] fetch exception:", err);
    return { ok: false, body: (err as Error).message };
  }
}

export async function push(to: string, messages: object[], accessToken: string): Promise<{ ok: boolean; status?: number; body?: string }> {
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to, messages }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`LINE push failed ${res.status}: ${body}`);
      return { ok: false, status: res.status, body };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    console.error("[push] fetch exception:", err);
    return { ok: false, body: (err as Error).message };
  }
}

export function text(msg: string) {
  return { type: "text", text: msg };
}

export async function replyAndLog(
  replyToken: string,
  messages: object[],
  accessToken: string,
  db: SupabaseClient,
  opts: { channelId?: number | null; lineUserId: string; displayName?: string; sourceType: string; groupId?: string | null }
) {
  const result = await reply(replyToken, messages, accessToken);
  if (!result.ok) {
    await logError(db, {
      channelId: opts.channelId,
      lineUserId: opts.lineUserId,
      sourceType: opts.sourceType,
      groupId: opts.groupId,
      errorType: "line_api_error",
      errorMessage: `reply failed (${result.status ?? "?"}): ${result.body ?? "unknown"}`,
    });
  }
  for (const msg of messages) {
    const msgText = (msg as any).altText ?? (msg as any).text ?? "[flex message]";
    await logMessage(db, {
      channelId: opts.channelId,
      lineUserId: "BOT",
      displayName: "營運管理助理",
      messageText: msgText,
      sourceType: opts.sourceType,
      direction: result.ok ? "outgoing" : "outgoing_failed",
      groupId: opts.groupId,
      eventType: "reply",
    });
  }
}

export async function pushAndLog(
  to: string,
  messages: object[],
  accessToken: string,
  db: SupabaseClient,
  opts: { channelId?: number | null; sourceType?: string; groupId?: string | null }
) {
  const result = await push(to, messages, accessToken);
  if (!result.ok) {
    await logError(db, {
      channelId: opts.channelId,
      sourceType: opts.sourceType,
      groupId: opts.groupId,
      errorType: "line_api_error",
      errorMessage: `push failed (${result.status ?? "?"}): ${result.body ?? "unknown"}`,
    });
  }
  for (const msg of messages) {
    const msgText = (msg as any).altText ?? (msg as any).text ?? "[flex message]";
    await logMessage(db, {
      channelId: opts.channelId,
      lineUserId: "BOT",
      displayName: "營運管理助理",
      messageText: msgText,
      sourceType: opts.sourceType ?? "user",
      direction: result.ok ? "outgoing" : "outgoing_failed",
      groupId: opts.groupId,
      eventType: "push",
    });
  }
}

export async function getLineProfile(lineUserId: string, accessToken: string, groupId?: string | null): Promise<{ displayName: string; pictureUrl?: string; userId?: string }> {
  // In group chats, use group member profile endpoint (direct profile only works for bot friends)
  const url = groupId
    ? `https://api.line.me/v2/bot/group/${groupId}/member/${lineUserId}`
    : `https://api.line.me/v2/bot/profile/${lineUserId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000),
  });
  if (res.ok) return await res.json();
  // Fallback: try direct profile if group endpoint failed
  if (groupId) {
    const res2 = await fetch(`https://api.line.me/v2/bot/profile/${lineUserId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res2.ok) return await res2.json();
  }
  return { displayName: "使用者" };
}

export async function getGroupSummary(groupId: string, accessToken: string): Promise<{ groupName: string }> {
  const res = await fetch(`https://api.line.me/v2/bot/group/${groupId}/summary`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000),
  });
  return res.ok ? await res.json() : { groupName: "" };
}
