// ── Postback handlers for approval cards (P0) ────────────────────────────────
// Action keys:
//   approve:request   → 直接核准（postback data: rt=<type>&id=<id>）
//   reject:request    → 進入 pending → 等使用者打駁回原因
//   resend:request    → 重發此卡（提醒）
//
// 全部 7 種類型共用：rt 欄位指定 (leave|overtime|trip|expense|expense_request|correction|cover|off_request)

import { registerPostback, setPending, type PostbackHandler } from './postback-handlers.ts';
import { flexResultOk, flexResultErr } from './flex-builders.ts';
import { buildApprovalCardMessage } from './card-approval.ts';
import { COLOR_DANGER, COLOR_SUCCESS, REQUEST_TYPE_COLORS } from './colors.ts';
import type { ApprovalRequestType } from './types.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseRequestType(s: string | undefined): ApprovalRequestType | null {
  const valid: ApprovalRequestType[] = [
    "leave", "overtime", "trip", "expense", "expense_request",
    "correction", "cover", "off_request",
  ];
  return (valid as string[]).includes(s ?? "") ? (s as ApprovalRequestType) : null;
}

// ── Handler: approve ─────────────────────────────────────────────────────────

const handleApprove: PostbackHandler = async (params, ctx) => {
  const rt = parseRequestType(params.rt);
  const id = Number(params.id);

  if (!rt || !id) {
    return [flexResultErr({ title: "無效的操作參數", lines: ["缺少類型或單號"] })];
  }

  const palette = REQUEST_TYPE_COLORS[rt];

  // 呼叫既有的 liff_approve_request RPC（已支援 7 種類型 + 多租戶 + chain step）
  const { data, error } = await ctx.db.rpc("liff_approve_request", {
    p_line_user_id: ctx.userId,
    p_type: rt,
    p_id: id,
    p_action: "approve",
    p_reason: null,
  });

  if (error) {
    return [flexResultErr({
      title: "核准失敗",
      lines: ["DB 錯誤：" + error.message, "請聯絡管理員。"],
    })];
  }

  const result = data as { ok?: boolean; error?: string; status?: string; applicant?: string } | null;
  if (!result?.ok) {
    const errorMap: Record<string, string> = {
      "EMPLOYEE_NOT_FOUND":             "找不到你的員工檔，請先綁定 LINE 帳號。",
      "INVALID_ACTION":                 "操作參數錯誤。",
      "REASON_REQUIRED":                "駁回需要原因。",
      "NOT_FOUND_OR_ALREADY_PROCESSED": "此申請單不存在或已被處理。",
      "APPLICANT_NOT_FOUND":            "找不到申請人資料。",
      "ORG_MISMATCH":                   "你不屬於此申請人的組織。",
      "NOT_YOUR_TURN":                  "目前不輪到你簽核這張單。",
    };
    return [flexResultErr({
      title: "無法核准",
      lines: [errorMap[result?.error ?? ""] ?? result?.error ?? "未知錯誤"],
    })];
  }

  return [flexResultOk({
    title: `已核准 ${palette.label}`,
    chip: `#${id}`,
    lines: [
      `申請人：${result.applicant ?? "—"}`,
      `狀態：${result.status ?? "已核准"}`,
      "✅ 已通知申請人 + 下一關簽核者（若有）",
    ],
  })];
};

// ── Handler: reject (set pending → ask reason) ────────────────────────────────

const handleReject: PostbackHandler = async (params, ctx) => {
  const rt = parseRequestType(params.rt);
  const id = Number(params.id);

  if (!rt || !id) {
    return [flexResultErr({ title: "無效的操作參數", lines: ["缺少類型或單號"] })];
  }

  const palette = REQUEST_TYPE_COLORS[rt];

  // 先確認該單仍在「待審核」/「申請中」（避免使用者按到舊卡）
  const tableMap: Record<ApprovalRequestType, string> = {
    leave: "leave_requests", overtime: "overtime_requests", trip: "business_trips",
    expense: "expenses", expense_request: "expense_requests",
    correction: "clock_corrections", cover: "shift_cover_requests",
    off_request: "off_requests",
  };
  const { data: rec } = await ctx.db.from(tableMap[rt]).select("status, employee").eq("id", id).maybeSingle();
  if (!rec) {
    return [flexResultErr({ title: "找不到申請單", lines: [`#${id} 可能已被刪除`] })];
  }
  if (rec.status !== "待審核" && rec.status !== "申請中") {
    return [flexResultErr({
      title: "此單已處理過",
      lines: [`目前狀態：${rec.status}`, "如需重新審核請聯絡 HR / 管理員。"],
    })];
  }

  // 寫 pending action — 下一段使用者打的文字會被當駁回原因
  await setPending(ctx.db, ctx.userId, {
    action: "approval_reject_reason",
    request_type: rt,
    request_id: id,
    title: `${rec.employee ?? "員工"}的${palette.label}`,
  });

  // 提示卡：請輸入駁回原因
  return [{
    type: "flex",
    altText: `❌ 請輸入駁回 ${palette.label} 的原因`,
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box", layout: "vertical", paddingAll: "14px", backgroundColor: COLOR_DANGER,
        contents: [
          { type: "text", text: `❌ 駁回 ${palette.label}`, color: "#FFFFFF", weight: "bold", size: "md" },
          { type: "text", text: `#${id} ${rec.employee ?? ""}`, color: "#FECACA", size: "xs", margin: "xs" },
        ],
      },
      body: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px",
        contents: [
          { type: "text", text: "請直接輸入駁回原因（會通知申請人）", size: "sm", color: "#333333", wrap: true },
          { type: "text", text: "範例：「需要附上醫師診斷書」、「請改成下週三」", size: "xxs", color: "#9CA3AF", margin: "sm", wrap: true },
        ],
      },
      footer: {
        type: "box", layout: "vertical", paddingAll: "10px",
        contents: [{
          type: "button", style: "secondary", height: "sm",
          action: { type: "postback", label: "取消駁回", data: `action=cancel&type=request&rt=${rt}&id=${id}`, displayText: "已取消駁回" },
        }],
      },
    },
  }];
};

// ── Handler: cancel (clear pending) ──────────────────────────────────────────

const handleCancel: PostbackHandler = async (_params, ctx) => {
  await ctx.db.from("line_users").update({ pending_action: null }).eq("line_user_id", ctx.userId);
  return [flexResultOk({ title: "已取消", lines: ["駁回流程已中止，此單仍維持原狀。"] })];
};

// ── Handler: resend ──────────────────────────────────────────────────────────
// 重新顯示申請卡（用於前一張卡片過期）

const handleResend: PostbackHandler = async (params, ctx) => {
  const rt = parseRequestType(params.rt);
  const id = Number(params.id);
  if (!rt || !id) {
    return [flexResultErr({ title: "無效的操作參數" })];
  }
  const card = await buildApprovalCardMessage(ctx.db, rt, id, ctx.liffIds.task || ctx.liffIds.dashboard);
  return [card];
};

// ── Register ─────────────────────────────────────────────────────────────────

registerPostback("approve", "request", handleApprove);
registerPostback("reject",  "request", handleReject);
registerPostback("cancel",  "request", handleCancel);
registerPostback("resend",  "request", handleResend);
