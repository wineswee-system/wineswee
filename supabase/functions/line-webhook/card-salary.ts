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
  const usingDefault = !!r.using_default_pin;
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
    body.push(row("實發 (隱藏)", r.net_salary_masked ?? "$ ***", { valueColor: COLOR_GOLD, bold: true }));
    if (usingDefault) {
      body.push({
        type: "text", text: "🔒 預設密碼為身分證後 4 碼", color: COLOR_INFO, size: "xxs", align: "center", margin: "md", wrap: true,
      });
    } else {
      body.push({
        type: "text", text: "🔒 完整明細需密碼解鎖", color: TEXT_SECONDARY, size: "xxs", align: "center", margin: "md", wrap: true,
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
  if (hasPin && !usingDefault && hasRecord) {
    footer.push({
      type: "button",
      action: { type: "postback", label: "🔑 忘記密碼（重設為預設）", data: "action=reset&type=salary" },
      style: "secondary", height: "sm",
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

// 薪資袋配色(Flex 需具體色碼,不可用 CSS 變數)
const COLOR_ADD = "#16a34a";   // 加項 綠
const COLOR_DED = "#dc2626";   // 減項 紅

export function buildSalaryFullMessage(r: any): object {
  const empName = r.employee_name ?? "";

  if (!r.has_record) {
    return flexResultErr({ title: "尚無薪資記錄", lines: [`${empName} 還沒有任何薪資記錄`] });
  }

  // ── 對齊薪資袋:本薪 → 加項 → 減項 → 實領;金額讀存的發布版,殘差吸收讓加得回實領 ──
  const N = (v: any): number => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
  const net  = Math.round(N(r.net_salary));
  const base = Math.round(N(r.base_salary));

  // 加項
  const add: Array<[string, number]> = [];
  const pA = (l: string, v: any) => { if (N(v) > 0) add.push([l, Math.round(N(v))]); };
  pA("主管加給", r.role_allowance);
  pA("伙食津貼", r.meal_allowance);
  pA("交通津貼", r.transport_allowance);
  // allowance_legacy 是津貼合計欄:只有沒逐項時才用,避免重複計
  if (N(r.role_allowance) + N(r.meal_allowance) + N(r.transport_allowance) === 0) pA("津貼", r.allowance_legacy);
  pA("加班費", r.overtime_pay);
  pA("全勤獎金", r.attendance_bonus);
  pA("獎金", r.bonus);

  // 減項
  const ded: Array<[string, number]> = [];
  const pD = (l: string, v: any) => { if (N(v) > 0) ded.push([l, Math.round(N(v))]); };
  pD("勞健保自付", r.insurance);
  pD("無薪假", r.absence_deduction);
  pD("遲到", r.late_deduction);
  pD(r.other_deduction_note || "其他扣款", r.other_deduction);

  // 殘差吸收(讓「本薪+加項−減項 = 實領」;粗欄位算不齊的差額歸其他)
  const gap = net - (base + add.reduce((s, [, v]) => s + v, 0) - ded.reduce((s, [, v]) => s + v, 0));
  if (gap > 1) add.push(["其他加項", gap]);
  else if (gap < -1) ded.push(["其他扣款", -gap]);
  const addTotal = add.reduce((s, [, v]) => s + v, 0);
  const dedTotal = ded.reduce((s, [, v]) => s + v, 0);

  const body: any[] = [
    row("月份", r.month ?? "—", { bold: true }),
    { type: "separator", margin: "md" },

    // 本薪
    row("本薪", fmtMoney(base), { bold: true }),

    // ＋ 加項
    ...(add.length ? [
      { type: "text", text: `＋ 加項  +${fmtMoney(addTotal).slice(2)}`, size: "xs", color: COLOR_ADD, weight: "bold", margin: "md" },
      ...add.map(([l, v]) => row(l, `+ ${fmtMoney(v).slice(2)}`, { valueColor: COLOR_ADD })),
    ] : []),

    // － 減項
    ...(ded.length ? [
      { type: "text", text: `－ 減項  -${fmtMoney(dedTotal).slice(2)}`, size: "xs", color: COLOR_DED, weight: "bold", margin: "md" },
      ...ded.map(([l, v]) => row(l, `- ${fmtMoney(v).slice(2)}`, { valueColor: COLOR_DED })),
    ] : []),

    // ＝ 實領
    { type: "separator", margin: "md" },
    {
      type: "box", layout: "horizontal", spacing: "sm", margin: "md", paddingAll: "10px",
      backgroundColor: "#FFFBEB", cornerRadius: "8px",
      contents: [
        { type: "text", text: "＝ 實領", color: COLOR_GOLD, size: "sm", flex: 4, weight: "bold" },
        { type: "text", text: fmtMoney(net), color: COLOR_GOLD, size: "lg", flex: 5, weight: "bold", align: "end" },
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
