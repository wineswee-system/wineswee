import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── LINE Push ──────────────────────────────────────────────────
async function pushLine(to: string, messages: object[], accessToken: string) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to, messages }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`LINE push failed ${res.status}: ${body}`);
  }
  return res.ok;
}

// ── Resolve LINE ID via multi-OA mapping ────────────────────────
async function resolveLineId(db: any, employeeId: number): Promise<string | null> {
  const { data } = await db.from("v_employee_line_resolved")
    .select("line_user_id")
    .eq("employee_id", employeeId)
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.line_user_id || null;
}

async function resolveLineAccount(db: any, employeeId: number): Promise<{ lineUserId: string | null; liffId: string | null }> {
  const { data } = await db.from("v_employee_line_resolved")
    .select("line_user_id, liff_id")
    .eq("employee_id", employeeId)
    .order("channel_code", { ascending: false })  // 'workflow' channel first
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { lineUserId: data?.line_user_id || null, liffId: data?.liff_id || null };
}

// ── LIFF URL builders（跟 src/lib/lineNotify.js getLiffTaskUrl / buildLiffTaskUrl 對齊）──
function buildLiffTaskUrl(taskId: number, liffId: string | null, action?: string): string {
  const toPath = `/tasks?task=${taskId}${action ? `&action=${action}` : ''}`;
  if (!liffId) return `https://line.me/`;
  return `https://liff.line.me/${liffId}?to=${encodeURIComponent(toPath)}`;
}

// ── Label helpers ──────────────────────────────────────────────
const leaveLabels: Record<string, string> = {
  annual: "特休", sick: "病假", personal: "事假",
  bereavement: "喪假", marriage: "婚假", maternity: "產假",
  paternity: "陪產假", unpaid: "無薪假",
  特休: "特休", 病假: "病假", 事假: "事假",
  喪假: "喪假", 婚假: "婚假", 產假: "產假",
  陪產假: "陪產假", 無薪假: "無薪假",
};
const getLeaveLabel = (t: string) => leaveLabels[t] || t;

function row(label: string, value: string, valueColor = "#111111") {
  return {
    type: "box", layout: "horizontal",
    contents: [
      { type: "text", text: label, size: "sm", color: "#888888", flex: 2 },
      { type: "text", text: value, size: "sm", color: valueColor, flex: 5, wrap: true },
    ],
  };
}

// ══════════════════════════════════════════════════════════════
// Flex Message Builders (完整移植自 wine_line)
// ══════════════════════════════════════════════════════════════

// ── 1. 請假提交 → 通知主管審核 ──────────────────────────────
function buildLeaveSubmissionNotification(details: {
  leave_id?: number; requester_name: string; leave_type: string;
  start_date: string; end_date: string; total_days: number; reason?: string;
}) {
  const leaveLabel = getLeaveLabel(details.leave_type);
  return {
    type: "flex",
    altText: `📥 新的請假申請：${details.requester_name}`,
    contents: {
      type: "bubble", size: "kilo",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#E67E22", paddingAll: "14px",
        contents: [
          { type: "text", text: `📥 待審核請假：${details.requester_name}`, weight: "bold", color: "#FFFFFF", size: "md" },
        ],
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "14px", spacing: "sm",
        contents: [
          row("申請人", details.requester_name),
          row("假別", leaveLabel),
          row("日期", `${details.start_date} ~ ${details.end_date}`),
          row("天數", `${details.total_days} 天`),
          ...(details.reason ? [row("原因", details.reason)] : []),
        ],
      },
      footer: {
        type: "box", layout: "horizontal", paddingAll: "10px", spacing: "sm", backgroundColor: "#F7FAFC",
        contents: [
          {
            type: "button", style: "primary", color: "#276749", height: "sm",
            action: { type: "message", label: "✅ 核准", text: `/管理 核准請假 ${details.leave_id || ''}` },
          },
          {
            type: "button", style: "primary", color: "#C53030", height: "sm",
            action: { type: "message", label: "❌ 退回", text: `/管理 退回請假 ${details.leave_id || ''}` },
          },
        ],
      },
    },
  };
}

// ── 2. 請假結果 → 通知申請人 ────────────────────────────────
function buildLeaveNotification(type: "approved" | "rejected", details: {
  leave_type: string; start_date: string; end_date: string;
  total_days: number; rejection_reason?: string; approver_name?: string;
}) {
  const leaveLabel = getLeaveLabel(details.leave_type);
  const isApproved = type === "approved";
  const headerColor = isApproved ? "#276749" : "#C53030";
  const icon = isApproved ? "✅" : "❌";
  const statusText = isApproved ? "已核准" : "已拒絕";

  return {
    type: "flex",
    altText: `${icon} 請假申請${statusText}`,
    contents: {
      type: "bubble", size: "kilo",
      header: {
        type: "box", layout: "vertical", backgroundColor: headerColor, paddingAll: "14px",
        contents: [{ type: "text", text: `${icon} 請假申請${statusText}`, weight: "bold", color: "#FFFFFF", size: "md" }],
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "14px", spacing: "sm",
        contents: [
          row("假別", leaveLabel),
          row("日期", `${details.start_date} ~ ${details.end_date}`),
          row("天數", `${details.total_days} 天`),
          ...(details.approver_name ? [row("審核人", details.approver_name)] : []),
          ...(!isApproved && details.rejection_reason ? [row("原因", details.rejection_reason, "#C53030")] : []),
        ],
      },
      footer: {
        type: "box", layout: "vertical", paddingAll: "10px", backgroundColor: "#F7FAFC",
        contents: [{
          type: "button", style: "link", height: "sm",
          action: { type: "message", label: "查看假期餘額", text: "/請假 餘額" },
        }],
      },
    },
  };
}

