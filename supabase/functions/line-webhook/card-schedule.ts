// ── Schedule preview card (P2) ───────────────────────────────────────────────
// 「班表」指令觸發：抓 7 天 + 月工時 + 希望休 + 代班，組成單張 flex bubble。
// 沒排班的日期顯示「休」；今天反白；點按鈕走 LIFF 看月曆 / 申請希望休 / 看代班邀請。

import type { SupabaseClient } from './types.ts';
import {
  COLOR_ATTENDANCE, COLOR_SUCCESS, COLOR_DANGER, COLOR_WARNING,
  TEXT_ON_COLOR, TEXT_DIM_ATTENDANCE, TEXT_TITLE, TEXT_BODY, TEXT_SECONDARY, TEXT_LABEL, TEXT_MUTED,
  BG_DIM_PRIMARY,
} from './colors.ts';
import { flexResultErr } from './flex-builders.ts';

function liffUri(liffId: string, path: string): string {
  return `https://liff.line.me/${liffId.trim()}?to=${encodeURIComponent(path)}`;
}

function fmtMonthDay(dateStr: string): string {
  // 'YYYY-MM-DD' → 'M/D'
  const parts = dateStr.split("-");
  return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
}

export async function buildScheduleBriefMessage(db: SupabaseClient, lineUserId: string, liffId: string): Promise<object> {
  const { data, error } = await db.rpc("liff_card_my_schedule_brief", { p_line_user_id: lineUserId });

  if (error) {
    return flexResultErr({ title: "讀取班表失敗", lines: [error.message] });
  }
  const r = data as any;
  if (!r?.ok) {
    const msg: Record<string, string> = {
      "EMPLOYEE_NOT_FOUND": "你的 LINE 還沒綁員工，請先 /註冊 姓名",
    };
    return flexResultErr({ title: "讀不到班表", lines: [msg[r?.error] ?? r?.error ?? "未知錯誤"] });
  }

  const week: any[] = r.week ?? [];
  const empName = r.employee?.name ?? "";
  const monthHours = Number(r.month_hours ?? 0);
  const offCount = r.off_request_count ?? 0;
  const pendingCover = r.pending_cover_invites ?? 0;

  // ── Body：7 天列表 ──
  const dayRows = week.map((d: any) => {
    const dateLabel = `${d.weekday} ${fmtMonthDay(d.date)}`;
    const isToday = d.is_today;
    const labelColor = isToday ? TEXT_ON_COLOR : (d.is_weekend ? TEXT_SECONDARY : TEXT_BODY);

    let shiftLabel = "—";
    let shiftColor = TEXT_MUTED;
    if (d.absence_type) {
      shiftLabel = d.absence_type;
      shiftColor = COLOR_WARNING;
    } else if (d.shift) {
      const time = (d.actual_start && d.actual_end) ? `${d.actual_start}-${d.actual_end}` : "";
      shiftLabel = time ? `${d.shift} ${time}` : d.shift;
      shiftColor = isToday ? TEXT_ON_COLOR : TEXT_BODY;
    } else {
      shiftLabel = "休";
      shiftColor = isToday ? TEXT_ON_COLOR : TEXT_LABEL;
    }

    return {
      type: "box", layout: "horizontal", spacing: "sm", paddingAll: "6px",
      margin: "xs",
      ...(isToday ? { backgroundColor: COLOR_ATTENDANCE, cornerRadius: "6px" } : {}),
      contents: [
        { type: "text", text: dateLabel, color: labelColor, size: "sm", weight: isToday ? "bold" : "regular", flex: 3 },
        { type: "text", text: shiftLabel, color: shiftColor, size: "sm", weight: isToday ? "bold" : "bold", flex: 6, wrap: true },
      ],
    };
  });

  // ── Footer：summary stats ──
  const summaryLines: any[] = [
    { type: "separator", margin: "md" },
    {
      type: "box", layout: "horizontal", spacing: "sm", margin: "md",
      contents: [
        { type: "text", text: "本月工時", color: TEXT_LABEL, size: "xs", flex: 3 },
        { type: "text", text: `${monthHours} 小時`, color: TEXT_BODY, size: "xs", flex: 5, weight: "bold" },
      ],
    },
    {
      type: "box", layout: "horizontal", spacing: "sm", margin: "xs",
      contents: [
        { type: "text", text: "本月希望休", color: TEXT_LABEL, size: "xs", flex: 3 },
        { type: "text", text: `${offCount} 天`, color: TEXT_BODY, size: "xs", flex: 5, weight: "bold" },
      ],
    },
  ];

  if (pendingCover > 0) {
    summaryLines.push({
      type: "box", layout: "horizontal", spacing: "sm", margin: "xs", paddingAll: "8px",
      backgroundColor: "#FFF7ED", cornerRadius: "6px",
      contents: [
        { type: "text", text: "⚠️", size: "sm", flex: 0 },
        { type: "text", text: `有 ${pendingCover} 筆代班邀請待回應`, color: COLOR_WARNING, size: "xs", flex: 5, weight: "bold", wrap: true },
      ],
    });
  }

  // ── Footer buttons ──
  const buttons: any[] = [];
  if (liffId) {
    buttons.push({
      type: "button",
      action: { type: "uri", label: "📅 看完整月曆", uri: liffUri(liffId, "/my-schedule") },
      style: "primary", color: COLOR_ATTENDANCE, height: "sm",
    });
    buttons.push({
      type: "box", layout: "horizontal", spacing: "sm",
      contents: [
        { type: "button", flex: 1, action: { type: "uri", label: "✏️ 希望休", uri: liffUri(liffId, "/off-request") }, style: "secondary", height: "sm" },
        ...(pendingCover > 0
          ? [{ type: "button", flex: 1, action: { type: "uri", label: "🔄 看代班", uri: liffUri(liffId, "/cover-invitations") }, style: "secondary", height: "sm" }]
          : []),
      ],
    });
  }

  return {
    type: "flex",
    altText: `📅 ${empName} 本週班表`,
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box", layout: "vertical", paddingAll: "14px", backgroundColor: COLOR_ATTENDANCE,
        contents: [
          { type: "text", text: "📅 我的班表", color: TEXT_ON_COLOR, weight: "bold", size: "lg" },
          { type: "text", text: `${empName}　本週 7 天`, color: TEXT_DIM_ATTENDANCE, size: "xs", margin: "xs" },
        ],
      },
      body: {
        type: "box", layout: "vertical", spacing: "none", paddingAll: "12px",
        contents: [...dayRows, ...summaryLines],
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px",
        contents: buttons,
      },
    },
  };
}
