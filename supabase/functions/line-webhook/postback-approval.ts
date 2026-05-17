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
    "leave", "overtime", "trip", "expense", "expense_request", "expense_settle",
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

  // 呼叫對應 RPC：off_request 走 liff_approve_off_request，其他走 liff_approve_request
  let data: any, error: any;
  if (rt === "off_request") {
    ({ data, error } = await ctx.db.rpc("liff_approve_off_request", {
      p_line_user_id: ctx.userId, p_id: id, p_action: "approve", p_reason: null,
    }));
  } else {
    ({ data, error } = await ctx.db.rpc("liff_approve_request", {
      p_line_user_id: ctx.userId, p_type: rt, p_id: id, p_action: "approve", p_reason: null,
    }));
  }

  if (error) return [txt(`❌ 核准失敗：${error.message}`)];

  const result = data as {
    ok?: boolean; error?: string; status?: string; applicant?: any; event?: string;
    next_approvers?: Array<{ emp_id: number; name?: string }>;
    applicant_emp_id?: number; date?: string;  // off_request 用
  } | null;
  if (!result?.ok) {
    const errorMap: Record<string, string> = {
      "EMPLOYEE_NOT_FOUND":             "你的 LINE 還沒綁員工，請先 /註冊 姓名",
      "INVALID_ACTION":                 "操作參數錯誤",
      "REASON_REQUIRED":                "駁回需要原因",
      "NOT_FOUND_OR_ALREADY_PROCESSED": "此單不存在或已被處理",
      "ALREADY_PROCESSED":              "此單已被處理",
      "NOT_FOUND":                      "找不到此申請單",
      "APPLICANT_NOT_FOUND":            "找不到申請人資料",
      "ORG_MISMATCH":                   "跨組織不能簽核",
      "NOT_YOUR_TURN":                  "不輪到你簽核",
    };
    return [txt(`❌ ${errorMap[result?.error ?? ""] ?? result?.error ?? "核准失敗"}`)];
  }

  // ★ 2026-05-08：next-step LINE 推送已搬到 DB trigger
  // (migration 20260508110000_expense_request_chain_db_trigger.sql)
  // 這裡不再呼 pushCardToApprovers，避免雙推。
  // expense_request_step_advance RPC update current_step → AFTER UPDATE trigger 會推下一關。

  // 成功：單行文字
  const status = result.status ?? "已核准";
  const applicantName = typeof result.applicant === "string" ? result.applicant : (result.applicant?.name ?? "申請人");
  const nextHint = (result.event === "advanced" && (result.next_approvers?.length ?? 0) > 0)
    ? `（已推給下關 ${result.next_approvers!.length} 位簽核者）` : "";

  if (rt === "off_request") {
    return [txt(`✅ ${result.date ?? ""} 的希望休已核准（#${id}）`)];
  }
  return [txt(`✅ ${applicantName} 的${palette.label}已${status === "已核銷" ? "核銷" : "核准"}（#${id}）${nextHint}`)];
};

// ── Push helper: notify next approvers with rich card ────────────────────────
// 用 line-push Edge Function 處理 token / channel 解析，自己這裡不重複那段邏輯。

