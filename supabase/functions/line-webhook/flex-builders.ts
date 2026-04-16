import { priorityLabel, statusLabel, PRIORITY_COLOR, STATUS_COLOR } from './constants.ts';

export function mkBtn(label: string, text: string, style: "primary" | "secondary" = "primary") {
  return { type: "button", action: { type: "message", label, text }, style, height: "sm" };
}

export function infoRow(label: string, value: string, color = "#333333") {
  return {
    type: "box", layout: "horizontal", spacing: "sm", margin: "xs",
    contents: [
      { type: "text", text: label, color: "#AAAAAA", size: "xs", flex: 2 },
      { type: "text", text: value, color, size: "xs", weight: "bold", flex: 5, wrap: true },
    ],
  };
}

export function withQuickReplies(msg: any, items: { label: string; text: string }[]) {
  if (!items.length) return msg;
  return { ...msg, quickReply: { items: items.map(i => ({ type: "action", action: { type: "message", label: i.label, text: i.text } })) } };
}

export function flexMenu(isGroup: boolean, isManager: boolean, liffNewTaskId = "") {
  const bodyItems: any[] = [
    { type: "text", text: "📋 任務管理", weight: "bold", size: "sm", color: "#1A252F", margin: "md" },
    { type: "text", text: "/任務 列表  — 查看我的任務", size: "xs", color: "#555555", margin: "xs" },
    { type: "text", text: "/任務 新增 [標題]  — 建立任務", size: "xs", color: "#555555", margin: "xs" },
    { type: "text", text: "/任務 #ID 完成  — 完成任務", size: "xs", color: "#555555", margin: "xs" },
    { type: "text", text: "/任務 #ID 更新  — 加備註", size: "xs", color: "#555555", margin: "xs" },
    { type: "separator", margin: "md" },
    { type: "text", text: "⚙️ 流程管理", weight: "bold", size: "sm", color: "#1A252F", margin: "md" },
    { type: "text", text: "/流程 狀態  — 查看進行中的流程", size: "xs", color: "#555555", margin: "xs" },
    { type: "text", text: "/流程 任務 #ID  — 查看流程任務", size: "xs", color: "#555555", margin: "xs" },
  ];
  if (isManager) {
    bodyItems.push(
      { type: "separator", margin: "md" },
      { type: "text", text: "👔 主管功能", weight: "bold", size: "sm", color: "#1A252F", margin: "md" },
      { type: "text", text: "/管理 全覽  — 團隊任務一覽", size: "xs", color: "#555555", margin: "xs" },
      { type: "text", text: "/管理 指派 [姓名] [標題]  — 指派任務", size: "xs", color: "#555555", margin: "xs" },
    );
  }
  if (!isGroup) {
    bodyItems.push(
      { type: "separator", margin: "md" },
      { type: "text", text: "🔗 帳號", weight: "bold", size: "sm", color: "#1A252F", margin: "md" },
      { type: "text", text: "/註冊 [姓名]  — 連結員工帳號", size: "xs", color: "#555555", margin: "xs" },
    );
  }

  return withQuickReplies({
    type: "flex", altText: "📖 SME Ops 指令說明",
    contents: {
      type: "bubble",
      header: { type: "box", layout: "vertical", paddingAll: "14px", backgroundColor: "#1A252F", contents: [
        { type: "text", text: "📖 SME Ops 助理", weight: "bold", color: "#FFFFFF", size: "lg" },
        { type: "text", text: "可用指令一覽", color: "#CCCCCC", size: "xs", margin: "xs" },
      ]},
      body: { type: "box", layout: "vertical", paddingAll: "14px", contents: bodyItems },
      footer: { type: "box", layout: "vertical", paddingAll: "8px", spacing: "xs", contents: [
        mkBtn("📋 任務列表", "/任務 列表", "primary"),
        mkBtn("⚙️ 流程狀態", "/流程 狀態", "secondary"),
      ]},
    },
  }, [{ label: "📋 任務列表", text: "/任務 列表" }, { label: "⚙️ 流程狀態", text: "/流程 狀態" }]);
}

export function flexSuccess(icon: string, title: string, detail: string) {
  return {
    type: "flex", altText: `${icon} ${title}`,
    contents: {
      type: "bubble",
      body: { type: "box", layout: "vertical", paddingAll: "20px", contents: [
        { type: "text", text: icon, size: "3xl", align: "center" },
        { type: "text", text: title, weight: "bold", size: "lg", align: "center", margin: "md" },
        { type: "text", text: detail, size: "sm", color: "#555555", align: "center", margin: "sm", wrap: true },
      ]},
    },
  };
}

