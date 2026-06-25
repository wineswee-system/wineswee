import type { SupabaseClient, PendingAction } from './types.ts';
import { priorityLabel, statusLabel, PRIORITY_COLOR, STATUS_COLOR } from './constants.ts';
import { text, pushAndLog } from './line-api.ts';
import { logCommand, logError } from './db-helpers.ts';
import {
  mkBtn, infoRow, withQuickReplies,
  flexWorkflowStatus, flexSuccess, flexManagerMenu, flexManagerOverview,
  buildWorkflowSelectionFlex, buildDueDateFlex, buildReminderFlex,
  buildOwnerSelectionFlex, buildConfirmationFlex,
} from './flex-builders.ts';

// ── Workflow Status Command ──────────────────────────────────────────────────

export async function cmdWorkflowStatus(db: SupabaseClient) {
  const { data: instances, error } = await db
    .from("workflow_instances")
    .select("id, name, status, started_at")
    .in("status", ["running", "paused"])
    .order("started_at", { ascending: false })
    .limit(8);

  if (error) console.error("cmdWorkflowStatus error:", error.message);

  // 為每個流程抓任務進度（current step、總數、卡關天數）讓 flex 顯示更詳細
  const enriched = await Promise.all((instances ?? []).map(async (wi: any) => {
    const { data: tasks } = await db
      .from("tasks")
      .select("id, title, status, updated_at, assignee:employees!tasks_assignee_id_fkey(name)")
      .eq("workflow_instance_id", wi.id)
      .order("sort_order", { ascending: true });

    const total = tasks?.length ?? 0;
    const completed = tasks?.filter((t: any) => t.status === "completed").length ?? 0;
    const cancelled = tasks?.filter((t: any) => t.status === "cancelled").length ?? 0;
    const currentTask = tasks?.find((t: any) => t.status !== "completed" && t.status !== "cancelled");
    const stuckDays = currentTask?.updated_at
      ? Math.floor((Date.now() - new Date(currentTask.updated_at).getTime()) / 86400000)
      : 0;

    return {
      ...wi,
      total,
      completed,
      effectiveTotal: Math.max(total - cancelled, 1),
      currentStepName: currentTask?.title ?? null,
      currentAssignee: (currentTask as any)?.assignee?.name ?? null,
      stuckDays,
    };
  }));

  return flexWorkflowStatus(enriched);
}

// ── Workflow Tasks Command ───────────────────────────────────────────────────

