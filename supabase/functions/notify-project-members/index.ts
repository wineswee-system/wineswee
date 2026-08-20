import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// 專案「通知成員」後端化:原本在瀏覽器前端 push LINE,7/18 多租戶 RLS 上線後前端讀不到別人的
// line 綁定 → resolveLineAccount 拿不到 userId → 靜默失敗(站內通知照寫、LINE 沒發)。
// 改由此 Edge Function 用 service role(繞 RLS)發送,對齊 task-reminder 的可靠後端路徑。

// @ts-ignore — Deno global available at runtime in Supabase Edge Functions
const SITE_URL = Deno.env.get("SITE_URL") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": SITE_URL,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LC = { muted: "#6B7280", dark: "#111827", brand: "#06b6d4" };

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function pushLine(to: string, messages: object[], accessToken: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to, messages }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(`LINE push failed ${res.status}: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("LINE push error", err);
    return false;
  }
}

// line_user_id 是頻道綁定的;取該員工(優先 primary)的綁定。service role 讀 → 不受 RLS 限制。
async function resolveLineId(sb: SupabaseClient, employeeId: number): Promise<string | null> {
  const { data } = await sb.from("v_employee_line_resolved")
    .select("line_user_id")
    .eq("employee_id", employeeId)
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.line_user_id || null;
}

// 對齊前端舊卡片(notifyProjectMember):標題 + 專案名 + 門市 + 任務清單。
function buildProjectCard(projectName: string, store: string | null, titles: string[]): Record<string, unknown> {
  const list = (titles || []).slice(0, 20).map((t) => ({
    type: "text", text: `• ${t}`, size: "sm", wrap: true, color: LC.dark, margin: "sm",
  }));
  return {
    type: "flex",
    altText: `📁 你被安排到專案：${projectName}（${(titles || []).length} 項任務）`,
    contents: {
      type: "bubble", size: "kilo",
      header: {
        type: "box", layout: "vertical", backgroundColor: LC.brand, paddingAll: "14px",
        contents: [{ type: "text", text: "📁 專案任務安排", color: "#ffffff", weight: "bold", size: "md" }],
      },
      body: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px",
        contents: [
          { type: "text", text: projectName, weight: "bold", size: "sm", wrap: true, color: LC.dark },
          ...(store ? [{ type: "text", text: store, size: "xs", color: LC.muted, wrap: true }] : []),
          { type: "separator", margin: "md" },
          { type: "text", text: `你被安排 ${(titles || []).length} 項任務：`, size: "xs", color: LC.muted, margin: "md" },
          ...list,
        ],
      },
    },
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // 需要 Bearer(使用者 JWT 或 service key)—— supabase.functions.invoke 會自動帶
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const { project_id, force = true } = await req.json();
    if (!project_id) return json({ error: "missing project_id" }, 400);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN_WORKFLOW") || "";

    const { data: proj } = await sb.from("projects").select("name, store").eq("id", project_id).maybeSingle();
    if (!proj) return json({ error: "project not found" }, 404);

    // RPC(SECURITY DEFINER):寫站內通知 + 回被指派任務的成員名單(含 task_titles)
    const { data: members, error } = await sb.rpc("notify_project_members", {
      p_project_id: project_id, p_force: force,
    });
    if (error) return json({ error: error.message }, 500);
    if (!Array.isArray(members)) return json({ notified: 0, pushed: 0 });

    let pushed = 0;
    let noLine = 0;
    for (const m of members) {
      const lineId = await resolveLineId(sb, m.employee_id);
      if (!lineId) { noLine++; continue; }
      const titles = Array.isArray(m.task_titles) ? m.task_titles.filter(Boolean) : [];
      const msg = buildProjectCard(proj.name, proj.store ?? null, titles);
      const ok = await pushLine(lineId, [msg], token);
      // 記 message_logs 保觀測性(對齊前端舊行為 + 之後可查送達)
      await sb.from("message_logs").insert({
        channel: "LINE", recipient: lineId, subject: msg.altText,
        body: JSON.stringify([msg]), status: ok ? "sent" : "failed",
      });
      if (ok) pushed++;
    }

    return json({ notified: members.length, pushed, no_line: noLine });
  } catch (err) {
    console.error("notify-project-members error", err);
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