export function flexTaskList(tasks: any[], displayName: string, liffNewTaskId = "") {
  if (!tasks.length) {
    return withQuickReplies(
      { type: "flex", altText: "📭 沒有待辦任務", contents: { type: "bubble", body: { type: "box", layout: "vertical", paddingAll: "20px", contents: [
        { type: "text", text: "📭", size: "3xl", align: "center" },
        { type: "text", text: "太棒了，沒有待辦任務！", weight: "bold", size: "md", align: "center", margin: "md" },
      ]}}},
      [{ label: "📖 說明", text: "/說明" }],
    );
  }

  const bubbles = tasks.slice(0, 10).map((t: any) => {
    const pColor = PRIORITY_COLOR[t.priority] ?? "#95A5A6";
    return {
      type: "bubble",
      header: { type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: pColor, contents: [
        { type: "text", text: t.title, color: "#FFFFFF", weight: "bold", size: "sm", wrap: true, maxLines: 3 },
        { type: "text", text: `#${t.id}`, color: "#FFFFFF99", size: "xxs", margin: "xs" },
      ]},
      body: { type: "box", layout: "vertical", paddingAll: "12px", contents: [
        infoRow("狀態", statusLabel(t.status), STATUS_COLOR[t.status] ?? "#95A5A6"),
        infoRow("優先", priorityLabel(t.priority), pColor),
        infoRow("截止", t.due_date || "無", "#333333"),
      ]},
      footer: { type: "box", layout: "horizontal", paddingAll: "8px", spacing: "sm", contents: [
        { type: "button", action: { type: "message", label: "📝 更新", text: `/任務 #${t.id} 更新` }, style: "secondary", height: "sm", flex: 1 },
        ...(t.status !== '已完成' ? [{ type: "button", action: { type: "message", label: "✅ 完成", text: `/任務 #${t.id} 完成` }, style: "primary", height: "sm", flex: 1, color: "#27AE60" }] : []),
      ]},
    };
  });

  return withQuickReplies(
    { type: "flex", altText: `📋 ${displayName} 的任務（${tasks.length} 件）`, contents: { type: "carousel", contents: bubbles } },
    [{ label: "📖 說明", text: "/說明" }],
  );
}

export function flexWorkflowStatus(instances: any[]) {
  if (!instances.length) {
    return withQuickReplies(
      { type: "flex", altText: "⚙️ 沒有進行中的流程", contents: { type: "bubble", body: { type: "box", layout: "vertical", paddingAll: "20px", contents: [
        { type: "text", text: "⚙️", size: "3xl", align: "center" },
        { type: "text", text: "目前沒有進行中的流程", weight: "bold", size: "md", align: "center", margin: "md" },
      ]}}},
      [{ label: "📋 任務列表", text: "/任務 列表" }],
    );
  }

  const bubbles = instances.map((i: any) => ({
    type: "bubble",
    header: { type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#2C3E50", contents: [
      { type: "text", text: i.template_name || i.name || `流程 #${i.id}`, color: "#FFFFFF", weight: "bold", size: "sm", wrap: true },
    ]},
    body: { type: "box", layout: "vertical", paddingAll: "12px", contents: [
      infoRow("狀態", i.status, "#2980B9"),
      infoRow("開始", i.started_at ? new Date(i.started_at).toLocaleDateString("zh-TW") : i.created_at ? new Date(i.created_at).toLocaleDateString("zh-TW") : "-"),
    ]},
    footer: { type: "box", layout: "vertical", paddingAll: "8px", contents: [
      mkBtn("📋 查看任務", `/流程 任務 #${i.id}`, "primary"),
    ]},
  }));

  return withQuickReplies(
    { type: "flex", altText: `⚙️ 進行中流程（${instances.length} 個）`, contents: { type: "carousel", contents: bubbles } },
    [{ label: "📋 任務列表", text: "/任務 列表" }],
  );
}

export function flexManagerMenu() {
  return withQuickReplies({
    type: "flex", altText: "👔 主管功能",
    contents: { type: "bubble",
      header: { type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#1A252F", contents: [
        { type: "text", text: "👔 主管管理功能", color: "#FFFFFF", weight: "bold", size: "lg" },
      ]},
      body: { type: "box", layout: "vertical", paddingAll: "14px", contents: [
        mkBtn("📊 團隊任務全覽", "/管理 全覽", "primary"),
        mkBtn("➕ 指派任務", "/管理 指派", "secondary"),
      ]},
    },
  }, [{ label: "📊 全覽", text: "/管理 全覽" }, { label: "📋 任務", text: "/任務 列表" }]);
}

export function flexManagerOverview(tasks: any[]) {
  if (!tasks.length) return flexSuccess("📊", "團隊任務", "目前沒有進行中的團隊任務");
  const bubbles = tasks.map((t: any) => ({
    type: "bubble",
    header: { type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: PRIORITY_COLOR[t.priority] ?? "#95A5A6", contents: [
      { type: "text", text: t.title, color: "#FFFFFF", weight: "bold", size: "sm", wrap: true },
    ]},
    body: { type: "box", layout: "vertical", paddingAll: "12px", contents: [
      infoRow("負責人", t.assignee || "—"),
      infoRow("截止", t.due_date || "無"),
      infoRow("優先", priorityLabel(t.priority), PRIORITY_COLOR[t.priority]),
    ]},
  }));
  return { type: "flex", altText: `📊 團隊任務（${tasks.length} 件）`, contents: { type: "carousel", contents: bubbles } };
}