export async function cmdWorkflowTasks(shortId: string, db: SupabaseClient, showAll = false, liffTaskId = "") {
  if (!shortId) return text("請提供流程 ID。例如：/流程 任務 #abc123");

  const { data: allInstances } = await db
    .from("workflow_instances")
    .select("id, name")
    .in("status", ["running", "paused"])
    .limit(100);

  const instance = allInstances?.find((i: any) => i.id.startsWith(shortId));
  if (!instance) return text(`❌ 找不到 ID 為 ${shortId} 的進行中流程。`);

  const baseQuery = db
    .from("tasks")
    .select("id, title, status, priority, due_date, notes, assignee:employees!tasks_assignee_id_fkey(name)")
    .eq("workflow_instance_id", instance.id);

  const { data: tasks } = await (showAll
    ? baseQuery
        .order("status", { ascending: false })  // desc: pending → in_progress → completed → cancelled → blocked
        .order("priority", { ascending: false })
        .limit(30)
    : baseQuery.in("status", ["in_progress"]).order("priority", { ascending: false }).limit(10));

  if (!tasks || tasks.length === 0) {
    const emptyMsg = showAll
      ? `📭 「${instance.name}」目前沒有任務。`
      : `🔄 「${instance.name}」目前沒有進行中的任務。`;
    return withQuickReplies(
      text(emptyMsg),
      [{ label: "⚙️ 流程狀態", text: "/流程 狀態" }],
    );
  }

  // Build one bubble per task (carousel / horizontal slider)
  const bubbles: any[] = tasks.map((t: any) => {
    const shortTaskId = String(t.id).slice(0, 6);
    const due = t.due_date ? t.due_date.slice(0, 10) : "無截止日";
    const pColor = PRIORITY_COLOR[t.priority] ?? "#95A5A6";
    const sColor = STATUS_COLOR[t.status] ?? "#95A5A6";
    const assigneeName = t.assignee?.name ?? "—";
    const isDone = t.status === "completed";

    // Show last note line, truncated
    const lastNote = t.notes
      ? t.notes.trim().split("\n").pop()?.slice(0, 55) + (t.notes.trim().length > 55 ? "…" : "")
      : null;

    const bodyItems: any[] = [
      {
        type: "box", layout: "horizontal", spacing: "sm",
        contents: [
          { type: "text", text: "狀態", color: "#AAAAAA", size: "xs", flex: 2 },
          { type: "text", text: statusLabel(t.status), color: sColor, size: "xs", weight: "bold", flex: 5, wrap: true },
        ],
      },
      {
        type: "box", layout: "horizontal", spacing: "sm", margin: "xs",
        contents: [
          { type: "text", text: "負責人", color: "#AAAAAA", size: "xs", flex: 2 },
          { type: "text", text: assigneeName, size: "xs", flex: 5, wrap: true },
        ],
      },
      {
        type: "box", layout: "horizontal", spacing: "sm", margin: "xs",
        contents: [
          { type: "text", text: "截止日", color: "#AAAAAA", size: "xs", flex: 2 },
          { type: "text", text: due, size: "xs", flex: 5 },
        ],
      },
      {
        type: "box", layout: "horizontal", spacing: "sm", margin: "xs",
        contents: [
          { type: "text", text: "優先", color: "#AAAAAA", size: "xs", flex: 2 },
          { type: "text", text: priorityLabel(t.priority), color: pColor, size: "xs", weight: "bold", flex: 5 },
        ],
      },
    ];

    if (lastNote) {
      bodyItems.push({ type: "separator", margin: "sm" });
      bodyItems.push({
        type: "box", layout: "vertical", margin: "sm",
        contents: [
          { type: "text", text: "📝 備註", color: "#AAAAAA", size: "xxs" },
          { type: "text", text: lastNote, size: "xxs", wrap: true, margin: "xs", color: "#555555" },
        ],
      });
    }

    // Footer：完成 + 延 1d + 備註 全部 postback；更新任務改開 LIFF
    const footerRows: any[] = [];
    if (!isDone) {
      footerRows.push({
        type: "button",
        action: { type: "postback", label: "✅ 完成任務", data: `action=complete&type=task&id=${t.id}` },
        style: "primary", height: "sm", color: "#27AE60",
      });
      footerRows.push({
        type: "box", layout: "horizontal", spacing: "xs",
        contents: [
          {
            type: "button", flex: 1,
            action: { type: "postback", label: "⏰ 延 1d", data: `action=postpone&type=task&id=${t.id}&days=1` },
            style: "secondary", height: "sm",
          },
          {
            type: "button", flex: 1,
            action: { type: "postback", label: "📝 備註", data: `action=note&type=task&id=${t.id}` },
            style: "secondary", height: "sm",
          },
        ],
      });
    } else {
      footerRows.push({
        type: "button",
        action: { type: "postback", label: "📝 加備註", data: `action=note&type=task&id=${t.id}` },
        style: "secondary", height: "sm",
      });
    }
    if (liffTaskId) {
      footerRows.push({
        type: "button",
        action: { type: "uri", label: "✏️ 開 LIFF 編輯", uri: `https://liff.line.me/${liffTaskId}?to=${encodeURIComponent(`/tasks?task=${t.id}`)}` },
        style: "link", height: "sm",
      });
    }

    return {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: pColor,
        contents: [
          { type: "text", text: instance.name, color: "#FFFFFF99", size: "xxs", weight: "bold" },
          { type: "text", text: t.title, color: "#FFFFFF", weight: "bold", size: "sm", wrap: true, maxLines: 3, margin: "xs" },
          { type: "text", text: `#${shortTaskId}`, color: "#FFFFFF99", size: "xxs", margin: "xs" },
        ],
      },
      body: { type: "box", layout: "vertical", paddingAll: "12px", contents: bodyItems },
      footer: { type: "box", layout: "vertical", paddingAll: "8px", spacing: "xs", contents: footerRows },
    };
  });

  // Navigation card at the end of the carousel
  bubbles.push({
    type: "bubble",
    body: {
      type: "box", layout: "vertical", paddingAll: "16px", justifyContent: "center", spacing: "sm",
      contents: [
        { type: "text", text: `⚙️ ${instance.name}`, weight: "bold", size: "sm", wrap: true, align: "center" },
        { type: "text", text: `${showAll ? "全部" : "進行中"}任務：${tasks.length} 件`, color: "#AAAAAA", size: "xs", align: "center" },
        { type: "separator", margin: "lg" },
        showAll
          ? mkBtn("🔄 進行中任務", `/流程 任務 #${shortId}`, "secondary")
          : mkBtn("📋 全部任務", `/流程 任務 #${shortId} 全部`, "secondary"),
        mkBtn("⚙️ 流程列表", "/流程 狀態", "secondary"),
      ],
    },
  } as any);

  return withQuickReplies(
    {
      type: "flex",
      altText: `⚙️ ${instance.name} 的任務（${tasks.length} 件）`,
      contents: { type: "carousel", contents: bubbles },
    },
    [{ label: "⚙️ 流程狀態", text: "/流程 狀態" }, { label: "📋 我的任務", text: "/任務 列表" }],
  );
}