// ── 3. 加班結果 → 通知申請人 ────────────────────────────────
function buildOtNotification(type: "approved" | "rejected", details: {
  request_date: string; ot_hours: number; ot_type?: string;
  filing_type?: string; rejection_reason?: string;
}) {
  const isApproved = type === "approved";
  const headerColor = isApproved ? "#1A365D" : "#C53030";
  const icon = isApproved ? "✅" : "❌";
  const statusText = isApproved ? "已核准" : "已拒絕";
  const otTypeLabel = details.ot_type === "comp" ? "補休" : "加班費";
  const filingLabel = details.filing_type === "pre" ? "事前申請" : "事後補報";

  return {
    type: "flex",
    altText: `${icon} 加班申請${statusText}`,
    contents: {
      type: "bubble", size: "kilo",
      header: {
        type: "box", layout: "vertical", backgroundColor: headerColor, paddingAll: "14px",
        contents: [{ type: "text", text: `${icon} 加班申請${statusText}`, weight: "bold", color: "#FFFFFF", size: "md" }],
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "14px", spacing: "sm",
        contents: [
          row("日期", details.request_date),
          row("加班時數", `${details.ot_hours} 小時`),
          row("補償方式", otTypeLabel),
          row("申請類型", filingLabel),
          ...(!isApproved && details.rejection_reason ? [row("原因", details.rejection_reason, "#C53030")] : []),
        ],
      },
    },
  };
}

// ── 4. 補打結果 → 通知申請人 ────────────────────────────────
function buildCorrectionNotification(type: "approved" | "rejected", details: {
  correction_type?: string; requested_clock_in?: string;
  requested_clock_out?: string; rejection_reason?: string;
}) {
  const isApproved = type === "approved";
  const icon = isApproved ? "✅" : "❌";
  const statusText = isApproved ? "已核准" : "已拒絕";
  const typeLabel: Record<string, string> = {
    clock_in: "更正上班", clock_out: "更正下班", both: "上下班均更正", missing: "補登打卡",
  };
  const label = typeLabel[details.correction_type || ""] || details.correction_type || "補打卡";

  const bodyContents: object[] = [row("申請類型", label)];
  if (details.requested_clock_in) {
    bodyContents.push(row("申請上班", new Date(details.requested_clock_in).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })));
  }
  if (details.requested_clock_out) {
    bodyContents.push(row("申請下班", new Date(details.requested_clock_out).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })));
  }
  if (!isApproved && details.rejection_reason) {
    bodyContents.push(row("拒絕原因", details.rejection_reason, "#C53030"));
  }

  return {
    type: "flex",
    altText: `${icon} 補打申請${statusText}`,
    contents: {
      type: "bubble", size: "kilo",
      header: {
        type: "box", layout: "vertical", backgroundColor: isApproved ? "#276749" : "#C53030", paddingAll: "14px",
        contents: [{ type: "text", text: `${icon} 補打申請${statusText}`, weight: "bold", color: "#FFFFFF", size: "md" }],
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "14px", spacing: "sm",
        contents: bodyContents,
      },
    },
  };
}

// ── 5. 班表發佈 → 通知員工（含班次明細）─────────────────────
function buildScheduleNotification(details: {
  store_name: string; week_start: string; week_end: string;
  shifts: { date: string; start_time: string; end_time: string }[];
}) {
  const shiftRows: object[] = details.shifts.length > 0
    ? details.shifts.map(s => ({
        type: "box", layout: "horizontal",
        contents: [
          { type: "text", text: s.date.slice(5), size: "sm", color: "#888888", flex: 2 },
          { type: "text", text: `${(s.start_time || "").slice(0, 5)} – ${(s.end_time || "").slice(0, 5)}`, size: "sm", weight: "bold", flex: 5 },
        ],
      }))
    : [{ type: "text", text: "本週無排班", size: "sm", color: "#888888" }];

  return {
    type: "flex",
    altText: `📅 新班表已發佈: ${details.store_name} ${details.week_start}`,
    contents: {
      type: "bubble", size: "kilo",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#2B6CB0", paddingAll: "14px",
        contents: [
          { type: "text", text: "📅 新班表已發佈", weight: "bold", color: "#FFFFFF", size: "md" },
          { type: "text", text: `${details.store_name} | ${details.week_start} ~ ${details.week_end}`, size: "xs", color: "#BEE3F8", marginTop: "4px" },
        ],
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "14px", spacing: "sm",
        contents: [
          { type: "text", text: "您的班次", size: "sm", weight: "bold", color: "#2D3748" },
          { type: "separator", margin: "sm" },
          ...shiftRows,
        ],
      },
      footer: {
        type: "box", layout: "vertical", paddingAll: "10px", backgroundColor: "#F7FAFC",
        contents: [{
          type: "button", style: "link", height: "sm",
          action: { type: "message", label: "查看完整班表", text: "/任務 列表" },
        }],
      },
    },
  };
}

