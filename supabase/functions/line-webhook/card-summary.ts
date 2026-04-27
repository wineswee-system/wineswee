// ── Today Summary card (P5) ──────────────────────────────────────────────────
// /說明 主選單前的「今日摘要」卡：待辦 / 待簽 / 任務 / 班別 / 打卡狀態。
// 與 flexMenu 組成 carousel 的第一張。

import type { SupabaseClient } from './types.ts';
import {
  COLOR_PRIMARY, COLOR_SUCCESS, COLOR_DANGER, COLOR_WARNING, COLOR_INFO,
  TEXT_ON_COLOR, TEXT_DIM_PRIMARY, TEXT_TITLE, TEXT_BODY, TEXT_LABEL,
} from './colors.ts';
import { flexResultErr } from './flex-builders.ts';

function liffUri(liffId: string, path: string): string {
  return `https://liff.line.me/${liffId.trim()}?to=${encodeURIComponent(path)}`;
}

export async function buildTodaySummaryBubble(db: SupabaseClient, lineUserId: string, liffId: string): Promise<object | null> {
  const { data, error } = await db.rpc("liff_card_today_summary", { p_line_user_id: lineUserId });
  if (error || !(data as any)?.ok) return null;
  const r = data as any;

  const empName = r.employee_name ?? "";
  const today = r.today ?? "";
  const weekday = r.weekday ?? "";
  const pendingTasks = r.pending_tasks ?? 0;
  const pendingApprovals = r.pending_approvals ?? 0;
  const pendingCover = r.pending_cover ?? 0;
  const todayShift = r.today_shift ?? "—";
  const clockedIn = !!r.clocked_in;
  const clockedOut = !!r.clocked_out;

  // 打卡狀態文字
  let clockText = "未打卡";
  let clockColor = COLOR_DANGER;
  if (clockedIn && clockedOut) { clockText = "✅ 已下班"; clockColor = COLOR_SUCCESS; }
  else if (clockedIn) { clockText = "🕐 上班中"; clockColor = COLOR_INFO; }
  else if (todayShift === "休") { clockText = "本日休"; clockColor = TEXT_LABEL; }

  const statRow = (label: string, value: string, valueColor: string) => ({
    type: "box", layout: "horizontal", spacing: "sm", margin: "xs",
    contents: [
      { type: "text", text: label, color: TEXT_LABEL, size: "xs", flex: 4 },
      { type: "text", text: value, color: valueColor, size: "sm", flex: 5, weight: "bold" },
    ],
  });

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "早安";
    if (h < 18) return "午安";
    return "晚安";
  })();

  const buttons: any[] = [];
  if (liffId) {
    if (!clockedIn) {
      buttons.push({
        type: "button",
        action: { type: "uri", label: "⏰ 立即打卡", uri: liffUri(liffId, "/clock") },
        style: "primary", color: COLOR_INFO, height: "sm",
      });
    } else if (!clockedOut) {
      buttons.push({
        type: "button",
        action: { type: "uri", label: "🕐 下班打卡", uri: liffUri(liffId, "/clock") },
        style: "primary", color: COLOR_INFO, height: "sm",
      });
    }
    if (pendingApprovals > 0) {
      buttons.push({
        type: "button",
        action: { type: "uri", label: `✅ 處理 ${pendingApprovals} 件簽核`, uri: liffUri(liffId, "/approve") },
        style: "primary", color: COLOR_PRIMARY, height: "sm",
      });
    }
  }

  return {
    type: "bubble",
    // 不指定 size：跟 flexMenu 對齊（兩張 bubble 在 carousel 內須同尺寸，否則 LINE 拒收）
    header: {
      type: "box", layout: "vertical", paddingAll: "16px", backgroundColor: COLOR_PRIMARY,
      contents: [
        { type: "text", text: `👋 ${greeting}，${empName}`, color: TEXT_ON_COLOR, weight: "bold", size: "lg" },
        { type: "text", text: `${weekday} ${today.slice(5)}`, color: TEXT_DIM_PRIMARY, size: "xs", margin: "xs" },
      ],
    },
    body: {
      type: "box", layout: "vertical", paddingAll: "14px", spacing: "none",
      contents: [
        statRow("待辦任務", `${pendingTasks} 件`, pendingTasks > 0 ? COLOR_WARNING : TEXT_BODY),
        statRow("待簽核",   `${pendingApprovals} 件`, pendingApprovals > 0 ? COLOR_DANGER : TEXT_BODY),
        ...(pendingCover > 0 ? [statRow("代班邀請", `${pendingCover} 件`, COLOR_WARNING)] : []),
        { type: "separator", margin: "md" },
        statRow("今日班別", todayShift, TEXT_BODY),
        statRow("打卡",     clockText, clockColor),
      ],
    },
    ...(buttons.length > 0 ? {
      footer: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px",
        contents: buttons,
      },
    } : {}),
  };
}
