import { priorityLabel, statusLabel, PRIORITY_COLOR, STATUS_COLOR } from './constants.ts';
import {
  COLOR_SUCCESS, COLOR_DANGER, COLOR_INFO, COLOR_WARNING, COLOR_PRIMARY,
  TEXT_ON_COLOR, TEXT_ON_COLOR_MUTED, TEXT_DIM_SUCCESS, TEXT_DIM_DANGER, TEXT_DIM_PRIMARY,
  TEXT_TITLE, TEXT_BODY, TEXT_SECONDARY, TEXT_LABEL, TEXT_MUTED,
  REQUEST_TYPE_COLORS,
} from './colors.ts';

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
  const { title, subtitle, buttonLabel, liffPath = "", emoji = "📱" } = opts;
  // Trim defensively — env vars and DB cells often arrive with stray whitespace,
  // which makes the URL `https://liff.line.me/ <id>` fail LINE's URI validator.
  const liffId = (opts.liffId ?? "").trim();
  // LINE rejects LIFF URIs with sub-paths ("invalid uri scheme") so we pass
  // the target route via ?to=... and let the LIFF read the query and navigate.
  const uri = liffPath
    ? `https://liff.line.me/${liffId}?to=${encodeURIComponent(liffPath)}`
    : `https://liff.line.me/${liffId}`;
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

// ── Generic Result Cards ──────────────────────────────────────────────────────
// 用於操作完成後給 user 一張結果卡（取代「文字成功」訊息）。
// 所有 postback 操作（核准 / 完成 / 拒絕 / 解鎖 ...）共用這兩個 builder。

type ResultCardOpts = {
  title: string;
  /** body 多行說明，每個元素一行 */
  lines?: string[];
  /** 標頭右上角 chip 文字（例：完成時間 / 操作者）*/
  chip?: string;
  /** footer 按鈕（最多 3 顆），未提供則無 footer */
  buttons?: Array<{ label: string; uri?: string; postback?: string; messageText?: string; style?: "primary" | "secondary"; color?: string; displayText?: string }>;
};

function buildResultCard(opts: ResultCardOpts, headerColor: string, dimColor: string, emoji: string, altPrefix: string) {
  const { title, lines = [], chip, buttons } = opts;
  const headerContents: any[] = [
    { type: "text", text: `${emoji} ${title}`, color: TEXT_ON_COLOR, weight: "bold", size: "md", wrap: true },
  ];
  if (chip) {
    headerContents.push({ type: "text", text: chip, color: dimColor, size: "xs", margin: "xs" });
  }

  const bubble: any = {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box", layout: "vertical", paddingAll: "14px",
      backgroundColor: headerColor,
      contents: headerContents,
    },
  };

  if (lines.length > 0) {
    bubble.body = {
      type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px",
      contents: lines.map(l => ({ type: "text", text: l, size: "sm", color: TEXT_BODY, wrap: true })),
    };
  }

  if (buttons && buttons.length > 0) {
    bubble.footer = {
      type: "box", layout: "vertical", spacing: "xs", paddingAll: "10px",
      contents: buttons.slice(0, 3).map(b => {
        const action: any = b.uri
          ? { type: "uri", label: b.label, uri: b.uri }
          : b.postback
          ? { type: "postback", label: b.label, data: b.postback, ...(b.displayText ? { displayText: b.displayText } : {}) }
          : { type: "message", label: b.label, text: b.messageText ?? b.label };
        return {
          type: "button", action,
          style: b.style ?? "secondary",
          height: "sm",
          ...(b.color ? { color: b.color } : {}),
        };
      }),
    };
  }

  return { type: "flex", altText: `${altPrefix} ${title}`, contents: bubble };
}

/** 操作成功的結果卡（綠色 header） */
export function flexResultOk(opts: ResultCardOpts) {
  return buildResultCard(opts, COLOR_SUCCESS, TEXT_DIM_SUCCESS, "✅", "✅");
}

/** 操作失敗的結果卡（紅色 header） */
export function flexResultErr(opts: ResultCardOpts) {
  return buildResultCard(opts, COLOR_DANGER, TEXT_DIM_DANGER, "❌", "❌");
}

/** 中性資訊卡（藍色 header） — 用於 preview / 提示 */
export function flexResultInfo(opts: ResultCardOpts) {
  return buildResultCard(opts, COLOR_PRIMARY, TEXT_DIM_PRIMARY, "ℹ️", "ℹ️");
}