// ── 6. 任務自動開始通知（對齊 src/lib/lineNotify.js notifyTaskAssignee 格式）────
// rich version：📋 任務通知 header + 完整 body + 「回報完成」+「查看任務」雙按鈕
function buildTaskAutoStarted(details: {
  task_id?: number;
  task_title?: string;
  assignee_name?: string;
  department?: string;
  store?: string;
  workflow_name?: string;
  due_date?: string;      // YYYY-MM-DD
  due_time?: string;      // HH:MM
  description?: string;
  notes?: string;
  completed_tasks?: string[];
  liff_id?: string | null;
}) {
  const LC = {
    brand: '#06b6d4', success: '#10b981', warning: '#f59e0b',
    danger: '#ef4444', muted: '#666666', dark: '#444444', soft: '#8c8c8c',
  };

  // 到期 label（Asia/Taipei，MM/DD HH:MM）
  let dueLabel = '未設定';
  let isOverdue = false;
  if (details.due_date) {
    const dt = new Date(`${details.due_date}T${details.due_time || '17:00'}:00+08:00`);
    if (!isNaN(dt.getTime())) {
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      const hh = String(dt.getHours()).padStart(2, '0');
      const mi = String(dt.getMinutes()).padStart(2, '0');
      dueLabel = `${mm}/${dd} ${hh}:${mi}`;
      isOverdue = dt < new Date();
    }
  }

  // 姓名 | 部門 | 門市
  const infoParts = [details.assignee_name, details.department, details.store].filter((x) => x && String(x).trim());
  const infoLine = infoParts.join('  |  ');

  // body contents
  const body: any[] = [
    { type: 'text', text: details.task_title || '未命名任務', weight: 'bold', size: 'sm', wrap: true },
    {
      type: 'text', text: `到期：${dueLabel}`, size: 'sm', wrap: true,
      color: isOverdue ? LC.danger : LC.muted,
      weight: isOverdue ? 'bold' : 'regular',
    },
  ];
  if (infoLine) body.push({ type: 'text', text: infoLine, size: 'sm', color: LC.muted, wrap: true });
  if (details.workflow_name) body.push({ type: 'text', text: `流程：${details.workflow_name}`, size: 'sm', color: LC.muted });
  if (Array.isArray(details.completed_tasks) && details.completed_tasks.length > 0) {
    body.push({ type: 'text', text: `前置已完成：${details.completed_tasks.join('、')}`, size: 'xs', color: LC.soft, wrap: true });
  }
  const desc = details.description && String(details.description).trim();
  if (desc) {
    body.push({ type: 'separator', margin: 'sm' });
    body.push({ type: 'text', text: desc, size: 'sm', color: LC.dark, wrap: true, margin: 'sm' });
  }
  const note = details.notes && String(details.notes).trim();
  if (note) {
    body.push({ type: 'separator', margin: 'sm' });
    body.push({ type: 'text', text: '📌 備註', size: 'sm', color: LC.soft, margin: 'sm' });
    body.push({ type: 'text', text: note, size: 'sm', color: LC.dark, wrap: true });
  }

  // footer 雙按鈕（只在有 task_id 時建 LIFF URL）
  const taskId = details.task_id;
  const liffUrl = taskId ? buildLiffTaskUrl(taskId, details.liff_id || null) : null;
  const footer = liffUrl ? {
    type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
    contents: [
      { type: 'button', style: 'primary', height: 'sm', color: LC.success,
        action: { type: 'postback', label: '回報完成', data: `action=complete&type=task&id=${taskId}`, displayText: '回報完成' } },
      { type: 'button', style: 'secondary', height: 'sm',
        action: { type: 'uri', label: '查看任務', uri: liffUrl } },
    ],
  } : undefined;

  // header（含 optional 逾期 badge）
  const headerContents: any[] = [
    { type: 'text', text: '📋 任務通知', color: '#FFFFFF', weight: 'bold', size: 'md', flex: 1 },
  ];
  if (isOverdue) {
    headerContents.push({
      type: 'box', layout: 'vertical', backgroundColor: LC.danger, cornerRadius: '4px',
      paddingTop: '3px', paddingBottom: '3px', paddingStart: '8px', paddingEnd: '8px',
      contents: [{ type: 'text', text: '⚠️ 逾期', color: '#ffffff', size: 'xxs', weight: 'bold' }],
    });
  }

  return {
    type: 'flex',
    altText: `${isOverdue ? '⚠️ [逾期] ' : ''}📋 任務通知：${details.task_title || ''}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: LC.brand, paddingAll: '14px',
        contents: [{ type: 'box', layout: 'horizontal', alignItems: 'center', contents: headerContents }],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px', contents: body },
      ...(footer ? { footer } : {}),
    },
  };
}

// ── task_with_bindings_assigned：任務剛被綁表單時，列出需完成的表單清單 ─────
function buildTaskWithBindingsAssigned(details: {
  task_id?: number;
  task_title?: string;
  workflow_name?: string;
  due_date?: string;
  due_time?: string;
  store?: string;
  bindings?: Array<{ label?: string; required_status?: string }>;
  liff_id?: string | null;
}) {
  const LC = {
    brand: '#06b6d4', success: '#10b981', warning: '#f59e0b',
    danger: '#ef4444', muted: '#666666', dark: '#444444', soft: '#8c8c8c',
  };

  // 到期 label
  let dueLabel = '未設定';
  let isOverdue = false;
  if (details.due_date) {
    const dt = new Date(`${details.due_date}T${details.due_time || '17:00'}:00+08:00`);
    if (!isNaN(dt.getTime())) {
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      const hh = String(dt.getHours()).padStart(2, '0');
      const mi = String(dt.getMinutes()).padStart(2, '0');
      dueLabel = `${mm}/${dd} ${hh}:${mi}`;
      isOverdue = dt < new Date();
    }
  }

  const body: any[] = [
    { type: 'text', text: details.task_title || '未命名任務', weight: 'bold', size: 'sm', wrap: true },
    {
      type: 'text', text: `到期：${dueLabel}`, size: 'sm', wrap: true,
      color: isOverdue ? LC.danger : LC.muted,
      weight: isOverdue ? 'bold' : 'regular',
    },
  ];
  if (details.store) body.push({ type: 'text', text: `門市：${details.store}`, size: 'sm', color: LC.muted });
  if (details.workflow_name) body.push({ type: 'text', text: `流程：${details.workflow_name}`, size: 'sm', color: LC.muted });

  // bindings 清單
  const bindings = Array.isArray(details.bindings) ? details.bindings : [];
  if (bindings.length > 0) {
    body.push({ type: 'separator', margin: 'sm' });
    body.push({ type: 'text', text: `📋 需完成表單（${bindings.length}）`, size: 'sm', color: LC.dark, weight: 'bold', margin: 'sm' });
    for (const b of bindings) {
      body.push({
        type: 'box', layout: 'horizontal', spacing: 'sm',
        contents: [
          { type: 'text', text: '•', size: 'sm', color: LC.brand, flex: 0 },
          { type: 'text', text: b.label || '未命名表單', size: 'sm', color: LC.dark, wrap: true, flex: 1 },
        ],
      });
    }
  }

  const taskId = details.task_id;
  const liffUrl = taskId ? buildLiffTaskUrl(taskId, details.liff_id || null) : null;
  const footer = liffUrl ? {
    type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
    contents: [
      { type: 'button', style: 'primary', height: 'sm', color: LC.brand,
        action: { type: 'uri', label: '查看任務 / 填表單', uri: liffUrl } },
    ],
  } : undefined;

  return {
    type: 'flex',
    altText: `📋 新任務（含需填表單）：${details.task_title || ''}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: LC.brand, paddingAll: '14px',
        contents: [{ type: 'text', text: '📋 任務通知（含需填表單）', color: '#FFFFFF', weight: 'bold', size: 'md' }],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px', contents: body },
      ...(footer ? { footer } : {}),
    },
  };
}

