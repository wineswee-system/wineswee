-- 加簽全表單對齊：移除 tasks(非簽核)、報帳補完、加入 4 個 HR 簽核表單 — 2026-07-08
-- C 決策：tasks 不是簽核類型且 0 用量 → 移出允許清單；expenses(報帳)保留並補完
--          (觸發器/顯示白名單/標籤)；off_requests/headcount/store_audits/form_submissions
--          加入允許清單(擋關/清理/顯示/通知先前已涵蓋)。
-- idempotent。

-- 1) 允許加簽的表：移除 tasks，加入 4 個 HR 簽核表單（expenses 保留）
CREATE OR REPLACE FUNCTION public._extra_step_allowed_tables()
 RETURNS text[]
 LANGUAGE sql IMMUTABLE
AS $function$
  SELECT ARRAY[
    -- HR Forms
    'leave_requests', 'overtime_requests', 'business_trips', 'clock_corrections', 'expenses',
    -- HR Personnel Changes
    'resignation_requests', 'personnel_transfer_requests', 'leave_of_absence_requests',
    -- 費用申請
    'expense_requests',
    -- 商品調撥
    'goods_transfer_requests',
    -- 其他 HR 簽核表單（2026-07-08 加入；希望休 off_requests 刻意不給加簽，不列入）
    'headcount_requests', 'store_audits', 'form_submissions'
  ]::text[]
$function$;

-- 2) 把擋關 + 清理觸發器補掛到 expenses(報帳)——先前只有它沒掛
DROP TRIGGER IF EXISTS trg_guard_pending_extra ON public.expenses;
CREATE TRIGGER trg_guard_pending_extra BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public._guard_pending_extra_step();
DROP TRIGGER IF EXISTS trg_cancel_extras_on_delete ON public.expenses;
CREATE TRIGGER trg_cancel_extras_on_delete AFTER UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public._cancel_extras_on_source_delete();

-- 3) 顯示 RPC 白名單加入 expenses + 報帳 label
CREATE OR REPLACE FUNCTION public.list_request_extra_steps(p_source_table text, p_source_id integer)
RETURNS TABLE (
  id integer, source_table text, source_id integer, insert_before_step integer,
  assignee_id integer, assignee_name text, requested_by_id integer, requester_name text,
  reason text, reject_reason text, status text, approved_at timestamptz, created_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT e.id, e.source_table, e.source_id, e.insert_before_step,
         e.assignee_id, ea.name, e.requested_by_id, er.name,
         e.reason, e.reject_reason, e.status, e.approved_at, e.created_at
  FROM approval_extra_steps e
  LEFT JOIN employees ea ON ea.id = e.assignee_id
  LEFT JOIN employees er ON er.id = e.requested_by_id
  WHERE e.source_table = p_source_table
    AND e.source_id = p_source_id
    AND e.status <> 'cancelled'
    AND p_source_table IN (
      'leave_requests','overtime_requests','business_trips','clock_corrections','off_requests',
      'personnel_transfer_requests','resignation_requests','leave_of_absence_requests',
      'headcount_requests','goods_transfer_requests','shift_cover_requests','store_audits',
      'expense_requests','expense_settles','form_submissions','expenses'
    )
  ORDER BY e.created_at;
$$;
GRANT EXECUTE ON FUNCTION public.list_request_extra_steps(text, integer) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
