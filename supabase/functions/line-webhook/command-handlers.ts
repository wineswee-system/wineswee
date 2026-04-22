import type { SupabaseClient } from './types.ts';
import { priorityLabel, statusLabel, PRIORITY_COLOR, STATUS_COLOR } from './constants.ts';
import { text, pushAndLog } from './line-api.ts';
import { resolveLineUserToEmployeeId } from './db-helpers.ts';
import {
  mkBtn, infoRow, withQuickReplies,
  flexTaskList, flexGroupTaskList, flexSuccess, flexWorkflowStatus,
} from './flex-builders.ts';

// ── Workflow Completion Check ────────────────────────────────────────────────

/** Check if all tasks in a workflow are done; if so, mark workflow complete and notify owner/group. */
export async function checkWorkflowCompletion(
  workflowInstanceId: string, db: SupabaseClient, accessToken: string,
) {
  // Count remaining non-completed tasks
  const { data: remaining } = await db.from("tasks")
    .select("id")
    .eq("workflow_instance_id", workflowInstanceId)
    .not("status", "in", '("completed","cancelled")')
    .limit(1);

  if (remaining && remaining.length > 0) return; // still tasks left

  // All tasks done → mark workflow instance as completed
  const { data: instance } = await db.from("workflow_instances")
    .select("id, name, assigned_user_id, status")
    .eq("id", workflowInstanceId)
    .maybeSingle();

  if (!instance || instance.status === "completed") return;

  await db.from("workflow_instances").update({
    status: "completed",
    completed_at: new Date().toISOString(),
  }).eq("id", workflowInstanceId);

  const wfName = instance.name || "工作流程";
  const completedAt = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });

  const flexMsg = {
    type: "flex",
    altText: `🎊 工作流程「${wfName}」已全部完成`,
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#7c3aed", paddingAll: "14px",
        contents: [
          { type: "text", text: wfName, color: "#e9d5ff", size: "xs" },
          { type: "text", text: "🎊 工作流程完成", weight: "bold", color: "#FFFFFF", size: "md" },
        ],
      },
      body: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px",
        contents: [
          { type: "text", text: wfName, weight: "bold", size: "lg", wrap: true },
          { type: "text", text: `所有任務已完成`, size: "sm", color: "#666666" },
          { type: "text", text: `完成時間：${completedAt}`, size: "xs", color: "#999999", margin: "sm" },
        ],
      },
      footer: {
        type: "box", layout: "vertical", paddingAll: "14px",
        contents: [
          {
            type: "button", style: "primary", height: "sm", color: "#7c3aed",
            action: { type: "message", label: "⚙️ 查看流程狀態", text: "/流程 狀態" },
          },
        ],
      },
    },
  };

  // Notify workflow owner via LINE
  if (instance.assigned_user_id) {
    let ownerLineId: string | null = null;
    const { data: lu } = await db.from("line_users")
      .select("line_user_id")
      .eq("employee_id", instance.assigned_user_id)
      .eq("is_verified", true)
      .maybeSingle();
    ownerLineId = lu?.line_user_id ?? null;
    if (!ownerLineId) {
      const { data: mapping } = await db.from("line_users")
        .select("line_user_id")
        .eq("employee_id", instance.assigned_user_id)
        .eq("is_verified", true)
        .maybeSingle();
      ownerLineId = mapping?.line_user_id ?? null;
    }
    if (ownerLineId) {
      await pushAndLog(ownerLineId, [flexMsg], accessToken, db, { sourceType: "system" });
    }
  }

  // Notify assigned LINE groups
  const { data: groupAssignments } = await db.from("workflow_instance_line_group_assignments")
    .select("line_group_id, line_groups!inner(line_group_id)")
    .eq("workflow_instance_id", workflowInstanceId);

  if (groupAssignments) {
    for (const ga of groupAssignments) {
      const lineGroupId = (ga as any).line_groups?.line_group_id;
      if (lineGroupId) {
        await pushAndLog(lineGroupId, [flexMsg], accessToken, db, { sourceType: "group", groupId: lineGroupId });
      }
    }
  }
}

// ── Task List Command ────────────────────────────────────────────────────────

