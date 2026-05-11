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
  const actionUrl = taskId ? buildLiffTaskUrl(taskId, details.liff_id || null, 'complete') : null;
  const footer = (liffUrl && actionUrl) ? {
    type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
    contents: [
      { type: 'button', style: 'primary', height: 'sm', color: LC.success,
        action: { type: 'uri', label: '回報完成', uri: actionUrl } },
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

    // ── Auth check: require service_role key or admin JWT ──
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      // If it's not the service_role_key, validate as admin
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (token !== serviceKey) {
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
    // task_auto_started 需要 liff_id（建 LIFF URL），多走一條 resolveLineAccount
    const isTaskAutoStarted = type === "task_auto_started";
    const acct = isTaskAutoStarted ? await resolveLineAccount(db, employee_id) : null;
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
