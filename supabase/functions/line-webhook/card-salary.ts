// ── Salary preview card with PIN unlock (P3) ─────────────────────────────────
// 「薪水」指令觸發：
//   1. 還沒設 PIN → 顯示空殼卡 + [🔧 設定密碼]
//   2. 已設 PIN → 顯示 masked 摘要 + [🔓 輸入密碼解鎖]
// 解鎖後 push 完整薪資卡（金額全公開）

import type { SupabaseClient } from './types.ts';
import {
  COLOR_GOLD, COLOR_PRIMARY, COLOR_SUCCESS, COLOR_INFO,
  TEXT_ON_COLOR, TEXT_DIM_GOLD, TEXT_TITLE, TEXT_BODY, TEXT_SECONDARY, TEXT_LABEL,
} from './colors.ts';
import { flexResultErr, flexResultOk } from './flex-builders.ts';

function liffUri(liffId: string, path: string): string {
  return `https://liff.line.me/${liffId.trim()}?to=${encodeURIComponent(path)}`;
}

function fmtMoney(v: any): string {
  if (v == null) return "$ —";
  const n = Number(v);
  if (!Number.isFinite(n)) return "$ —";
  return `$ ${n.toLocaleString("zh-TW")}`;
}

function row(label: string, value: string, opts?: { valueColor?: string; bold?: boolean }) {
  return {
    type: "box", layout: "horizontal", spacing: "sm", margin: "xs",
    contents: [
      { type: "text", text: label, color: TEXT_LABEL, size: "xs", flex: 4 },
      { type: "text", text: value, color: opts?.valueColor ?? TEXT_BODY, size: "xs", flex: 5, weight: opts?.bold ? "bold" : "regular", align: "end" },
    ],
  };
}

// ── Brief card (no PIN required) ─────────────────────────────────────────────

export async function buildSalaryBriefMessage(db: SupabaseClient, lineUserId: string, liffId: string): Promise<object> {
  const { data, error } = await db.rpc("liff_card_my_salary_brief", { p_line_user_id: lineUserId });
  if (error) return flexResultErr({ title: "讀取薪資失敗", lines: [error.message] });

  const r = data as any;
  if (!r?.ok) {
    const msg: Record<string, string> = { "EMPLOYEE_NOT_FOUND": "你的 LINE 還沒綁員工，請先 /註冊 姓名" };
    return flexResultErr({ title: "讀不到薪資", lines: [msg[r?.error] ?? r?.error ?? "未知錯誤"] });
  }

  const empName = r.employee_name ?? "";
  const hasPin = !!r.has_pin;
  const hasRecord = !!r.has_record;

  // ── Header ──
  const header = {
    type: "box", layout: "vertical", paddingAll: "16px", backgroundColor: COLOR_GOLD,
    contents: [
      { type: "text", text: "💰 我的薪資", color: TEXT_ON_COLOR, weight: "bold", size: "lg" },
      { type: "text", text: empName ? `${empName}` : "", color: TEXT_DIM_GOLD, size: "xs", margin: "xs" },
    ],
  };

  // ── Body ──
  const body: any[] = [];

  if (!hasRecord) {
    body.push({ type: "text", text: "尚無薪資記錄", color: TEXT_LABEL, size: "sm", align: "center", margin: "md" });
  } else {
    body.push(row("月份", r.month ?? "—", { bold: true }));
    body.push({ type: "separator", margin: "md" });
    if (hasPin) {
      body.push(row("實發 (隱藏)", r.net_salary_masked ?? "$ ***", { valueColor: COLOR_GOLD, bold: true }));
      body.push({
        type: "text", text: "🔒 完整明細需密碼解鎖", color: TEXT_SECONDARY, size: "xxs", align: "center", margin: "md", wrap: true,
      });
    } else {
      body.push({
        type: "text", text: "尚未設定密碼，請先設 4-6 位數字密碼", color: COLOR_INFO, size: "xs", align: "center", margin: "md", wrap: true,
      });
    }
  }

  // ── Footer ──
  const footer: any[] = [];
  if (hasPin && hasRecord) {
    footer.push({
      type: "button",
      action: { type: "postback", label: "🔓 輸入密碼解鎖", data: "action=unlock&type=salary" },
      style: "primary", color: COLOR_GOLD, height: "sm",
    });
  }
  if (!hasPin) {
    footer.push({
      type: "button",
      action: { type: "postback", label: "🔧 設定密碼", data: "action=setup&type=salary" },
      style: "primary", color: COLOR_PRIMARY, height: "sm",
    });
  }
  if (liffId) {
    footer.push({
      type: "button",
      action: { type: "uri", label: "📊 歷史薪資 (LIFF)", uri: liffUri(liffId, "/salary") },
      style: "secondary", height: "sm",
    });
  }

  return {
    type: "flex",
    altText: `💰 ${empName} 薪資`,  // 故意不寫金額，避免 LINE 通知預覽外洩
    contents: {
      type: "bubble",
      size: "kilo",
      header,
      body: { type: "box", layout: "vertical", paddingAll: "14px", contents: body },
      footer: { type: "box", layout: "vertical", paddingAll: "12px", spacing: "sm", contents: footer },
    },
  };
}