// ── contract_expiry_batch：合約 + 證件到期預警彙整（推給所有 admin/manager）─
function buildExpiryBatchNotification(alerts: any[]) {
  const DOC_LABELS: Record<string, string> = {
    work_permit: '工作許可', arc: '居留證', health_check: '健康檢查',
    passport: '護照', other: '其他',
    contract: '勞動契約', 定期勞動契約: '定期合約', 勞務承攬: '勞務承攬', 兼職: '兼職合約', 派遣: '派遣合約',
  }
  const label = (a: any) => DOC_LABELS[a.label] || a.label || a.alert_type

  const urgent   = alerts.filter(a => a.days_remaining !== null && a.days_remaining >= 0  && a.days_remaining <= 30)
  const warning  = alerts.filter(a => a.days_remaining !== null && a.days_remaining > 30   && a.days_remaining <= 90)
  const expired  = alerts.filter(a => a.days_remaining !== null && a.days_remaining < 0)

  const rows: object[] = []
  if (expired.length > 0) {
    rows.push({ type: "text", text: `❌ 已過期 ${expired.length} 件`, size: "sm", color: "#dc2626", weight: "bold" })
    expired.slice(0, 3).forEach(a => rows.push(row(a.employee_name, `${label(a)} 已過期 ${Math.abs(a.days_remaining)} 天`, "#dc2626")))
    if (expired.length > 3) rows.push({ type: "text", text: `…另有 ${expired.length - 3} 件，請至系統查看`, size: "xs", color: "#9CA3AF", wrap: true })
    if (urgent.length > 0 || warning.length > 0) rows.push({ type: "separator", margin: "sm" })
  }
  if (urgent.length > 0) {
    rows.push({ type: "text", text: `⚠️ 30 天內到期 ${urgent.length} 件`, size: "sm", color: "#d97706", weight: "bold" })
    urgent.slice(0, 5).forEach(a => rows.push(row(a.employee_name, `${label(a)} 剩 ${a.days_remaining} 天`, a.days_remaining <= 7 ? "#dc2626" : "#d97706")))
    if (urgent.length > 5) rows.push({ type: "text", text: `…另有 ${urgent.length - 5} 件`, size: "xs", color: "#9CA3AF", wrap: true })
    if (warning.length > 0) rows.push({ type: "separator", margin: "sm" })
  }
  if (warning.length > 0) {
    rows.push({ type: "text", text: `🔔 90 天內到期 ${warning.length} 件`, size: "sm", color: "#6B7280", weight: "bold" })
    warning.slice(0, 3).forEach(a => rows.push(row(a.employee_name, `${label(a)} 剩 ${a.days_remaining} 天`)))
  }
  if (rows.length === 0) rows.push({ type: "text", text: "目前無到期預警項目", size: "sm", color: "#888888" })

  const totalCount = expired.length + urgent.length + warning.length
  return {
    type: "flex",
    altText: `🔔 HR 到期預警 — ${totalCount} 件（緊急 ${urgent.length + expired.length}）`,
    contents: {
      type: "bubble", size: "kilo",
      header: {
        type: "box", layout: "vertical", backgroundColor: urgent.length + expired.length > 0 ? "#d97706" : "#2563eb", paddingAll: "14px",
        contents: [
          { type: "text", text: "🔔 HR 到期預警", weight: "bold", color: "#FFFFFF", size: "md" },
          { type: "text", text: `合約 + 外籍移工證件 | 共 ${totalCount} 件`, size: "xs", color: "#FEF3C7", margin: "xs" },
        ],
      },
      body: { type: "box", layout: "vertical", paddingAll: "14px", spacing: "sm", contents: rows },
    },
  }
}

