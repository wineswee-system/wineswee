import { priorityLabel, statusLabel, PRIORITY_COLOR, STATUS_COLOR } from './constants.ts';

// ── Core Flex Helpers ─────────────────────────────────────────────────────────

/** A single button row for Flex body/footer */
export function mkBtn(
  label: string,
  msgText: string,
  style: "primary" | "secondary" | "link" = "secondary",
  color?: string,
) {
  return {
    type: "button",
    action: { type: "message", label, text: msgText },
    style,
    height: "sm",
    margin: "xs",
    ...(color ? { color } : {}),
  };
}

/** Two-column label/value row for Flex body */
export function infoRow(label: string, value: string, valueColor = "#333333") {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    margin: "xs",
    contents: [
      { type: "text", text: label, color: "#AAAAAA", size: "xs", flex: 2 },
      { type: "text", text: value, color: valueColor, size: "xs", flex: 5, weight: "bold" },
    ],
  };
}

/** Append quick reply chips to any message object */
export function withQuickReplies(msg: object, items: Array<{ label: string; text: string }>) {
  // LINE rejects quickReply with empty items (400: must be non-empty array).
  // Guard here so every callsite is safe.
  if (!items || items.length === 0) return { ...msg };
  return {
    ...msg,
    quickReply: {
      items: items.map(it => ({
        type: "action",
        action: { type: "message", label: it.label, text: it.text },
      })),
    },
  };
}

/** Single-button shortcut card that opens a LIFF page (deeplink path appended to LIFF endpoint) */
export function flexLiffShortcut(opts: {
  title: string;
  subtitle?: string;
  buttonLabel: string;
  liffId: string;
  liffPath?: string;
  emoji?: string;
}) {
  const { title, subtitle, buttonLabel, liffId, liffPath = "", emoji = "📱" } = opts;
  const uri = `https://liff.line.me/${liffId}${liffPath}`;
  return {
    type: "flex",
    altText: `${emoji} ${title}`,
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "14px",
        backgroundColor: "#2563EB",
        contents: [
          { type: "text", text: `${emoji} ${title}`, weight: "bold", color: "#FFFFFF", size: "lg" },
          ...(subtitle ? [{ type: "text", text: subtitle, color: "#BFDBFE", size: "sm", margin: "xs", wrap: true }] : []),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        contents: [{
          type: "button",
          style: "primary",
          height: "sm",
          action: { type: "uri", label: buttonLabel, uri },
        }],
      },
    },
  };
}

// ── Main Menu Flex ────────────────────────────────────────────────────────────

export function flexMenu(isGroup = false, isManager = false, liffNewTaskId = "", liffDashboardId = "") {
  const newTaskBtn = liffNewTaskId
    ? { type: "button", action: { type: "uri", label: "➕ 新增任務", uri: `https://liff.line.me/${liffNewTaskId}` }, style: "secondary", height: "sm" }
    : mkBtn("➕ 新增任務", "/任務 新增", "secondary");
  const dashboardBtn = liffDashboardId
    ? { type: "button", action: { type: "uri", label: "📊 儀錶板", uri: `https://liff.line.me/${liffDashboardId}` }, style: "secondary", height: "sm" }
    : null;
  return {
    type: "flex",
    altText: "📖 功能選單",
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        backgroundColor: "#2563EB",
        contents: [
          { type: "text", text: "📋 營運管理助理", weight: "bold", color: "#FFFFFF", size: "xl" },
          { type: "text", text: "請選擇要執行的功能", color: "#BFDBFE", size: "sm", margin: "xs" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "12px",
        contents: [
          ...(isGroup
            ? [mkBtn("📋 任務列表", "/任務 列表", "primary")]
            : [
              {
                type: "box",
                layout: "horizontal",
                spacing: "sm",
                contents: [
                  mkBtn("📋 進行中任務", "/任務 列表", "primary"),
                  mkBtn("📁 所有任務", "/任務 全部", "secondary"),
                ],
              },
            ]),
          newTaskBtn,
          ...(dashboardBtn ? [dashboardBtn] : []),
          mkBtn("⚙️ 工作流程狀態", "/流程 狀態", "secondary"),
          ...(isGroup ? [] : [mkBtn("📝 備註查詢", "/備註", "secondary")]),
          ...(isManager ? [mkBtn("🔑 管理員選單", "/管理", "secondary")] : []),
          ...(isGroup ? [] : [mkBtn("👤 帳號連結說明", "/說明", "link")]),
        ],
      },
    },
  };
}

