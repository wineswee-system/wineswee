import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── LINE Push ──────────────────────────────────────────────────
async function pushLine(to: string, messages: object[], accessToken: string): Promise<boolean> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to, messages }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`LINE push failed ${res.status}: ${body}`);
    return false;
  }
  return true;
}

// ── Resolve LINE ID via multi-OA mapping ────────────────────────
async function resolveLineId(sb: SupabaseClient, employeeId: number): Promise<string | null> {
  const { data } = await sb.from("v_employee_line_resolved")
    .select("line_user_id")
    .eq("employee_id", employeeId)
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.line_user_id || null;
}

// ── Helpers ────────────────────────────────────────────────────
function todayTaipei(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function actionFooter(taskId: number, liffId?: string | null) {
  // Single primary LIFF button — user completes / updates notes inside LIFF UI
  // (not via BOT text commands). Matches the inline-web card.
  const liffUrl = liffId
    ? `https://liff.line.me/${liffId}?to=${encodeURIComponent(`/tasks?task=${taskId}`)}`
    : null;
  return {
    type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px",
    contents: liffUrl
      ? [{
          type: "button", style: "primary", color: "#06b6d4", height: "sm",
          action: { type: "uri", label: "📋 查看任務", uri: liffUrl },
        }]
      : [],
  };
}

// ── Flex Builders ──────────────────────────────────────────────

function buildReminderFlex(task: any, liffId?: string | null) {
  const dueLabel = task.due_date ? formatDate(task.due_date) : "未設定";
  return {
    type: "flex",
    altText: `⏰ 提醒：任務「${task.title}」即將到期`,
    contents: {
      type: "bubble", size: "kilo",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#F59E0B", paddingAll: "14px",
        contents: [
          { type: "text", text: "⏰ 任務提醒", weight: "bold", color: "#FFFFFF", size: "md" },
        ],
      },
      body: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px",
        contents: [
          { type: "text", text: task.title, weight: "bold", size: "md", wrap: true },
          { type: "text", text: `到期時間：${dueLabel}`, size: "sm", color: "#666666" },
        ],
      },
      footer: actionFooter(task.id, liffId),
    },
  };
}

function buildOverdueFlex(task: any, daysOverdue: number, liffId?: string | null) {
  const dueLabel = task.due_date ? formatDate(task.due_date) : "未設定";
  return {
    type: "flex",
    altText: `🔴 逾期：任務「${task.title}」已超過到期時間 (${daysOverdue}天)`,
    contents: {
      type: "bubble", size: "kilo",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#EF4444", paddingAll: "14px",
        contents: [
          { type: "text", text: "🔴 任務逾期通知", weight: "bold", color: "#FFFFFF", size: "md" },
        ],
      },
      body: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px",
        contents: [
          { type: "text", text: task.title, weight: "bold", size: "md", wrap: true },
          { type: "text", text: `到期時間：${dueLabel}`, size: "sm", color: "#666666" },
          { type: "text", text: `已逾期 ${daysOverdue} 天，請盡快處理。`, size: "sm", color: "#EF4444", wrap: true },
        ],
      },
      footer: actionFooter(task.id, liffId),
    },
  };
}

function buildDueSoonFlex(task: any, label: string, liffId?: string | null) {
  const dueLabel = task.due_date ? formatDate(task.due_date) : "未設定";
  return {
    type: "flex",
    altText: `📢 ${label}：任務「${task.title}」`,
    contents: {
      type: "bubble", size: "kilo",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#F59E0B", paddingAll: "14px",
        contents: [
          { type: "text", text: `📢 ${label}`, weight: "bold", color: "#FFFFFF", size: "md" },
        ],
      },
      body: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px",
        contents: [
          { type: "text", text: task.title, weight: "bold", size: "md", wrap: true },
          { type: "text", text: `到期時間：${dueLabel}`, size: "sm", color: "#666666" },
        ],
      },
      footer: actionFooter(task.id, liffId),
    },
  };
}

