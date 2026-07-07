import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Supabase client type ────────────────────────────────────────────────────

export type SupabaseClient = ReturnType<typeof createClient>;

// ── Request types (for P0 approval cards) ───────────────────────────────────

export type ApprovalRequestType =
  | "leave"
  | "overtime"
  | "trip"
  | "expense"
  | "expense_request"
  | "expense_settle"
  | "correction"
  | "cover"
  | "off_request"
  | "form_submission"
  | "goods_transfer"
  // HR B 類 chain（走 hr_chain_approve，非 liff_approve_request）
  | "resignation"
  | "transfer"
  | "loa"
  | "headcount"
  // 門市稽核（走 liff_store_audit_approve 獨立 RPC）
  | "store_audit";

// ── Pending Action types ────────────────────────────────────────────────────

export type PendingAction =
  | { action: "add_note"; task_id: string; task_title: string }
  | { action: "reject_reason"; task_id: string; task_title: string; short_id: string }
  | {
      action: "create_task";
      step: "workflow" | "due_date" | "reminder" | "owner" | "confirm";
      data: {
        title: string;
        source_group_id?: string | null;
        workflow_instance_id?: string | null;
        workflow_name?: string | null;
        due_date?: string | null;
        reminder?: string | null;
        owner_employee_id?: number | null;
        owner_name?: string | null;
        is_manager: boolean;
      };
    }
  // ── New for upgraded P0/P1 cards ─────────────────────────────────────────
  // 簽核拒絕 — 等使用者打駁回原因，再呼叫 RPC reject
  | {
      action: "approval_reject_reason";
      request_type: ApprovalRequestType;
      request_id: number;
      title: string;
    }
  // 簽核核准 + 留話（使用者按 [✅ 核准+寫話]）
  | {
      action: "approval_approve_note";
      request_type: ApprovalRequestType;
      request_id: number;
      title: string;
    }
  // 加簽退回 — 等使用者打退回原因，再呼叫 process_extra_signer reject
  | { action: "extra_reject_reason"; extra_step_id: number; title: string }
  // 任務加備註 v2 — 用 numeric task_id (非 short id)
  | { action: "task_note_v2"; task_id: number; title: string }
  // 薪資 PIN 解鎖 — 等使用者打 4-6 位密碼
  | {
      action: "salary_pin";
      mode: "unlock" | "setup";   // unlock=驗 PIN 看薪資, setup=新 PIN
      attempts?: number;          // 已嘗試次數（僅 unlock）
    };