export async function cmdTaskList(userId: string, db: SupabaseClient, displayName?: string, isGroup = false, lineGroupId?: string | null, liffNewTaskId = "", showAll = false) {
  let tasks: any[] | null = null;
  const employeeId = await resolveLineUserToEmployeeId(db, userId);
  console.log("[cmdTaskList] userId=", userId, "employeeId=", employeeId, "isGroup=", isGroup, "lineGroupId=", lineGroupId);

  if (isGroup && lineGroupId) {
    // Group chat: show all tasks from workflows assigned to this group, with assignee name
    const { data: groupRow } = await db
      .from("line_groups")
      .select("id")
      .eq("line_group_id", lineGroupId)
      .maybeSingle();

    console.log("[cmdTaskList] groupRow=", JSON.stringify(groupRow));
    if (groupRow?.id) {
      // Find running workflow instances directly assigned to this LINE group
      const { data: instanceAssignments } = await db
        .from("workflow_instance_line_group_assignments")
        .select("workflow_instance_id")
        .eq("line_group_id", groupRow.id);

      if (instanceAssignments && instanceAssignments.length > 0) {
        const instanceIds = instanceAssignments.map((a: any) => a.workflow_instance_id);
        const { data: allTasks } = await db
          .from("tasks")
          .select("id, title, status, priority, due_date, notes, confirmation_required, assignee:employees!tasks_assignee_id_fkey(name), workflow_instance:workflow_instances(name)")
          .in("workflow_instance_id", instanceIds)
          .in("status", showAll ? ["pending", "in_progress", "completed", "cancelled"] : ["in_progress"])
          .order("priority", { ascending: false })
          .limit(10);
        tasks = allTasks;
      }
    }
    // Fall back to tasks directly assigned to this user if no workflow tasks found
    console.log("[cmdTaskList] group workflow tasks count=", tasks?.length ?? 0);
    if (!tasks || tasks.length === 0) {
      console.log("[cmdTaskList] falling back to user tasks for employeeId=", employeeId);
      if (employeeId) {
        const { data: fallback, error: fallbackErr } = await db
          .from("tasks")
          .select("id, title, status, priority, due_date, notes, confirmation_required, workflow_instance:workflow_instances(name)")
          .eq("assignee_id", employeeId)
          .in("status", showAll ? ["pending", "in_progress", "completed", "cancelled"] : ["in_progress"])
          .order("priority", { ascending: false })
          .limit(10);
        console.log("[cmdTaskList] fallback tasks=", JSON.stringify(fallback), "err=", fallbackErr);
        tasks = fallback;
      }
    }
    console.log("[cmdTaskList] returning flexGroupTaskList with", tasks?.length ?? 0, "tasks");
    return flexGroupTaskList(tasks ?? []);
  } else {
    // Private chat: show tasks from workflow instances assigned to this user
    const { data: instances } = await db
      .from("workflow_instances")
      .select("id")
      .eq("assigned_user_id", userId)
      .in("status", ["running", "paused"]);

    const statusFilter = showAll ? ["pending", "in_progress", "completed", "cancelled"] : ["in_progress"];
    if (instances && instances.length > 0) {
      const instanceIds = instances.map((i: any) => i.id);
      const { data: wfTasks } = await db
        .from("tasks")
        .select("id, title, status, priority, due_date, notes, confirmation_required, workflow_instance:workflow_instances(name)")
        .in("workflow_instance_id", instanceIds)
        .in("status", statusFilter)
        .order("priority", { ascending: false })
        .limit(10);
      tasks = wfTasks;
    }
    // Fall back to tasks directly assigned to this user
    if ((!tasks || tasks.length === 0) && employeeId) {
      const { data: fallback } = await db
        .from("tasks")
        .select("id, title, status, priority, due_date, notes, confirmation_required, workflow_instance:workflow_instances(name)")
        .eq("assignee_id", employeeId)
        .in("status", statusFilter)
        .order("priority", { ascending: false })
        .limit(10);
      tasks = fallback;
    }
    return flexTaskList(tasks ?? [], undefined, liffNewTaskId);
  }
}

// ── Task Create Command ──────────────────────────────────────────────────────

export async function cmdTaskCreate(userId: string, title: string, db: SupabaseClient) {
  if (!title) {
    // Prompt with instructions
    return withQuickReplies(
      {
        type: "flex",
        altText: "➕ 新增任務",
        contents: {
          type: "bubble",
          header: {
            type: "box",
            layout: "vertical",
            paddingAll: "12px",
            backgroundColor: "#E67E22",
            contents: [{ type: "text", text: "➕ 新增任務", color: "#FFFFFF", weight: "bold", size: "lg" }],
          },
          body: {
            type: "box",
            layout: "vertical",
            paddingAll: "16px",
            contents: [
              { type: "text", text: "請輸入以下格式：", color: "#555555", size: "sm" },
              {
                type: "box",
                layout: "vertical",
                margin: "md",
                paddingAll: "10px",
                backgroundColor: "#F5F5F5",
                cornerRadius: "6px",
                contents: [
                  { type: "text", text: "/任務 新增 [任務標題]", size: "sm", color: "#E67E22", weight: "bold" },
                ],
              },
              { type: "text", text: "例如：", color: "#AAAAAA", size: "xs", margin: "md" },
              { type: "text", text: "/任務 新增 盤點倉庫庫存", size: "sm", color: "#333333", margin: "xs" },
              { type: "text", text: "/任務 新增 整理出貨區", size: "sm", color: "#333333", margin: "xs" },
            ],
          },
        },
      },
      [{ label: "📋 任務列表", text: "/任務 列表" }],
    );
  }

  const employeeId = await resolveLineUserToEmployeeId(db, userId);
  if (!employeeId) return text("❌ 找不到您的員工資料，請先綁定 LINE 帳號。");

  const { error } = await db.from("tasks").insert({
    title,
    assignee_id: employeeId,
    status: "pending",
    priority: "medium",
  });

  if (error) return text(`❌ 建立失敗：${error.message}`);
  return flexSuccess("✅", `任務已建立`, `「${title}」已加入待處理清單`);
}