// ══════════════════════════════════════════════════════════════
// Main Handler
// ══════════════════════════════════════════════════════════════

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // line_user_id is channel-scoped — pick the token matching the channel the
    // assignee is bound to. Fallback to legacy generic token for old reminders.
    const fallbackToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN_WORKFLOW") || "";
    const tokenFor = (_channelCode: string | null | undefined): string => fallbackToken;
    // LIFF deep-link target for the "查看詳情" button on every flex card
    const taskLiffId =
      Deno.env.get("LIFF_TASK_ID_WORKFLOW") ||
      Deno.env.get("LIFF_NEW_TASK_ID_WORKFLOW") ||
      Deno.env.get("LIFF_TASK_ID") ||
      "";
    // Legacy reminder/overdue/due_soon paths still use the fallback
    const lineToken = fallbackToken;
    const sb = createClient(supabaseUrl, serviceKey);

    let mode = "all";
    try {
      const body = await req.json();
      if (body?.mode) mode = body.mode;
    } catch { /* empty body is fine */ }

    const now = new Date().toISOString();
    const today = todayTaipei();
    let reminderCount = 0;
    let overdueCount = 0;
    let dueSoonCount = 0;
    let skippedCount = 0;

    // ── 1. Reminder: tasks with reminder_at <= now, not yet sent ──
    // tasks 表沒有 reminder_sent 欄位 → 用 metadata.reminder_sent JSONB 標記
    if (mode === "all" || mode === "reminders") {
      const { data: rawReminderTasks } = await sb.from("tasks")
        .select("id, title, due_date, assignee_id, reminder_at, status, metadata")
        .lte("reminder_at", now)
        .not("status", "in", '("已完成","已取消")')
        .limit(200);

      const reminderTasks = (rawReminderTasks || []).filter(
        (t: any) => !(t.metadata && t.metadata.reminder_sent)
      ).slice(0, 50);

      for (const task of reminderTasks) {
        const meta = (task.metadata || {}) as Record<string, unknown>;
        if (!task.assignee_id || !lineToken) {
          await sb.from("tasks").update({ metadata: { ...meta, reminder_sent: true } }).eq("id", task.id);
          continue;
        }

        const lineId = await resolveLineId(sb, task.assignee_id);
        if (!lineId) { skippedCount++; continue; }

        const sent = await pushLine(lineId, [buildReminderFlex(task, taskLiffId)], lineToken);
        if (sent) {
          await sb.from("tasks").update({ metadata: { ...meta, reminder_sent: true } }).eq("id", task.id);
          reminderCount++;
        }
      }
    }

    // ── 2. Overdue: tasks past due_date ──
    if (mode === "all" || mode === "overdue") {
      const { data: overdueTasks } = await sb.from("tasks")
        .select("id, title, due_date, assignee_id, metadata, status")
        .lt("due_date", now)
        .not("status", "in", '("已完成","已取消")')
        .limit(50);

      if (overdueTasks) {
        for (const task of overdueTasks) {
          const meta = (task.metadata || {}) as Record<string, unknown>;
          if (meta.last_overdue_date === today) continue;
          if (!task.assignee_id || !lineToken) continue;

          const lineId = await resolveLineId(sb, task.assignee_id);
          if (!lineId) { skippedCount++; continue; }

          const dueDate = new Date(task.due_date);
          const daysOverdue = Math.floor((Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

          const sent = await pushLine(lineId, [buildOverdueFlex(task, daysOverdue, taskLiffId)], lineToken);
          if (sent) {
            await sb.from("tasks").update({
              metadata: { ...meta, last_overdue_date: today },
            }).eq("id", task.id);
            overdueCount++;
          }
        }
      }
    }

    // ── 3. Due soon: tasks due today or tomorrow ──
    if (mode === "all" || mode === "due_soon") {
      const taipeiNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
      const todayStr = todayTaipei();
      const tomorrowDate = new Date(taipeiNow);
      tomorrowDate.setDate(tomorrowDate.getDate() + 1);
      const tomorrowStr = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}`;

      const { data: dueSoonTasks } = await sb.from("tasks")
        .select("id, title, due_date, assignee_id, metadata, status")
        .gte("due_date", todayStr)
        .lt("due_date", `${tomorrowStr}T23:59:59`)
        .not("status", "in", '("已完成","已取消")')
        .limit(50);

      if (dueSoonTasks) {
        for (const task of dueSoonTasks) {
          if (!task.assignee_id || !lineToken || !task.due_date) continue;

          const meta = (task.metadata || {}) as Record<string, unknown>;
          const dueDateStr = task.due_date.slice(0, 10);
          const isDueToday = dueDateStr === todayStr;
          const isDueTomorrow = dueDateStr === tomorrowStr;

          let label = "";
          let metaKey = "";
          if (isDueTomorrow && meta.due_soon_tomorrow !== todayStr) {
            label = "明日到期提醒"; metaKey = "due_soon_tomorrow";
          } else if (isDueToday && meta.due_soon_today !== todayStr) {
            label = "今日到期提醒"; metaKey = "due_soon_today";
          } else {
            continue;
          }

          const lineId = await resolveLineId(sb, task.assignee_id);
          if (!lineId) { skippedCount++; continue; }

          const sent = await pushLine(lineId, [buildDueSoonFlex(task, label, taskLiffId)], lineToken);
          if (sent) {
            await sb.from("tasks").update({
              metadata: { ...meta, [metaKey]: todayStr },
            }).eq("id", task.id);
            dueSoonCount++;
          }
        }
      }
    }

    // ── 4. Approval SLA: 簽核者待審 > 24h，每日推 summary 卡（D9）──
    let slaCount = 0;
    if (mode === "all" || mode === "approval_sla") {
      const { data: linkedEmps } = await sb.from("v_employee_line_resolved")
        .select("employee_id, line_user_id")
        .not("line_user_id", "is", null);

      const dayMs = 24 * 60 * 60 * 1000;
      for (const row of (linkedEmps || []) as Array<{ employee_id: number; line_user_id: string }>) {
        if (!row.line_user_id) continue;
        const { data: pa } = await sb.rpc("liff_list_pending_approvals", { p_line_user_id: row.line_user_id });
        if (!pa) continue;

        const buckets: Array<{ key: string; label: string; emoji: string }> = [
          { key: "leaves",           label: "請假",   emoji: "🏖" },
          { key: "overtimes",        label: "加班",   emoji: "⏰" },
          { key: "trips",            label: "出差",   emoji: "✈️" },
          { key: "corrections",      label: "補打卡", emoji: "🔧" },
          { key: "expenses",         label: "報帳",   emoji: "💰" },
          { key: "expense_requests", label: "經費",   emoji: "💳" },
          { key: "off_requests",     label: "希望休", emoji: "🌴" },
        ];

        const overdue: Array<{ label: string; emoji: string; id: number; applicant: string; days: number }> = [];
        for (const b of buckets) {
          const list = ((pa as any)[b.key] || []) as Array<any>;
          for (const item of list) {
            if (!item.created_at) continue;
            const days = Math.floor((Date.now() - new Date(item.created_at).getTime()) / dayMs);
            if (days >= 1) {
              overdue.push({
                label: b.label, emoji: b.emoji, id: item.id,
                applicant: item.employee ?? "—", days,
              });
            }
          }
        }

        if (overdue.length === 0) continue;

        // Build SLA reminder card
        const top5 = overdue
          .sort((a, b) => b.days - a.days)
          .slice(0, 8);
        const flex = {
          type: "flex",
          altText: `⚠️ 你有 ${overdue.length} 件簽核超過 24h 未處理`,
          contents: {
            type: "bubble", size: "kilo",
            header: {
              type: "box", layout: "vertical", paddingAll: "14px", backgroundColor: "#dc2626",
              contents: [
                { type: "text", text: "⏰ 簽核逾期提醒", color: "#FFFFFF", weight: "bold", size: "lg" },
                { type: "text", text: `共 ${overdue.length} 件超過 24h 未處理`, color: "#FECACA", size: "xs", margin: "xs" },
              ],
            },
            body: {
              type: "box", layout: "vertical", spacing: "xs", paddingAll: "12px",
              contents: top5.map((o) => ({
                type: "box", layout: "horizontal", spacing: "sm", margin: "xs",
                contents: [
                  { type: "text", text: `${o.emoji} ${o.applicant}`, size: "sm", color: "#333", flex: 5, wrap: true },
                  { type: "text", text: `${o.label} ${o.days}d`, size: "xs", color: "#dc2626", flex: 4, weight: "bold", align: "end" },
                ],
              })).concat(overdue.length > 8 ? [{
                type: "box", layout: "horizontal", contents: [
                  { type: "text", text: `... 還有 ${overdue.length - 8} 件`, size: "xs", color: "#9CA3AF", align: "center" },
                ],
              }] : [] as any),
            },
            footer: {
              type: "box", layout: "vertical", paddingAll: "10px",
              contents: [{
                type: "button", style: "primary", color: "#dc2626", height: "sm",
                action: { type: "message", label: "✅ 立即處理", text: "簽核" },
              }],
            },
          },
        };

        const sent = await pushLine(row.line_user_id, [flex], lineToken);
        if (sent) slaCount++;
      }
    }

    // ── 5. Drain task_pending_notifications：cascade 啟動的任務推 LINE ──
    // service_role can't read RLS-scoped tables (tasks/workflow_instances/employee_line_accounts
    // policies are 'TO authenticated' only). Use SECURITY DEFINER RPC that joins everything.
    let startedNotifyCount = 0;
    let drainDebug: Record<string, unknown> = {};
    if (mode === "all" || mode === "task_started" || mode === "drain_queue") {
      const { data: pending, error: pendingErr } = await sb.rpc("drain_task_started_notifications");

      drainDebug = {
        query_error: pendingErr ? { message: pendingErr.message, code: pendingErr.code, details: pendingErr.details, hint: pendingErr.hint } : null,
        rows_fetched: Array.isArray(pending) ? pending.length : null,
        first_row: Array.isArray(pending) ? pending[0] ?? null : null,
      };

      if (Array.isArray(pending)) {
        for (const p of pending as Array<{
          queue_id: number;
          task_id: number | null;
          task_title: string | null;
          task_description: string | null;
          task_notes: string | null;
          task_priority: string | null;
          task_due_date: string | null;
          task_store: string | null;
          task_assignee: string | null;
          task_assignee_id: number | null;
          task_workflow_instance_id: number | null;
          instance_template_name: string | null;
          line_user_id: string | null;
          channel_code: string | null;
        }>) {
          // task 不見了或沒人 → 標記已處理免得重抓
          if (!p.task_id || !p.task_assignee_id) {
            await sb.rpc("mark_task_notification_sent", { p_queue_id: p.queue_id });
            continue;
          }

          // 沒 LINE 綁定 → 標記已處理 + skipped
          if (!p.line_user_id) {
            await sb.rpc("mark_task_notification_sent", { p_queue_id: p.queue_id });
            skippedCount++;
            continue;
          }

          // Use the token matching the channel the assignee is bound to
          const channelToken = tokenFor(p.channel_code);
          if (!channelToken) continue;

          const dueLabel = p.task_due_date ? formatDate(p.task_due_date) : "未設定";
          const instanceName = p.instance_template_name || "";
          const isOverdue = !!(p.task_due_date && new Date(p.task_due_date) < new Date());

          const flex = {
            type: "flex",
            altText: `${isOverdue ? "⚠️ [逾期] " : ""}📋 任務通知：${p.task_title}`,
            contents: {
              type: "bubble", size: "kilo",
              header: {
                type: "box", layout: "vertical", paddingAll: "14px", backgroundColor: "#06b6d4",
                contents: [
                  {
                    type: "box", layout: "horizontal", alignItems: "center",
                    contents: [
                      { type: "text", text: "📋 任務通知", color: "#FFFFFF", weight: "bold", size: "md", flex: 1 },
                      ...(isOverdue ? [{
                        type: "box", layout: "vertical", backgroundColor: "#ef4444", cornerRadius: "4px",
                        paddingTop: "3px", paddingBottom: "3px", paddingStart: "8px", paddingEnd: "8px",
                        contents: [{ type: "text", text: "⚠️ 逾期", color: "#ffffff", size: "xxs", weight: "bold" }],
                      }] : []),
                    ],
                  },
                ],
              },
              body: {
                type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px",
                contents: [
                  { type: "text", text: p.task_title ?? "", weight: "bold", size: "md", wrap: true },
                  { type: "text", text: `到期：${dueLabel}`, size: "xs", color: isOverdue ? "#ef4444" : "#666666", weight: isOverdue ? "bold" : "regular" },
                  ...(p.task_assignee ? [{ type: "text", text: `負責人：${p.task_assignee}`, size: "xs", color: "#666666" }] : []),
                  ...(instanceName ? [{ type: "text", text: `流程：${instanceName}`, size: "xs", color: "#666666" }] : []),
                  ...(p.task_description?.trim() ? [
                    { type: "separator", margin: "sm" },
                    { type: "text", text: p.task_description.trim(), size: "sm", color: "#444444", wrap: true, margin: "sm" },
                  ] : []),
                  ...(p.task_notes?.trim() ? [
                    { type: "separator", margin: "sm" },
                    { type: "text", text: "📌 備註", size: "xxs", color: "#8c8c8c", margin: "sm" },
                    { type: "text", text: p.task_notes.trim(), size: "sm", color: "#444444", wrap: true },
                  ] : []),
                  ...(p.task_store ? [{ type: "text", text: `門市：${p.task_store}`, size: "xs", color: "#666666", margin: "sm" }] : []),
                ],
              },
              footer: actionFooter(p.task_id, taskLiffId),
            },
          };

          const sent = await pushLine(p.line_user_id, [flex], channelToken);
          if (sent) {
            await sb.rpc("mark_task_notification_sent", { p_queue_id: p.queue_id });
            startedNotifyCount++;
          }
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true, mode,
      reminders_sent: reminderCount,
      overdue_sent: overdueCount,
      due_soon_sent: dueSoonCount,
      sla_sent: slaCount,
      task_started_sent: startedNotifyCount,
      skipped_no_line_id: skippedCount,
      drain_debug: drainDebug,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("task-reminder error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