async function pushCardToApprovers(
  ctx: PostbackContext,
  rt: ApprovalRequestType,
  requestId: number,
  approvers: Array<{ emp_id: number; name?: string }>,
): Promise<void> {
  const liffId = (ctx.liffIds.task || ctx.liffIds.newTask || ctx.liffIds.dashboard || "").trim();
  let card: object | null = null;
  try {
    card = await buildApprovalCardMessage(ctx.db, rt, requestId, liffId);
  } catch (err) {
    console.warn(`[postback-approval] buildApprovalCardMessage failed for ${rt}/${requestId}`, err);
    return;
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return;

  for (const ap of approvers) {
    if (!ap?.emp_id) continue;
    try {
      const { data: target } = await ctx.db.rpc("liff_resolve_line_target", { p_emp_id: ap.emp_id });
      const lineUserId = (target as any)?.line_user_id;
      if (!lineUserId) continue;

      await fetch(`${supabaseUrl}/functions/v1/line-push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ to: lineUserId, messages: [card] }),
      });
    } catch (err) {
      console.warn(`[postback-approval] push to approver ${ap.emp_id} failed`, err);
    }
  }
}

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
    expense_settle: "expense_requests",
    correction: "clock_corrections", cover: "shift_cover_requests",
    off_request: "off_requests",
  };
  const { data: rec } = await ctx.db.from(tableMap[rt]).select("status, employee").eq("id", id).maybeSingle();
  if (!rec) return [txt(`❌ 找不到 #${id}（可能已刪除）`)];
  // expense_settle 期待狀態是「待核銷」；其他類型是「待審核/申請中」
  const validStatus = rt === "expense_settle"
    ? rec.status === "待核銷"
    : (rec.status === "待審核" || rec.status === "申請中");
  if (!validStatus) {
    return [txt(`⚠️ 此單已是「${rec.status}」狀態，不能再駁回`)];
  }

  // 寫 pending action — 下一段使用者打的文字會被當駁回原因
  await setPending(ctx, {
    action: "approval_reject_reason",
    request_type: rt,
    request_id: id,
    title: `${rec.employee ?? "員工"}的${palette.label}`,
  });

  // 提示：4 個常用按鈕 (一鍵送) + 自己寫 (跳 LIFF popup) + 取消
  const applicantName = rec.employee ?? "員工";
  const promptText =
    `❌ 你正在駁回「${applicantName}」的${palette.label}（#${id}）\n\n` +
    `下方選常用原因（一鍵送出）\n` +
    `或按 [✏️ 自己寫] 開啟視窗輸入`;

  const quickReasons: Array<{ label: string; reason: string }> = [
    { label: "需附證明", reason: "需附證明文件" },
    { label: "日期改其他天", reason: "請改其他日期" },
    { label: "工時不允許", reason: "當天工時不允許" },
    { label: "再溝通", reason: "請先跟主管討論" },
  ];

  // 跳 LIFF popup 的 URI（帶 type / id / applicant 給頁面預填）
  const liffId = (ctx.liffIds.task || ctx.liffIds.newTask || ctx.liffIds.dashboard || "").trim();
  const liffWriteAction = liffId
    ? {
        type: "uri",
        label: "✏️ 自己寫",
        uri: `https://liff.line.me/${liffId}?to=${encodeURIComponent("/reject-reason")}&type=${rt}&id=${id}&applicant=${encodeURIComponent(applicantName)}`,
      }
    : null;

  return [{
    type: "text",
    text: promptText,
    quickReply: {
      items: [
        ...quickReasons.map(q => ({
          type: "action",
          action: { type: "message", label: q.label, text: q.reason },
        })),
        ...(liffWriteAction ? [{ type: "action", action: liffWriteAction }] : []),
        {
          type: "action",
          action: { type: "postback", label: "取消駁回", data: `action=cancel&type=request&rt=${rt}&id=${id}` },
        },
      ],
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

// ── Handler: 加簽核准（P3d） ──────────────────────────────────────────────────
// postback data: action=approve&type=extra&extra_id=X
// 加簽人 LINE 卡按「✅ 核准加簽」→ 直接通過，不用進 LIFF
//
// 加簽退回需要填原因 → 不做 postback，使用者按「📋 查看 / 退回」進 LIFF 填寫
// 撤銷加簽 → 從 Web/LIFF UI 觸發，不從 LINE 卡上做
const handleApproveExtra: PostbackHandler = async (params, ctx) => {
  const extraId = Number(params.extra_id);
  if (!extraId) {
    return [txt("⚠️ 加簽參數有誤")];
  }

  // 解 line user → employee_id
  if (!ctx.lineUser?.employee_id) {
    return [txt("❌ 你的 LINE 還沒綁員工，請先 /註冊 姓名")];
  }
  const empId = ctx.lineUser.employee_id;

  const { data, error } = await ctx.db.rpc("process_extra_signer", {
    p_extra_step_id: extraId,
    p_processor_id: empId,
    p_action: "approve",
    p_reject_reason: null,
  });

  if (error) {
    // PostgreSQL RAISE EXCEPTION 訊息可能含中文錯誤
    const msg = error.message ?? "核准失敗";
    if (msg.includes("加簽紀錄不存在")) return [txt("❌ 加簽紀錄不存在或已被處理")];
    if (msg.includes("狀態非 pending")) return [txt("❌ 此加簽已被處理或撤銷")];
    if (msg.includes("只有加簽人本人")) return [txt("❌ 你不是這個加簽的對象")];
    return [txt(`❌ 核准加簽失敗：${msg}`)];
  }

  // 後續 LINE 推送由 DB trigger _trg_extra_signer_updated 自動處理：
  // - 推「✅ 加簽已通過」卡給原發起人
  return [txt(`✅ 已核准加簽（#${extraId}）`)];
};

// ── Register ─────────────────────────────────────────────────────────────────

registerPostback("approve", "request", handleApprove);
registerPostback("reject",  "request", handleReject);
registerPostback("cancel",  "request", handleCancel);
registerPostback("approve", "extra",   handleApproveExtra);  // P3d 加簽核准
registerPostback("resend",  "request", handleResend);