// ── Task List Flex Carousel ───────────────────────────────────────────────────

export function flexTaskList(tasks: any[], ownerName?: string, liffNewTaskId = "") {
  const altText = ownerName
    ? `📋 ${ownerName} 的任務（${tasks.length} 件）`
    : `📋 您的任務（${tasks.length} 件）`;

  // Empty state
  if (tasks.length === 0) {
    return withQuickReplies(
      {
        type: "flex",
        altText: ownerName ? `✅ ${ownerName} 目前沒有進行中的任務` : "✅ 目前沒有待處理的任務",
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            paddingAll: "20px",
            contents: [
              { type: "text", text: "✅", size: "3xl", align: "center" },
              {
                type: "text",
                text: ownerName ? `${ownerName} 目前沒有進行中任務` : "沒有待處理任務",
                weight: "bold",
                size: "lg",
                align: "center",
                margin: "md",
              },
              { type: "text", text: "目前所有任務均已完成", color: "#AAAAAA", size: "sm", align: "center", margin: "sm" },
            ],
          },
          footer: {
            type: "box",
            layout: "vertical",
            paddingAll: "8px",
            contents: [liffNewTaskId
              ? { type: "button", action: { type: "uri", label: "➕ 新增任務", uri: `https://liff.line.me/${liffNewTaskId}` }, style: "primary", height: "sm" }
              : mkBtn("➕ 新增任務", "/任務 新增", "primary")],
          },
        },
      },
      liffNewTaskId
        ? [{ label: "➕ 新增任務", text: "/說明" }, { label: "⚙️ 流程狀態", text: "/流程 狀態" }]
        : [{ label: "➕ 新增任務", text: "/任務 新增" }, { label: "⚙️ 流程狀態", text: "/流程 狀態" }],
    );
  }

  const now = new Date();
  const bubbles = tasks.slice(0, 10).map((t: any, i: number) => {
    const shortId = t.id.slice(0, 6);
    const due = t.due_date ? t.due_date.slice(0, 10) : "無截止日";
    const pColor = PRIORITY_COLOR[t.priority] ?? "#95A5A6";
    const sColor = STATUS_COLOR[t.status] ?? "#95A5A6";
    const isOverdue = t.due_date && t.status !== "completed" && t.status !== "cancelled" && new Date(t.due_date) < now;
    const daysOverdue = isOverdue ? Math.ceil((now.getTime() - new Date(t.due_date).getTime()) / 86400000) : 0;
    const headerBg = isOverdue ? "#dc2626" : t.status === "pending" ? "#4A4A4A" : pColor;
    const wfName = t.workflow_instance?.name ?? null;
    const noteLines = t.notes ? t.notes.split("\n").filter(Boolean) : [];

    return {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "10px",
        backgroundColor: headerBg,
        contents: [
          ...(wfName ? [{ type: "text", text: wfName, color: "#FFFFFFAA", size: "xxs" }] : []),
          {
            type: "text",
            text: isOverdue ? `${i + 1}. ${t.title}  🔴逾期${daysOverdue}天` : `${i + 1}. ${t.title}`,
            color: "#FFFFFF",
            weight: "bold",
            size: "sm",
            wrap: true,
            maxLines: 2,
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "10px",
        contents: [
          infoRow("狀態", statusLabel(t.status), sColor),
          infoRow("優先", priorityLabel(t.priority), pColor),
          infoRow("截止", due),
          ...(noteLines.length > 0 ? [
            { type: "separator", margin: "sm" },
            { type: "text", text: "📝 備註", color: "#333333", size: "xxs", weight: "bold", margin: "sm" },
            ...noteLines.slice(-5).map((n: string) => ({ type: "text", text: n, color: "#666666", size: "xxs", wrap: true })),
          ] : []),
          { type: "text", text: `#${shortId}`, color: "#CCCCCC", size: "xxs", margin: "sm" },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "xs",
        paddingAll: "8px",
        contents: [
          t.confirmation_required
            ? {
                type: "button",
                action: { type: "message", label: "🔐 請求確認", text: `/任務 ${shortId} 請求確認` },
                style: "primary",
                height: "sm",
                color: "#8b5cf6",
              }
            : {
                type: "button",
                action: { type: "message", label: "✅ 標記完成", text: `/任務 #${shortId} 完成` },
                style: "primary",
                height: "sm",
                color: "#27AE60",
              },
          {
            type: "button",
            action: { type: "message", label: "📝 更新備註", text: `/任務 #${shortId} 更新` },
            style: "secondary",
            height: "sm",
          },
        ],
      },
    };
  });

  // In group context, prepend a header bubble showing whose tasks these are
  if (ownerName) {
    bubbles.unshift({
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        justifyContent: "center",
        backgroundColor: "#2563EB",
        contents: [
          { type: "text", text: `📋 ${ownerName}`, color: "#FFFFFF", weight: "bold", size: "md", align: "center" },
          { type: "text", text: "的進行中任務", color: "#BFDBFE", size: "xs", align: "center", margin: "xs" },
          {
            type: "box",
            layout: "vertical",
            margin: "md",
            paddingAll: "6px",
            backgroundColor: "#FFFFFF22",
            cornerRadius: "20px",
            contents: [
              { type: "text", text: `${tasks.length} 件`, color: "#FFFFFF", size: "xl", weight: "bold", align: "center" },
            ],
          },
        ],
      },
    } as any);
  }

  return withQuickReplies(
    {
      type: "flex",
      altText,
      contents: { type: "carousel", contents: bubbles },
    },
    [
      { label: "⚙️ 流程狀態", text: "/流程 狀態" },
      { label: "📖 指令說明", text: "/說明" },
    ],
  );
}

