// ════════════════════════════════════════════════════════════════
// Discord Bot — Interactions Endpoint (HTTP webhook，免 gateway 常駐)
//
// 部署：supabase functions deploy discord-bot --no-verify-jwt
// 必要 secrets：DISCORD_PUBLIC_KEY（Ed25519 簽章驗證用）
// 內建 env：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//
// Slash commands（全部 ephemeral 回覆，只有本人看得到）：
//   /link code:<綁定碼>  — 綁定 ERP 員工帳號（碼由 ERP 內 RPC generate_discord_link_code 產生）
//   /schedule            — 查未來 7 天班表（schedules + shift_definitions）
//   /leave               — 查今年假期餘額（leave_balances）
//   /kpi                 — 今日營業額（admin / super_admin / manager 限定）
// ════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Discord interaction 常數 ─────────────────────────────────────
const InteractionType = { PING: 1, APPLICATION_COMMAND: 2 } as const;
const EPHEMERAL = 64; // message flag：只有指令發起人看得到

// ── Ed25519 簽章驗證（Discord 要求；失敗一律 401）────────────────
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string,
  timestamp: string,
  rawBody: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKeyHex),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      hexToBytes(signatureHex),
      new TextEncoder().encode(timestamp + rawBody),
    );
  } catch (err) {
    console.error("[discord-bot] signature verify error:", err);
    return false;
  }
}

// ── 回覆 helpers ─────────────────────────────────────────────────
function json(payload: object, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function ephemeralReply(content: string): Response {
  return json({ type: 4, data: { content, flags: EPHEMERAL } });
}

// ── 日期 helpers（Asia/Taipei = UTC+8）───────────────────────────
function taipeiDateString(offsetDays = 0): string {
  // 加 8 小時後取 ISO 日期即為台北當日（YYYY-MM-DD）
  return new Date(Date.now() + (8 * 3600 + offsetDays * 86400) * 1000)
    .toISOString()
    .slice(0, 10);
}

const WEEKDAYS_ZH = ["日", "一", "二", "三", "四", "五", "六"];
function weekdayZh(dateStr: string): string {
  // 用正午 +08:00 建 Date 再取 UTC day 前先位移，避免時區歪掉
  const d = new Date(`${dateStr}T12:00:00+08:00`);
  return WEEKDAYS_ZH[d.getUTCDay()];
}

// ── 員工解析（鏡射 line-webhook 的 lineUser → employee 模式）──────
type LinkedEmployee = {
  employee_id: number;
  organization_id: number;
  name: string;
  role: string;
  store_id: number | null;
};

async function resolveLinkedEmployee(db: any, discordUserId: string): Promise<LinkedEmployee | null> {
  const { data: link } = await db
    .from("discord_account_links")
    .select("employee_id, organization_id")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();
  if (!link) return null;

  const { data: emp } = await db
    .from("employees")
    .select("id, name, role, organization_id, store_id, roles:role_id (name)")
    .eq("id", link.employee_id)
    .maybeSingle();
  if (!emp) return null;

  return {
    employee_id: emp.id,
    organization_id: link.organization_id ?? emp.organization_id,
    name: emp.name,
    role: (emp as any).roles?.name ?? emp.role ?? "",
    store_id: emp.store_id ?? null,
  };
}

const UNLINKED_MSG =
  "🔗 你還沒綁定 ERP 員工帳號。\n" +
  "① 登入 ERP 系統取得 8 碼綁定碼（RPC `generate_discord_link_code`，或請管理員代為產生）\n" +
  "② 回到這裡輸入 `/link code:<綁定碼>` 完成綁定";

// ── /link ────────────────────────────────────────────────────────
async function cmdLink(db: any, discordUserId: string, discordUsername: string, rawCode: string): Promise<Response> {
  const code = (rawCode ?? "").trim().toUpperCase();
  if (!code) return ephemeralReply("⚠️ 請提供綁定碼：`/link code:<8碼>`");

  const { data: linkCode } = await db
    .from("discord_link_codes")
    .select("code, employee_id, organization_id, expires_at, used")
    .eq("code", code)
    .eq("used", false)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (!linkCode) {
    return ephemeralReply("❌ 綁定碼無效或已過期（有效 15 分鐘）。請回 ERP 重新產生一組。");
  }

  const { data: emp } = await db
    .from("employees")
    .select("id, name")
    .eq("id", linkCode.employee_id)
    .maybeSingle();
  if (!emp) return ephemeralReply("❌ 找不到對應員工，請聯絡系統管理員。");

  // 換綁防呆：清掉同 Discord 帳號或同員工的舊綁定，再寫入新綁定
  await db.from("discord_account_links").delete().eq("discord_user_id", discordUserId);
  await db.from("discord_account_links").delete().eq("employee_id", linkCode.employee_id);

  const { error: insErr } = await db.from("discord_account_links").insert({
    organization_id: linkCode.organization_id,
    employee_id: linkCode.employee_id,
    discord_user_id: discordUserId,
    discord_username: discordUsername || null,
  });
  if (insErr) {
    console.error("[discord-bot] link insert failed:", insErr);
    return ephemeralReply("❌ 綁定失敗，請稍後再試。");
  }

  await db.from("discord_link_codes").update({ used: true }).eq("code", code);

  return ephemeralReply(
    `✅ 綁定成功！**${emp.name}**\n` +
    "現在可以使用：\n" +
    "• `/schedule` 查未來 7 天班表\n" +
    "• `/leave` 查假期餘額\n" +
    "• `/kpi` 今日營業額（主管限定）",
  );
}

// ── /schedule：未來 7 天班表 ──────────────────────────────────────
async function cmdSchedule(db: any, emp: LinkedEmployee): Promise<Response> {
  const from = taipeiDateString(0);
  const to = taipeiDateString(6);

  // schedules 以員工姓名為主鍵（同 src/lib/db/attendance.js getEmployeeShiftForDate），
  // employee_id 為後補欄位 → 姓名 OR employee_id 都撈
  const { data: rows, error } = await db
    .from("schedules")
    .select("date, shift, absence_type, employee, employee_id")
    .or(`employee.eq.${emp.name},employee_id.eq.${emp.employee_id}`)
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true });

  if (error) {
    console.error("[discord-bot] schedule query failed:", error);
    return ephemeralReply("❌ 班表查詢失敗，請稍後再試。");
  }

  // 班別時間對照
  const { data: defs } = await db
    .from("shift_definitions")
    .select("name, start_time, end_time");
  const defMap = new Map<string, { start_time: string; end_time: string }>();
  for (const d of defs ?? []) defMap.set(d.name, d);

  const byDate = new Map<string, any>();
  for (const r of rows ?? []) byDate.set(String(r.date), r);

  const lines: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = taipeiDateString(i);
    const label = `${d.slice(5).replace("-", "/")} (${weekdayZh(d)})`;
    const row = byDate.get(d);
    if (!row || !row.shift || row.shift === "休") {
      lines.push(`${label}　${row?.absence_type ? row.absence_type : "休"}`);
    } else {
      const def = defMap.get(row.shift);
      const time = def ? ` ${String(def.start_time).slice(0, 5)}–${String(def.end_time).slice(0, 5)}` : "";
      lines.push(`${label}　${row.shift}${time}`);
    }
  }

  return ephemeralReply(`📅 **${emp.name} 未來 7 天班表**\n${lines.join("\n")}`);
}