// ── Compact two-column row used by upgraded approval/task cards ──────────────
// 比 infoRow 多一點視覺層次：label 灰、value 黑粗體 + 可選彩色 dot 提示。
export function rowKv(label: string, value: string, opts?: { valueColor?: string; valueWeight?: "regular" | "bold"; dot?: string }) {
  const contents: any[] = [
    { type: "text", text: label, color: TEXT_LABEL, size: "xs", flex: 3 },
    { type: "text", text: value, color: opts?.valueColor ?? TEXT_BODY, size: "xs", flex: 6, weight: opts?.valueWeight ?? "bold", wrap: true },
  ];
  if (opts?.dot) {
    contents.splice(1, 0, { type: "text", text: opts.dot, size: "xs", flex: 0, margin: "none" });
  }
  return { type: "box", layout: "horizontal", spacing: "sm", margin: "xs", contents };
}

// ── Approval Request Card (P0) ───────────────────────────────────────────────
// 統一的簽核請求卡：請假 / 加班 / 出差 / 經費 / 補卡 / 代班 / 希望休 七種共用。
// 使用 REQUEST_TYPE_COLORS 取顏色，header / footer / button 都統一格式。
//
// 操作按鈕走 postback：
//   - approve:request&type=leave&id=42       → 直接核准
//   - reject:request&type=leave&id=42        → 進入 pending → 等使用者打駁回原因
//   - detail:request&type=leave&id=42&path=/approve  → 開 LIFF 看完整詳情

export type ApprovalCardData = {
  /** 7 種申請類型之一 */
  type: "leave" | "overtime" | "trip" | "expense" | "expense_request" | "correction" | "cover" | "off_request";
  /** 該申請單在 DB 的 id */
  id: number;
  /** 申請人姓名 */
  applicantName: string;
  /** 申請人單位（部門/門市，可選） */
  applicantDept?: string | null;
  /** 狀態 chip 文字（例：「待審核」「待你審核」） */
  statusChip?: string;
  /** key/value 欄位列（依類型不同而異） */
  rows: Array<{ label: string; value: string; valueColor?: string }>;
  /** 申請原因 / 描述（會以全寬 wrap 顯示） */
  reason?: string | null;
  /** 附件清單（檔名 + URL） */
  attachments?: Array<{ name: string; url?: string | null }>;
  /** 提示行（餘額、衝突警示、SLA 提醒…） */
  alerts?: string[];
  /** 看完整詳情的 LIFF 路徑（預設 /approve） */
  liffDetailPath?: string;
  /** LIFF id（從 webhook ctx 帶進來） */
  liffId?: string;
};

