import type { SupabaseClient, PendingAction } from './types.ts';
import { priorityLabel, statusLabel } from './constants.ts';
import { text, pushAndLog } from './line-api.ts';
import { logCommand, logError } from './db-helpers.ts';
import { mkBtn, infoRow, withQuickReplies, flexWorkflowStatus, flexSuccess, flexManagerMenu, flexManagerOverview, buildWorkflowSelectionFlex, buildDueDateFlex, buildReminderFlex, buildOwnerSelectionFlex, buildConfirmationFlex } from './flex-builders.ts';

// ── Workflow Status ────────────────────────────────────────────────────────────

export async function cmdWorkflowStatus(db: SupabaseClient) {
  const { data: instances } = await db.from("workflow_instances")
    .select("id, template_name, status, created_at")
    .in("status", ["進行中", "已暫停"])
    .order("created_at", { ascending: false }).limit(8);

  return flexWorkflowStatus(instances ?? []);
}

// ── Workflow Tasks ─────────────────────────────────────────────────────────────

export async function cmdWorkflowTasks(instanceId: number, db: SupabaseClient) {
  const { data: tasks } = await db.from("tasks").select("id, title, status, priority, due_date, assignee")
    .eq("workflow_instance_id", instanceId)
    .in("status", ["未開始", "進行中", "待處理"])
    .order("sort_order").limit(10);

  if (!tasks?.length) return text("目前沒有待辦任務。");

  const lines = tasks.map((t: any) => `#${t.id} ${statusLabel(t.status)} ${t.title}${t.assignee ? ` (${t.assignee})` : ""}`).join("\n");
  return text(`📋 流程 #${instanceId} 的任務：\n\n${lines}`);
}

// ── Manager Check ──────────────────────────────────────────────────────────────

export async function checkManager(employeeId: number, db: SupabaseClient): Promise<boolean> {
  const { data } = await db.from("employees").select("is_line_manager, is_manager").eq("id", employeeId).maybeSingle();
  return data?.is_line_manager === true || data?.is_manager === true;
}

// ── Manager Overview ───────────────────────────────────────────────────────────

export async function cmdManagerOverview(db: SupabaseClient) {
  const { data: tasks } = await db.from("tasks")
    .select("id, title, priority, due_date, assignee")
    .in("status", ["未開始", "進行中"])
    .order("priority", { ascending: false }).limit(10);

  return flexManagerOverview(tasks ?? []);
}

// ── Manager Assign ─────────────────────────────────────────────────────────────

export async function cmdManagerAssign(nameQuery: string, title: string, db: SupabaseClient, accessToken: string) {
  if (!nameQuery || !title) return text("格式：/管理 指派 [員工姓名] [任務標題]\n例如：/管理 指派 張小明 整理庫存");

  const { data: emps } = await db.from("employees").select("id, name, line_user_id")
    .ilike("name", `%${nameQuery}%`).eq("status", "在職").limit(3);

  if (!emps?.length) return text(`❌ 找不到員工「${nameQuery}」`);
  if (emps.length > 1) return text(`找到多位員工，請輸入完整姓名：\n${emps.map((u: any) => `• ${u.name}`).join("\n")}`);

  const assignee = emps[0];
  const { error } = await db.from("tasks").insert({
    title, assignee: assignee.name, assignee_id: assignee.id, status: "未開始", priority: "中",
  });

  if (error) return text(`❌ 指派失敗：${error.message}`);

  // Push notification to assignee
  if (assignee.line_user_id) {
    const { data: lineUser } = await db.from("line_users").select("line_user_id")
      .eq("employee_id", assignee.id).eq("is_verified", true).maybeSingle();
    if (lineUser?.line_user_id) {
      await pushAndLog(lineUser.line_user_id, [
        text(`🔔 新任務已指派給您：「${title}」`),
      ], accessToken, db, { sourceType: "user" });
    }
  }

  return flexSuccess("✅", "任務已指派", `「${title}」已指派給 ${assignee.name}`);
}

// ── Manager Leave Review ───────────────────────────────────────────────────────

export async function cmdManagerLeaveReview(leaveId: number, isApprove: boolean, db: SupabaseClient) {
  const newStatus = isApprove ? "已核准" : "已拒絕";
  const { error } = await db.from("leave_requests").update({ status: newStatus }).eq("id", leaveId);
  if (error) return text(`❌ 更新失敗：${error.message}`);
  return flexSuccess(isApprove ? "✅" : "❌", `請假已${isApprove ? "核准" : "退回"}`, `請假記錄 #${leaveId}`);
}