// ── /leave：今年假期餘額 ──────────────────────────────────────────
const LEAVE_LABELS: Record<string, string> = {
  annual: "特休", sick: "病假", personal: "事假",
  bereavement: "喪假", marriage: "婚假", maternity: "產假",
  paternity: "陪產假", unpaid: "無薪假",
};

async function cmdLeave(db: any, emp: LinkedEmployee): Promise<Response> {
  const year = Number(taipeiDateString(0).slice(0, 4));
  const { data: balances, error } = await db
    .from("leave_balances")
    .select("leave_type, total_days, used_days, carry_over_days")
    .eq("employee_id", emp.employee_id)
    .eq("year", year);

  if (error) {
    console.error("[discord-bot] leave query failed:", error);
    return ephemeralReply("❌ 假期餘額查詢失敗，請稍後再試。");
  }
  if (!balances || balances.length === 0) {
    return ephemeralReply(`📋 ${year} 年假期餘額尚未設定，請聯繫 HR。`);
  }

  const lines = balances.map((b: any) => {
    const total = Number(b.total_days || 0) + Number(b.carry_over_days || 0);
    const used = Number(b.used_days || 0);
    const remaining = total - used;
    const label = LEAVE_LABELS[b.leave_type] || b.leave_type;
    return `${label}　共 ${total} 天｜已用 ${used} 天｜**剩 ${remaining.toFixed(1)} 天**`;
  });

  return ephemeralReply(`🌿 **${emp.name} ${year} 年假期餘額**\n${lines.join("\n")}`);
}

// ── /kpi：今日營業額（主管限定，org-scoped）──────────────────────
const KPI_ROLES = ["admin", "super_admin", "manager"];

