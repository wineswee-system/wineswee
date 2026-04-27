// ── Postback handlers for approval cards (P0) ────────────────────────────────
// Action keys:
//   approve:request   → 直接核准（postback data: rt=<type>&id=<id>）
//   reject:request    → 進入 pending → 等使用者打駁回原因
//   resend:request    → 重發此卡（提醒）
//
// 全部 7 種類型共用：rt 欄位指定 (leave|overtime|trip|expense|expense_request|correction|cover|off_request)

import { registerPostback, setPending, clearPending, type PostbackHandler } from './postback-handlers.ts';
import { flexResultOk, flexResultErr } from './flex-builders.ts';
import { buildApprovalCardMessage } from './card-approval.ts';
import { COLOR_DANGER, COLOR_SUCCESS, REQUEST_TYPE_COLORS } from './colors.ts';
import type { ApprovalRequestType } from './types.ts';

// 純文字訊息（單行）— 用於替代大張結果卡，減少版面浪費
function txt(s: string) { return { type: "text", text: s }; }

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
    return [txt("⚠️ 操作參數有誤")];
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

  if (error) return [txt(`❌ 核准失敗：${error.message}`)];

  const result = data as { ok?: boolean; error?: string; status?: string; applicant?: string } | null;
  if (!result?.ok) {
    const errorMap: Record<string, string> = {
      "EMPLOYEE_NOT_FOUND":             "你的 LINE 還沒綁員工，請先 /註冊 姓名",
      "INVALID_ACTION":                 "操作參數錯誤",
      "REASON_REQUIRED":                "駁回需要原因",
      "NOT_FOUND_OR_ALREADY_PROCESSED": "此單不存在或已被處理",
      "APPLICANT_NOT_FOUND":            "找不到申請人資料",
      "ORG_MISMATCH":                   "跨組織不能簽核",
      "NOT_YOUR_TURN":                  "不輪到你簽核",
    };
    return [txt(`❌ ${errorMap[result?.error ?? ""] ?? result?.error ?? "核准失敗"}`)];
  }

  // 成功：單行文字（含申請人 + 類型 + 狀態 + 單號）
  const status = result.status ?? "已核准";
  return [txt(`✅ ${result.applicant ?? "申請人"} 的${palette.label}已${status === "已核銷" ? "核銷" : "核准"}（#${id}）`)];
};

// ── Handler: reject (set pending → ask reason) ────────────────────────────────

const handleReject: PostbackHandler = async (params, ctx) => {
  const rt = parseRequestType(params.rt);
  const id = Number(params.id);

  if (!rt || !id) return [txt("⚠️ 操作參數有誤")];

  const palette = REQUEST_TYPE_COLORS[rt];

  // 先確認該單仍在「待審核」/「申請中」（避免使用者按到舊卡）
  const tableMap: Record<ApprovalRequestType, string> = {
    leave: "leave_requests", overtime: "overtime_requests", trip: "business_trips",
    expense: "expenses", expense_request: "expense_requests",
    correction: "clock_corrections", cover: "shift_cover_requests",
    off_request: "off_requests",
  };
  const { data: rec } = await ctx.db.from(tableMap[rt]).select("status, employee").eq("id", id).maybeSingle();
  if (!rec) return [txt(`❌ 找不到 #${id}（可能已刪除）`)];
  if (rec.status !== "待審核" && rec.status !== "申請中") {
    return [txt(`⚠️ 此單已是「${rec.status}」狀態，不能再駁回`)];
  }

  // 寫 pending action — 下一段使用者打的文字會被當駁回原因
  await setPending(ctx, {
    action: "approval_reject_reason",
    request_type: rt,
    request_id: id,
    title: `${rec.employee ?? "員工"}的${palette.label}`,
  });

  // 提示：請輸入駁回原因（用最小化文字 + quick reply 取消）
  const promptText = `❌ 駁回 ${rec.employee ?? "員工"} 的${palette.label}（#${id}）\n請直接輸入駁回原因，或按下方取消。`;
  return [{
    type: "text",
    text: promptText,
    quickReply: {
      items: [{
        type: "action",
        action: { type: "postback", label: "取消駁回", data: `action=cancel&type=request&rt=${rt}&id=${id}` },
      }],
    },
  }];
};

// ── Handler: cancel (clear pending) ──────────────────────────────────────────

const handleCancel: PostbackHandler = async (_params, ctx) => {
  await clearPending(ctx);
  return [txt("已取消駁回，此單維持原狀。")];
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