// ── Group Task List (shows all tasks with owner names) ────────────────────────

export function flexGroupTaskList(tasks: any[]) {
  if (tasks.length === 0) {
    return withQuickReplies(
      { type: "text", text: "✅ 此群組目前沒有進行中的流程任務。" },
      [{ label: "⚙️ 流程狀態", text: "/流程 狀態" }],
    );
  }

  const now = new Date();
  const bubbles: any[] = tasks.slice(0, 10).map((t: any, i: number) => {
    const shortId = t.id.slice(0, 6);
    const due = t.due_date ? t.due_date.slice(0, 10) : "無截止日";
    const pColor = PRIORITY_COLOR[t.priority] ?? "#95A5A6";
    const sColor = STATUS_COLOR[t.status] ?? "#95A5A6";
    const isOverdue = t.due_date && t.status !== "completed" && t.status !== "cancelled" && new Date(t.due_date) < now;
    const daysOverdue = isOverdue ? Math.ceil((now.getTime() - new Date(t.due_date).getTime()) / 86400000) : 0;
    const headerBg = isOverdue ? "#dc2626" : t.status === "pending" ? "#4A4A4A" : pColor;
    const assigneeName = t.assignee?.name ?? "—";
    const wfName = t.workflow_instance?.name ?? null;
    const noteLines = t.notes ? t.notes.split("\n").filter(Boolean) : [];

    return {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "10px",
        backgroundColor: headerBg,
        contents: [
          ...(wfName ? [{ type: "text", text: wfName, color: "#FFFFFFAA", size: "xxs" }] : []),
          { type: "text", text: isOverdue ? `${i + 1}. ${t.title}  🔴逾期${daysOverdue}天` : `${i + 1}. ${t.title}`, color: "#FFFFFF", weight: "bold", size: "sm", wrap: true, maxLines: 2 },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "10px",
        contents: [
          infoRow("負責人", assigneeName, "#1A252F"),
          infoRow("狀態", statusLabel(t.status), sColor),
          infoRow("優先", priorityLabel(t.priority), pColor),
          infoRow("截止", due),
          ...(noteLines.length > 0 ? [
            { type: "separator", margin: "sm" },
            { type: "text", text: "📝 備註", color: "#333333", size: "xxs", weight: "bold", margin: "sm" },
            ...noteLines.slice(-5).map((n: string) => ({ type: "text", text: n, color: "#666666", size: "xxs", wrap: true })),
          ] : []),
          { type: "text", text: `#${shortId}`, color: "#CCCCCC", size: "xxs", margin: "sm" },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "xs",
        paddingAll: "8px",
        contents: [
          t.confirmation_required
            ? {
                type: "button",
                action: { type: "message", label: "🔐 請求確認", text: `/任務 ${shortId} 請求確認` },
                style: "primary",
                height: "sm",
                color: "#8b5cf6",
              }
            : {
                type: "button",
                action: { type: "message", label: "✅ 標記完成", text: `/任務 #${shortId} 完成` },
                style: "primary",
                height: "sm",
                color: "#27AE60",
              },
        ],
      },
    };
  });

  // Header bubble — must match task bubble size (kilo) for carousel
  bubbles.unshift({
    type: "bubble",
    size: "kilo",
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      justifyContent: "center",
      backgroundColor: "#2563EB",
      contents: [
        { type: "text", text: "📋 群組流程任務", color: "#FFFFFF", weight: "bold", size: "md", align: "center" },
        { type: "text", text: "所有成員任務", color: "#BFDBFE", size: "xs", align: "center", margin: "xs" },
        {
          type: "box",
          layout: "vertical",
          margin: "md",
          paddingAll: "6px",
          backgroundColor: "#FFFFFF22",
          cornerRadius: "20px",
          contents: [
            { type: "text", text: `${tasks.length} 件`, color: "#FFFFFF", size: "xl", weight: "bold", align: "center" },
          ],
        },
      ],
    },
  } as any);

  return withQuickReplies(
    {
      type: "flex",
      altText: `📋 群組流程任務（${tasks.length} 件）`,
      contents: { type: "carousel", contents: bubbles },
    },
    [
      { label: "⚙️ 流程狀態", text: "/流程 狀態" },
      { label: "📖 說明", text: "/說明" },
    ],
  );
}

