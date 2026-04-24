import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { PendingAction } from './types.ts';
import { verifySignature, getLineProfile, getGroupSummary, text, replyAndLog, pushAndLog } from './line-api.ts';
import { upsertLineUser, upsertLineGroup, upsertLineGroupMember, logMessage, logCommand, logError } from './db-helpers.ts';
import { mkBtn, withQuickReplies, flexMenu, flexSuccess, flexManagerMenu, buildWorkflowSelectionFlex, flexLiffShortcut, flexAttendanceCard } from './flex-builders.ts';
import { cmdTaskList, cmdTaskCreate, cmdTaskDone, cmdTaskUpdate, cmdTaskRequestConfirm, cmdTaskConfirmRespond, cmdNotes, cmdProjectList, cmdProjectDone, cmdProjectNote, cmdProjectStatus } from './command-handlers.ts';
import { cmdWorkflowStatus, cmdWorkflowTasks, checkManager, cmdManagerOverview, cmdManagerAssign, cmdManagerLeaveReview, cmdRegister, handleCreateTaskStep } from './command-handlers-workflow.ts';
import { resolveChannel, resolveEnv } from '../_shared/channel.ts';

// LIFF deeplink shortcuts — text command → LIFF page on sme-ops-liff
type LiffShortcut = { key: string; match: string[]; title: string; subtitle: string; buttonLabel: string; path: string; emoji: string };
const LIFF_SHORTCUTS: LiffShortcut[] = [
  { key: "clock",            match: ["打卡", "/打卡", "上班", "下班"],                  title: "打卡",         subtitle: "上下班打卡（需 GPS 定位）",  buttonLabel: "📍 開始打卡",   path: "/clock",            emoji: "📍" },
  { key: "clock_correction", match: ["補打卡", "/補打卡", "補登"],                       title: "補打卡申請",   subtitle: "忘記打卡？線上補登",         buttonLabel: "📝 補打卡",     path: "/clock-correction", emoji: "📝" },
  { key: "schedule",         match: ["班表", "/班表", "我的班表"],                       title: "我的班表",     subtitle: "查看本月排班",               buttonLabel: "📅 開啟班表",   path: "/my-schedule",      emoji: "📅" },
  { key: "leave",            match: ["請假", "/請假", "請假申請"],                       title: "請假申請",     subtitle: "提交請假單",                 buttonLabel: "🏖 申請請假",    path: "/leave",            emoji: "🏖" },
  { key: "off_request",      match: ["希望休", "/希望休", "休假申請"],                   title: "希望休",       subtitle: "提出希望休日",               buttonLabel: "✨ 提出希望休", path: "/off-request",      emoji: "✨" },
  { key: "overtime",         match: ["加班", "/加班", "加班申請"],                       title: "加班申請",     subtitle: "提交加班單",                 buttonLabel: "⏰ 申請加班",   path: "/overtime",         emoji: "⏰" },
  { key: "business_trip",    match: ["出差", "/出差", "出差申請"],                       title: "出差申請",     subtitle: "提交出差單",                 buttonLabel: "✈️ 申請出差",   path: "/business-trip",    emoji: "✈️" },
  { key: "expense",          match: ["費用", "/費用", "報銷", "費用申請"],               title: "費用申請",     subtitle: "報帳、補貼",                 buttonLabel: "💰 申請費用",   path: "/expense-request",  emoji: "💰" },
  { key: "expenses_list",    match: ["費用紀錄", "/費用紀錄"],                            title: "費用紀錄",     subtitle: "查看歷史費用單",             buttonLabel: "📊 開啟紀錄",   path: "/expenses",         emoji: "📊" },
  { key: "approve",          match: ["簽核", "/簽核", "待簽核", "審核"],                   title: "待我簽核",     subtitle: "主管審批項目",               buttonLabel: "✅ 開啟簽核",   path: "/approve",          emoji: "✅" },
  { key: "approval_status",  match: ["簽核狀態", "/簽核狀態", "我的申請"],                title: "我的申請進度", subtitle: "查看送出單據的審批狀態",     buttonLabel: "📋 查看進度",   path: "/approval-status",  emoji: "📋" },
  { key: "dashboard",        match: ["儀表板", "儀錶板", "/儀表板", "/儀錶板"],           title: "營運儀表板",   subtitle: "流程進度 / 任務統計",        buttonLabel: "📊 開啟儀表板", path: "/dashboard",        emoji: "📊" },
  { key: "salary",           match: ["薪水", "/薪水", "查薪水", "薪資"],                   title: "薪資查詢",     subtitle: "查看歷月薪資單",             buttonLabel: "💰 查看薪資",   path: "/salary",           emoji: "💰" },
  { key: "todo",             match: ["代辦", "代辦項目", "/代辦", "/代辦項目", "待辦"],     title: "代辦項目",     subtitle: "任務與簽核一覽",             buttonLabel: "📋 開啟代辦",   path: "/todo",             emoji: "📋" },
];
function matchLiffShortcut(text: string): LiffShortcut | null {
  for (const sc of LIFF_SHORTCUTS) if (sc.match.includes(text)) return sc;
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" },
    });
  }

  const url = new URL(req.url);
  const queryCode = url.searchParams.get("channel");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const rawBody = await req.text();
  const body = JSON.parse(rawBody);
  const destinationId: string | null = body?.destination ?? null;

  const db = createClient(supabaseUrl, supabaseKey);

  const channelRow = await resolveChannel(db, { queryCode, destinationId });
  if (!channelRow) {
    console.error("[webhook] No LINE channel could be resolved", { queryCode, destinationId });
    return new Response("Unknown channel", { status: 400 });
  }
  const channelCode = channelRow.code;
  const channelId = channelRow.id;

  const channelSecret = resolveEnv("LINE_CHANNEL_SECRET", channelCode);
  const accessToken =
    resolveEnv("LINE_CHANNEL_ACCESS_TOKEN", channelCode) ??
    resolveEnv("LINE_CHANNEL_TOKEN", channelCode);
  const liffTaskId =
    resolveEnv("LIFF_TASK_ID", channelCode) ??
    channelRow.liff_id ??
    "";
  const liffNewTaskId =
    resolveEnv("LIFF_NEW_TASK_ID", channelCode) ??
    channelRow.liff_id ??
    "";
  const liffDashboardId =
    resolveEnv("LIFF_DASHBOARD_ID", channelCode) ?? "";

  if (!channelSecret || !accessToken) {
    console.error(`[webhook] Missing credentials for channel=${channelCode}`);
    return new Response("Missing LINE credentials", { status: 500 });
  }

  const signature = req.headers.get("x-line-signature") ?? "";
  const valid = await verifySignature(rawBody, signature, channelSecret);
  if (!valid) {
    console.error("Invalid LINE signature");
    return new Response("Invalid signature", { status: 401 });
  }

  for (const event of body.events ?? []) {
   try {
    const isGroup = (event.source?.type === "group") || (event.source?.type === "room");
    const groupId: string | null = event.source?.groupId ?? event.source?.roomId ?? null;

    // ── Join / Leave ─────────────────────────────────────────────────────────
    if (event.type === "join" && groupId) {
      const summary = await getGroupSummary(groupId, accessToken);
      await upsertLineGroup(groupId, summary.groupName, db, channelId);
      await replyAndLog(event.replyToken, [
        withQuickReplies(
          {
            type: "flex",
            altText: "👋 大家好！",
            contents: {
              type: "bubble",
              header: {
                type: "box",
                layout: "vertical",
                paddingAll: "16px",
                backgroundColor: "#2563EB",
                contents: [
                  { type: "text", text: "📋 營運管理助理", weight: "bold", color: "#FFFFFF", size: "xl" },
                  { type: "text", text: "已加入此群組", color: "#BFDBFE", size: "sm", margin: "xs" },
                ],
              },
              body: {
                type: "box",
                layout: "vertical",
                paddingAll: "16px",
                contents: [
                  { type: "text", text: "我可以幫助您管理：", color: "#555555", size: "sm" },
                  { type: "text", text: "📋 任務指派與追蹤", size: "sm", margin: "sm" },
                  { type: "text", text: "⚙️ 工作流程狀態查詢", size: "sm", margin: "xs" },
                  { type: "separator", margin: "md" },
                  { type: "text", text: "💡 個人任務請先私訊機器人完成帳號連結", color: "#AAAAAA", size: "xs", margin: "md", wrap: true },
                ],
              },
              footer: {
                type: "box",
                layout: "vertical",
                spacing: "xs",
                paddingAll: "8px",
                contents: [
                  mkBtn("📋 任務列表", "/任務 列表", "primary"),
                  mkBtn("⚙️ 工作流程狀態", "/流程 狀態", "secondary"),
                ],
              },
            },
          },
          [{ label: "📋 任務列表", text: "/任務 列表" }, { label: "⚙️ 流程狀態", text: "/流程 狀態" }],
        ),
      ], accessToken, db, { channelId, lineUserId: "BOT", sourceType: "group", groupId });
      await logCommand(db, { channelId, lineUserId: "BOT", commandMatched: "join", rawInput: "[join event]", sourceType: "group", groupId, success: true });
      continue;
    }

    if (event.type === "leave" && groupId) {
      await db.from("line_groups").update({ is_active: false }).eq("channel_id", channelId).eq("line_group_id", groupId);
      await logCommand(db, { channelId, lineUserId: "BOT", commandMatched: "leave", rawInput: "[leave event]", sourceType: "group", groupId, success: true });
      continue;
    }

    // ── Only text messages from here ─────────────────────────────────────────
    if (event.type !== "message" || event.message?.type !== "text") continue;
    if (!event.source?.userId) continue;

    const lineUserId: string = event.source.userId;
    const rawText: string = event.message.text.trim();

    // Normalize full-width spaces (U+3000) → ASCII space, collapse multiple spaces
    const lower = rawText.toLowerCase().replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();
    console.log(`[cmd] isGroup=${isGroup} lower="${lower}"`);

    const sourceType = isGroup ? (event.source?.type ?? "group") : "user";

    if (isGroup && groupId) {
      const summary = await getGroupSummary(groupId, accessToken);
      await upsertLineGroup(groupId, summary.groupName, db, channelId);
      if (lineUserId) await upsertLineGroupMember(lineUserId, groupId, db);
    }

    const profile = await getLineProfile(lineUserId, accessToken, groupId);

    // ── Log ALL incoming messages FIRST (before user lookup or filtering) ─────
    await logMessage(db, {
      channelId,
      lineUserId,
      displayName: profile.displayName,
      messageText: rawText,
      sourceType,
      direction: "incoming",
      groupId,
      eventType: "message",
    });

    const { row: lineUser, isNew } = await upsertLineUser(lineUserId, profile.displayName, db, channelId);

    if (!lineUser) {
      console.error("Failed to upsert line_user for", lineUserId);
      continue;
    }

    // Check for enhanced task creation triggers (group: @linebot 新增任務 or 新增任務)
    const isNewTaskTrigger =
      lower.startsWith("新增任務") ||
      (lower.includes("@linebot") && lower.includes("新增任務"));

    // In groups, only respond to command-like messages (unless user has a pending action or new-task trigger)
    if (isGroup && !rawText.startsWith("/") && !["說明","任務","流程","專案"].some(w => rawText.startsWith(w)) && !isNewTaskTrigger) {
      if (!lineUser.pending_action) continue;
    }

    // ── Handle pending conversational action (free-text reply) ────────────────
    const pending = lineUser.pending_action as PendingAction | null;
    if (pending && !rawText.startsWith("/")) {
      if (pending.action === "add_note") {
        const cmdStart = Date.now();
        const { data: task } = await db.from("tasks").select("id, title, notes").eq("id", pending.task_id).maybeSingle();
        await db.from("line_users").update({ pending_action: null }).eq("id", lineUser.id);
        if (task) {
          const timestamp = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
          const newNotes = `${task.notes ? task.notes + "\n" : ""}[${timestamp}] ${rawText}`;
          const { error: noteErr } = await db.from("tasks").update({ notes: newNotes, updated_at: new Date().toISOString() }).eq("id", task.id);
          const responseMsg = noteErr
            ? text(`❌ 備註儲存失敗：${noteErr.message}`)
            : flexSuccess("📝", "備註已儲存", `「${task.title}」\n${rawText}`);
          await logCommand(db, { channelId, lineUserId, displayName: profile.displayName, commandMatched: "pending_add_note", rawInput: rawText, sourceType, groupId, success: !noteErr, errorMessage: noteErr?.message, executionMs: Date.now() - cmdStart });
          await replyAndLog(event.replyToken, [responseMsg], accessToken, db, { channelId, lineUserId, displayName: profile.displayName, sourceType, groupId });
        } else {
          await logCommand(db, { channelId, lineUserId, displayName: profile.displayName, commandMatched: "pending_add_note", rawInput: rawText, sourceType, groupId, success: false, errorMessage: "Task not found", executionMs: Date.now() - cmdStart });
          await replyAndLog(event.replyToken, [text("❌ 找不到對應任務，備註未儲存。")], accessToken, db, { channelId, lineUserId, displayName: profile.displayName, sourceType, groupId });
        }
        continue;
      } else if (pending.action === "reject_reason") {
        const cmdStart = Date.now();
        await db.from("line_users").update({ pending_action: null }).eq("id", lineUser.id);
        const reason = rawText.trim();
        const responseMsg = await cmdTaskConfirmRespond(pending.short_id, "拒絕", lineUser.employee_id!, db, accessToken, reason);
        await logCommand(db, { channelId, lineUserId, displayName: profile.displayName, commandMatched: "pending_reject_reason", rawInput: rawText, sourceType, groupId, success: true, executionMs: Date.now() - cmdStart });
        await replyAndLog(event.replyToken, [responseMsg], accessToken, db, { channelId, lineUserId, displayName: profile.displayName, sourceType, groupId });
        continue;
      } else if (pending.action === "create_task") {
        const cmdStart = Date.now();
        const stepResult = await handleCreateTaskStep(lineUser, rawText, db, accessToken);
        if (stepResult) {
          await logCommand(db, { channelId, lineUserId, displayName: profile.displayName, commandMatched: `pending_create_task_${pending.step}`, rawInput: rawText, sourceType, groupId, success: true, executionMs: Date.now() - cmdStart });
          await replyAndLog(event.replyToken, [stepResult], accessToken, db, { channelId, lineUserId, displayName: profile.displayName, sourceType, groupId });
        }
        continue;
      }
    }

    // ── Route commands ────────────────────────────────────────────────────────
    console.log("[ROUTE] rawText=", JSON.stringify(rawText), "lower=", JSON.stringify(lower), "isGroup=", isGroup, "verified=", lineUser.is_verified, "user_id=", lineUser.employee_id);
    let responseMsg;
    let commandName = "unknown";
    const cmdStart = Date.now();

    if (lower === "/說明" || lower === "/help" || lower === "說明" || lower === "help" || lower === "指令") {
      commandName = "help";
      const isManager = (lineUser.is_verified && lineUser.employee_id)
        ? await checkManager(lineUser.employee_id, db)
        : false;
      const menu = flexMenu(isGroup, isManager, liffNewTaskId, liffDashboardId, liffTaskId);
      // Append HR shortcut chips (max 13 items per LINE quick reply spec).
      responseMsg = isGroup ? menu : withQuickReplies(menu, [
        { label: "🗓 出勤", text: "出勤" },
        { label: "📍 打卡", text: "打卡" },
        { label: "📅 班表", text: "班表" },
        { label: "🏖 請假", text: "請假" },
        { label: "⏰ 加班", text: "加班" },
        { label: "💰 費用", text: "費用" },
        { label: "✅ 簽核", text: "簽核" },
      ]);

    } else if (lower === "/出勤" || lower === "出勤" || lower === "attendance") {
      commandName = "attendance_card";
      responseMsg = flexAttendanceCard(liffTaskId, liffNewTaskId, liffDashboardId);

    } else if (lower === "/帳號連結" || lower === "帳號連結" || lower === "帳號連結說明") {
      commandName = "account_help";
      responseMsg = text(
        "👤 帳號連結說明\n\n" +
        "① 傳訊息給機器人：\n   /註冊 您的姓名\n   例：/註冊 張小明\n\n" +
        "② 綁定完成後即可：\n   • 透過 LINE 打卡 / 看班表 / 請假 / 報帳\n   • 收到任務派發與審批推播\n   • 開啟 LIFF 主管儀表板（限主管）\n\n" +
        "③ 如綁定失敗或需換綁，請聯絡系統管理員。"
      );

    } else if (lower.startsWith("/註冊") || lower.startsWith("註冊")) {
      commandName = "register";
      if (isGroup) {
        responseMsg = text(`帳號連結請私訊機器人：\n/註冊 您的姓名\n\n例如：/註冊 張小明`);
      } else {
        const namePart = rawText.replace(/^\/?(註冊)\s*/i, "").trim();
        responseMsg = await cmdRegister(lineUser.id, namePart, db, channelId, lineUserId, profile.displayName);
      }

    // ── Project task commands (/專案) ──────────────────────────────────────
    } else if (lower === "/專案 列表" || lower === "/專案列表" || lower === "/project list" || lower === "專案") {
      commandName = "project_list";
      responseMsg = await cmdProjectList(db);

    } else if (lower.match(/^\/專案\s+#?(\d+)\s+完成/)) {
      commandName = "project_done";
      const m = rawText.match(/\/專案\s+#?(\d+)\s+完成/);
      const taskNo = m ? parseInt(m[1], 10) : 0;
      responseMsg = await cmdProjectDone(taskNo, db);

    } else if (lower.match(/^\/專案\s+#?(\d+)\s+備註/)) {
      commandName = "project_note";
      const m = rawText.match(/\/專案\s+#?(\d+)\s+備註\s*(.*)/);
      const taskNo = m ? parseInt(m[1], 10) : 0;
      const note = m ? m[2].trim() : "";
      if (!note) {
        responseMsg = text("請提供備註內容。\n例如：/專案 #1 備註 設計圖已確認");
      } else {
        responseMsg = await cmdProjectNote(taskNo, note, db);
      }

    } else if (lower.match(/^\/專案\s+#?(\d+)\s+狀態/)) {
      commandName = "project_status";
      const m = rawText.match(/\/專案\s+#?(\d+)\s+狀態\s*(.*)/);
      const taskNo = m ? parseInt(m[1], 10) : 0;
      const status = m ? m[2].trim() : "";
      if (!status) {
        responseMsg = text("請提供狀態。\n可用狀態：未開始、進行中、已完成\n例如：/專案 #1 狀態 進行中");
      } else {
        responseMsg = await cmdProjectStatus(taskNo, status, db);
      }

    } else if (lower === "/任務 列表" || lower === "/task list" || lower === "任務" || lower === "tasks"
      || lower.replace(/\s+/g, ' ') === "/任務 列表"
      || lower === "/任務列表") {
      commandName = "task_list";
      console.log("[ROUTE] matched /任務 列表 branch");
      if (!lineUser.is_verified || !lineUser.employee_id) {
        console.log("[ROUTE] user not verified or no user_id");
        responseMsg = isGroup
          ? text(`${profile.displayName}，請先私訊機器人：\n/註冊 您的姓名`)
          : withQuickReplies(text("您尚未連結帳號。\n請輸入：/註冊 您的姓名"), []);
      } else {
        try {
          console.log("[ROUTE] calling cmdTaskList");
          responseMsg = await cmdTaskList(lineUser.employee_id, db, profile.displayName, isGroup, groupId, liffNewTaskId);
          console.log("[ROUTE] cmdTaskList returned, responseMsg type=", (responseMsg as any)?.type);
        } catch (err) {
          console.error("[ROUTE] cmdTaskList THREW:", err);
          responseMsg = text(`❗ 任務列表載入失敗：${(err as Error).message}`);
        }
      }

    } else if (lower === "/任務 列表 全部" || lower === "/任務 全部" || lower === "/任務全部" || lower === "/task all" || lower === "/任務列表全部" || lower === "/task list all") {
      commandName = "task_list_all";
      if (!lineUser.is_verified || !lineUser.employee_id) {
        responseMsg = isGroup
          ? text(`${profile.displayName}，請先私訊機器人：\n/註冊 您的姓名`)
          : withQuickReplies(text("您尚未連結帳號。\n請輸入：/註冊 您的姓名"), []);
      } else {
        try {
          responseMsg = await cmdTaskList(lineUser.employee_id, db, profile.displayName, isGroup, groupId, liffNewTaskId, true);
        } catch (err) {
          responseMsg = text(`❗ 任務列表載入失敗：${(err as Error).message}`);
        }
      }

    } else if (lower.startsWith("/任務 新增") || lower.startsWith("/task create")) {
      commandName = "task_create";
      if (!lineUser.is_verified || !lineUser.employee_id) {
        responseMsg = isGroup
          ? text(`${profile.displayName}，請先私訊機器人：\n/註冊 您的姓名`)
          : text("您尚未連結帳號。\n請輸入：/註冊 您的姓名");
      } else {
        const title = rawText.replace(/^\/任務 新增\s*|^\/task create\s*/i, "").trim();
        if (!title) {
          // No title: show instructions (existing behavior)
          responseMsg = await cmdTaskCreate(lineUser.employee_id, title, db);
        } else {
          // Title provided: start enhanced multi-step flow
          const isManager = await checkManager(lineUser.employee_id, db);
          await db.from("line_users").update({
            pending_action: {
              action: "create_task",
              step: "workflow",
              data: { title, source_group_id: isGroup ? groupId : null, is_manager: isManager },
            } as PendingAction,
          }).eq("id", lineUser.id);
          // Fetch workflows and show first step
          const { data: instances } = await db
            .from("workflow_instances").select("id, name")
            .in("status", ["running", "paused"]).order("started_at", { ascending: false }).limit(10);
          responseMsg = buildWorkflowSelectionFlex(instances ?? [], title, isManager);
        }
      }

    } else if (isNewTaskTrigger) {
      // ── Enhanced task creation from group: @linebot 新增任務 or 新增任務 ──────
      commandName = "enhanced_task_create";
      if (!lineUser.is_verified || !lineUser.employee_id) {
        responseMsg = text(`${profile.displayName}，請先私訊機器人完成帳號連結：\n/註冊 您的姓名`);
      } else {
        let title = rawText.replace(/@linebot\s*/gi, "").replace(/^新增任務\s*/i, "").trim();
        if (!title) {
          responseMsg = text("請提供任務標題。例如：新增任務 盤點倉庫庫存");
        } else {
          const isManager = await checkManager(lineUser.employee_id, db);
          await db.from("line_users").update({
            pending_action: {
              action: "create_task",
              step: "workflow",
              data: { title, source_group_id: groupId, is_manager: isManager },
            } as PendingAction,
          }).eq("id", lineUser.id);
          // Reply in group, then push first step to personal chat
          responseMsg = text(`📝 收到！我會私訊 ${profile.displayName} 確認「${title}」的任務細節。`);
          // Push workflow selection to personal chat
          const { data: instances } = await db
            .from("workflow_instances").select("id, name")
            .in("status", ["running", "paused"]).order("started_at", { ascending: false }).limit(10);
          await pushAndLog(lineUserId, [buildWorkflowSelectionFlex(instances ?? [], title, isManager)], accessToken, db, { channelId, sourceType: "user" });
        }
      }

    } else if (lower.match(/^\/任務\s+\S+\s+完成/) || lower.match(/^\/task\s+\S+\s+done/)) {
      commandName = "task_done";
      const m = rawText.match(/^\/任務\s+(\S+)\s+完成/i) || rawText.match(/^\/task\s+(\S+)\s+done/i);
      if (!lineUser.is_verified || !lineUser.employee_id) {
        responseMsg = isGroup
          ? text(`${profile.displayName}，請先私訊機器人：\n/註冊 您的姓名`)
          : text("您尚未連結帳號。\n請輸入：/註冊 您的姓名");
      } else {
        responseMsg = await cmdTaskDone(m ? m[1] : "", lineUser.employee_id, db, accessToken, groupId, profile.displayName);
      }

    } else if (lower.match(/^\/任務\s+\S+\s+請求確認/)) {
      commandName = "task_request_confirm";
      const m = rawText.match(/^\/任務\s+(\S+)\s+請求確認/i);
      if (!lineUser.is_verified || !lineUser.employee_id) {
        responseMsg = isGroup
          ? text(`${profile.displayName}，請先私訊機器人：\n/註冊 您的姓名`)
          : text("您尚未連結帳號。\n請輸入：/註冊 您的姓名");
      } else {
        responseMsg = await cmdTaskRequestConfirm(m ? m[1] : "", lineUser.employee_id, db, accessToken, profile.displayName);
      }

    } else if (lower.match(/^\/確認\s+\S+\s+(核准|拒絕)/)) {
      commandName = "task_confirm_respond";
      const m = rawText.match(/^\/確認\s+(\S+)\s+(核准|拒絕)\s*(.*)/i);
      if (!lineUser.is_verified || !lineUser.employee_id) {
        responseMsg = text("您尚未連結帳號。\n請輸入：/註冊 您的姓名");
      } else if (m && m[2] === "拒絕" && !(m[3] || "").trim()) {
        // Rejection without reason → ask for reason via pending action
        const rid = (m[1] || "").replace(/[[\]#\s]/g, "").toLowerCase();
        const { data: matchTasks } = await db.from("tasks").select("id, title").neq("status", "completed").limit(300);
        const found = matchTasks?.filter((t: any) => t.id.toLowerCase().startsWith(rid));
        if (found && found.length > 0) {
          await db.from("line_users").update({
            pending_action: { action: "reject_reason", task_id: found[0].id, task_title: found[0].title, short_id: rid },
          }).eq("id", lineUser.id);
          responseMsg = text(`請輸入拒絕「${found[0].title}」的原因：`);
        } else {
          responseMsg = text(`❌ 找不到任務 ${rid}。`);
        }
      } else {
        responseMsg = await cmdTaskConfirmRespond(m ? m[1] : "", m ? m[2] : "", lineUser.employee_id, db, accessToken, m ? (m[3] || "").trim() : "");
      }

    } else if (lower.match(/^\/任務\s+\S+\s+更新/) || lower.match(/^\/task\s+\S+\s+update/)) {
      commandName = "task_update";
      const m = rawText.match(/^\/任務\s+(\S+)\s+更新\s*(.*)/i) || rawText.match(/^\/task\s+(\S+)\s+update\s*(.*)/i);
      const rawId = m ? m[1] : "";
      const note = m ? m[2].trim() : "";
      responseMsg = await cmdTaskUpdate(rawId, note, db, lineUser.id, lineUser.employee_id);

    } else if (lower === "/備註" || lower === "備註" || lower === "/notes") {
      commandName = "notes";
      if (!lineUser.is_verified || !lineUser.employee_id) {
        responseMsg = text("您尚未連結帳號。\n請輸入：/註冊 您的姓名");
      } else {
        responseMsg = await cmdNotes(lineUser.employee_id, db);
      }

    } else if (lower === "/流程 狀態" || lower === "/workflow status" || lower === "流程" || lower === "workflows") {
      commandName = "workflow_status";
      responseMsg = await cmdWorkflowStatus(db);

    } else if (lower.startsWith("/流程 任務") || lower.startsWith("/workflow tasks")) {
      commandName = "workflow_tasks";
      const m = rawText.match(/\/流程 任務\s+#?(\S+?)(?:\s+(全部|all))?$/i);
      const shortId = (m ? m[1] : "").replace(/[#\s]/g, "").toLowerCase();
      const showAll = !!(m && m[2]);
      responseMsg = await cmdWorkflowTasks(shortId, db, showAll, liffTaskId);

    } else if (lower === "/管理" || lower === "/管理 選單" || lower === "管理") {
      commandName = "manager_menu";
      if (isGroup) { responseMsg = text("🔒 管理功能請私訊機器人使用。"); } else
      if (!lineUser.is_verified || !lineUser.employee_id) {
        responseMsg = text("您尚未連結帳號。\n請輸入：/註冊 您的姓名");
      } else if (!await checkManager(lineUser.employee_id, db)) {
        responseMsg = text("🔒 您沒有管理員權限。\n如需開通，請聯絡系統管理員。");
      } else {
        responseMsg = flexManagerMenu(liffTaskId, liffNewTaskId, liffDashboardId);
      }

    } else if (lower === "/管理 全覽" || lower === "/manage overview") {
      commandName = "manager_overview";
      if (isGroup) { responseMsg = text("🔒 管理功能請私訊機器人使用。"); } else
      if (!lineUser.is_verified || !lineUser.employee_id) {
        responseMsg = text("您尚未連結帳號。\n請輸入：/註冊 您的姓名");
      } else if (!await checkManager(lineUser.employee_id, db)) {
        responseMsg = text("🔒 您沒有管理員權限。");
      } else {
        responseMsg = await cmdManagerOverview(db);
      }

    } else if (lower.startsWith("/管理 指派") || lower.startsWith("/manage assign")) {
      commandName = "manager_assign";
      if (isGroup) { responseMsg = text("🔒 管理功能請私訊機器人使用。"); } else
      if (!lineUser.is_verified || !lineUser.employee_id) {
        responseMsg = text("您尚未連結帳號。\n請輸入：/註冊 您的姓名");
      } else if (!await checkManager(lineUser.employee_id, db)) {
        responseMsg = text("🔒 您沒有管理員權限。");
      } else {
        // Format: /管理 指派 [姓名] [任務標題]  (first word = name, rest = title)
        const args = rawText.replace(/^\/管理 指派\s*/i, "").trim().split(/\s+/);
        const nameQuery = args[0] ?? "";
        const title = args.slice(1).join(" ");
        responseMsg = await cmdManagerAssign(nameQuery, title, db, accessToken);
      }

    } else if (lower.startsWith('/管理 核准請假') || lower.startsWith('/管理 退回請假')) {
      commandName = "manager_leave_review";
      if (isGroup) { responseMsg = text("🔒 管理功能請私訊機器人使用。"); } else
      if (!lineUser.is_verified || !lineUser.employee_id) {
        responseMsg = text("您尚未連結帳號。");
      } else if (!await checkManager(lineUser.employee_id, db)) {
        responseMsg = text("🔒 您沒有權限審核請假。");
      } else {
        const isApprove = lower.startsWith('/管理 核准請假');
        const prefixLength = isApprove ? 8 : 8; // "/管理 核准請假 " length
        const leaveId = rawText.substring(prefixLength).trim();
        responseMsg = await cmdManagerLeaveReview(leaveId, isApprove, db, lineUser.employee_id);
      }

    } else if (!isGroup && (isNew || !lineUser.is_verified)) {
      commandName = "welcome";
      // New user welcome with flex
      responseMsg = {
        type: "flex",
        altText: `👋 歡迎，${profile.displayName}！`,
        contents: {
          type: "bubble",
          header: {
            type: "box",
            layout: "vertical",
            paddingAll: "16px",
            backgroundColor: "#2563EB",
            contents: [
              { type: "text", text: "📋 營運管理助理", weight: "bold", color: "#FFFFFF", size: "xl" },
              { type: "text", text: `歡迎，${profile.displayName}！`, color: "#BFDBFE", size: "sm", margin: "xs" },
            ],
          },
          body: {
            type: "box",
            layout: "vertical",
            paddingAll: "16px",
            contents: [
              { type: "text", text: "請先連結您的員工帳號：", weight: "bold", size: "sm" },
              {
                type: "box",
                layout: "vertical",
                margin: "md",
                paddingAll: "10px",
                backgroundColor: "#FFF3E0",
                cornerRadius: "6px",
                contents: [
                  { type: "text", text: "/註冊 您的姓名", size: "md", color: "#E67E22", weight: "bold" },
                ],
              },
              { type: "text", text: "例如：/註冊 張小明", color: "#AAAAAA", size: "xs", margin: "md" },
            ],
          },
        },
      };

    } else if (
      lower.includes('假期餘額') || lower.includes('特休餘額') ||
      lower.includes('特休還有') || lower.includes('剩幾天') ||
      lower.includes('請假餘額') || lower.includes('還有幾天假') ||
      lower === '假期' || lower === '特休'
    ) {
      commandName = "leave_balance";
      // Leave balance query
      if (!lineUser.is_verified || !lineUser.employee_id) {
        responseMsg = text('請先連結您的員工帳號。\n輸入：/註冊 您的姓名');
      } else {
        const currentYear = new Date().getFullYear();
        const { data: balances } = await db
          .from('leave_balances')
          .select('leave_type, total_days, used_days, carry_over_days')
          .eq('employee_id', lineUser.employee_id)
          .eq('year', currentYear);

        const leaveTypeLabel: Record<string, string> = {
          annual: '特休',
          sick: '病假',
          personal: '事假',
          bereavement: '喪假',
          marriage: '婚假',
          maternity: '產假',
          paternity: '陪產假',
          unpaid: '無薪假',
        };

        if (!balances || balances.length === 0) {
          responseMsg = text(`📋 ${currentYear} 年假期餘額尚未設定。\n請聯繫 HR 確認假期配額。`);
        } else {
          const rows = balances.map((b: any) => {
            const remaining = Number(b.total_days || 0) + Number(b.carry_over_days || 0) - Number(b.used_days || 0);
            const label = leaveTypeLabel[b.leave_type] || b.leave_type;
            return {
              type: "box",
              layout: "horizontal",
              paddingTop: "6px",
              paddingBottom: "6px",
              borderWidth: "0.5px",
              borderColor: "#EEEEEE",
              contents: [
                { type: "text", text: label, size: "sm", flex: 3, color: "#444444" },
                { type: "text", text: `${Number(b.total_days || 0) + Number(b.carry_over_days || 0)} 天`, size: "sm", flex: 2, color: "#888888", align: "center" },
                { type: "text", text: `已用 ${Number(b.used_days || 0)} 天`, size: "sm", flex: 3, color: "#888888", align: "center" },
                {
                  type: "text",
                  text: `剩 ${remaining.toFixed(1)} 天`,
                  size: "sm",
                  flex: 3,
                  color: remaining <= 0 ? "#E53E3E" : remaining <= 3 ? "#DD6B20" : "#276749",
                  weight: "bold",
                  align: "right",
                },
              ],
            };
          });

          responseMsg = {
            type: "flex",
            altText: `${currentYear} 年假期餘額查詢`,
            contents: {
              type: "bubble",
              size: "kilo",
              header: {
                type: "box",
                layout: "vertical",
                backgroundColor: "#276749",
                paddingAll: "14px",
                contents: [
                  { type: "text", text: "🌿 假期餘額", weight: "bold", color: "#FFFFFF", size: "lg" },
                  { type: "text", text: `${currentYear} 年度`, color: "#C6F6D5", size: "xs", margin: "xs" },
                ],
              },
              body: {
                type: "box",
                layout: "vertical",
                paddingAll: "14px",
                contents: [
                  {
                    type: "box",
                    layout: "horizontal",
                    paddingBottom: "6px",
                    contents: [
                      { type: "text", text: "假別", size: "xs", flex: 3, color: "#AAAAAA", weight: "bold" },
                      { type: "text", text: "總天數", size: "xs", flex: 2, color: "#AAAAAA", weight: "bold", align: "center" },
                      { type: "text", text: "已使用", size: "xs", flex: 3, color: "#AAAAAA", weight: "bold", align: "center" },
                      { type: "text", text: "剩餘", size: "xs", flex: 3, color: "#AAAAAA", weight: "bold", align: "right" },
                    ],
                  },
                  ...rows,
                ],
              },
              footer: {
                type: "box",
                layout: "vertical",
                paddingAll: "10px",
                backgroundColor: "#F7FAFC",
                contents: [
                  {
                    type: "button",
                    style: "link",
                    height: "sm",
                    action: { type: "message", label: "📋 查看主選單", text: "/說明" },
                  },
                ],
              },
            },
          };
        }
      }

    } else if (
      lower.includes('加班記錄') || lower.includes('我的加班') || lower.includes('本月加班') ||
      lower.includes('加班時數') || lower === '加班'
    ) {
      commandName = "overtime_query";
      // OT hours query for current month
      if (!lineUser.is_verified || !lineUser.employee_id) {
        responseMsg = text('請先連結您的員工帳號。\n輸入：/註冊 您的姓名');
      } else {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
        const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;

        const { data: otRecords } = await db
          .from('overtime_requests')
          .select('request_date, ot_hours, ot_type, filing_type, status')
          .eq('employee_id', lineUser.employee_id)
          .gte('request_date', monthStart)
          .lt('request_date', nextMonth)
          .order('request_date', { ascending: false });

        if (!otRecords || otRecords.length === 0) {
          responseMsg = text(`📋 ${year}年${month}月 尚無加班記錄。`);
        } else {
          const approvedHours = otRecords.filter((r: any) => r.status === 'approved')
            .reduce((sum: number, r: any) => sum + Number(r.ot_hours || 0), 0);
          const pendingHours = otRecords.filter((r: any) => r.status === 'pending')
            .reduce((sum: number, r: any) => sum + Number(r.ot_hours || 0), 0);

          const otTypeLabel = (t: string) => t === 'comp' ? '補休' : '加班費';
          const otStatusLabel = (s: string) => s === 'approved' ? '✅' : s === 'rejected' ? '❌' : '⏳';

          const rowContents = otRecords.slice(0, 8).map((r: any) => ({
            type: "box",
            layout: "horizontal",
            paddingTop: "5px",
            paddingBottom: "5px",
            contents: [
              { type: "text", text: r.request_date, size: "xs", flex: 3, color: "#444444" },
              { type: "text", text: `${Number(r.ot_hours || 0)}h`, size: "xs", flex: 2, align: "center", weight: "bold" },
              { type: "text", text: otTypeLabel(r.ot_type), size: "xs", flex: 2, align: "center", color: "#888888" },
              { type: "text", text: otStatusLabel(r.status), size: "xs", flex: 1, align: "right" },
            ],
          }));

          responseMsg = {
            type: "flex",
            altText: `${year}年${month}月加班記錄`,
            contents: {
              type: "bubble",
              size: "kilo",
              header: {
                type: "box",
                layout: "vertical",
                backgroundColor: "#1A365D",
                paddingAll: "14px",
                contents: [
                  { type: "text", text: "⏰ 加班記錄", weight: "bold", color: "#FFFFFF", size: "lg" },
                  { type: "text", text: `${year}年${month}月`, color: "#90CDF4", size: "xs", margin: "xs" },
                ],
              },
              body: {
                type: "box",
                layout: "vertical",
                paddingAll: "14px",
                contents: [
                  {
                    type: "box",
                    layout: "horizontal",
                    marginBottom: "8px",
                    contents: [
                      {
                        type: "box", layout: "vertical", flex: 1, alignItems: "center",
                        contents: [
                          { type: "text", text: `${approvedHours.toFixed(1)}h`, size: "xl", weight: "bold", color: "#276749", align: "center" },
                          { type: "text", text: "已核准", size: "xs", color: "#888888", align: "center" },
                        ],
                      },
                      {
                        type: "box", layout: "vertical", flex: 1, alignItems: "center",
                        contents: [
                          { type: "text", text: `${pendingHours.toFixed(1)}h`, size: "xl", weight: "bold", color: "#DD6B20", align: "center" },
                          { type: "text", text: "待審核", size: "xs", color: "#888888", align: "center" },
                        ],
                      },
                    ],
                  },
                  { type: "separator", margin: "md" },
                  {
                    type: "box", layout: "horizontal", margin: "md", paddingBottom: "4px",
                    contents: [
                      { type: "text", text: "日期", size: "xs", flex: 3, color: "#AAAAAA", weight: "bold" },
                      { type: "text", text: "時數", size: "xs", flex: 2, color: "#AAAAAA", weight: "bold", align: "center" },
                      { type: "text", text: "類型", size: "xs", flex: 2, color: "#AAAAAA", weight: "bold", align: "center" },
                      { type: "text", text: "", size: "xs", flex: 1 },
                    ],
                  },
                  ...rowContents,
                ],
              },
              footer: {
                type: "box", layout: "vertical", paddingAll: "10px",
                backgroundColor: "#F7FAFC",
                contents: [{
                  type: "button", style: "link", height: "sm",
                  action: { type: "message", label: "查看主選單", text: "/說明" },
                }],
              },
            },
          };
        }
      }

    } else if (
      lower.includes('薪資單') || lower.includes('薪資') || lower === '我的薪資' || lower === '查薪資'
    ) {
      commandName = "payslip_query";
      // Payslip query — show recent payroll records
      if (!lineUser.is_verified || !lineUser.employee_id) {
        responseMsg = text('請先連結您的員工帳號。\n輸入：/註冊 您的姓名');
      } else {
        const fmt = (n: number) => new Intl.NumberFormat('zh-TW').format(Math.round(n || 0));

        const { data: payslips } = await db
          .from('payroll_records')
          .select('pay_period, gross_salary, net_salary')
          .eq('employee_id', lineUser.employee_id)
          .order('pay_period', { ascending: false })
          .limit(3);

        if (!payslips || payslips.length === 0) {
          responseMsg = text('尚無薪資記錄，請聯繫 HR。');
        } else {
          responseMsg = {
            type: 'flex',
            altText: '近期薪資記錄',
            contents: {
              type: 'carousel',
              contents: payslips.map((p: any) => ({
                type: 'bubble',
                size: 'kilo',
                header: {
                  type: 'box', layout: 'vertical', backgroundColor: '#4f46e5',
                  contents: [{ type: 'text', text: p.pay_period, color: '#fff', weight: 'bold' }],
                  paddingAll: '12px',
                },
                body: {
                  type: 'box', layout: 'vertical', spacing: 'sm',
                  contents: [
                    { type: 'box', layout: 'horizontal', contents: [
                      { type: 'text', text: '應發', size: 'sm', color: '#777', flex: 1 },
                      { type: 'text', text: `NT$${fmt(p.gross_salary)}`, size: 'sm', align: 'end', flex: 1 },
                    ]},
                    { type: 'box', layout: 'horizontal', contents: [
                      { type: 'text', text: '實領', size: 'md', weight: 'bold', color: '#4f46e5', flex: 1 },
                      { type: 'text', text: `NT$${fmt(p.net_salary)}`, size: 'md', weight: 'bold', color: '#4f46e5', align: 'end', flex: 1 },
                    ]},
                  ],
                  paddingAll: '12px',
                },
              })),
            },
          };
        }
      }

    } else if (matchLiffShortcut(lower)) {
      const sc = matchLiffShortcut(lower)!;
      commandName = `liff_shortcut_${sc.key}`;
      const liffId = liffNewTaskId || liffTaskId;
      if (!liffId) {
        responseMsg = text(`⚠️ ${sc.title} 無法開啟：管理員尚未設定 LIFF_TASK_ID。`);
      } else {
        responseMsg = flexLiffShortcut({
          title: sc.title,
          subtitle: sc.subtitle,
          buttonLabel: sc.buttonLabel,
          liffId,
          liffPath: sc.path,
          emoji: sc.emoji,
        });
      }

    } else if (!isGroup) {
      commandName = "unrecognized";
      responseMsg = withQuickReplies(
        text(`❓ 未識別的指令「${rawText}」`),
        [
          { label: "📖 查看說明", text: "/說明" },
          { label: "📋 任務列表", text: "/任務 列表" },
        ],
      );

    } else {
      continue; // Ignore unknown commands in groups
    }

    // ── Log command execution ───────────────────────────────────────────────
    const cmdSuccess = !((responseMsg as any)?.text?.startsWith("❌") || (responseMsg as any)?.text?.startsWith("❗"));
    const cmdErrorMsg = !cmdSuccess ? ((responseMsg as any)?.text ?? null) : null;
    await logCommand(db, {
      channelId,
      lineUserId,
      displayName: profile.displayName,
      commandMatched: commandName,
      rawInput: rawText,
      sourceType,
      groupId,
      success: cmdSuccess,
      errorMessage: cmdErrorMsg,
      executionMs: Date.now() - cmdStart,
    });

    console.log("[REPLY] about to reply, responseMsg type=", (responseMsg as any)?.type, "replyToken exists=", !!event.replyToken);
    await replyAndLog(event.replyToken, [responseMsg], accessToken, db, { channelId, lineUserId, displayName: profile.displayName, sourceType, groupId });
  } catch (eventErr) {
    // ── Log unhandled errors ──────────────────────────────────────────────
    console.error("[EVENT] unhandled error:", eventErr);
    await logError(db, {
      channelId,
      lineUserId: event.source?.userId ?? null,
      sourceType: event.source?.type ?? "system",
      groupId: event.source?.groupId ?? event.source?.roomId ?? null,
      errorType: "unhandled",
      errorMessage: (eventErr as Error).message ?? String(eventErr),
      errorStack: (eventErr as Error).stack ?? null,
      context: { rawText: event.message?.text, eventType: event.type },
    });
  }
  }

  return new Response("ok", { status: 200 });
});
