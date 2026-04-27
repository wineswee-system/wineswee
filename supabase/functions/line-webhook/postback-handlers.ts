// ── Postback dispatch ────────────────────────────────────────────────────────
// LINE postback events come with a `data` string. We use URL-encoded query
// format: "action=approve&type=leave&id=42&extra=foo".
//
// Each handler is registered against an "action:type" key and returns the
// LINE message(s) to reply with (or null if it pushed already / no reply).

import type { SupabaseClient, PendingAction, ApprovalRequestType } from './types.ts';
import { flexResultOk, flexResultErr } from './flex-builders.ts';

// ── Context ──────────────────────────────────────────────────────────────────

export interface PostbackContext {
  db: SupabaseClient;
  accessToken: string;
  channelCode: string;
  channelId: number | null;
  userId: string;          // LINE userId of the sender
  replyToken: string;
  // LINE user row (may be null if not registered yet)
  lineUser: {
    id?: number;
    line_user_id: string;
    display_name?: string | null;
    employee_id?: number | null;
    is_verified?: boolean;
  } | null;
  liffIds: { task: string; newTask: string; dashboard: string };
}

// ── Parse / build ────────────────────────────────────────────────────────────

/** Parse "a=1&b=2" into { a: "1", b: "2" } */
export function parsePostback(data: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!data) return out;
  for (const pair of data.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const k = eq < 0 ? pair : pair.slice(0, eq);
    const v = eq < 0 ? "" : pair.slice(eq + 1);
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return out;
}

/** Build "action=approve&type=leave&id=42" from object. Skips empty/null. */
export function buildPostback(params: Record<string, string | number | null | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

// ── Handler signature ────────────────────────────────────────────────────────

export type PostbackHandler = (
  params: Record<string, string>,
  ctx: PostbackContext,
) => Promise<object[] | null>;

// ── Registry ─────────────────────────────────────────────────────────────────
// Lookup key is `${action}:${type}`. We start empty here — individual handler
// modules register themselves below by mutating REGISTRY before export.

const REGISTRY: Record<string, PostbackHandler> = {};

/** Public way to register a handler. Last-write wins. */
export function registerPostback(action: string, type: string, fn: PostbackHandler) {
  REGISTRY[`${action}:${type}`] = fn;
}

/** Main dispatch — returns messages to reply with, or null. */
export async function dispatchPostback(data: string, ctx: PostbackContext): Promise<object[] | null> {
  const params = parsePostback(data);
  const action = params.action ?? "";
  const type = params.type ?? "";
  const key = `${action}:${type}`;

  const handler = REGISTRY[key];
  if (!handler) {
    return [
      flexResultErr({
        title: "未知的操作",
        lines: [`收到操作：${key || "(空)"}`, "可能是舊版卡片，請重新觸發指令。"],
      }),
    ];
  }

  try {
    return await handler(params, ctx);
  } catch (err) {
    console.error(`[postback] handler ${key} threw`, err);
    return [
      flexResultErr({
        title: "操作失敗",
        lines: [
          (err as Error).message ?? "系統異常",
          "稍後再試一次，或聯絡管理員。",
        ],
      }),
    ];
  }
}

// ── PendingAction helpers (for two-step flows: postback → ask text → execute) ─

/** Set a pending action on the line_users row. Cleared automatically when
 * the next text message is processed by index.ts. */
export async function setPending(db: SupabaseClient, lineUserId: string, pending: PendingAction): Promise<void> {
  await db.from("line_users").update({ pending_action: pending }).eq("line_user_id", lineUserId);
}

export async function clearPending(db: SupabaseClient, lineUserId: string): Promise<void> {
  await db.from("line_users").update({ pending_action: null }).eq("line_user_id", lineUserId);
}

// ── Re-export helpers used by individual handler modules ─────────────────────

export type { ApprovalRequestType };