// ── Task Created / Done Flex ──────────────────────────────────────────────────

export function flexSuccess(emoji: string, title: string, subtitle: string) {
  return withQuickReplies(
    {
      type: "flex",
      altText: title,
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          paddingAll: "20px",
          contents: [
            { type: "text", text: emoji, size: "3xl", align: "center" },
            { type: "text", text: title, weight: "bold", size: "md", align: "center", margin: "md", wrap: true },
            { type: "text", text: subtitle, color: "#AAAAAA", size: "sm", align: "center", margin: "sm", wrap: true },
          ],
        },
        footer: {
          type: "box",
          layout: "vertical",
          paddingAll: "8px",
          contents: [mkBtn("📋 查看任務列表", "/任務 列表", "primary")],
        },
      },
    },
    [
      { label: "📋 任務列表", text: "/任務 列表" },
      { label: "➕ 再新增", text: "/任務 新增" },
      { label: "⚙️ 流程狀態", text: "/流程 狀態" },
    ],
  );
}

// ── Workflow Status Flex ──────────────────────────────────────────────────────

export function flexWorkflowStatus(instances: any[]) {
  if (!instances || instances.length === 0) {
    return withQuickReplies(
      { type: "text", text: "📭 目前沒有進行中的流程。" },
      [{ label: "📋 任務列表", text: "/任務 列表" }],
    );
  }

  const bodyContents: any[] = [];
  instances.forEach((wi: any, idx: number) => {
    const shortId = (wi.id as string).slice(0, 6);
    const date = wi.started_at ? (wi.started_at as string).slice(0, 10) : "";
    const wiStatusLabel = wi.status === "paused" ? "⏸ 暫停" : "🔄 進行中";

    if (idx > 0) bodyContents.push({ type: "separator", margin: "md" });

    bodyContents.push({
      type: "box", layout: "vertical", margin: idx === 0 ? "none" : "md",
      contents: [
        { type: "text", text: wi.name ?? "—", weight: "bold", size: "sm", wrap: true },
        { type: "text", text: `${wiStatusLabel}　開始：${date}`, color: "#AAAAAA", size: "xs", margin: "xs" },
        {
          type: "box", layout: "horizontal", spacing: "sm", margin: "sm",
          contents: [
            {
              type: "button",
              action: { type: "message", label: "🔄 進行中", text: `/流程 任務 #${shortId}` },
              style: "secondary", height: "sm", flex: 1,
            },
            {
              type: "button",
              action: { type: "message", label: "📋 全部", text: `/流程 任務 #${shortId} 全部` },
              style: "secondary", height: "sm", flex: 1,
            },
          ],
        },
      ],
    });
  });

  return withQuickReplies(
    {
      type: "flex",
      altText: `⚙️ 進行中的流程（${instances.length} 件）`,
      contents: {
        type: "bubble",
        header: {
          type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#2C3E50",
          contents: [
            { type: "text", text: `⚙️ 進行中的流程（${instances.length} 件）`, color: "#FFFFFF", weight: "bold", size: "md" },
          ],
        },
        body: { type: "box", layout: "vertical", paddingAll: "12px", contents: bodyContents },
        footer: {
          type: "box", layout: "vertical", paddingAll: "8px",
          contents: [mkBtn("📋 查看任務列表", "/任務 列表", "primary")],
        },
      },
    },
    [{ label: "📋 任務列表", text: "/任務 列表" }, { label: "📖 說明", text: "/說明" }],
  );
}

