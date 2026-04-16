import type { SupabaseClient } from './types.ts';
import { priorityLabel, statusLabel } from './constants.ts';
import { text, pushAndLog } from './line-api.ts';
import { logCommand } from './db-helpers.ts';
import { withQuickReplies, flexTaskList, flexSuccess, infoRow, mkBtn } from './flex-builders.ts';

// ── Task List ──────────────────────────────────────────────────────────────────

export async function cmdTaskList(employeeId: number, db: SupabaseClient, displayName: string, isGroup: boolean, groupId: string | null, liffNewTaskId = "", showAll = false) {
  const query = db.from("tasks").select("id, title, status, priority, due_date, notes, assignee")
    .eq("assignee_id", employeeId)
    .order("due_date", { ascending: true, nullsFirst: false });

  const { data: tasks } = showAll ? await query.limit(20) : await query.in("status", ["未開始", "進行中", "待處理"]).limit(10);

  return flexTaskList(tasks ?? [], displayName, liffNewTaskId);
}

// ── Task Create (simple) ───────────────────────────────────────────────────────

export async function cmdTaskCreate(employeeId: number, title: string, db: SupabaseClient) {
  if (!title) return text("請提供任務標題。\n例如：/任務 新增 整理庫存報表");

  const { data: task, error } = await db.from("tasks")
    .insert({ title, assignee_id: employeeId, status: "未開始", priority: "中" })
    .select("id").single();

  if (error) return text(`❌ 建立失敗：${error.message}`);
  return flexSuccess("✅", "任務已建立", `「${title}」\n#${task.id}`);
}

// ── Task Done ──────────────────────────────────────────────────────────────────

export async function cmdTaskDone(taskId: number, db: SupabaseClient, accessToken: string) {
  const { data: task } = await db.from("tasks").select("id, title, workflow_instance_id, assignee_id")
    .eq("id", taskId).maybeSingle();

  if (!task) return text(`❌ 找不到任務 #${taskId}`);

  await db.from("tasks").update({ status: "已完成", completed_at: new Date().toISOString() }).eq("id", taskId);

  // Check if workflow is complete
  if (task.workflow_instance_id) {
    await checkWorkflowCompletion(task.workflow_instance_id, db);
  }

  return flexSuccess("✅", "任務已完成", `「${task.title}」\n#${taskId}`);
}

async function checkWorkflowCompletion(instanceId: number, db: SupabaseClient) {
  const { data: tasks } = await db.from("tasks").select("status")
    .eq("workflow_instance_id", instanceId);

  if (!tasks?.length) return;
  const allDone = tasks.every((t: any) => t.status === "已完成" || t.status === "已取消");
  if (allDone) {
    await db.from("workflow_instances").update({ status: "已完成" }).eq("id", instanceId);
  }
}

// ── Task Update (add note) ─────────────────────────────────────────────────────

export async function cmdTaskUpdate(taskId: number, db: SupabaseClient) {
  const { data: task } = await db.from("tasks").select("id, title").eq("id", taskId).maybeSingle();
  if (!task) return { msg: text(`❌ 找不到任務 #${taskId}`), pendingAction: null };

  return {
    msg: withQuickReplies(
      text(`📝 請輸入「${task.title}」的備註內容：\n（輸入任何文字即可儲存）`),
      [{ label: "❌ 取消", text: "取消" }],
    ),
    pendingAction: { action: "add_note" as const, task_id: task.id, task_title: task.title },
  };
}

// ── Task Confirm Request ───────────────────────────────────────────────────────

export async function cmdTaskRequestConfirm(taskId: number, db: SupabaseClient) {
  const { data: task } = await db.from("tasks").select("id, title").eq("id", taskId).maybeSingle();
  if (!task) return text(`❌ 找不到任務 #${taskId}`);

  await db.from("tasks").update({ confirmation_required: true, confirmation_status: 'pending', confirmation_requested_at: new Date().toISOString() }).eq("id", taskId);
  return flexSuccess("🔔", "已發起確認請求", `「${task.title}」正在等待確認`);
}

// ── Task Confirm Respond ───────────────────────────────────────────────────────

export async function cmdTaskConfirmRespond(taskId: number, action: string, employeeId: number, db: SupabaseClient, accessToken: string, reason = "") {
  const isApprove = action === "核准" || action === "通過";
  const status = isApprove ? "approved" : "rejected";

  await db.from("tasks").update({
    confirmation_status: status,
    confirmation_responded_at: new Date().toISOString(),
    confirmation_notes: reason || null,
  }).eq("id", taskId);

  const label = isApprove ? "已核准" : "已退回";
  return flexSuccess(isApprove ? "✅" : "❌", label, `任務 #${taskId} ${label}${reason ? `\n原因：${reason}` : ""}`);
}

// ── Notes Query ────────────────────────────────────────────────────────────────

export async function cmdNotes(employeeId: number, db: SupabaseClient) {
  const { data: tasks } = await db.from("tasks").select("id, title, notes")
    .eq("assignee_id", employeeId)
    .not("notes", "is", null)
    .order("updated_at", { ascending: false })
    .limit(5);

  if (!tasks?.length) return text("📝 沒有包含備註的任務。");

  const lines = tasks.map((t: any) => {
    const lastNote = t.notes.trim().split("\n").pop()?.slice(0, 60);
    return `#${t.id} ${t.title}\n  └ ${lastNote}`;
  }).join("\n\n");

  return text(`📝 最近備註：\n\n${lines}`);
}
