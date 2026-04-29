// ── Postback handlers for task carousel (P1) ─────────────────────────────────
// Action keys:
//   complete:task   → 直接標記完成（會觸發 cascade）
//   postpone:task   → 延後 N 天（postback data 帶 days=1/3/7）
//   note:task       → 進入 pending → 等使用者打備註
//
// 全部用 postback 不留聊天室文字，結果用單行文字回覆。

import { registerPostback, setPending, type PostbackHandler } from './postback-handlers.ts';

function txt(s: string) { return { type: "text", text: s }; }

// ── Handler: complete ────────────────────────────────────────────────────────
// 直接 update task.status = 'completed'，附帶 cascade 觸發 metadata.trigger_actions

const handleComplete: PostbackHandler = async (params, ctx) => {
  const taskId = Number(params.id);
  if (!taskId) return [txt("⚠️ 缺少任務 ID")];

  const empId = ctx.lineUser?.employee_id;
  if (!empId) return [txt("❌ 你的 LINE 還沒綁員工，請先 /註冊 姓名")];

  const { data: task } = await ctx.db.from("tasks")
    .select("id, title, status, assignee_id, metadata")
    .eq("id", taskId).maybeSingle();
  if (!task) return [txt("❌ 找不到此任務")];
  if (task.assignee_id != null && task.assignee_id !== empId) {
    return [txt("⚠️ 你不是這個任務的負責人，不能完成")];
  }
  if (task.status === "completed") return [txt(`⚠️ 「${task.title}」已是完成狀態`)];

  const { error } = await ctx.db.from("tasks")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", taskId);
  if (error) return [txt(`❌ 完成失敗：${error.message}`)];

  // Cascade：metadata.trigger_actions 中列出的任務 → 啟動 + 推 LINE 給負責人
  const triggerActions: any[] = ((task.metadata as any)?.trigger_actions ?? []);
  let triggered = 0;
  let notified = 0;
  for (const tid of triggerActions) {
    const { data: t2 } = await ctx.db.from("tasks")
      .update({ status: "in_progress" })
      .eq("id", tid).eq("status", "pending")
      .select("id, title, priority, due_date, assignee_id")
      .maybeSingle();
    if (!t2) continue;
    triggered++;

    // 推給該任務的負責人
    if (t2.assignee_id) {
      const ok = await pushNewTaskNotification(ctx, t2, task.title);
      if (ok) notified++;
    }
  }

  const tail = triggered > 0
    ? `\n🔔 觸發 ${triggered} 個後續任務啟動${notified > 0 ? `（已通知 ${notified} 位負責人）` : ""}`
    : "";
  return [txt(`✅ 已完成「${task.title}」${tail}`)];
};

// 推「新任務啟動」通知給後續任務的負責人（小 flex bubble）
async function pushNewTaskNotification(
  ctx: any,
  newTask: { id: number; title: string; priority?: string; due_date?: string; assignee_id?: number },
  triggeredByTitle: string,
): Promise<boolean> {
  try {
    const { data: target } = await ctx.db.rpc("liff_resolve_line_target", { p_emp_id: newTask.assignee_id });
    const lineUserId = (target as any)?.line_user_id;
    if (!lineUserId) return false;

    const due = newTask.due_date ? newTask.due_date.slice(0, 10) : "無截止日";
    const priorityColor: Record<string, string> = { low: "#4CAF50", medium: "#E67E22", high: "#E74C3C", urgent: "#8E44AD" };
    const priorityLabel: Record<string, string> = { low: "🟢低", medium: "🟡中", high: "🔴高", urgent: "🚨緊急" };
    const pColor = priorityColor[newTask.priority ?? ""] ?? "#95A5A6";
    const pLabel = priorityLabel[newTask.priority ?? ""] ?? newTask.priority ?? "—";

    const liffTaskId = ctx.liffIds.task || ctx.liffIds.dashboard || "";
    const liffUri = liffTaskId
      ? `https://liff.line.me/${liffTaskId.trim()}?to=${encodeURIComponent("/tasks")}`
      : null;

    const bubble = {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: pColor,
        contents: [
          { type: "text", text: "🔔 新任務啟動", color: "#FFFFFF", weight: "bold", size: "md" },
          { type: "text", text: `由「${triggeredByTitle}」完成觸發`, color: "#FFFFFFCC", size: "xxs", wrap: true, margin: "xs" },
        ],
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "14px", spacing: "sm",
        contents: [
          { type: "text", text: newTask.title, weight: "bold", size: "md", color: "#111827", wrap: true },
          { type: "separator", margin: "sm" },
          { type: "box", layout: "horizontal", contents: [
            { type: "text", text: "優先", color: "#9CA3AF", size: "xs", flex: 2 },
            { type: "text", text: pLabel, color: pColor, size: "xs", flex: 5, weight: "bold" },
          ]},
          { type: "box", layout: "horizontal", contents: [
            { type: "text", text: "截止", color: "#9CA3AF", size: "xs", flex: 2 },
            { type: "text", text: due, color: "#333333", size: "xs", flex: 5, weight: "bold" },
          ]},
        ],
      },
      footer: {
        type: "box", layout: "vertical", paddingAll: "10px", spacing: "xs",
        contents: [
          {
            type: "button",
            action: { type: "postback", label: "✅ 標記完成", data: `action=complete&type=task&id=${newTask.id}` },
            style: "primary", color: "#27AE60", height: "sm",
          },
          ...(liffUri ? [{
            type: "button",
            action: { type: "uri", label: "📋 看任務列表", uri: liffUri },
            style: "secondary", height: "sm",
          }] : []),
        ],
      },
    };

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return false;

    const res = await fetch(`${supabaseUrl}/functions/v1/line-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        to: lineUserId,
        messages: [{ type: "flex", altText: `🔔 新任務：${newTask.title}`, contents: bubble }],
      }),
    });
    return res.ok;
  } catch (err) {
    console.warn("[postback-task] cascade push failed", err);
    return false;
  }
}

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