// ── Manager Flex Builders ─────────────────────────────────────────────────────

export function flexManagerMenu() {
  return withQuickReplies(
    {
      type: "flex",
      altText: "🔑 管理員選單",
      contents: {
        type: "bubble",
        header: {
          type: "box",
          layout: "vertical",
          paddingAll: "16px",
          backgroundColor: "#1A252F",
          contents: [
            { type: "text", text: "🔑 管理員選單", weight: "bold", color: "#FFFFFF", size: "xl" },
            { type: "text", text: "選擇管理功能", color: "#AEB6BF", size: "sm", margin: "xs" },
          ],
        },
        body: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          paddingAll: "12px",
          contents: [
            mkBtn("📊 團隊任務全覽", "/管理 全覽", "primary"),
            mkBtn("➕ 指派任務", "/管理 指派", "secondary"),
            mkBtn("⚙️ 流程狀態", "/流程 狀態", "secondary"),
            mkBtn("📋 我的任務", "/任務 列表", "secondary"),
          ],
        },
      },
    },
    [
      { label: "📊 全覽", text: "/管理 全覽" },
      { label: "➕ 指派", text: "/管理 指派" },
      { label: "⚙️ 流程", text: "/流程 狀態" },
    ],
  );
}

export function flexManagerOverview(tasks: any[]) {
  if (tasks.length === 0) {
    return withQuickReplies(
      {
        type: "flex",
        altText: "✅ 團隊目前沒有進行中任務",
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            paddingAll: "20px",
            contents: [
              { type: "text", text: "✅", size: "3xl", align: "center" },
              { type: "text", text: "團隊目前沒有進行中任務", weight: "bold", size: "md", align: "center", margin: "md" },
              { type: "text", text: "所有任務均已完成", color: "#AAAAAA", size: "sm", align: "center", margin: "sm" },
            ],
          },
          footer: {
            type: "box",
            layout: "vertical",
            paddingAll: "8px",
            contents: [mkBtn("➕ 指派新任務", "/管理 指派", "primary")],
          },
        },
      },
      [{ label: "➕ 指派任務", text: "/管理 指派" }, { label: "⚙️ 流程狀態", text: "/流程 狀態" }],
    );
  }

  const bubbles: any[] = tasks.slice(0, 10).map((t: any, i: number) => {
    const shortId = t.id.slice(0, 6);
    const due = t.due_date ? t.due_date.slice(0, 10) : "無截止日";
    const pColor = PRIORITY_COLOR[t.priority] ?? "#95A5A6";
    const assigneeName = t.assignee?.name ?? "—";

    return {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "10px",
        backgroundColor: pColor,
        contents: [
          { type: "text", text: `${i + 1}. ${t.title}`, color: "#FFFFFF", weight: "bold", size: "sm", wrap: true, maxLines: 2 },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "10px",
        contents: [
          infoRow("負責人", assigneeName, "#1A252F"),
          infoRow("優先", priorityLabel(t.priority), pColor),
          infoRow("截止", due),
          { type: "text", text: `#${shortId}`, color: "#CCCCCC", size: "xxs", margin: "sm" },
        ],
      },
    };
  });

  // Prepend summary header bubble — must match task bubble size (kilo)
  bubbles.unshift({
    type: "bubble",
    size: "kilo",
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      justifyContent: "center",
      backgroundColor: "#1A252F",
      contents: [
        { type: "text", text: "📊 團隊全覽", color: "#FFFFFF", weight: "bold", size: "md", align: "center" },
        { type: "text", text: "進行中任務", color: "#AEB6BF", size: "xs", align: "center", margin: "xs" },
        {
          type: "box",
          layout: "vertical",
          margin: "md",
          paddingAll: "6px",
          backgroundColor: "#FFFFFF22",
          cornerRadius: "20px",
          contents: [
            { type: "text", text: `${tasks.length} 件`, color: "#FFFFFF", size: "xl", weight: "bold", align: "center" },
          ],
        },
      ],
    },
  });

  return withQuickReplies(
    {
      type: "flex",
      altText: `📊 團隊進行中任務（${tasks.length} 件）`,
      contents: { type: "carousel", contents: bubbles },
    },
    [
      { label: "➕ 指派任務", text: "/管理 指派" },
      { label: "⚙️ 流程狀態", text: "/流程 狀態" },
      { label: "📋 我的任務", text: "/任務 列表" },
    ],
  );
}

