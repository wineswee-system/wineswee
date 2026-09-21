// ── Postback handler for cover invitation (D1) ───────────────────────────────
// Action keys:
//   claim:cover  → 搶單，呼叫 liff_claim_cover_request

import { registerPostback, type PostbackHandler } from './postback-handlers.ts';

function txt(s: string) { return { type: "text", text: s }; }

const handleClaim: PostbackHandler = async (params, ctx) => {
  const id = Number(params.id);
  if (!id) return [txt("⚠️ 缺少代班單 ID")];

  const { data, error } = await ctx.db.rpc("liff_claim_cover_request", {
    p_line_user_id: ctx.userId,
    p_id: id,
  });

  if (error) return [txt(`❌ 搶單失敗：${error.message}`)];

  const r = data as any;
  if (!r?.ok) {
    const errMap: Record<string, string> = {
      "EMPLOYEE_NOT_FOUND": "你的 LINE 還沒綁員工，請先 /註冊 姓名",
      "TOO_LATE_OR_NOT_ELIGIBLE": "可惜，已被搶走或你不在邀請名單",
    };
    return [txt(`❌ ${errMap[r?.error ?? ""] ?? r?.error ?? "搶單失敗"}`)];
  }

  return [txt(`✅ 搶單成功！${r.shift_date ?? ""} ${r.shift_label ?? ""} 的班是你的了。\n班表已自動更新。`)];
};

registerPostback("claim", "cover", handleClaim);
