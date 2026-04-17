import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { PendingAction } from './types.ts';
import { verifySignature, getLineProfile, getGroupSummary, text, replyAndLog, pushAndLog } from './line-api.ts';
import { upsertLineUser, upsertLineGroup, upsertLineGroupMember, logMessage, logCommand, logError } from './db-helpers.ts';
import { mkBtn, withQuickReplies, flexMenu, flexSuccess, flexManagerMenu, buildWorkflowSelectionFlex } from './flex-builders.ts';
import { cmdTaskList, cmdTaskCreate, cmdTaskDone, cmdTaskUpdate, cmdTaskRequestConfirm, cmdTaskConfirmRespond, cmdNotes } from './command-handlers.ts';
import { cmdWorkflowStatus, cmdWorkflowTasks, checkManager, cmdManagerOverview, cmdManagerAssign, cmdManagerLeaveReview, cmdRegister, handleCreateTaskStep } from './command-handlers-workflow.ts';

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
  }

  const channelSecret = Deno.env.get("LINE_CHANNEL_SECRET");
  const accessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const liffNewTaskId = Deno.env.get("LIFF_NEW_TASK_ID") ?? "";

  if (!channelSecret || !accessToken) {
    console.error("Missing LINE_CHANNEL_SECRET or LINE_CHANNEL_ACCESS_TOKEN");
    return new Response("Missing LINE credentials", { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";
  const valid = await verifySignature(rawBody, signature, channelSecret);
  if (!valid) return new Response("Invalid signature", { status: 401 });

  const body = JSON.parse(rawBody);
  const db = createClient(supabaseUrl, supabaseKey);

  for (const event of body.events ?? []) {
   try {
    const isGroup = event.source?.type === "group" || event.source?.type === "room";
    const groupId: string | null = event.source?.groupId ?? event.source?.roomId ?? null;

    // ── Join / Leave ─────────────────────────────────────────────────────────
    if (event.type === "join" && groupId) {
      const summary = await getGroupSummary(groupId, accessToken);
      await upsertLineGroup(groupId, summary.groupName, db);
      await replyAndLog(event.replyToken, [
        withQuickReplies(
          { type: "flex", altText: "👋 大家好！", contents: { type: "bubble",
            header: { type: "box", layout: "vertical", paddingAll: "16px", backgroundColor: "#1A252F", contents: [
              { type: "text", text: "🏢 SME Ops 助理", weight: "bold", color: "#FFFFFF", size: "xl" },
              { type: "text", text: "已加入此群組", color: "#CCCCCC", size: "sm", margin: "xs" },
            ]},
            body: { type: "box", layout: "vertical", paddingAll: "16px", contents: [
              { type: "text", text: "我可以幫助您管理：", color: "#555555", size: "sm" },
              { type: "text", text: "📋 任務指派與追蹤", size: "sm", margin: "sm" },
              { type: "text", text: "⚙️ 工作流程狀態查詢", size: "sm", margin: "xs" },
              { type: "text", text: "👔 主管管理功能", size: "sm", margin: "xs" },
              { type: "separator", margin: "md" },
              { type: "text", text: "💡 個人任務請先私訊機器人完成帳號連結", color: "#AAAAAA", size: "xs", margin: "md", wrap: true },
            ]},
            footer: { type: "box", layout: "vertical", spacing: "xs", paddingAll: "8px", contents: [
              mkBtn("📋 任務列表", "/任務 列表", "primary"),
              mkBtn("⚙️ 流程狀態", "/流程 狀態", "secondary"),
            ]},
          }},
          [{ label: "📋 任務列表", text: "/任務 列表" }, { label: "⚙️ 流程狀態", text: "/流程 狀態" }],
        ),
      ], accessToken, db, { lineUserId: "BOT", sourceType: "group", groupId });
      continue;
    }

    if (event.type === "leave" && groupId) {
      await db.from("line_groups").update({ is_active: false }).eq("line_group_id", groupId);
      continue;
    }

    // ── Only text messages from here ─────────────────────────────────────────
    if (event.type !== "message" || event.message?.type !== "text") continue;
    if (!event.source?.userId) continue;

    const lineUserId: string = event.source.userId;
    const rawText: string = event.message.text.trim();
    const lower = rawText.toLowerCase().replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();

    const sourceType = isGroup ? "group" : "user";

    if (isGroup && groupId) {
      const summary = await getGroupSummary(groupId, accessToken);
      await upsertLineGroup(groupId, summary.groupName, db);
      await upsertLineGroupMember(lineUserId, groupId, db);
    }

    const profile = await getLineProfile(lineUserId, accessToken, groupId);

    // Log incoming message
    await logMessage(db, { lineUserId, displayName: profile.displayName, messageText: rawText, sourceType, direction: "incoming", groupId, eventType: "message" });

    const { row: lineUser } = await upsertLineUser(lineUserId, profile.displayName, db);
    if (!lineUser) continue;

    // In groups, only respond to commands (unless pending action)
    if (isGroup && !rawText.startsWith("/") && !["說明","任務","流程","管理"].some(w => rawText.startsWith(w))) {
      if (!lineUser.pending_action) continue;
    }

    // ── Handle pending conversational action ────────────────────────────────
    const pending = lineUser.pending_action as PendingAction | null;
    if (pending && !rawText.startsWith("/")) {
      if (pending.action === "add_note") {
        const { data: task } = await db.from("tasks").select("id, title, notes").eq("id", pending.task_id).maybeSingle();
        await db.from("line_users").update({ pending_action: null }).eq("id", lineUser.id);
        if (task) {
          const timestamp = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
          const newNotes = `${task.notes ? task.notes + "\n" : ""}[${timestamp}] ${rawText}`;
          await db.from("tasks").update({ notes: newNotes, updated_at: new Date().toISOString() }).eq("id", task.id);
          await replyAndLog(event.replyToken, [flexSuccess("📝", "備註已儲存", `「${task.title}」\n${rawText}`)], accessToken, db, { lineUserId, displayName: profile.displayName, sourceType, groupId });
        }
        continue;
      } else if (pending.action === "reject_reason") {
        await db.from("line_users").update({ pending_action: null }).eq("id", lineUser.id);
        const responseMsg = await cmdTaskConfirmRespond(pending.task_id, "拒絕", lineUser.employee_id!, db, accessToken, rawText.trim());
        await replyAndLog(event.replyToken, [responseMsg], accessToken, db, { lineUserId, displayName: profile.displayName, sourceType, groupId });
        continue;
      } else if (pending.action === "create_task") {
        const stepResult = await handleCreateTaskStep(lineUser, rawText, db, accessToken);
        if (stepResult) await replyAndLog(event.replyToken, [stepResult], accessToken, db, { lineUserId, displayName: profile.displayName, sourceType, groupId });
        continue;
      }
    }

    // ── Route commands ────────────────────────────────────────────────────────
    let responseMsg;
    let commandName = "unknown";
    const cmdStart = Date.now();

    if (lower === "/說明" || lower === "/help" || lower === "說明" || lower === "help") {
      commandName = "help";
      const isManager = lineUser.is_verified && lineUser.employee_id ? await checkManager(lineUser.employee_id, db) : false;
      responseMsg = flexMenu(isGroup, isManager, liffNewTaskId);

    } else if (lower.startsWith("/註冊") || lower.startsWith("註冊")) {
      commandName = "register";
      if (isGroup) {
        responseMsg = text("帳號連結請私訊機器人：\n/註冊 您的姓名");
      } else {
        const namePart = rawText.replace(/^\/?(註冊)\s*/i, "").trim();
        responseMsg = await cmdRegister(lineUser.id, namePart, db);
      }

    } else if (lower === "/任務 列表" || lower === "/task list" || lower === "任務" || lower === "/任務列表") {
      commandName = "task_list";
      if (!lineUser.is_verified || !lineUser.employee_id) {
        responseMsg = isGroup ? text(`${profile.displayName}，請先私訊機器人：\n/註冊 您的姓名`) : text("您尚未連結帳號。\n請輸入：/註冊 您的姓名");
      } else {
        responseMsg = await cmdTaskList(lineUser.employee_id, db, profile.displayName, isGroup, groupId, liffNewTaskId);
      }

    } else if (lower.startsWith("/任務 新增") || lower.startsWith("/task create")) {
      commandName = "task_create";
      if (!lineUser.is_verified || !lineUser.employee_id) {
        responseMsg = text("您尚未連結帳號。\n請輸入：/註冊 您的姓名");
      } else {
        const title = rawText.replace(/^\/任務 新增\s*|^\/task create\s*/i, "").trim();
        if (!title) {
          responseMsg = await cmdTaskCreate(lineUser.employee_id, title, db);
        } else {
          // Start multi-step creation
          const isManager = await checkManager(lineUser.employee_id, db);
          const { data: instances } = await db.from("workflow_instances").select("id, template_name").in("status", ["進行中", "已暫停"]).limit(10);
          await db.from("line_users").update({
            pending_action: { action: "create_task", step: "workflow", data: { title, source_group_id: groupId, is_manager: isManager } },
          }).eq("id", lineUser.id);
          responseMsg = buildWorkflowSelectionFlex(instances ?? [], title);
        }
      }

    } else if (lower.match(/^\/任務\s+#?(\d+)\s+完成/)) {
      commandName = "task_done";
      const m = rawText.match(/\/任務\s+#?(\d+)\s+完成/);
      const taskId = m ? parseInt(m[1], 10) : 0;
      responseMsg = await cmdTaskDone(taskId, db, accessToken);

    } else if (lower.match(/^\/任務\s+#?(\d+)\s+更新/)) {
      commandName = "task_update";
      const m = rawText.match(/\/任務\s+#?(\d+)\s+更新/);
      const taskId = m ? parseInt(m[1], 10) : 0;
      const result = await cmdTaskUpdate(taskId, db);
      responseMsg = result.msg;
      if (result.pendingAction) {
        await db.from("line_users").update({ pending_action: result.pendingAction }).eq("id", lineUser.id);
      }

    } else if (lower === "/流程 狀態" || lower === "/流程狀態" || lower === "流程") {
      commandName = "workflow_status";
      responseMsg = await cmdWorkflowStatus(db);

    } else if (lower.match(/^\/流程\s+任務\s+#?(\d+)/)) {
      commandName = "workflow_tasks";
      const m = rawText.match(/\/流程\s+任務\s+#?(\d+)/);
      const instanceId = m ? parseInt(m[1], 10) : 0;
      responseMsg = await cmdWorkflowTasks(instanceId, db);

    } else if (lower === "/管理" || lower === "/管理 功能") {
      commandName = "manager_menu";
      if (!lineUser.employee_id || !await checkManager(lineUser.employee_id, db)) {
        responseMsg = text("❌ 此功能僅限主管使用。");
      } else {
        responseMsg = flexManagerMenu();
      }

    } else if (lower === "/管理 全覽") {
      commandName = "manager_overview";
      responseMsg = await cmdManagerOverview(db);

    } else if (lower.startsWith("/管理 指派")) {
      commandName = "manager_assign";
      const parts = rawText.replace(/^\/管理 指派\s*/, "").trim().split(/\s+/);
      const nameQuery = parts[0] || "";
      const title = parts.slice(1).join(" ");
      responseMsg = await cmdManagerAssign(nameQuery, title, db, accessToken);

    } else if (lower === "/備註" || lower === "/notes") {
      commandName = "notes";
      if (!lineUser.employee_id) {
        responseMsg = text("您尚未連結帳號。");
      } else {
        responseMsg = await cmdNotes(lineUser.employee_id, db);
      }

    } else {
      // Unknown command in DM
      if (!isGroup) {
        responseMsg = withQuickReplies(text("❓ 不認識的指令。輸入 /說明 查看可用指令。"), [{ label: "📖 說明", text: "/說明" }]);
        commandName = "unknown";
      }
    }

    if (responseMsg) {
      await logCommand(db, { lineUserId, displayName: profile.displayName, commandMatched: commandName, rawInput: rawText, sourceType, groupId, success: true, executionMs: Date.now() - cmdStart });
      await replyAndLog(event.replyToken, [responseMsg], accessToken, db, { lineUserId, displayName: profile.displayName, sourceType, groupId });
    }

   } catch (err) {
    console.error("[webhook] event error:", err);
    await logError(db, { errorType: "webhook_error", errorMessage: (err as Error).message, context: { event_type: event.type } });
   }
  }

  return new Response("OK", { status: 200 });
});