// ── Manager Helper ───────────────────────────────────────────────────────────

export async function checkManager(userId: string, db: SupabaseClient): Promise<boolean> {
  const { data } = await db.from("employees").select("is_line_manager").eq("id", userId).maybeSingle();
  return data?.is_line_manager === true;
}

// ── Manager Overview Command ─────────────────────────────────────────────────

export async function cmdManagerOverview(db: SupabaseClient) {
  const { data: tasks } = await db
    .from("tasks")
    .select("id, title, priority, due_date, assignee:employees!tasks_assignee_id_fkey(name)")
    .eq("status", "in_progress")
    .order("priority", { ascending: false })
    .limit(10);

  return flexManagerOverview(tasks ?? []);
}

// ── Manager Assign Command ───────────────────────────────────────────────────

export async function cmdManagerAssign(nameQuery: string, title: string, db: SupabaseClient, accessToken: string) {
  if (!nameQuery || !title) {
    return withQuickReplies(
      {
        type: "flex",
        altText: "➕ 指派任務",
        contents: {
          type: "bubble",
          header: {
            type: "box",
            layout: "vertical",
            paddingAll: "12px",
            backgroundColor: "#1A252F",
            contents: [{ type: "text", text: "➕ 指派任務", color: "#FFFFFF", weight: "bold", size: "lg" }],
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
                  { type: "text", text: "/管理 指派 [員工姓名] [任務標題]", size: "sm", color: "#1A252F", weight: "bold" },
                ],
              },
              { type: "text", text: "例如：", color: "#AAAAAA", size: "xs", margin: "md" },
              { type: "text", text: "/管理 指派 張小明 盤點倉庫庫存", size: "sm", color: "#333333", margin: "xs" },
            ],
          },
        },
      },
      [{ label: "📊 團隊全覽", text: "/管理 全覽" }],
    );
  }

  const { data: users } = await db
    .from("employees")
    .select("id, name")
    .ilike("name", `%${nameQuery}%`)
    .eq("status", "在職")
    .limit(3);

  if (!users?.length) return text(`❌ 找不到員工「${nameQuery}」`);
  if (users.length > 1) {
    const list = users.map((u: any) => `• ${u.name}`).join("\n");
    return text(`找到多位符合的員工，請輸入完整姓名：\n${list}`);
  }

  const assignee = users[0];
  const { error } = await db.from("tasks").insert({
    title,
    assignee_id: assignee.id,
    status: "進行中",
    priority: "中",
  });

  if (error) return text(`❌ 指派失敗：${error.message}`);

  // Push notification to assignee if they have LINE linked
  const { data: lineUser } = await db
    .from("line_users")
    .select("line_user_id")
    .eq("employee_id", assignee.id)
    .eq("is_verified", true)
    .maybeSingle();

  if (lineUser?.line_user_id) {
    await pushAndLog(lineUser.line_user_id, [
      withQuickReplies(
        {
          type: "flex",
          altText: `🔔 新任務已指派：${title}`,
          contents: {
            type: "bubble",
            header: {
              type: "box",
              layout: "vertical",
              paddingAll: "12px",
              backgroundColor: "#E67E22",
              contents: [
                { type: "text", text: "🔔 新任務已指派給您", color: "#FFFFFF", weight: "bold", size: "md" },
                { type: "text", text: "管理員已指派以下任務", color: "#FFFFFF", size: "xs", margin: "xs" },
              ],
            },
            body: {
              type: "box",
              layout: "vertical",
              paddingAll: "14px",
              contents: [
                { type: "text", text: title, weight: "bold", size: "lg", wrap: true },
                { type: "separator", margin: "md" },
                infoRow("優先", priorityLabel("medium"), "#E67E22"),
                infoRow("狀態", "進行中", "#2980B9"),
              ],
            },
            footer: {
              type: "box",
              layout: "vertical",
              paddingAll: "8px",
              contents: [mkBtn("📋 查看我的任務", "/任務 列表", "primary")],
            },
          },
        },
        [{ label: "📋 任務列表", text: "/任務 列表" }],
      ),
    ], accessToken, db, { sourceType: "user" });
  }

  return flexSuccess("✅", "任務已指派", `「${title}」已指派給 ${assignee.name}`);
}

