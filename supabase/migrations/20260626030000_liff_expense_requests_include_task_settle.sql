-- ════════════════════════════════════════════════════════════════════════════
-- liff_list_expense_requests：加上「任務驗收段被指派」條件
-- 2026-06-26
--
-- 原本只抓 employee_id=自己 OR settle_assignee_id=自己。
-- 情境：A 申請，B 被任務派去驗收，B 不是申請人也不是 settle_assignee_id →
-- 選完申請單後 /expense-request?settle_id=X 找不到 request → 驗收單不開。
-- 修法：加第三條件：有 task_form_bindings(expense_settle) 指向此 request
--       且 task.assignee_id 或 binding.assignee_id 是當前使用者。
-- idempotent: CREATE OR REPLACE
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.liff_list_expense_requests(p_line_user_id text)
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH emp AS (SELECT id FROM public._liff_resolve_employee(p_line_user_id))
  SELECT COALESCE(json_agg(row_to_json(er.*) ORDER BY er.created_at DESC), '[]'::json)
  FROM public.expense_requests er
  WHERE er.deleted_at IS NULL
    AND (
      -- 自己申請的
      er.employee_id = (SELECT id FROM emp)
      -- 自己是指定核銷人（舊版 trigger 設定的）
      OR (
        er.settle_assignee_id = (SELECT id FROM emp)
        AND er.status IN ('已核准', '核銷已退回')
      )
      -- 自己被任務指派為驗收段執行人（新版 task 派工）
      OR (
        er.status IN ('已核准', '待核銷', '核銷已退回')
        AND EXISTS (
          SELECT 1 FROM public.task_form_bindings tfb
          JOIN public.tasks t ON t.id = tfb.task_id
          WHERE tfb.form_type = 'expense_settle'
            AND tfb.form_id = er.id
            AND (t.assignee_id = (SELECT id FROM emp) OR tfb.assignee_id = (SELECT id FROM emp))
        )
      )
    )
$function$;

NOTIFY pgrst, 'reload schema';
