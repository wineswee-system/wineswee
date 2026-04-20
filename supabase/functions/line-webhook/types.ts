import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Supabase client type ────────────────────────────────────────────────────

export type SupabaseClient = ReturnType<typeof createClient>;

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
    };