export function buildWorkflowSelectionFlex(instances: any[], title: string) {
  const list = instances.map((inst: any, i: number) => `${i + 1}. ${inst.template_name || inst.name || `流程 #${inst.id}`}`).join("\n");
  return {
    type: "flex", altText: "選擇流程",
    contents: { type: "bubble",
      header: { type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#2C3E50", contents: [
        { type: "text", text: `📋 建立任務：${title}`, color: "#FFFFFF", weight: "bold", size: "sm", wrap: true },
        { type: "text", text: "步驟 1：選擇流程", color: "#CCCCCC", size: "xs", margin: "xs" },
      ]},
      body: { type: "box", layout: "vertical", paddingAll: "14px", contents: [
        { type: "text", text: "請選擇要關聯的流程：", size: "sm", color: "#555555" },
        { type: "text", text: list || "（無進行中流程）", size: "xs", color: "#333333", margin: "md", wrap: true },
        { type: "separator", margin: "md" },
        { type: "text", text: "輸入編號（1, 2...）或「跳過」", size: "xs", color: "#AAAAAA", margin: "sm" },
      ]},
    },
  };
}

export function buildDueDateFlex(title: string, step: number, total: number) {
  return {
    type: "flex", altText: "設定截止日",
    contents: { type: "bubble",
      header: { type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#2C3E50", contents: [
        { type: "text", text: `📅 步驟 ${step}/${total}：截止日`, color: "#FFFFFF", weight: "bold", size: "sm" },
      ]},
      body: { type: "box", layout: "vertical", paddingAll: "14px", contents: [
        { type: "text", text: `任務：${title}`, size: "sm", weight: "bold", wrap: true },
        { type: "separator", margin: "md" },
        { type: "text", text: "請輸入截止日期：", size: "xs", color: "#555555", margin: "md" },
        { type: "text", text: "• YYYY-MM-DD（如 2026-04-20）\n• 今天 / 明天 / 後天\n• 下週一 ~ 下週日\n• 3天後\n• 或輸入「跳過」", size: "xs", color: "#333333", margin: "xs", wrap: true },
      ]},
    },
  };
}

export function buildReminderFlex(title: string, step: number, total: number) {
  return {
    type: "flex", altText: "設定提醒",
    contents: { type: "bubble",
      header: { type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#2C3E50", contents: [
        { type: "text", text: `🔔 步驟 ${step}/${total}：提醒設定`, color: "#FFFFFF", weight: "bold", size: "sm" },
      ]},
      body: { type: "box", layout: "vertical", paddingAll: "14px", contents: [
        { type: "text", text: `任務：${title}`, size: "sm", weight: "bold", wrap: true },
        { type: "separator", margin: "md" },
        { type: "text", text: "需要設定提醒嗎？\n請輸入提醒內容（如「記得帶文件」）\n或輸入「跳過」", size: "xs", color: "#555555", margin: "md", wrap: true },
      ]},
    },
  };
}

export function buildOwnerSelectionFlex(employees: any[], title: string) {
  const list = employees.map((e: any, i: number) => `${i + 1}. ${e.name}`).join("\n");
  return {
    type: "flex", altText: "指定負責人",
    contents: { type: "bubble",
      header: { type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#E67E22", contents: [
        { type: "text", text: "👤 指定負責人", color: "#FFFFFF", weight: "bold", size: "sm" },
      ]},
      body: { type: "box", layout: "vertical", paddingAll: "14px", contents: [
        { type: "text", text: `任務：${title}`, size: "sm", weight: "bold", wrap: true },
        { type: "separator", margin: "md" },
        { type: "text", text: list, size: "xs", color: "#333333", margin: "md", wrap: true },
        { type: "text", text: "輸入編號、姓名，或「自己」", size: "xs", color: "#AAAAAA", margin: "sm" },
      ]},
    },
  };
}

export function buildConfirmationFlex(data: Record<string, any>) {
  const details = [
    `📝 ${data.title}`,
    data.workflow_name ? `📂 流程：${data.workflow_name}` : null,
    data.due_date ? `📅 截止：${data.due_date}` : null,
    data.owner_name ? `👤 負責人：${data.owner_name}` : "👤 負責人：自己",
    data.reminder ? `🔔 提醒：${data.reminder}` : null,
  ].filter(Boolean).join("\n");

  return withQuickReplies({
    type: "flex", altText: "確認建立任務",
    contents: { type: "bubble",
      header: { type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#27AE60", contents: [
        { type: "text", text: "✅ 確認建立任務", color: "#FFFFFF", weight: "bold", size: "md" },
      ]},
      body: { type: "box", layout: "vertical", paddingAll: "14px", contents: [
        { type: "text", text: details, size: "sm", color: "#333333", wrap: true },
        { type: "separator", margin: "lg" },
        { type: "text", text: "輸入「確認」建立，或「取消」放棄", size: "xs", color: "#AAAAAA", margin: "md" },
      ]},
    },
  }, [{ label: "✅ 確認", text: "確認" }, { label: "❌ 取消", text: "取消" }]);
}