export function flexApprovalRequest(d: ApprovalCardData) {
  const palette = REQUEST_TYPE_COLORS[d.type] ?? REQUEST_TYPE_COLORS.leave;

  // ── Header ──
  const header: any = {
    type: "box", layout: "vertical", paddingAll: "16px",
    backgroundColor: palette.header,
    contents: [
      {
        type: "box", layout: "horizontal", contents: [
          { type: "text", text: `${palette.emoji} ${palette.label}`, color: TEXT_ON_COLOR, weight: "bold", size: "lg", flex: 5 },
          ...(d.statusChip ? [{ type: "text", text: d.statusChip, color: TEXT_ON_COLOR_MUTED, size: "xs", align: "end", gravity: "center", flex: 3 }] : []),
        ],
      },
      { type: "text", text: `#${d.id}`, color: palette.subtitle, size: "xs", margin: "xs" },
    ],
  };

  // ── Body ──
  const bodyContents: any[] = [];

  // 申請人區塊（突出顯示）
  bodyContents.push({
    type: "box", layout: "horizontal", spacing: "sm",
    contents: [
      { type: "text", text: "👤", size: "lg", flex: 0 },
      {
        type: "box", layout: "vertical", flex: 7,
        contents: [
          { type: "text", text: d.applicantName, weight: "bold", size: "md", color: TEXT_TITLE },
          ...(d.applicantDept ? [{ type: "text", text: d.applicantDept, size: "xs", color: TEXT_SECONDARY, margin: "none" }] : []),
        ],
      },
    ],
  });

  bodyContents.push({ type: "separator", margin: "md" });

  // 欄位列
  for (const r of d.rows) {
    bodyContents.push(rowKv(r.label, r.value, { valueColor: r.valueColor }));
  }

  // 原因（full width，獨立區塊）
  if (d.reason && d.reason.trim()) {
    bodyContents.push({ type: "separator", margin: "md" });
    bodyContents.push({
      type: "box", layout: "vertical", margin: "sm", paddingAll: "10px",
      backgroundColor: "#F9FAFB", cornerRadius: "8px",
      contents: [
        { type: "text", text: "📝 申請原因", size: "xxs", color: TEXT_LABEL, weight: "bold" },
        { type: "text", text: d.reason, size: "sm", color: TEXT_BODY, wrap: true, margin: "sm" },
      ],
    });
  }

  // 附件
  if (d.attachments && d.attachments.length > 0) {
    bodyContents.push({ type: "separator", margin: "md" });
    bodyContents.push({
      type: "box", layout: "vertical", spacing: "xs", margin: "sm",
      contents: [
        { type: "text", text: "📎 附件", size: "xxs", color: TEXT_LABEL, weight: "bold" },
        ...d.attachments.slice(0, 4).map(a => ({
          type: "text",
          text: `• ${a.name}`,
          size: "xs",
          color: a.url ? COLOR_INFO : TEXT_SECONDARY,
          wrap: true,
          ...(a.url ? { action: { type: "uri", label: a.name, uri: a.url } } : {}),
        })),
      ],
    });
  }

  // 提醒 / 影響 / 餘額
  if (d.alerts && d.alerts.length > 0) {
    bodyContents.push({ type: "separator", margin: "md" });
    bodyContents.push({
      type: "box", layout: "vertical", spacing: "xs", margin: "sm",
      contents: d.alerts.map(a => ({ type: "text", text: a, size: "xs", color: COLOR_WARNING, wrap: true })),
    });
  }

  // ── Footer ──
  const liffDetailUri = d.liffId
    ? `https://liff.line.me/${d.liffId.trim()}?to=${encodeURIComponent(d.liffDetailPath ?? "/approve")}`
    : null;

  // 注意：postback 不帶 displayText → 按了不會在聊天室留回音文字（節省版面）
  const footerButtons: any[] = [
    {
      type: "box", layout: "horizontal", spacing: "sm",
      contents: [
        {
          type: "button",
          action: { type: "postback", label: "✅ 核准", data: `action=approve&type=request&rt=${d.type}&id=${d.id}` },
          style: "primary", color: COLOR_SUCCESS, height: "sm", flex: 1,
        },
        {
          type: "button",
          action: { type: "postback", label: "❌ 駁回", data: `action=reject&type=request&rt=${d.type}&id=${d.id}` },
          style: "primary", color: COLOR_DANGER, height: "sm", flex: 1,
        },
      ],
    },
  ];
  if (liffDetailUri) {
    footerButtons.push({
      type: "button",
      action: { type: "uri", label: "📋 看完整詳情", uri: liffDetailUri },
      style: "secondary", height: "sm",
    });
  }

  return {
    type: "flex",
    altText: `${palette.emoji} ${palette.label} — ${d.applicantName}`,
    contents: {
      type: "bubble",
      size: "kilo",
      header,
      body: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px", contents: bodyContents },
      footer: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px", contents: footerButtons },
    },
  };
}

// ── Main Menu Flex ────────────────────────────────────────────────────────────

// Build a LIFF deep-link URI. LINE rejects sub-paths so we pass the SPA route
// via ?to=..., and the LIFF's LiffDeepLinkRedirect forwards the target route.
function liffUri(liffId: string, path: string): string {
  return `https://liff.line.me/${liffId.trim()}?to=${encodeURIComponent(path)}`;
}

// Pick first non-empty LIFF id from the fallback chain. Lets callers pass any
// mix of LIFF_TASK_ID / LIFF_NEW_TASK_ID / LIFF_DASHBOARD_ID — one is enough.
function pickLiff(...ids: string[]): string {
  for (const id of ids) if (id && id.trim()) return id.trim();
  return "";
}

// LIFF deep-link button helper. Returns null when no LIFF id available so caller
// can fall back to a text-command button.
function liffDeepLinkBtn(
  label: string,
  id: string,
  path: string,
  style: "primary" | "secondary" = "secondary",
) {
  return id
    ? { type: "button", action: { type: "uri", label, uri: liffUri(id, path) }, style, height: "sm" }
    : null;
}