// ── Registration ───────────────────────────────────────────────────────────────

export async function cmdRegister(lineUserRowId: number, namePart: string, db: SupabaseClient) {
  if (!namePart) return text("請提供姓名。例如：/註冊 張小明");

  const { data: emps } = await db.from("employees")
    .select("id, name, name_en")
    .or(`name.ilike.%${namePart}%,name_en.ilike.%${namePart}%`)
    .eq("status", "在職").limit(5);

  if (!emps?.length) return text(`❌ 找不到「${namePart}」的員工記錄。\n請確認姓名正確，或聯絡管理員。`);
  if (emps.length > 1) {
    const list = emps.map((e: any) => `• ${e.name}${e.name_en ? ` (${e.name_en})` : ""}`).join("\n");
    return text(`找到多位符合的員工，請輸入完整姓名：\n${list}`);
  }

  const emp = emps[0];
  await db.from("line_users").update({ employee_id: emp.id, is_verified: true }).eq("id", lineUserRowId);

  return withQuickReplies(
    flexSuccess("🎉", `歡迎，${emp.name}！`, "帳號連結成功！您現在可以使用所有功能。"),
    [{ label: "📋 任務列表", text: "/任務 列表" }, { label: "📖 所有指令", text: "/說明" }],
  );
}

// ── Enhanced Task Creation: Multi-Step Flow ──────────────────────────────────

export function parseChineseDate(input: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const mdMatch = input.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (mdMatch) return `${new Date().getFullYear()}-${mdMatch[1].padStart(2, "0")}-${mdMatch[2].padStart(2, "0")}`;

  const now = new Date();
  const toISO = (d: Date) => d.toISOString().slice(0, 10);
  if (input === "今天") return toISO(now);
  if (input === "明天") { now.setDate(now.getDate() + 1); return toISO(now); }
  if (input === "後天") { now.setDate(now.getDate() + 2); return toISO(now); }

  const weekdayMap: Record<string, number> = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 0, "天": 0 };
  const weekMatch = input.match(/^下週(.)$/);
  if (weekMatch && weekdayMap[weekMatch[1]] !== undefined) {
    const target = weekdayMap[weekMatch[1]];
    const current = now.getDay();
    now.setDate(now.getDate() + ((target - current + 7) % 7) + 7);
    return toISO(now);
  }

  const daysLater = input.match(/^(\d+)天後$/);
  if (daysLater) { now.setDate(now.getDate() + parseInt(daysLater[1], 10)); return toISO(now); }
  return null;
}

