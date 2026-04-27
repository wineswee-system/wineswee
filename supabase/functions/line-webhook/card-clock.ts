// ── Clock-in status preview card (P4) ────────────────────────────────────────
// 「打卡」指令觸發：先給今日狀態 preview（上下班時間 + 排班對照 + 門市），
// 主動作 [⏰ 立即打卡→LIFF] 必須跳 LIFF（要 GPS 不可避免）。

import type { SupabaseClient } from './types.ts';
import {
  COLOR_ATTENDANCE, COLOR_SUCCESS, COLOR_DANGER, COLOR_WARNING, COLOR_NEUTRAL,
  TEXT_ON_COLOR, TEXT_DIM_ATTENDANCE, TEXT_BODY, TEXT_LABEL, TEXT_SECONDARY, TEXT_MUTED,
} from './colors.ts';
import { flexResultErr } from './flex-builders.ts';

function liffUri(liffId: string, path: string): string {
  return `https://liff.line.me/${liffId.trim()}?to=${encodeURIComponent(path)}`;
}

function row(label: string, value: string, valueColor?: string) {
  return {
    type: "box", layout: "horizontal", spacing: "sm", margin: "xs",
    contents: [
      { type: "text", text: label, color: TEXT_LABEL, size: "xs", flex: 3 },
      { type: "text", text: value, color: valueColor ?? TEXT_BODY, size: "xs", flex: 6, weight: "bold", wrap: true },
    ],
  };
}

export async function buildClockTodayMessage(db: SupabaseClient, lineUserId: string, liffId: string): Promise<object> {
  const { data, error } = await db.rpc("liff_card_clock_today", { p_line_user_id: lineUserId });
  if (error) return flexResultErr({ title: "讀取打卡狀態失敗", lines: [error.message] });

  const r = data as any;
  if (!r?.ok) {
    return flexResultErr({
      title: "讀不到打卡狀態",
      lines: [r?.error === "EMPLOYEE_NOT_FOUND" ? "你的 LINE 還沒綁員工，請先 /註冊 姓名" : (r?.error ?? "未知錯誤")],
    });
  }

  const empName = r.employee_name ?? "";
  const today = r.today ?? "";
  const weekday = r.weekday ?? "";
  const store = r.store ?? null;
  const clockIn = r.clock_in;
  const clockOut = r.clock_out;
  const hours = r.hours;
  const shift = r.shift;
  const shiftStart = r.shift_start;
  const shiftEnd = r.shift_end;
  const absence = r.absence_type;

  // ── Body ──
  const body: any[] = [];

  // 上班區
  if (clockIn) {
    body.push(row("上班", `${clockIn}  ✅`, COLOR_SUCCESS));
  } else if (absence) {
    body.push(row("上班", `— (${absence})`, COLOR_WARNING));
  } else {
    body.push(row("上班", "──  ⏳ 未打", COLOR_NEUTRAL));
  }

  // 下班區
  if (clockOut) {
    body.push(row("下班", `${clockOut}  ✅`, COLOR_SUCCESS));
  } else if (clockIn) {
    body.push(row("下班", "──  ⏳ 未打", COLOR_NEUTRAL));
  } else {
    body.push(row("下班", "—"));
  }

  // 工時
  if (hours != null && Number(hours) > 0) {
    body.push(row("工時", `${Number(hours).toFixed(1)} 小時`));
  } else {
    body.push(row("工時", "—"));
  }

  body.push({ type: "separator", margin: "md" });

  // 排班對照
  if (shift) {
    const shiftLabel = (shiftStart && shiftEnd) ? `${shift}　${shiftStart}–${shiftEnd}` : shift;
    body.push(row("排班", shiftLabel, TEXT_BODY));
  } else if (absence) {
    body.push(row("排班", absence, COLOR_WARNING));
  } else {
    body.push(row("排班", "本日休"));
  }
  if (store) body.push(row("門市", store));

  // ── Footer buttons ──
  const buttons: any[] = [];
  if (liffId) {
    buttons.push({
      type: "button",
      action: { type: "uri", label: clockIn && clockOut ? "🔄 已完成今日打卡" : (clockIn ? "⏰ 立即下班打卡" : "⏰ 立即打卡 (GPS)"), uri: liffUri(liffId, "/clock") },
      style: "primary", color: COLOR_ATTENDANCE, height: "sm",
    });
    buttons.push({
      type: "button",
      action: { type: "uri", label: "🔧 補打卡申請", uri: liffUri(liffId, "/clock-correction") },
      style: "secondary", height: "sm",
    });
  }

  return {
    type: "flex",
    altText: `⏰ ${empName} 今日打卡狀態`,
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box", layout: "vertical", paddingAll: "14px", backgroundColor: COLOR_ATTENDANCE,
        contents: [
          { type: "text", text: `⏰ 今日打卡  ${weekday} ${today.slice(5)}`, color: TEXT_ON_COLOR, weight: "bold", size: "lg" },
          { type: "text", text: empName, color: TEXT_DIM_ATTENDANCE, size: "xs", margin: "xs" },
        ],
      },
      body: { type: "box", layout: "vertical", paddingAll: "14px", contents: body },
      footer: { type: "box", layout: "vertical", paddingAll: "12px", spacing: "sm", contents: buttons },
    },
  };
}