// ── Full salary card (after PIN unlock) ──────────────────────────────────────

export function buildSalaryFullMessage(r: any): object {
  const empName = r.employee_name ?? "";

  if (!r.has_record) {
    return flexResultErr({ title: "尚無薪資記錄", lines: [`${empName} 還沒有任何薪資記錄`] });
  }

  // 計算各區塊總和
  const allowanceTotal = Number(r.role_allowance ?? 0) + Number(r.meal_allowance ?? 0)
    + Number(r.transport_allowance ?? 0) + Number(r.attendance_bonus ?? 0) + Number(r.allowance_legacy ?? 0);
  const otherEarnings = Number(r.overtime_pay ?? 0) + Number(r.bonus ?? 0);
  const deductionTotal = Number(r.absence_deduction ?? 0) + Number(r.late_deduction ?? 0)
    + Number(r.other_deduction ?? 0) + Number(r.deductions_legacy ?? 0);
  const insurance = Number(r.insurance ?? 0);

  const body: any[] = [
    row("月份", r.month ?? "—", { bold: true }),
    { type: "separator", margin: "md" },

    // 收入區
    { type: "text", text: "💵 收入", size: "xxs", color: TEXT_LABEL, weight: "bold", margin: "md" },
    row("基本薪資", fmtMoney(r.base_salary)),
    ...(allowanceTotal > 0 ? [row("津貼合計", fmtMoney(allowanceTotal))] : []),
    ...(Number(r.overtime_pay ?? 0) > 0 ? [row("加班費", fmtMoney(r.overtime_pay))] : []),
    ...(Number(r.bonus ?? 0) > 0 ? [row("獎金", fmtMoney(r.bonus))] : []),

    // 扣款區
    ...(deductionTotal > 0 || insurance > 0 ? [
      { type: "separator", margin: "md" },
      { type: "text", text: "🔻 扣款", size: "xxs", color: TEXT_LABEL, weight: "bold", margin: "md" },
      ...(insurance > 0 ? [row("勞健保", `- ${fmtMoney(insurance).slice(2)}`)] : []),
      ...(Number(r.absence_deduction ?? 0) > 0 ? [row("事假扣薪", `- ${fmtMoney(r.absence_deduction).slice(2)}`)] : []),
      ...(Number(r.late_deduction ?? 0) > 0 ? [row("遲到扣薪", `- ${fmtMoney(r.late_deduction).slice(2)}`)] : []),
      ...(Number(r.other_deduction ?? 0) > 0 ? [row(r.other_deduction_note || "其他扣款", `- ${fmtMoney(r.other_deduction).slice(2)}`)] : []),
    ] : []),

    // 實發
    { type: "separator", margin: "md" },
    {
      type: "box", layout: "horizontal", spacing: "sm", margin: "md", paddingAll: "10px",
      backgroundColor: "#FFFBEB", cornerRadius: "8px",
      contents: [
        { type: "text", text: "✅ 實發", color: COLOR_GOLD, size: "sm", flex: 4, weight: "bold" },
        { type: "text", text: fmtMoney(r.net_salary), color: COLOR_GOLD, size: "lg", flex: 5, weight: "bold", align: "end" },
      ],
    },
  ];

  return {
    type: "flex",
    altText: `💰 ${empName} ${r.month ?? ""} 薪資明細`,
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box", layout: "vertical", paddingAll: "14px", backgroundColor: COLOR_GOLD,
        contents: [
          { type: "text", text: "💰 薪資明細", color: TEXT_ON_COLOR, weight: "bold", size: "lg" },
          { type: "text", text: `${empName} · ${r.month ?? ""}`, color: TEXT_DIM_GOLD, size: "xs", margin: "xs" },
        ],
      },
      body: { type: "box", layout: "vertical", paddingAll: "14px", contents: body },
    },
  };
}