// ── form_submission：自訂表單通用通知（step_assigned / approved / rejected）─
function buildFormSubmissionNotification(
  variant: "step_assigned" | "approved" | "rejected",
  details: {
    submission_id: number;
    template_name: string;
    applicant_name: string;
    current_step_label?: string;
    current_step_index?: number;
    total_steps?: number;
    summary_fields?: Array<{ label: string; value: string }>;
    reject_reason?: string;
    liff_url?: string;
  },
) {
  const sid = details.submission_id;
  const isStep = variant === "step_assigned";
  const isApproved = variant === "approved";
  const headerColor = isStep ? "#0EA5E9" : isApproved ? "#16a34a" : "#dc2626";
  const emoji = isStep ? "📄" : isApproved ? "✅" : "❌";
  const headerLabel = isStep
    ? `待你審核：${details.template_name}`
    : isApproved
      ? `已核准：${details.template_name}`
      : `已退回：${details.template_name}`;
  const altText = `${emoji} ${headerLabel} — ${details.applicant_name}`;

  const summary = (details.summary_fields || []).slice(0, 5).map(f => row(f.label, f.value || "—"));
  const stepRow = isStep && details.current_step_label
    ? [row("關卡",
        `第 ${(details.current_step_index ?? 0) + 1}/${details.total_steps ?? "?"} 關 · ${details.current_step_label}`,
        "#0EA5E9")]
    : [];
  const reasonRow = variant === "rejected" && details.reject_reason
    ? [
        { type: "separator", margin: "md" },
        { type: "text", text: "退回原因", size: "xs", color: "#9CA3AF", margin: "md" },
        { type: "text", text: details.reject_reason, size: "sm", color: "#dc2626", wrap: true, margin: "xs" },
      ]
    : [];

  const footerButtons: object[] = [];
  if (isStep) {
    footerButtons.push(
      { type: "button", style: "primary", color: "#16a34a", height: "sm",
        action: { type: "postback", label: "✅ 核准",
          data: `action=approve&type=request&rt=form_submission&id=${sid}`,
          displayText: "核准" } },
      { type: "button", style: "primary", color: "#dc2626", height: "sm",
        action: { type: "postback", label: "❌ 退回",
          data: `action=reject&type=request&rt=form_submission&id=${sid}`,
          displayText: "退回" } },
    );
  }
  if (details.liff_url) {
    footerButtons.push({ type: "button", style: "link", height: "sm",
      action: { type: "uri", label: isStep ? "📋 看完整詳情" : "📋 看詳情", uri: details.liff_url } });
  }

  return {
    type: "flex",
    altText,
    contents: {
      type: "bubble", size: "kilo",
      header: {
        type: "box", layout: "vertical", backgroundColor: headerColor, paddingAll: "14px",
        contents: [
          { type: "text", text: `${emoji} ${headerLabel}`, weight: "bold", color: "#FFFFFF", size: "md", wrap: true },
          { type: "text", text: `#${sid}`, size: "xs", color: "#FFFFFFAA", margin: "xs" },
        ],
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "14px", spacing: "sm",
        contents: [
          row("申請人", details.applicant_name),
          ...stepRow,
          ...summary,
          ...reasonRow,
        ],
      },
      ...(footerButtons.length
        ? { footer: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px", contents: footerButtons } }
        : {}),
    },
  };
}

// ── store_audit：門市稽核通知 ────────────────────────────────
function buildStoreAuditNotification(
  variant: "on_duty_assigned" | "step_assigned" | "approved" | "rejected",
  details: {
    audit_id: number; store_name: string; audit_date: string;
    shift?: string | null; auditor_name?: string;
    failed_count?: number; total_deducted?: number;
    current_step_label?: string; current_step_index?: number; total_steps?: number;
    reject_reason?: string | null; approver?: string | null;
    liff_url?: string | null;
  },
) {
  const aid = details.audit_id;
  const isAction = variant === "on_duty_assigned" || variant === "step_assigned";
  const isOnDuty = variant === "on_duty_assigned";
  const isApproved = variant === "approved";
  const headerColor = isOnDuty ? "#6366f1"
                    : variant === "step_assigned" ? "#0EA5E9"
                    : isApproved ? "#16a34a" : "#dc2626";
  const emoji = isOnDuty ? "📋" : variant === "step_assigned" ? "🔍"
              : isApproved ? "✅" : "❌";
  const headerLabel = isOnDuty
    ? `稽核確認：${details.store_name}`
    : variant === "step_assigned" ? `待你簽核：${details.store_name}`
    : isApproved ? `稽核已通過：${details.store_name}`
    : `稽核已退回：${details.store_name}`;
  const altText = `${emoji} ${headerLabel}`;

  const bodyRows: object[] = [
    row("門市", details.store_name),
    row("日期", `${details.audit_date}${details.shift ? ` · ${details.shift}` : ""}`),
    row("稽核員", details.auditor_name || "—"),
  ];
  if (typeof details.failed_count === "number") {
    bodyRows.push(row("不合格項目", `${details.failed_count} 項`, details.failed_count > 0 ? "#dc2626" : "#111111"));
  }
  if (typeof details.total_deducted === "number" && details.total_deducted > 0) {
    bodyRows.push(row("扣分", `${details.total_deducted} 分`, "#dc2626"));
  }
  if (variant === "step_assigned" && details.current_step_label) {
    bodyRows.push(row("關卡", `第 ${(details.current_step_index ?? 0) + 1}/${details.total_steps ?? "?"} 關 · ${details.current_step_label}`, "#0EA5E9"));
  }
  if (variant === "rejected" && details.reject_reason) {
    bodyRows.push({ type: "separator", margin: "md" });
    bodyRows.push({ type: "text", text: "退回原因", size: "xs", color: "#9CA3AF", margin: "md" });
    bodyRows.push({ type: "text", text: details.reject_reason, size: "sm", color: "#dc2626", wrap: true, margin: "xs" });
  }
  if (isApproved && details.approver) {
    bodyRows.push(row("核簽人", details.approver, "#16a34a"));
  }

  const footerButtons: object[] = [];
  if (isAction) {
    footerButtons.push(
      { type: "button", style: "primary", color: "#16a34a", height: "sm",
        action: { type: "postback", label: isOnDuty ? "✅ 確認屬實" : "✅ 核准",
          data: `action=approve&type=request&rt=store_audit&id=${aid}`,
          displayText: isOnDuty ? "確認" : "核准" } },
      { type: "button", style: "primary", color: "#dc2626", height: "sm",
        action: { type: "postback", label: "❌ 退回",
          data: `action=reject&type=request&rt=store_audit&id=${aid}`,
          displayText: "退回" } },
    );
  }
  if (details.liff_url) {
    footerButtons.push({ type: "button", style: "link", height: "sm",
      action: { type: "uri", label: isAction ? "📋 看完整詳情" : "📋 看詳情", uri: details.liff_url } });
  }

  return {
    type: "flex",
    altText,
    contents: {
      type: "bubble", size: "kilo",
      header: {
        type: "box", layout: "vertical", backgroundColor: headerColor, paddingAll: "14px",
        contents: [
          { type: "text", text: `${emoji} ${headerLabel}`, weight: "bold", color: "#FFFFFF", size: "md", wrap: true },
          { type: "text", text: `#${aid}`, size: "xs", color: "#FFFFFFAA", margin: "xs" },
        ],
      },
      body: { type: "box", layout: "vertical", paddingAll: "14px", spacing: "sm", contents: bodyRows },
      ...(footerButtons.length
        ? { footer: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px", contents: footerButtons } }
        : {}),
    },
  };
}

// ══════════════════════════════════════════════════════════════
// Main Handler
// ══════════════════════════════════════════════════════════════

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const accessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN_WORKFLOW");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Missing LINE_CHANNEL_ACCESS_TOKEN_WORKFLOW" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const db = createClient(supabaseUrl, supabaseKey);

    // ── Auth check: require service_role token (any) or admin JWT ──
    // Note: decode JWT 看 role claim，不對 env var 做 strict 字串比對 —
    // 專案 key 輪換 / vault 跟 env 不同步時，strict 比對會誤殺 PG trigger 呼叫。
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      let isServiceRole = false;
      try {
        const parts = token.split(".");
        if (parts.length === 3) {
          const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
          const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
          const payload = JSON.parse(atob(padded));
          // anon role = PG trigger 內部呼叫（所有 trigger 均用 anon key）
          isServiceRole = payload?.role === "service_role" || payload?.role === "anon";
        }
      } catch (_e) { /* fall through to user check */ }

      if (!isServiceRole) {
        const { data: { user } } = await db.auth.getUser(token);
        if (!user) {
          return new Response(JSON.stringify({ error: "未授權" }), {
            status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const { data: emp } = await db.from("employees").select("role").eq("email", user.email).single();
        if (!emp || !["admin", "super_admin", "manager"].includes(emp.role)) {
          return new Response(JSON.stringify({ error: "權限不足" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    const body = await req.json();
    const { employee_id, type, details } = body;

    if (!type) {
      return new Response(JSON.stringify({ error: "Missing type" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── contract_expiry_batch: 合約 + 外籍移工證件到期預警 → 推給所有 admin/manager ──
    if (type === "contract_expiry_batch") {
      const orgId = details?.organization_id || null

      // 查 v_expiry_alerts：合約 90 天內 + 已過期 7 天內、證件 90 天內 + 已過期 7 天內
      let query = db.from("v_expiry_alerts")
        .select("*")
        .lte("days_remaining", 90)
        .gte("days_remaining", -7)
        .order("days_remaining", { ascending: true })
      if (orgId) query = query.eq("organization_id", orgId)
      const { data: alerts } = await query

      // 無到期項目仍推一次（讓 HR 知道系統在運作）
      const msg = buildExpiryBatchNotification(alerts || [])

      // 找所有 admin / manager（有 LINE 帳號的）
      let adminQuery = db.from("employees")
        .select("id")
        .in("role", ["admin", "super_admin", "manager"])
        .eq("status", "在職")
      if (orgId) adminQuery = adminQuery.eq("organization_id", orgId)
      const { data: admins } = await adminQuery

      let sent = 0
      for (const admin of (admins || [])) {
        const lineId = await resolveLineId(db, admin.id)
        if (lineId && await pushLine(lineId, [msg], accessToken)) sent++
      }

      console.log(`[hr-notify] contract_expiry_batch: ${(alerts || []).length} alerts, sent to ${sent} admins`)
      return new Response(JSON.stringify({ ok: true, sent, alert_count: (alerts || []).length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // ── schedule_published: broadcast to all employees with shifts ──
    if (type === "schedule_published") {
      const { store_name, week_start, week_end, assignments, employee_ids } = details || body;
      if (!week_start) {
        return new Response(JSON.stringify({ error: "Missing week_start" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const wEnd = week_end || (() => { const d = new Date(week_start); d.setDate(d.getDate() + 6); return d.toISOString().split("T")[0]; })();

      // Get employee IDs to notify
      const empIds: number[] = employee_ids || [];
      if (empIds.length === 0 && assignments) {
        const unique = new Set((assignments as any[]).map((a: any) => a.employee_id).filter(Boolean));
        empIds.push(...unique);
      }
      if (empIds.length === 0) {
        return new Response(JSON.stringify({ ok: true, sent: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let sentCount = 0;
      for (const empId of empIds) {
        const lineId = await resolveLineId(db, empId);
        if (!lineId) continue;

        // Get this employee's shifts
        const { data: empSchedules } = await db.from("schedules")
          .select("date, start_time, end_time")
          .eq("employee_id", empId)
          .gte("date", week_start)
          .lte("date", wEnd)
          .order("date");

        const shifts = (empSchedules || []).map((s: any) => ({
          date: s.date, start_time: s.start_time || "", end_time: s.end_time || "",
        }));

        const msg = buildScheduleNotification({
          store_name: store_name || "門市",
          week_start, week_end: wEnd, shifts,
        });
        await pushLine(lineId, [msg], accessToken);
        sentCount++;
      }

      return new Response(JSON.stringify({ ok: true, sent: sentCount }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // All other types require employee_id
    if (!employee_id) {
      return new Response(JSON.stringify({ error: "Missing employee_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── leave_submitted → notify supervisor/admin ──
    if (type === "leave_submitted") {
      const { data: requester } = await db.from("employees")
        .select("name, reporting_to").eq("id", employee_id).single();
      const requesterName = requester?.name || "員工";

      const message = buildLeaveSubmissionNotification({
        leave_id: details?.leave_id, requester_name: requesterName, ...details,
      });

      // Dynamic routing: ≥3 days → admins, else → supervisor
      let approverIds: number[] = [];
      const totalDays = Number(details?.total_days) || 1;

      if (totalDays >= 3) {
        const { data: admins } = await db.from("employees")
          .select("id").in("role", ["admin", "super_admin"]).eq("status", "在職");
        approverIds = admins?.map((a: any) => a.id) || [];
      } else if (requester?.reporting_to) {
        approverIds = [requester.reporting_to];
      }

      // Fallback
      if (approverIds.length === 0) {
        const { data: managers } = await db.from("employees")
          .select("id").eq("is_manager", true).eq("status", "在職");
        approverIds = managers?.map((a: any) => a.id) || [];
      }

      if (approverIds.length === 0) {
        console.error(`[hr-notify] leave_submitted: 找不到審核人 (employee_id=${employee_id})`);
        return new Response(JSON.stringify({ ok: false, error: "找不到審核人，請確認員工有設定主管或系統有管理員" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let sent = 0;
      const noLineIds: number[] = [];
      for (const appId of approverIds) {
        const lineId = await resolveLineId(db, appId);
        if (lineId) {
          if (await pushLine(lineId, [message], accessToken)) sent++;
        } else {
          noLineIds.push(appId);
        }
      }

      if (noLineIds.length > 0) {
        console.warn(`[hr-notify] 審核人 ${noLineIds.join(',')} 沒有綁定 LINE，通知未送達`);
      }

      return new Response(JSON.stringify({ ok: true, sent, no_line_ids: noLineIds }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── All remaining: send to the employee_id ──
    // 需要 liff_id 建 LIFF URL 的 type 走 resolveLineAccount
    const needsLiff = type === "task_auto_started" || type === "task_with_bindings_assigned";
    const acct = needsLiff ? await resolveLineAccount(db, employee_id) : null;
    const lineUserId = acct ? acct.lineUserId : await resolveLineId(db, employee_id);
    if (!lineUserId) {
      console.log(`No LINE mapping for employee ${employee_id}, skipping`);
      return new Response(JSON.stringify({ ok: true, sent: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let message: object;

    if (type === "leave_approved") {
      message = buildLeaveNotification("approved", details);
    } else if (type === "leave_rejected") {
      message = buildLeaveNotification("rejected", details);
    } else if (type === "ot_approved") {
      message = buildOtNotification("approved", details);
    } else if (type === "ot_rejected") {
      message = buildOtNotification("rejected", details);
    } else if (type === "correction_approved") {
      message = buildCorrectionNotification("approved", details);
    } else if (type === "correction_rejected") {
      message = buildCorrectionNotification("rejected", details);
    } else if (type === "form_submission_step_assigned") {
      message = buildFormSubmissionNotification("step_assigned", details);
    } else if (type === "form_submission_approved") {
      message = buildFormSubmissionNotification("approved", details);
    } else if (type === "form_submission_rejected") {
      message = buildFormSubmissionNotification("rejected", details);
    } else if (type === "store_audit_on_duty_assigned") {
      message = buildStoreAuditNotification("on_duty_assigned", details);
    } else if (type === "store_audit_step_assigned") {
      message = buildStoreAuditNotification("step_assigned", details);
    } else if (type === "store_audit_approved") {
      message = buildStoreAuditNotification("approved", details);
    } else if (type === "store_audit_rejected") {
      message = buildStoreAuditNotification("rejected", details);
    } else if (type === "task_auto_started") {
      // 補抓 task 完整欄位（trigger 只丟 task_id + 簡單 details，這裡 hydrate）
      let enriched = { ...details, liff_id: acct?.liffId || null };
      if (details?.task_id && !details?.due_date) {
        const { data: task } = await db.from("tasks")
          .select("id, title, due_date, due_time, description, notes, store, assignee, workflow_instance_id")
          .eq("id", details.task_id).maybeSingle();
        if (task) {
          // 抓 workflow_instance template_name
          let workflowName: string | undefined = details.workflow_name;
          if (!workflowName && task.workflow_instance_id) {
            const { data: inst } = await db.from("workflow_instances")
              .select("template_name").eq("id", task.workflow_instance_id).maybeSingle();
            workflowName = inst?.template_name || undefined;
          }
          // 抓 employee dept
          const { data: emp } = await db.from("employees")
            .select("name, dept").eq("id", employee_id).maybeSingle();
          enriched = {
            ...enriched,
            task_id: task.id,
            task_title: enriched.task_title || task.title,
            due_date: task.due_date,
            due_time: task.due_time,
            description: task.description,
            notes: task.notes,
            store: task.store,
            assignee_name: emp?.name || task.assignee,
            department: emp?.dept,
            workflow_name: workflowName,
          };
        }
      }
      message = buildTaskAutoStarted(enriched);
    } else if (type === "task_with_bindings_assigned") {
      message = buildTaskWithBindingsAssigned({ ...details, liff_id: acct?.liffId || null });
    } else {
      return new Response(JSON.stringify({ error: `Unknown type: ${type}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await pushLine(lineUserId, [message], accessToken);

    console.log(`[hr-notify] type=${type}, employee_id=${employee_id}, sent=true`);

    return new Response(JSON.stringify({ ok: true, sent: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("hr-notify error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