export async function handleCreateTaskStep(lineUser: any, rawText: string, db: SupabaseClient, accessToken: string): Promise<object | null> {
  const pending = lineUser.pending_action as PendingAction;
  if (pending.action !== "create_task") return text("❓ 狀態異常，請重新開始。");

  const { step, data } = pending;
  const lower = rawText.toLowerCase().trim();
  const totalSteps = data.is_manager ? 4 : 3;

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
        const { data: instances } = await db.from("workflow_instances").select("id, template_name")
          .in("status", ["進行中", "已暫停"]).limit(10);
        const idx = parseInt(lower, 10);
        let matched = null;
        if (!isNaN(idx) && idx >= 1 && idx <= (instances?.length ?? 0)) matched = instances![idx - 1];
        else matched = instances?.find((i: any) => (i.template_name || "").includes(rawText.trim()));
        if (!matched) return text(`❌ 無效的選擇。請輸入編號或「跳過」。`);
        data.workflow_instance_id = matched.id;
        data.workflow_name = matched.template_name;
      }
      await db.from("line_users").update({ pending_action: { action: "create_task", step: "due_date", data } }).eq("id", lineUser.id);
      return buildDueDateFlex(data.title, 2, totalSteps);
    }

    case "due_date": {
      if (lower === "跳過" || lower === "skip") { data.due_date = null; }
      else {
        const parsed = parseChineseDate(rawText.trim());
        if (!parsed) return text("❌ 無法識別日期。請輸入 YYYY-MM-DD 或「跳過」。");
        data.due_date = parsed;
      }
      await db.from("line_users").update({ pending_action: { action: "create_task", step: "reminder", data } }).eq("id", lineUser.id);
      return buildReminderFlex(data.title, 3, totalSteps);
    }

    case "reminder": {
      data.reminder = (lower === "跳過" || lower === "skip") ? null : rawText.trim();
      if (data.is_manager) {
        const { data: emps } = await db.from("employees").select("id, name").eq("status", "在職").order("name").limit(20);
        await db.from("line_users").update({ pending_action: { action: "create_task", step: "owner", data } }).eq("id", lineUser.id);
        return buildOwnerSelectionFlex(emps ?? [], data.title);
      }
      data.owner_id = null; data.owner_name = null;
      await db.from("line_users").update({ pending_action: { action: "create_task", step: "confirm", data } }).eq("id", lineUser.id);
      return buildConfirmationFlex(data);
    }

    case "owner": {
      if (lower === "跳過" || lower === "skip" || lower === "自己" || lower === "我") {
        data.owner_id = null; data.owner_name = null;
      } else {
        const { data: allActive } = await db.from("employees").select("id, name").eq("status", "在職").order("name").limit(20);
        const idx = parseInt(lower, 10);
        let matched = null;
        if (!isNaN(idx) && idx >= 1 && idx <= (allActive?.length ?? 0)) matched = allActive![idx - 1];
        else {
          const byName = allActive?.filter((u: any) => u.name.includes(rawText.trim()));
          if (byName?.length === 1) matched = byName[0];
          else if (byName && byName.length > 1) return text(`找到多位員工：\n${byName.map((u: any) => `• ${u.name}`).join("\n")}`);
        }
        if (!matched) return text("❌ 找不到該員工。請重新輸入或「自己」。");
        data.owner_id = matched.id; data.owner_name = matched.name;
      }
      await db.from("line_users").update({ pending_action: { action: "create_task", step: "confirm", data } }).eq("id", lineUser.id);
      return buildConfirmationFlex(data);
    }

    case "confirm": {
      if (lower === "確認" || lower === "yes" || lower === "ok" || lower === "y") {
        return await finalizeTaskCreation(lineUser, data, db, accessToken);
      } else if (lower === "取消" || lower === "no" || lower === "n") {
        await db.from("line_users").update({ pending_action: null }).eq("id", lineUser.id);
        return text("❌ 已取消任務建立。");
      }
      return text("請輸入「確認」建立任務，或「取消」放棄。");
    }

    default:
      await db.from("line_users").update({ pending_action: null }).eq("id", lineUser.id);
      return text("❓ 狀態異常，已重設。");
  }
}

async function finalizeTaskCreation(lineUser: any, data: Record<string, any>, db: SupabaseClient, accessToken: string) {
  const assigneeId = data.owner_id ?? lineUser.employee_id;
  const assigneeName = data.owner_name ?? null;

  const payload: Record<string, any> = {
    title: data.title, assignee_id: assigneeId, status: "未開始", priority: "中",
  };
  if (assigneeName) payload.assignee = assigneeName;
  if (data.workflow_instance_id) payload.workflow_instance_id = data.workflow_instance_id;
  if (data.due_date) payload.due_date = data.due_date;
  if (data.reminder) payload.metadata = { reminder: data.reminder };

  const { data: newTask, error } = await db.from("tasks").insert(payload).select("id").single();
  await db.from("line_users").update({ pending_action: null }).eq("id", lineUser.id);

  if (error) return text(`❌ 建立失敗：${error.message}`);

  // Notify group
  if (data.source_group_id) {
    await pushAndLog(data.source_group_id, [text(`✅ 任務「${data.title}」已建立！${data.owner_name ? `（${data.owner_name}）` : ""}`)], accessToken, db, { sourceType: "group", groupId: data.source_group_id });
  }

  // Notify assignee
  if (data.owner_id && data.owner_id !== lineUser.employee_id) {
    const { data: lu } = await db.from("line_users").select("line_user_id").eq("employee_id", data.owner_id).eq("is_verified", true).maybeSingle();
    if (lu?.line_user_id) {
      await pushAndLog(lu.line_user_id, [text(`🔔 新任務：「${data.title}」${data.due_date ? `\n📅 截止：${data.due_date}` : ""}`)], accessToken, db, { sourceType: "user" });
    }
  }

  const summary = [`「${data.title}」已建立`, data.workflow_name ? `📂 ${data.workflow_name}` : null, data.due_date ? `📅 ${data.due_date}` : null, data.owner_name ? `👤 ${data.owner_name}` : null].filter(Boolean).join("\n");
  return flexSuccess("✅", "任務已建立", summary);
}
