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
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`LINE push failed ${res.status}: ${body}`);
    return false;
  }
  return true;
}

// ── Resolve LINE ID ────────────────────────────────────────────
async function resolveLineId(sb: SupabaseClient, employeeId: number): Promise<string | null> {
  const { data: lu } = await sb.from("line_users")
    .select("line_user_id")
    .eq("employee_id", employeeId)
    .eq("is_verified", true)
    .maybeSingle();
  if (lu?.line_user_id) return lu.line_user_id;

  // Fallback: employees.line_user_id
  const { data: emp } = await sb.from("employees")
    .select("line_user_id")
    .eq("id", employeeId)
    .maybeSingle();
  return emp?.line_user_id || null;
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

function actionFooter(taskId: number) {
  return {
    type: "box", layout: "horizontal", spacing: "sm", paddingAll: "14px",
    contents: [
      {
        type: "button", style: "secondary", height: "sm",
        action: { type: "message", label: "📝 更新備註", text: `/任務 #${taskId} 更新` },
      },
      {
        type: "button", style: "primary", height: "sm", color: "#16a34a",
        action: { type: "message", label: "✅ 完成", text: `/任務 #${taskId} 完成` },
      },
    ],
  };
}

// ── Flex Builders ──────────────────────────────────────────────

function buildReminderFlex(task: any) {
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
      footer: actionFooter(task.id),
    },
  };
}

function buildOverdueFlex(task: any, daysOverdue: number) {
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
      footer: actionFooter(task.id),
    },
  };
}

function buildDueSoonFlex(task: any, label: string) {
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
      footer: actionFooter(task.id),
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
    const lineToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") || "";
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
    if (mode === "all" || mode === "reminders") {
      const { data: reminderTasks } = await sb.from("tasks")
        .select("id, title, due_date, assignee_id, reminder_at, status")
        .lte("reminder_at", now)
        .eq("reminder_sent", false)
        .not("status", "in", '("已完成","已取消")')
        .limit(50);

      if (reminderTasks) {
        for (const task of reminderTasks) {
          if (!task.assignee_id || !lineToken) {
            await sb.from("tasks").update({ reminder_sent: true }).eq("id", task.id);
            continue;
          }

          const lineId = await resolveLineId(sb, task.assignee_id);
          if (!lineId) { skippedCount++; continue; }

          const sent = await pushLine(lineId, [buildReminderFlex(task)], lineToken);
          if (sent) {
            await sb.from("tasks").update({ reminder_sent: true }).eq("id", task.id);
            reminderCount++;
          }
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

          const sent = await pushLine(lineId, [buildOverdueFlex(task, daysOverdue)], lineToken);
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

          const sent = await pushLine(lineId, [buildDueSoonFlex(task, label)], lineToken);
          if (sent) {
            await sb.from("tasks").update({
              metadata: { ...meta, [metaKey]: todayStr },
            }).eq("id", task.id);
            dueSoonCount++;
          }
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true, mode,
      reminders_sent: reminderCount,
      overdue_sent: overdueCount,
      due_soon_sent: dueSoonCount,
      skipped_no_line_id: skippedCount,
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