// ── Task Creation Flow Flex Builders ──────────────────────────────────────────

export function buildWorkflowSelectionFlex(instances: any[], title: string, isManager: boolean): object {
  const totalSteps = isManager ? 4 : 3;
  const bodyItems: any[] = [
    { type: "text", text: `📝 新任務：「${title}」`, weight: "bold", size: "md", wrap: true },
    { type: "separator", margin: "md" },
    { type: "text", text: "請選擇要關聯的工作流程：", size: "sm", margin: "md", color: "#555555" },
  ];
  if (instances.length === 0) {
    bodyItems.push({ type: "text", text: "（目前沒有進行中的流程）", size: "sm", color: "#AAAAAA", margin: "sm" });
  } else {
    instances.forEach((inst: any, i: number) => {
      bodyItems.push({ type: "text", text: `${i + 1}. ${inst.name}`, size: "sm", margin: "xs", color: "#333333" });
    });
  }
  bodyItems.push(
    { type: "separator", margin: "md" },
    { type: "text", text: "輸入編號選擇，或輸入「跳過」", size: "xs", color: "#AAAAAA", margin: "sm" },
  );
  return withQuickReplies({
    type: "flex",
    altText: `選擇工作流程 — ${title}`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#E67E22",
        contents: [
          { type: "text", text: `➕ 新增任務 — 步驟 1/${totalSteps}`, color: "#FFFFFF", weight: "bold", size: "md" },
          { type: "text", text: "選擇工作流程", color: "#FFE0B2", size: "xs", margin: "xs" },
        ],
      },
      body: { type: "box", layout: "vertical", paddingAll: "14px", contents: bodyItems },
    },
  }, [{ label: "跳過", text: "跳過" }, { label: "取消", text: "取消" }]);
}

export function buildDueDateFlex(title: string, stepNum: number, totalSteps: number): object {
  return withQuickReplies({
    type: "flex",
    altText: `設定截止日 — ${title}`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#E67E22",
        contents: [
          { type: "text", text: `➕ 新增任務 — 步驟 ${stepNum}/${totalSteps}`, color: "#FFFFFF", weight: "bold", size: "md" },
          { type: "text", text: "設定截止日期", color: "#FFE0B2", size: "xs", margin: "xs" },
        ],
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "14px",
        contents: [
          { type: "text", text: `任務：「${title}」`, size: "sm", weight: "bold", wrap: true },
          { type: "separator", margin: "md" },
          { type: "text", text: "請輸入截止日期：", size: "sm", margin: "md", color: "#555555" },
          { type: "text", text: "格式：YYYY-MM-DD 或 MM/DD", size: "xs", color: "#AAAAAA", margin: "sm" },
          { type: "text", text: "也可以輸入：今天、明天、後天、下週一、3天後", size: "xs", color: "#AAAAAA", margin: "xs", wrap: true },
        ],
      },
    },
  }, [
    { label: "明天", text: "明天" },
    { label: "後天", text: "後天" },
    { label: "下週一", text: "下週一" },
    { label: "跳過", text: "跳過" },
  ]);
}