// ── Manager Leave Review Command ─────────────────────────────────────────────
// NOTE: This function is referenced in the original code but was never defined.
// Preserving the call signature to maintain existing behavior.

export async function cmdManagerLeaveReview(leaveId: string, isApprove: boolean, db: SupabaseClient, userId: string): Promise<object> {
  const newStatus = isApprove ? 'approved' : 'rejected';
  const { data: leave, error } = await db
    .from('leave_requests')
    .update({ status: newStatus, reviewed_by: userId, reviewed_at: new Date().toISOString() })
    .eq('id', leaveId)
    .select('id, employee_id, leave_type, start_date, end_date')
    .single();

  if (error || !leave) {
    return text(`❌ 找不到請假記錄或更新失敗。`);
  }

  const actionLabel = isApprove ? '核准' : '退回';
  return flexSuccess(isApprove ? '✅' : '❌', `請假已${actionLabel}`, `請假記錄 ${String(leaveId).slice(0, 6)} 已${actionLabel}`);
}

// ── Enhanced Task Creation: Multi-Step Conversational Flow ──────────────────

export function parseChineseDate(input: string): string | null {
  // ISO format: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  // MM/DD or MM-DD (assume current year)
  const mdMatch = input.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (mdMatch) {
    const year = new Date().getFullYear();
    return `${year}-${mdMatch[1].padStart(2, "0")}-${mdMatch[2].padStart(2, "0")}`;
  }
  // Relative Chinese dates
  const now = new Date();
  const toISO = (d: Date) => d.toISOString().slice(0, 10);
  if (input === "今天") return toISO(now);
  if (input === "明天") { now.setDate(now.getDate() + 1); return toISO(now); }
  if (input === "後天") { now.setDate(now.getDate() + 2); return toISO(now); }
  // "下週X" pattern
  const weekdayMap: Record<string, number> = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 0, "天": 0 };
  const weekMatch = input.match(/^下週(.)$/);
  if (weekMatch && weekdayMap[weekMatch[1]] !== undefined) {
    const target = weekdayMap[weekMatch[1]];
    const current = now.getDay();
    const daysUntil = ((target - current + 7) % 7) + 7;
    now.setDate(now.getDate() + daysUntil);
    return toISO(now);
  }
  // "X天後" pattern
  const daysLater = input.match(/^(\d+)天後$/);
  if (daysLater) { now.setDate(now.getDate() + parseInt(daysLater[1], 10)); return toISO(now); }
  return null;
}

