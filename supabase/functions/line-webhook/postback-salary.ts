// ── Postback handlers for salary card (P3) ───────────────────────────────────
// Action keys:
//   unlock:salary  → 設 pending → 等使用者打 PIN
//   setup:salary   → 設 pending → 等使用者打 4-6 位新 PIN

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

registerPostback("unlock", "salary", handleUnlock);
registerPostback("setup",  "salary", handleSetup);
