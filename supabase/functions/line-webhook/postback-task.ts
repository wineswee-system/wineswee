// ── Postback handlers for task carousel (P1) ─────────────────────────────────
// Action keys:
//   complete:task   → 直接標記完成（會觸發 cascade）
//   postpone:task   → 延後 N 天（postback data 帶 days=1/3/7）
//   note:task       → 進入 pending → 等使用者打備註
//
// 全部用 postback 不留聊天室文字，結果用單行文字回覆。

import { registerPostback, setPending, type PostbackHandler } from './postback-handlers.ts';
import { cmdTaskDone } from './command-handlers.ts';

function txt(s: string) { return { type: "text", text: s }; }

// ── Handler: complete ────────────────────────────────────────────────────────
// ★ 修(2026-06-25)：原本自己 raw update status='completed'(英文)→ 全系統任務狀態是
//   中文('已完成'/'待處理'/'進行中')，App 不認得、cascade 用 .eq('status','pending') 也永遠
//   不 match → 按鈕等於壞的。改成走跟文字指令 /任務 X 完成 同一支 cmdTaskDone：
//   設 '已完成'、有簽核鏈導去 LIFF、cascade 交給 DB trigger _task_cascade_on_complete。
//   (LIFF/Web 走 web_complete_task RPC，也是同樣由 DB 統一處理。)
const handleComplete: PostbackHandler = async (params, ctx) => {
  const empId = ctx.lineUser?.employee_id;
  if (!empId) return [txt("❌ 你的 LINE 還沒綁員工，請先 /註冊 姓名")];
  if (!params.id) return [txt("⚠️ 缺少任務 ID")];
  const msg = await cmdTaskDone(String(params.id), empId, ctx.db, ctx.accessToken);
  return Array.isArray(msg) ? msg : [msg];
};

// ── Handler: postpone ────────────────────────────────────────────────────────

const handlePostpone: PostbackHandler = async (params, ctx) => {
  const taskId = params.id;
  const days = Number(params.days ?? 1);
  if (!taskId) return [txt("⚠️ 缺少任務 ID")];
  if (!Number.isFinite(days) || days <= 0 || days > 30) {
    return [txt("⚠️ 延後天數必須在 1-30 之間")];
  }

  // 確認任務存在 + 是負責人（避免別人亂改）
  const { data: task } = await ctx.db
    .from("tasks")
    .select("id, title, due_date, assignee_id, status")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return [txt("❌ 找不到此任務")];
  if (task.status === "completed" || task.status === "cancelled") {
    return [txt(`⚠️ 此任務已是「${task.status}」狀態，不能延後`)];
  }

  // 權限：只有 assignee 能延後（如果是 manager 也應該可以，先簡化）
  if (ctx.lineUser?.employee_id && task.assignee_id !== ctx.lineUser.employee_id) {
    return [txt("⚠️ 你不是這個任務的負責人，不能延後")];
  }

  // 計算新截止日：從原 due_date（若有）或 NOW 開始 +N 天
  const base = task.due_date ? new Date(task.due_date) : new Date();
  base.setDate(base.getDate() + days);
  const newDue = base.toISOString();

  const { error } = await ctx.db
    .from("tasks")
    .update({ due_date: newDue, updated_at: new Date().toISOString() })
    .eq("id", taskId);
  if (error) return [txt(`❌ 延後失敗：${error.message}`)];

  // 加 system note
  const ts = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
  await ctx.db.from("task_comments").insert({
    task_id: taskId,
    content: `⏰ ${ctx.lineUser?.display_name ?? "使用者"} 延後 ${days} 天 → ${newDue.slice(0, 10)} (${ts})`,
    source: "system",
  }).then(() => {}, () => {}); // 失敗 silent，task_comments 可能沒有

  return [txt(`⏰ 已延後「${task.title}」${days} 天\n新截止：${newDue.slice(0, 10)}`)];
};

// ── Handler: note (set pending) ──────────────────────────────────────────────

const handleNote: PostbackHandler = async (params, ctx) => {
  const taskId = params.id;
  if (!taskId) return [txt("⚠️ 缺少任務 ID")];

  const { data: task } = await ctx.db
    .from("tasks")
    .select("id, title")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return [txt("❌ 找不到此任務")];

  await setPending(ctx, {
    action: "task_note_v2",
    task_id: Number(taskId),
    title: task.title,
  });

  return [txt(`📝 加備註到「${task.title}」\n👇 直接打字輸入備註內容，或按 [取消] 中止。`)];
};

// ── Register ─────────────────────────────────────────────────────────────────

registerPostback("complete", "task", handleComplete);
registerPostback("postpone", "task", handlePostpone);
registerPostback("note",     "task", handleNote);