export function flexMenu(
  isGroup = false,
  isManager = false,
  liffNewTaskId = "",
  liffDashboardId = "",
  liffTaskId = "",
) {
  const listId = pickLiff(liffTaskId, liffNewTaskId, liffDashboardId);
  const newId  = pickLiff(liffNewTaskId, liffTaskId, liffDashboardId);
  const dashId = pickLiff(liffDashboardId, liffTaskId, liffNewTaskId);

  // 主 LIFF 區（儀表板優先）
  const dashboardBtn = liffDeepLinkBtn("📊 儀表板", dashId, "/dashboard", "primary")
    ?? mkBtn("📊 儀表板", "/流程 狀態", "primary");
  const newTaskBtn = liffDeepLinkBtn("➕ 新增任務", newId, "/tasks/new")
    ?? mkBtn("➕ 新增任務", "/任務 新增", "secondary");
  const updateTaskBtn = liffDeepLinkBtn("⚙️ 更新任務", listId, "/tasks")
    ?? mkBtn("⚙️ 更新任務", "/任務 列表", "secondary");
  const todoBtn = liffDeepLinkBtn("📋 代辦項目", listId, "/todo")
    ?? mkBtn("📋 代辦項目", "/代辦", "secondary");

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
        contents: isGroup
          ? [newTaskBtn, todoBtn]
          : [dashboardBtn, newTaskBtn, updateTaskBtn, todoBtn],
      },
    },
  };
}

// ── 出勤卡片（文字指令「出勤」觸發）─────────────────────────────
// 單張 flex，四顆 LIFF deep-link 按鈕：打卡 / 班表 / 請假 / 加班。
export function flexAttendanceCard(
  liffTaskId = "",
  liffNewTaskId = "",
  liffDashboardId = "",
) {
  const id = pickLiff(liffTaskId, liffNewTaskId, liffDashboardId);
  // 沒有 LIFF id 就退化成文字指令版（各自的 LIFF_SHORTCUTS 或提示）。
  const btn = (label: string, path: string, style: "primary" | "secondary" = "secondary") =>
    liffDeepLinkBtn(label, id, path, style) ?? mkBtn(label, label.replace(/^\S+\s/, ""), style);

  return {
    type: "flex",
    altText: "🗓 出勤功能",
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", paddingAll: "14px",
        backgroundColor: "#06b6d4",
        contents: [
          { type: "text", text: "🗓 出勤", weight: "bold", color: "#FFFFFF", size: "lg" },
          { type: "text", text: "打卡、班表、請假、加班", color: "#CFFAFE", size: "xs", margin: "xs" },
        ],
      },
      body: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px",
        contents: [
          btn("⏰ 打卡", "/clock", "primary"),
          btn("📅 班表", "/my-schedule"),
          btn("🏖 請假", "/leave"),
          btn("🕐 加班", "/overtime"),
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
              ? { type: "button", action: { type: "uri", label: "➕ 新增任務", uri: liffUri(liffNewTaskId, "/tasks/new") }, style: "primary", height: "sm" }
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
    const shortId = String(t.id).slice(0, 6);
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
    const shortId = String(t.id).slice(0, 6);
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
    const shortId = String(wi.id).slice(0, 6);
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

export function flexManagerMenu(liffTaskId = "", liffNewTaskId = "", liffDashboardId = "") {
  const listId = pickLiff(liffTaskId, liffNewTaskId, liffDashboardId);
  const newId  = pickLiff(liffNewTaskId, liffTaskId, liffDashboardId);
  const dashId = pickLiff(liffDashboardId, liffTaskId, liffNewTaskId);

  const liffBtn = (label: string, id: string, path: string, style: "primary" | "secondary" = "secondary") =>
    id
      ? { type: "button", action: { type: "uri", label, uri: liffUri(id, path) }, style, height: "sm" }
      : null;

  // B3: top row = direct LIFF dashboard shortcut (primary)
  const topDashBtn = liffBtn("📊 開啟 LIFF 儀表板", dashId, "/dashboard", "primary");

  // Existing 4 buttons — mapped to LIFF routes when LIFF id available,
  // fallback to text commands (old BOT flow) when no LIFF id configured.
  const overviewBtn = liffBtn("📊 團隊任務全覽", dashId, "/dashboard")
    ?? mkBtn("📊 團隊任務全覽", "/管理 全覽", "primary");
  const assignBtn = liffBtn("➕ 指派任務", newId, "/tasks/new")
    ?? mkBtn("➕ 指派任務", "/管理 指派", "secondary");
  const workflowBtn = liffBtn("⚙️ 流程狀態", dashId, "/dashboard")
    ?? mkBtn("⚙️ 流程狀態", "/流程 狀態", "secondary");
  const myTasksBtn = liffBtn("📋 我的任務", listId, "/tasks")
    ?? mkBtn("📋 我的任務", "/任務 列表", "secondary");

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
            ...(topDashBtn ? [topDashBtn, { type: "separator", margin: "xs" }] : []),
            overviewBtn,
            assignBtn,
            workflowBtn,
            myTasksBtn,
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
    const shortId = String(t.id).slice(0, 6);
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