export function buildReminderFlex(title: string, stepNum: number, totalSteps: number): object {
  return withQuickReplies({
    type: "flex",
    altText: `設定提醒 — ${title}`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#E67E22",
        contents: [
          { type: "text", text: `➕ 新增任務 — 步驟 ${stepNum}/${totalSteps}`, color: "#FFFFFF", weight: "bold", size: "md" },
          { type: "text", text: "設定提醒", color: "#FFE0B2", size: "xs", margin: "xs" },
        ],
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "14px",
        contents: [
          { type: "text", text: `任務：「${title}」`, size: "sm", weight: "bold", wrap: true },
          { type: "separator", margin: "md" },
          { type: "text", text: "需要設定提醒嗎？", size: "sm", margin: "md", color: "#555555" },
          { type: "text", text: "例如：截止前1天、截止前2小時", size: "xs", color: "#AAAAAA", margin: "sm" },
        ],
      },
    },
  }, [
    { label: "截止前1天", text: "截止前1天" },
    { label: "截止前2小時", text: "截止前2小時" },
    { label: "跳過", text: "跳過" },
  ]);
}

export function buildOwnerSelectionFlex(employees: any[], title: string): object {
  const list = employees.map((e: any, i: number) => ({
    type: "text", text: `${i + 1}. ${e.name}`, size: "sm", margin: "xs", color: "#333333",
  }));
  return withQuickReplies({
    type: "flex",
    altText: `指派任務負責人 — ${title}`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#E67E22",
        contents: [
          { type: "text", text: "➕ 新增任務 — 步驟 4/4", color: "#FFFFFF", weight: "bold", size: "md" },
          { type: "text", text: "選擇任務負責人", color: "#FFE0B2", size: "xs", margin: "xs" },
        ],
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "14px",
        contents: [
          { type: "text", text: `任務：「${title}」`, size: "sm", weight: "bold", wrap: true },
          { type: "separator", margin: "md" },
          { type: "text", text: "選擇負責人（輸入編號或姓名）：", size: "sm", margin: "md", color: "#555555" },
          ...list,
          { type: "separator", margin: "md" },
          { type: "text", text: "輸入「自己」指定自己", size: "xs", color: "#AAAAAA", margin: "sm" },
        ],
      },
    },
  }, [
    { label: "自己", text: "自己" },
    { label: "取消", text: "取消" },
  ]);
}

export function buildConfirmationFlex(data: Record<string, any>): object {
  return withQuickReplies({
    type: "flex",
    altText: `確認建立任務：${data.title}`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", paddingAll: "12px", backgroundColor: "#27AE60",
        contents: [
          { type: "text", text: "✅ 確認建立任務", color: "#FFFFFF", weight: "bold", size: "md" },
        ],
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "14px",
        contents: [
          infoRow("標題", data.title ?? "—"),
          infoRow("工作流程", data.workflow_name ?? "無"),
          infoRow("截止日", data.due_date ?? "未設定"),
          infoRow("提醒", data.reminder ?? "未設定"),
          infoRow("負責人", data.owner_name ?? "自己"),
        ],
      },
      footer: {
        type: "box", layout: "horizontal", paddingAll: "8px", spacing: "sm",
        contents: [
          mkBtn("✅ 確認", "確認", "primary", "#27AE60"),
          mkBtn("❌ 取消", "取消", "secondary"),
        ],
      },
    },
  }, [
    { label: "確認", text: "確認" },
    { label: "取消", text: "取消" },
  ]);
}