export async function handleCreateTaskStep(
  lineUser: any,
  rawText: string,
  db: SupabaseClient,
  accessToken: string,
): Promise<object | null> {
  const pending = lineUser.pending_action as PendingAction;
  if (pending.action !== "create_task") return text("❓ 狀態異常，請重新開始。");

  const { step, data } = pending;
  const lower = rawText.toLowerCase().trim();
  const totalSteps = data.is_manager ? 4 : 3;

  // Allow cancellation at any step
  if (lower === "取消" || lower === "cancel") {
    await db.from("line_users").update({ pending_action: null }).eq("id", lineUser.id);
    return text("❌ 已取消任務建立。");
  }

  switch (step) {
    case "workflow": {
      if (lower === "跳過" || lower === "skip" || lower === "0") {
        data.workflow_instance_id = null;
        data.workflow_name = null;
      } else {
        const { data: instances } = await db
          .from("workflow_instances").select("id, name")
          .in("status", ["running", "paused"]).limit(10);
        const idx = parseInt(lower, 10);
        let matched = null;
        if (!isNaN(idx) && idx >= 1 && idx <= (instances?.length ?? 0)) {
          matched = instances![idx - 1];
        } else {
          matched = instances?.find((i: any) => i.name.includes(rawText.trim()));
        }
        if (!matched) {
          return text(`❌ 無效的選擇。請輸入編號(1-${instances?.length ?? 0})、流程名稱，或輸入「跳過」。`);
        }
        data.workflow_instance_id = matched.id;
        data.workflow_name = matched.name;
      }
      await db.from("line_users").update({
        pending_action: { action: "create_task", step: "due_date", data } as PendingAction,
      }).eq("id", lineUser.id);
      return buildDueDateFlex(data.title, 2, totalSteps);
    }

    case "due_date": {
      if (lower === "跳過" || lower === "skip") {
        data.due_date = null;
      } else {
        const parsed = parseChineseDate(rawText.trim());
        if (!parsed) return text("❌ 無法識別日期。請輸入 YYYY-MM-DD 格式（如 2026-04-01），或輸入「跳過」。");
        data.due_date = parsed;
      }
      await db.from("line_users").update({
        pending_action: { action: "create_task", step: "reminder", data } as PendingAction,
      }).eq("id", lineUser.id);
      return buildReminderFlex(data.title, 3, totalSteps);
    }

    case "reminder": {
      if (lower === "跳過" || lower === "skip") {
        data.reminder = null;
      } else {
        data.reminder = rawText.trim();
      }
      if (data.is_manager) {
        // Manager: go to owner selection
        const { data: employees } = await db
          .from("employees").select("id, name").eq("status", "在職").order("name").limit(20);
        await db.from("line_users").update({
          pending_action: { action: "create_task", step: "owner", data } as PendingAction,
        }).eq("id", lineUser.id);
        return buildOwnerSelectionFlex(employees ?? [], data.title);
      } else {
        // Non-manager: skip to confirm
        data.owner_employee_id = null;
        data.owner_name = null;
        await db.from("line_users").update({
          pending_action: { action: "create_task", step: "confirm", data } as PendingAction,
        }).eq("id", lineUser.id);
        return buildConfirmationFlex(data);
      }
    }

    case "owner": {
      if (lower === "跳過" || lower === "skip" || lower === "自己" || lower === "我") {
        data.owner_employee_id = null;
        data.owner_name = null;
      } else {
        const { data: allActive } = await db
          .from("employees").select("id, name").eq("status", "在職").order("name").limit(20);
        const idx = parseInt(lower, 10);
        let matched = null;
        if (!isNaN(idx) && idx >= 1 && idx <= (allActive?.length ?? 0)) {
          matched = allActive![idx - 1];
        } else {
          const byName = allActive?.filter((u: any) => u.name.includes(rawText.trim()));
          if (byName?.length === 1) {
            matched = byName[0];
          } else if (byName && byName.length > 1) {
            return text(`找到多位員工，請輸入完整姓名或編號：\n${byName.map((u: any) => `• ${u.name}`).join("\n")}`);
          }
        }
        if (!matched) return text("❌ 找不到該員工。請重新輸入姓名或編號，或輸入「自己」。");
        data.owner_employee_id = matched.id;
        data.owner_name = matched.name;
      }
      await db.from("line_users").update({
        pending_action: { action: "create_task", step: "confirm", data } as PendingAction,
      }).eq("id", lineUser.id);
      return buildConfirmationFlex(data);
    }

    case "confirm": {
      if (lower === "確認" || lower === "yes" || lower === "ok" || lower === "y") {
        return await finalizeTaskCreation(lineUser, data, db, accessToken);
      } else if (lower === "取消" || lower === "no" || lower === "n") {
        await db.from("line_users").update({ pending_action: null }).eq("id", lineUser.id);
        return text("❌ 已取消任務建立。");
      } else {
        return text("請輸入「確認」建立任務，或「取消」放棄。");
      }
    }

    default:
      await db.from("line_users").update({ pending_action: null }).eq("id", lineUser.id);
      return text("❓ 狀態異常，已重設。請重新開始。");
  }
}

