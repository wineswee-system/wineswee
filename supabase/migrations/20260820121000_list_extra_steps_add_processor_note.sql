-- list_request_extra_steps 回傳補上 processor_note(加簽人核准/退回時留的備註),供前端在簽核鏈顯示。
-- RETURNS TABLE 改欄位不能 CREATE OR REPLACE(改 return type)→ 先 DROP 再建。DEFINER 預設 PUBLIC EXECUTE,anon/authenticated 照舊可呼叫。
DROP FUNCTION IF EXISTS public.list_request_extra_steps(text, integer);

CREATE OR REPLACE FUNCTION public.list_request_extra_steps(p_source_table text, p_source_id integer)
RETURNS TABLE(
  id integer, source_table text, source_id integer, insert_before_step integer,
  assignee_id integer, assignee_name text, requested_by_id integer, requester_name text,
  reason text, reject_reason text, processor_note text, status text,
  approved_at timestamp with time zone, created_at timestamp with time zone
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT e.id, e.source_table, e.source_id, e.insert_before_step,
         e.assignee_id, ea.name, e.requested_by_id, er.name,
         e.reason, e.reject_reason, e.processor_note, e.status, e.approved_at, e.created_at
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
$function$;
