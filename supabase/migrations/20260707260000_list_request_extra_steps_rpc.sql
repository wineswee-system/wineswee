-- 加簽顯示：讓前端讀得到某單的加簽關 — 2026-07-07
-- 背景：approval_extra_steps 對 anon/authenticated 沒開讀取（前端直查 permission denied），
--       所以簽核 timeline 的 mergeExtraSteps 撈到錯誤就默默略過 → 加簽關不顯示。
-- 作法：SECURITY DEFINER RPC 依 source_table + source_id 回該單的加簽關（不含已撤銷），
--       繞過 RLS/grant，通用給所有表單 + web/LIFF 共用。只讀、不寫。
-- p_source_table 白名單防注入。idempotent。

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
    -- 白名單：只允許已知的簽核來源表
    AND p_source_table IN (
      'leave_requests','overtime_requests','business_trips','clock_corrections','off_requests',
      'personnel_transfer_requests','resignation_requests','leave_of_absence_requests',
      'headcount_requests','goods_transfer_requests','shift_cover_requests','store_audits',
      'expense_requests','expense_settles','form_submissions'
    )
  ORDER BY e.created_at;
$$;

GRANT EXECUTE ON FUNCTION public.list_request_extra_steps(text, integer) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