async function cmdKpi(db: any, emp: LinkedEmployee): Promise<Response> {
  if (!KPI_ROLES.includes(emp.role)) {
    return ephemeralReply("🔒 權限不足：`/kpi` 僅限管理員 / 主管使用。");
  }
  if (!emp.organization_id) {
    return ephemeralReply("❌ 你的員工資料未設定組織，請聯絡系統管理員。");
  }

  // org → 門市 ids → 今日（台北時區）pos_transactions 彙總
  const { data: stores } = await db
    .from("stores")
    .select("id")
    .eq("organization_id", emp.organization_id);
  const storeIds = (stores ?? []).map((s: any) => s.id);
  if (storeIds.length === 0) {
    return ephemeralReply("📊 你的組織尚未設定門市，無銷售資料。");
  }

  const today = taipeiDateString(0);
  const dayStartUtc = new Date(`${today}T00:00:00+08:00`).toISOString();

  const { data: txns, error } = await db
    .from("pos_transactions")
    .select("total")
    .in("store_id", storeIds)
    .eq("status", "完成")
    .gte("created_at", dayStartUtc);

  if (error) {
    console.error("[discord-bot] kpi query failed:", error);
    return ephemeralReply("❌ 營收查詢失敗，請稍後再試。");
  }

  const count = txns?.length ?? 0;
  const sum = (txns ?? []).reduce((acc: number, t: any) => acc + Number(t.total || 0), 0);
  const fmt = new Intl.NumberFormat("zh-TW").format(Math.round(sum));

  return ephemeralReply(
    `📊 **今日營運 KPI**（${today}）\n` +
    `營業額：NT$ ${fmt}\n` +
    `交易筆數：${count} 筆`,
  );
}

// ── 未知指令 ─────────────────────────────────────────────────────
const HELP_MSG =
  "❓ 未識別的指令。可用指令：\n" +
  "• `/link code:<綁定碼>` — 綁定 ERP 員工帳號\n" +
  "• `/schedule` — 未來 7 天班表\n" +
  "• `/leave` — 假期餘額\n" +
  "• `/kpi` — 今日營業額（主管限定）";

// ── 主入口 ───────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const publicKey = Deno.env.get("DISCORD_PUBLIC_KEY");
  if (!publicKey) {
    console.error("[discord-bot] Missing DISCORD_PUBLIC_KEY secret");
    return new Response("Server misconfigured", { status: 500 });
  }

  const signature = req.headers.get("X-Signature-Ed25519") ?? "";
  const timestamp = req.headers.get("X-Signature-Timestamp") ?? "";
  const rawBody = await req.text();

  if (!signature || !timestamp || !(await verifyDiscordSignature(publicKey, signature, timestamp, rawBody))) {
    console.error("[discord-bot] Invalid request signature");
    return new Response("invalid request signature", { status: 401 });
  }

  let interaction: any;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Discord endpoint 驗證 handshake
  if (interaction.type === InteractionType.PING) {
    return json({ type: 1 });
  }

  if (interaction.type !== InteractionType.APPLICATION_COMMAND) {
    return ephemeralReply(HELP_MSG);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(supabaseUrl, supabaseKey);

  // guild 內 interaction 帶 member.user；DM 帶 user
  const discordUser = interaction.member?.user ?? interaction.user ?? {};
  const discordUserId: string = discordUser.id ?? "";
  const discordUsername: string = discordUser.username ?? "";
  const commandName: string = interaction.data?.name ?? "";

  if (!discordUserId) {
    return ephemeralReply("❌ 無法識別你的 Discord 帳號。");
  }

  try {
    if (commandName === "link") {
      const codeOpt = (interaction.data?.options ?? []).find((o: any) => o.name === "code");
      return await cmdLink(db, discordUserId, discordUsername, String(codeOpt?.value ?? ""));
    }

    // 其餘指令都需要先綁定
    const emp = await resolveLinkedEmployee(db, discordUserId);
    if (!emp) return ephemeralReply(UNLINKED_MSG);

    switch (commandName) {
      case "schedule":
        return await cmdSchedule(db, emp);
      case "leave":
        return await cmdLeave(db, emp);
      case "kpi":
        return await cmdKpi(db, emp);
      default:
        return ephemeralReply(HELP_MSG);
    }
  } catch (err) {
    // 不外洩內部錯誤細節
    console.error(`[discord-bot] command "${commandName}" failed:`, err);
    return ephemeralReply("❌ 查詢失敗，請稍後再試或聯絡系統管理員。");
  }
});
