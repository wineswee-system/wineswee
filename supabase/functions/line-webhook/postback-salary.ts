// ── Postback handlers for salary card (P3) ───────────────────────────────────
// Action keys:
//   unlock:salary  → 設 pending → 等使用者打 PIN
//   setup:salary   → 設 pending → 等使用者打 4-6 位新 PIN
//   reset:salary   → 自助重設，清掉自訂 PIN → 回到身分證後4碼預設

import { registerPostback, setPending, type PostbackHandler } from './postback-handlers.ts';

function txt(s: string) { return { type: "text", text: s }; }

const handleUnlock: PostbackHandler = async (_params, ctx) => {
  await setPending(ctx, { action: "salary_pin", mode: "unlock", attempts: 0 });
  return [txt("🔓 請輸入你的薪資密碼（4-6 位數字），輸入後送出。")];
};

const handleSetup: PostbackHandler = async (_params, ctx) => {
  await setPending(ctx, { action: "salary_pin", mode: "setup" });
  return [txt(
    "🔧 設定薪資密碼\n" +
    "請打 4-6 位數字當作密碼。\n" +
    "送出後完成設定，下次看薪資需要這組密碼解鎖。"
  )];
};

const handleReset: PostbackHandler = async (_params, ctx) => {
  const { db, lineUserId } = ctx;
  const { data, error } = await db.rpc("liff_reset_my_salary_pin", { p_line_user_id: lineUserId });
  if (error || !(data as any)?.ok) {
    const errMap: Record<string, string> = {
      "EMPLOYEE_NOT_FOUND": "你的 LINE 還沒綁員工，請先 /註冊 姓名",
      "NO_DEFAULT_PIN": "員工資料尚未填身分證號，無法啟用預設密碼，請聯絡管理員",
    };
    return [txt(`❌ 重設失敗：${errMap[(data as any)?.error ?? ""] ?? error?.message ?? "未知錯誤"}`)];
  }
  return [txt("✅ 密碼已重設！\n下次解鎖請使用身分證後 4 碼。\n解鎖後可再設定新密碼。")];
};

registerPostback("unlock", "salary", handleUnlock);
registerPostback("setup",  "salary", handleSetup);
registerPostback("reset",  "salary", handleReset);