// ── Task Done Command ────────────────────────────────────────────────────────

export async function cmdTaskDone(rawId: string, userId: string, db: SupabaseClient, accessToken: string, groupId?: string | null, displayName?: string) {
  const shortId = rawId.replace(/[[\]#\s]/g, "").toLowerCase();
  if (!shortId) return text("請提供任務 ID。例如：/任務 #abc123 完成");

  const employeeId = await resolveLineUserToEmployeeId(db, userId);
  if (!employeeId) return text("❌ 找不到您的員工資料，請先綁定 LINE 帳號。");

  // Fetch only tasks assigned to this user (not completed)
  const { data: allTasks } = await db
    .from("tasks")
    .select("id, title, metadata, workflow_instance_id, sort_order")
    .eq("assignee_id", employeeId)
    .neq("status", "completed")
    .limit(300);

  const task = allTasks?.find((t: any) => t.id.startsWith(shortId));
  if (!task) return text(`❌ 此任務不存在或您不是負責人，無法完成。`);

  await db.from("tasks")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", task.id);

  // Start triggered tasks and notify their assignees
  const triggerActions: string[] = (task.metadata as any)?.trigger_actions ?? [];
  let triggeredCount = 0;

  for (const triggeredId of triggerActions) {
    // Fetch the triggered task with its assignee
    const { data: triggered } = await db
      .from("tasks")
      .select("id, title, priority, due_date, assignee_id")
      .eq("id", triggeredId)
      .eq("status", "pending")
      .maybeSingle();

    if (!triggered) continue;

    // Update triggered task to in_progress
    await db.from("tasks").update({ status: "in_progress" }).eq("id", triggeredId);
    triggeredCount++;

    // Look up the assignee's LINE user ID
    if (!triggered.assignee_id) continue;
    const { data: lineUser } = await db
      .from("line_users")
      .select("line_user_id")
      .eq("employee_id", triggered.assignee_id)
      .eq("is_verified", true)
      .maybeSingle();

    if (!lineUser?.line_user_id) continue;

    // Push notification to assignee
    const due = triggered.due_date ? triggered.due_date.slice(0, 10) : "無截止日";
    const pColor = PRIORITY_COLOR[triggered.priority] ?? "#95A5A6";
    const shortTriggeredId = triggered.id.slice(0, 6);

    await pushAndLog(lineUser.line_user_id, [
      withQuickReplies(
        {
          type: "flex",
          altText: `🔔 新任務已指派：${triggered.title}`,
          contents: {
            type: "bubble",
            header: {
              type: "box",
              layout: "vertical",
              paddingAll: "12px",
              backgroundColor: pColor,
              contents: [
                { type: "text", text: "🔔 您有新任務開始了", color: "#FFFFFF", weight: "bold", size: "md" },
                { type: "text", text: `由「${task.title}」完成後觸發`, color: "#FFFFFF", size: "xs", margin: "xs", wrap: true },
              ],
            },
            body: {
              type: "box",
              layout: "vertical",
              paddingAll: "14px",
              contents: [
                { type: "text", text: triggered.title, weight: "bold", size: "lg", wrap: true },
                { type: "separator", margin: "md" },
                infoRow("優先", priorityLabel(triggered.priority), pColor),
                infoRow("截止", due),
                { type: "text", text: `#${shortTriggeredId}`, color: "#CCCCCC", size: "xxs", margin: "sm" },
              ],
            },
            footer: {
              type: "box",
              layout: "vertical",
              spacing: "xs",
              paddingAll: "8px",
              contents: [
                {
                  type: "button",
                  action: { type: "message", label: "✅ 標記完成", text: `/任務 #${shortTriggeredId} 完成` },
                  style: "primary",
                  height: "sm",
                  color: "#27AE60",
                },
                {
                  type: "button",
                  action: { type: "message", label: "📋 查看所有任務", text: "/任務 列表" },
                  style: "secondary",
                  height: "sm",
                },
              ],
            },
          },
        },
        [
          { label: "✅ 完成", text: `/任務 #${shortTriggeredId} 完成` },
          { label: "📋 任務列表", text: "/任務 列表" },
        ],
      ),
    ], accessToken, db, { sourceType: "user" });
  }

  // Look up the next pending/in_progress task in the same workflow instance
  let nextTask: { title: string; assigneeName: string } | null = null;
  if (task.workflow_instance_id) {
    const { data: nextTasks } = await db
      .from("tasks")
      .select("id, title, sort_order, assignee:employees!tasks_assignee_id_fkey(name)")
      .eq("workflow_instance_id", task.workflow_instance_id)
      .in("status", ["pending", "in_progress"])
      .neq("id", task.id)
      .order("sort_order", { ascending: true })
      .limit(1);
    if (nextTasks && nextTasks.length > 0) {
      const nt = nextTasks[0];
      nextTask = { title: nt.title, assigneeName: nt.assignee?.name ?? "—" };
    } else {
      // No more tasks → check if entire workflow is complete
      await checkWorkflowCompletion(task.workflow_instance_id, db, accessToken);
    }
  }

  // Build single completion reply
  const bodyContents: any[] = [
    { type: "text", text: `✅ 「${task.title}」已標記為完成`, size: "sm", wrap: true, color: "#27AE60", weight: "bold" },
  ];

  if (triggeredCount > 0) {
    bodyContents.push({
      type: "text", text: `🔔 已通知 ${triggeredCount} 個後續任務負責人`,
      size: "xs", color: "#E67E22", margin: "sm",
    });
  }

  if (nextTask) {
    bodyContents.push({ type: "separator", margin: "md" });
    bodyContents.push({ type: "text", text: "下一個任務是", size: "xs", color: "#AAAAAA", margin: "md" });
    bodyContents.push({ type: "text", text: nextTask.title, weight: "bold", size: "sm", wrap: true, margin: "xs" });
    bodyContents.push({ type: "text", text: `👤 負責人：${nextTask.assigneeName}`, size: "xs", color: "#AAAAAA", margin: "xs" });
  }

  return withQuickReplies(
    {
      type: "flex",
      altText: `✅ 任務完成：${task.title}`,
      contents: {
        type: "bubble",
        header: {
          type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#27AE60",
          contents: [
            { type: "text", text: "🎉 任務完成！", color: "#FFFFFF", weight: "bold", size: "lg" },
          ],
        },
        body: { type: "box", layout: "vertical", paddingAll: "14px", contents: bodyContents },
        footer: {
          type: "box", layout: "vertical", paddingAll: "8px",
          contents: [mkBtn("📋 任務列表", "/任務 列表", "secondary")],
        },
      },
    },
    [{ label: "📋 任務列表", text: "/任務 列表" }, { label: "⚙️ 流程狀態", text: "/流程 狀態" }],
  );
}

// ── Task Update Command ──────────────────────────────────────────────────────

export async function cmdTaskUpdate(rawId: string, note: string, db: SupabaseClient, lineUserRowId?: string, userId?: string) {
  const shortId = rawId.replace(/[[\]#\s]/g, "");
  if (!shortId) return text("請提供任務 ID。");

  let query = db
    .from("tasks")
    .select("id, title, notes")
    .neq("status", "completed");
  if (userId) {
    const employeeId = await resolveLineUserToEmployeeId(db, userId);
    if (!employeeId) return text("❌ 找不到您的員工資料，請先綁定 LINE 帳號。");
    query = query.eq("assignee_id", employeeId);
  }
  const { data: allTasks2 } = await query.limit(300);

  const tasks = allTasks2?.filter((t: any) => t.id.startsWith(shortId));
  if (!tasks || tasks.length === 0) return text(`❌ 找不到 ID 為 ${shortId} 的任務。`);
  const task = tasks![0];

  if (!note) {
    // Save pending action and ask user to type note
    if (lineUserRowId) {
      await db.from("line_users")
        .update({ pending_action: { action: "add_note", task_id: task.id, task_title: task.title } })
        .eq("id", lineUserRowId);
    }
    return text(`📝 請直接輸入「${task.title}」的備註內容：`);
  }

  const timestamp = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
  const existing = task.notes ? `${task.notes}\n` : "";
  const newNotes = `${existing}[${timestamp}] ${note}`;
  const { error: updateErr } = await db.from("tasks").update({ notes: newNotes, updated_at: new Date().toISOString() }).eq("id", task.id);
  if (updateErr) return text(`❌ 備註更新失敗：${updateErr.message}`);
  return flexSuccess("📝", "備註已更新", `「${task.title}」\n${note}`);
}

// ── Task Request Confirmation Command ────────────────────────────────────────

export async function cmdTaskRequestConfirm(rawId: string, userId: string, db: SupabaseClient, accessToken: string, displayName?: string) {
  const shortId = rawId.replace(/[[\]#\s]/g, "").toLowerCase();
  if (!shortId) return text("請提供任務 ID。例如：/任務 #abc123 請求確認");

  const employeeId = await resolveLineUserToEmployeeId(db, userId);
  if (!employeeId) return text("❌ 找不到您的員工資料，請先綁定 LINE 帳號。");

  const { data: allTasks } = await db
    .from("tasks")
    .select("id, title, confirmation_required, confirmation_status, workflow_instance:workflow_instances(name)")
    .eq("assignee_id", employeeId)
    .neq("status", "completed")
    .limit(300);

  const tasks = allTasks?.filter((t: any) => t.id.toLowerCase().startsWith(shortId));
  if (!tasks || tasks.length === 0) return text(`❌ 找不到 ID 為 ${shortId} 的任務。`);
  const task = tasks[0];

  if (!task.confirmation_required) {
    return text(`任務「${task.title}」不需要確認審批，可直接完成。\n輸入：/任務 ${shortId} 完成`);
  }

  const isResend = task.confirmation_status === "pending";

  if (!isResend) {
    // Set confirmation status to pending
    await db.from("tasks").update({
      confirmation_status: "pending",
      confirmation_requested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", task.id);

    // Reset any existing confirmation records to pending
    await db.from("task_confirmations")
      .update({ status: "pending", responded_at: null })
      .eq("task_id", task.id);
  }

  // Check if approvers exist; if not, auto-assign manager(s) as approvers
  const { data: existingConfs } = await db.from("task_confirmations")
    .select("id")
    .eq("task_id", task.id)
    .limit(1);

  if (!existingConfs || existingConfs.length === 0) {
    // Find managers: first check workflow instance owner, then user's managers
    const approverCandidates: string[] = [];

    // 1. Workflow instance owner (if task belongs to a workflow)
    const { data: fullTask } = await db.from("tasks")
      .select("workflow_instance_id")
      .eq("id", task.id)
      .maybeSingle();

    if (fullTask?.workflow_instance_id) {
      const { data: wfInstance } = await db.from("workflow_instances")
        .select("assigned_user_id")
        .eq("id", fullTask.workflow_instance_id)
        .maybeSingle();
      if (wfInstance?.assigned_user_id && wfInstance.assigned_user_id !== userId) {
        approverCandidates.push(wfInstance.assigned_user_id);
      }
    }

    // 2. Users with is_line_manager = true (if no workflow owner found)
    if (approverCandidates.length === 0) {
      const { data: managers } = await db.from("employees")
        .select("id")
        .eq("is_line_manager", true)
        .neq("id", userId)
        .limit(5);
      if (managers) approverCandidates.push(...managers.map((m: any) => m.id));
    }

    if (approverCandidates.length === 0) {
      return text(`❌ 無法找到審批人員。請先在管理後台設定任務確認人。`);
    }

    // Insert approver records
    const inserts = approverCandidates.map(appId => ({
      task_id: task.id,
      approver_id: appId,
      status: "pending",
    }));
    await db.from("task_confirmations").insert(inserts);
  }

  // Notify approvers via LINE
  const { data: confirmations } = await db.from("task_confirmations")
    .select("approver_id")
    .eq("task_id", task.id)
    .eq("status", "pending");

  if (confirmations && confirmations.length > 0 && accessToken) {
    const approverIds = confirmations.map((c: any) => c.approver_id);

    // Resolve approver LINE IDs via line_users then line_employee_mapping
    for (const approverId of approverIds) {
      let lineId: string | null = null;
      const { data: lu } = await db.from("line_users")
        .select("line_user_id")
        .eq("employee_id", approverId)
        .eq("is_verified", true)
        .maybeSingle();
      lineId = lu?.line_user_id ?? null;

      if (!lineId) {
        const { data: mapping } = await db.from("line_users")
          .select("line_user_id")
          .eq("employee_id", approverId)
          .eq("is_verified", true)
          .maybeSingle();
        lineId = mapping?.line_user_id ?? null;
      }

      if (!lineId) continue;

      const requesterName = displayName || "員工";
      const wfName = (task as any).workflow_instance?.name ?? null;
      const headerTitle = wfName ? `${wfName} 任務確認請求` : "🔐 任務確認請求";
      await pushAndLog(lineId, [{
        type: "flex",
        altText: `🔐 確認請求：「${task.title}」`,
        contents: {
          type: "bubble",
          size: "kilo",
          header: {
            type: "box", layout: "vertical", backgroundColor: "#8b5cf6", paddingAll: "14px",
            contents: [
              ...(wfName ? [{ type: "text", text: wfName, size: "xs", color: "#e9d5ff" }] : []),
              { type: "text", text: "🔐 任務確認請求", weight: "bold", color: "#FFFFFF", size: "md" },
            ],
          },
          body: {
            type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px",
            contents: [
              { type: "text", text: task.title, weight: "bold", size: "md", wrap: true },
              { type: "text", text: `申請人：${requesterName}`, size: "sm", color: "#666666" },
              { type: "text", text: "請審核此任務是否完成。", size: "sm", color: "#8b5cf6", wrap: true },
            ],
          },
          footer: {
            type: "box", layout: "horizontal", spacing: "sm", paddingAll: "14px",
            contents: [
              {
                type: "button", style: "primary", height: "sm", color: "#16a34a",
                action: { type: "message", label: "✅ 核准", text: `/確認 ${shortId} 核准` },
              },
              {
                type: "button", style: "primary", height: "sm", color: "#dc2626",
                action: { type: "message", label: "❌ 拒絕", text: `/確認 ${shortId} 拒絕` },
              },
            ],
          },
        },
      }], accessToken, db, { sourceType: "system" });
    }
  }

  // Add system comment
  if (!isResend) {
    await db.from("task_comments").insert({
      task_id: task.id,
      content: `🔐 確認請求已送出 (${new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })})`,
      source: "system",
    });
  }

  const msg = isResend
    ? `「${task.title}」確認通知已重新發送給審批人員。`
    : `「${task.title}」已提交確認審批，等待主管回覆。`;
  return flexSuccess("🔐", isResend ? "確認通知已重送" : "確認請求已送出", msg);
}

// ── Task Confirm Respond Command ─────────────────────────────────────────────

export async function cmdTaskConfirmRespond(rawId: string, action: string, userId: string, db: SupabaseClient, accessToken: string, notes?: string) {
  const shortId = rawId.replace(/[[\]#\s]/g, "").toLowerCase();
  const approved = action === "核准";

  // Find the task by short ID
  const { data: allTasks } = await db
    .from("tasks")
    .select("id, title, confirmation_status")
    .neq("status", "completed")
    .limit(300);

  const tasks = allTasks?.filter((t: any) => t.id.toLowerCase().startsWith(shortId));
  if (!tasks || tasks.length === 0) return text(`❌ 找不到 ID 為 ${shortId} 的任務。`);
  const task = tasks[0];

  // Check this user is an approver
  const { data: conf } = await db.from("task_confirmations")
    .select("id, status")
    .eq("task_id", task.id)
    .eq("approver_id", userId)
    .maybeSingle();

  if (!conf) return text(`❌ 您不是任務「${task.title}」的審批人員。`);
  if (conf.status !== "pending") return text(`此任務您已回覆：${conf.status === "approved" ? "核准" : "拒絕"}`);

  // Update this approver's response
  await db.from("task_confirmations").update({
    status: approved ? "approved" : "rejected",
    notes: notes || null,
    responded_at: new Date().toISOString(),
  }).eq("id", conf.id);

  // Check if all approvers responded
  const { data: allConfs } = await db.from("task_confirmations")
    .select("status")
    .eq("task_id", task.id);

  const confirmations = allConfs || [];
  const allApproved = confirmations.length > 0 && confirmations.every((c: any) => c.status === "approved");
  const anyRejected = confirmations.some((c: any) => c.status === "rejected");

  if (allApproved) {
    await db.from("tasks").update({
      confirmation_status: "approved",
      confirmation_responded_at: new Date().toISOString(),
      confirmation_notes: "所有確認人已核准",
      status: "completed",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", task.id);

    await db.from("task_comments").insert({
      task_id: task.id,
      content: `✅ 所有審批人已核准，任務自動完成 (${new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })})`,
      source: "system",
    });

    // Notify task owner that approval passed and task is completed
    const { data: approvedTask } = await db.from("tasks")
      .select("assignee_id, workflow_instance_id")
      .eq("id", task.id)
      .maybeSingle();

    if (approvedTask?.assignee_id) {
      let ownerLineId: string | null = null;
      const { data: lu } = await db.from("line_users")
        .select("line_user_id")
        .eq("employee_id", approvedTask.assignee_id)
        .eq("is_verified", true)
        .maybeSingle();
      ownerLineId = lu?.line_user_id ?? null;
      if (ownerLineId) {
        await pushAndLog(ownerLineId, [{
          type: "flex",
          altText: `✅ 任務「${task.title}」已核准完成`,
          contents: {
            type: "bubble",
            size: "kilo",
            header: {
              type: "box", layout: "vertical", backgroundColor: "#16a34a", paddingAll: "14px",
              contents: [
                { type: "text", text: "✅ 任務確認通過", weight: "bold", color: "#FFFFFF", size: "md" },
              ],
            },
            body: {
              type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px",
              contents: [
                { type: "text", text: task.title, weight: "bold", size: "md", wrap: true },
                { type: "text", text: "所有審批人已核准，任務已自動標記完成。", size: "sm", color: "#666666", wrap: true },
              ],
            },
            footer: {
              type: "box", layout: "vertical", paddingAll: "14px",
              contents: [
                {
                  type: "button", style: "primary", height: "sm", color: "#4f46e5",
                  action: { type: "message", label: "📋 查看任務列表", text: "/任務 列表" },
                },
              ],
            },
          },
        }], accessToken, db, { sourceType: "system" });
      }
    }

    // Check if entire workflow is now complete
    if (approvedTask?.workflow_instance_id) {
      await checkWorkflowCompletion(approvedTask.workflow_instance_id, db, accessToken);
    }

    return flexSuccess("✅", "已核准 — 任務完成", `「${task.title}」所有審批人已核准，任務已標記完成。`);
  } else if (anyRejected) {
    // Keep task in_progress, reset confirmation so owner can re-request
    await db.from("tasks").update({
      confirmation_status: null,
      confirmation_responded_at: new Date().toISOString(),
      confirmation_notes: notes || "審批被拒絕",
      updated_at: new Date().toISOString(),
    }).eq("id", task.id);

    await db.from("task_comments").insert({
      task_id: task.id,
      content: `❌ 審批被拒絕${notes ? `：${notes}` : ""} (${new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })})`,
      source: "system",
    });

    // Notify task owner to review and re-request
    const { data: fullTask } = await db.from("tasks")
      .select("assignee_id")
      .eq("id", task.id)
      .maybeSingle();

    if (fullTask?.assignee_id) {
      // Resolve owner's LINE ID
      let ownerLineId: string | null = null;
      const { data: lu } = await db.from("line_users")
        .select("line_user_id")
        .eq("employee_id", fullTask.assignee_id)
        .eq("is_verified", true)
        .maybeSingle();
      ownerLineId = lu?.line_user_id ?? null;

      if (ownerLineId) {
        const sid = shortId.slice(0, 8);
        await pushAndLog(ownerLineId, [{
          type: "flex",
          altText: `❌ 任務「${task.title}」確認被拒絕`,
          contents: {
            type: "bubble",
            size: "kilo",
            header: {
              type: "box", layout: "vertical", backgroundColor: "#dc2626", paddingAll: "14px",
              contents: [
                { type: "text", text: "❌ 確認請求被拒絕", weight: "bold", color: "#FFFFFF", size: "md" },
              ],
            },
            body: {
              type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px",
              contents: [
                { type: "text", text: task.title, weight: "bold", size: "md", wrap: true },
                ...(notes ? [{ type: "text", text: `拒絕原因：${notes}`, size: "sm", color: "#dc2626", wrap: true }] : []),
                { type: "text", text: "請檢視任務後重新送出確認請求。", size: "sm", color: "#666666", wrap: true, margin: "md" },
              ],
            },
            footer: {
              type: "box", layout: "horizontal", spacing: "sm", paddingAll: "14px",
              contents: [
                {
                  type: "button", style: "secondary", height: "sm",
                  action: { type: "message", label: "📝 更新備註", text: `/任務 ${sid} 更新 ` },
                },
                {
                  type: "button", style: "primary", height: "sm", color: "#8b5cf6",
                  action: { type: "message", label: "🔐 重新請求確認", text: `/任務 ${sid} 請求確認` },
                },
              ],
            },
          },
        }], accessToken, db, { sourceType: "system" });
      }
    }

    return flexSuccess("❌", "已拒絕", `「${task.title}」的確認請求已被拒絕，已通知任務負責人。${notes ? `\n原因：${notes}` : ""}`);
  }

  // Partial — some approved, waiting for others
  const pending = confirmations.filter((c: any) => c.status === "pending").length;
  return flexSuccess(approved ? "✅" : "❌", approved ? "已核准" : "已拒絕", `「${task.title}」— 還有 ${pending} 位審批人尚未回覆。`);
}

// ── Notes Command ────────────────────────────────────────────────────────────

export async function cmdNotes(userId: string, db: SupabaseClient) {
  const employeeId = await resolveLineUserToEmployeeId(db, userId);
  if (!employeeId) return text("❌ 找不到您的員工資料，請先綁定 LINE 帳號。");

  const { data: tasks } = await db
    .from("tasks")
    .select("id, title, notes, status")
    .eq("assignee_id", employeeId)
    .not("notes", "is", null)
    .neq("notes", "")
    .order("updated_at", { ascending: false })
    .limit(5);

  if (!tasks || tasks.length === 0) {
    return text("📝 目前沒有包含備註的任務。");
  }

  const bubbles = tasks.map((t: any) => {
    const shortId = t.id.slice(0, 6);
    const lastNote = t.notes.split("\n").filter(Boolean).slice(-2).join("\n");
    return {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "10px",
        backgroundColor: "#3498DB",
        contents: [
          { type: "text", text: `📝 ${t.title}`, color: "#FFFFFF", weight: "bold", size: "sm", wrap: true, maxLines: 2 },
          { type: "text", text: `#${shortId} · ${statusLabel(t.status)}`, color: "#D6EAF8", size: "xxs", margin: "xs" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "10px",
        contents: [
          { type: "text", text: lastNote, size: "xs", color: "#555555", wrap: true, maxLines: 6 },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "8px",
        contents: [
          mkBtn("📝 新增備註", `/任務 #${shortId} 更新`, "secondary"),
        ],
      },
    };
  });

  return {
    type: "flex",
    altText: `📝 最近備註（${tasks.length} 件）`,
    contents: { type: "carousel", contents: bubbles },
  };
}

// ── Project Tasks Commands ───────────────────────────────────────────────────
// 注意：project_tasks 表在目前 DB 並未建立（整併到 tasks + project_id 後未補完）。
// 這些指令暫時回覆提示訊息，避免 LINE 端 500。
const PROJECT_TASKS_DISABLED = "⚠️ 專案任務模組整理中，暫時無法使用。";

export async function cmdProjectList(db: SupabaseClient) {
  // project_tasks 表不存在 → 暫停功能
  return text(PROJECT_TASKS_DISABLED);

  // @ts-ignore unreachable fallback kept for when the table is restored
  const { data: tasks } = await db
    .from("project_tasks")
    .select("task_no, name, assignee, planned_end, actual_end, status, note1")
    .order("task_no", { ascending: true });

  if (!tasks || tasks.length === 0) {
    return text("📭 目前沒有專案任務。");
  }

  const inProgress = tasks.filter((t: any) => t.status !== '已完成');
  const completed = tasks.filter((t: any) => t.status === '已完成');

  const statusIcon = (s: string) => s === '已完成' ? '✅' : s === '進行中' ? '🔄' : '⏳';

  const bubbles = [];
  // Show in-progress first, then batches of 10
  const display = [...inProgress.slice(0, 20)];

  for (let i = 0; i < display.length; i += 5) {
    const batch = display.slice(i, i + 5);
    const rows = batch.map((t: any) => ({
      type: "box",
      layout: "horizontal",
      paddingTop: "6px",
      paddingBottom: "6px",
      borderWidth: "0.5px",
      borderColor: "#EEEEEE",
      contents: [
        { type: "text", text: `#${t.task_no}`, size: "xs", flex: 1, color: "#888888", weight: "bold" },
        { type: "text", text: t.name, size: "xs", flex: 4, color: "#333333", wrap: true },
        { type: "text", text: t.assignee || '-', size: "xs", flex: 2, color: "#666666", align: "center" },
        { type: "text", text: statusIcon(t.status), size: "xs", flex: 1, align: "right" },
      ],
    }));

    bubbles.push({
      type: "bubble",
      size: "mega",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#2D3748", paddingAll: "14px",
        contents: [
          { type: "text", text: "🏗️ 專案進度", weight: "bold", color: "#FFFFFF", size: "lg" },
          { type: "text", text: `${inProgress.length} 進行中 / ${completed.length} 完成`, color: "#A0AEC0", size: "xs", margin: "xs" },
        ],
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "12px",
        contents: [
          {
            type: "box", layout: "horizontal", paddingBottom: "6px",
            contents: [
              { type: "text", text: "#", size: "xs", flex: 1, color: "#AAAAAA", weight: "bold" },
              { type: "text", text: "任務", size: "xs", flex: 4, color: "#AAAAAA", weight: "bold" },
              { type: "text", text: "負責人", size: "xs", flex: 2, color: "#AAAAAA", weight: "bold", align: "center" },
              { type: "text", text: "", size: "xs", flex: 1 },
            ],
          },
          ...rows,
        ],
      },
    });
  }

  return withQuickReplies(
    { type: "flex", altText: `🏗️ 專案進度（${inProgress.length} 進行中）`, contents: { type: "carousel", contents: bubbles.slice(0, 10) } },
    [{ label: "📖 說明", text: "/說明" }],
  );
}

export async function cmdProjectDone(taskNo: number, db: SupabaseClient): Promise<object> {
  return text(PROJECT_TASKS_DISABLED);

  // @ts-ignore unreachable
  const today = new Date().toISOString().slice(0, 10);
  // @ts-ignore unreachable
  const { data: task, error } = await db
    .from("project_tasks")
    .update({ status: '已完成', actual_end: today, sync_source: 'line' })
    .eq("task_no", taskNo)
    .select("name")
    .single();

  if (error || !task) return text(`❌ 找不到專案任務 #${taskNo}`);

  return withQuickReplies(
    flexSuccess("✅", `任務 #${taskNo} 完成`, `「${task.name}」已標記為完成`),
    [{ label: "🏗️ 專案列表", text: "/專案 列表" }],
  );
}

export async function cmdProjectNote(taskNo: number, note: string, db: SupabaseClient): Promise<object> {
  return text(PROJECT_TASKS_DISABLED);

  // @ts-ignore unreachable
  const { data: task, error } = await db
    .from("project_tasks")
    .update({ note1: note, sync_source: 'line' })
    .eq("task_no", taskNo)
    .select("name")
    .single();

  if (error || !task) return text(`❌ 找不到專案任務 #${taskNo}`);

  return withQuickReplies(
    text(`📝 任務 #${taskNo}「${task.name}」備註已更新：\n${note}`),
    [{ label: "🏗️ 專案列表", text: "/專案 列表" }],
  );
}

export async function cmdProjectStatus(taskNo: number, newStatus: string, db: SupabaseClient): Promise<object> {
  return text(PROJECT_TASKS_DISABLED);

  // @ts-ignore unreachable
  const validStatuses = ['未開始', '進行中', '已完成'];
  if (!validStatuses.includes(newStatus)) {
    return text(`❌ 無效狀態。請使用：${validStatuses.join('、')}`);
  }

  const updates: any = { status: newStatus, sync_source: 'line' };
  if (newStatus === '已完成') updates.actual_end = new Date().toISOString().slice(0, 10);

  const { data: task, error } = await db
    .from("project_tasks")
    .update(updates)
    .eq("task_no", taskNo)
    .select("name")
    .single();

  if (error || !task) return text(`❌ 找不到專案任務 #${taskNo}`);

  return withQuickReplies(
    text(`📋 任務 #${taskNo}「${task.name}」狀態已更新為：${newStatus}`),
    [{ label: "🏗️ 專案列表", text: "/專案 列表" }],
  );
}