async function finalizeTaskCreation(
  lineUser: any,
  data: Record<string, any>,
  db: SupabaseClient,
  accessToken: string,
): Promise<object> {
  const assignedTo = data.owner_employee_id ?? lineUser.employee_id;

  const insertPayload: Record<string, any> = {
    title: data.title,
    assignee_id: assignedTo,
    status: "待處理",
    priority: "中",
  };

  if (data.workflow_instance_id) insertPayload.workflow_instance_id = data.workflow_instance_id;
  if (data.due_date) insertPayload.due_date = data.due_date;
  if (data.reminder) insertPayload.metadata = { reminder: data.reminder };

  const { data: newTask, error } = await db.from("tasks")
    .insert(insertPayload)
    .select("id")
    .single();

  // Clear pending_action
  await db.from("line_users").update({ pending_action: null }).eq("id", lineUser.id);

  if (error) {
    await logError(db, {
      lineUserId: lineUser.line_user_id,
      errorType: "db_error",
      errorMessage: error.message,
      context: { function: "finalizeTaskCreation", title: data.title },
    });
    return text(`❌ 建立失敗：${error.message}`);
  }

  // Log the created task
  await logCommand(db, {
    lineUserId: lineUser.line_user_id,
    commandMatched: "task_created",
    rawInput: data.title,
    sourceType: data.source_group_id ? "group" : "user",
    groupId: data.source_group_id,
    success: true,
    createdEntityType: "task",
    createdEntityId: newTask?.id,
    metadata: { workflow_instance_id: data.workflow_instance_id, due_date: data.due_date, assignee_id: assignedTo },
  });

  // Notify the originating group if initiated from a group
  if (data.source_group_id) {
    await pushAndLog(data.source_group_id, [
      text(`✅ 任務「${data.title}」已建立！${data.owner_name ? `（負責人：${data.owner_name}）` : ""}`),
    ], accessToken, db, { sourceType: "group", groupId: data.source_group_id });
  }

  // Notify the assignee if assigned to someone else
  if (data.owner_employee_id && data.owner_employee_id !== lineUser.employee_id) {
    const { data: assigneeLineUser } = await db
      .from("line_users")
      .select("line_user_id")
      .eq("employee_id", data.owner_employee_id)
      .eq("is_verified", true)
      .maybeSingle();
    if (assigneeLineUser?.line_user_id) {
      await pushAndLog(assigneeLineUser.line_user_id, [
        text(`🔔 您有新任務：「${data.title}」${data.due_date ? `\n📅 截止日：${data.due_date}` : ""}`),
      ], accessToken, db, { sourceType: "user" });
    }
  }

  const summary = [
    `「${data.title}」已加入待處理清單`,
    data.workflow_name ? `📂 流程：${data.workflow_name}` : null,
    data.due_date ? `📅 截止：${data.due_date}` : null,
    data.owner_name ? `👤 負責人：${data.owner_name}` : null,
  ].filter(Boolean).join("\n");

  return flexSuccess("✅", "任務已建立", summary);
}

// ── Registration Command ─────────────────────────────────────────────────────

export async function cmdRegister(
  lineUserRowId: string,
  namePart: string,
  db: SupabaseClient,
  channelId: number,
  lineUserId: string,
  displayName: string,
  pictureUrl: string | null = null,
) {
  if (!namePart) return text("請提供姓名。例如：/註冊 張小明 或 /註冊 John");

  const { data: users } = await db
    .from("employees")
    .select("id, name, name_en")
    .or(`name.ilike.%${namePart}%,name_en.ilike.%${namePart}%`)
    .eq("status", "在職")
    .limit(5);

  if (!users || users.length === 0) {
    return text(`❌ 找不到「${namePart}」的員工記錄。\n請確認姓名或英文名正確，或聯絡管理員。`);
  }
  if (users.length > 1) {
    const list = users.map((u: any) => {
      const eng = u.name_en ? ` (${u.name_en})` : "";
      return `• ${u.name}${eng}`;
    }).join("\n");
    return text(`找到多位符合的員工，請輸入完整姓名：\n${list}`);
  }

  const user = users[0];

  // First binding for this employee (across all OAs) becomes primary.
  const { data: existing } = await db
    .from("employee_line_accounts")
    .select("id")
    .eq("employee_id", user.id)
    .limit(1);
  const isPrimary = !existing || existing.length === 0;

  const now = new Date().toISOString();
  await db.from("employee_line_accounts")
    .upsert(
      {
        employee_id: user.id,
        channel_id: channelId,
        line_user_id: lineUserId,
        display_name: displayName,
        picture_url: pictureUrl,
        is_primary: isPrimary,
        is_verified: true,
        linked_at: now,
        last_active_at: now,
      },
      { onConflict: "channel_id,line_user_id" },
    );

  await db.from("line_users")
    .update({ employee_id: user.id, is_verified: true })
    .eq("id", lineUserRowId);

  const primaryNote = isPrimary ? "" : "\n（已綁定於其他 OA，此 OA 作為次要接收者）";
  return withQuickReplies(
    flexSuccess("🎉", `歡迎，${user.name}！`, `帳號連結成功！您現在可以使用所有功能。${primaryNote}`),
    [
      { label: "📋 任務列表", text: "/任務 列表" },
      { label: "📖 所有指令", text: "/說明" },
    ],
  );
}
