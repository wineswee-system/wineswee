-- ════════════════════════════════════════════════════════════════════════════
-- liff_list_my_submissions：加入 form_submissions（含 reject_attachments）
-- ────────────────────────────────────────────────────────────────────────────
-- 場景：申請人的表單被退回時，退回附件只有 Web 看得到。
--   LIFF ApprovalStatus 只呼叫 liff_list_my_submissions，此 RPC 原本沒回
--   form_submissions，所以 LIFF 完全看不到駁回附件。
--
-- 修法：完整 CREATE OR REPLACE（保留原有 6 種類型），加上 form_submissions
--   - 新增 reject_attachments jsonb 欄位
--   - 同時回傳 data_resolved（picker ID 已換成 name）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.liff_list_my_submissions(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object(
      'leaves','[]'::json,'overtimes','[]'::json,'trips','[]'::json,
      'expenses','[]'::json,'corrections','[]'::json,'expense_requests','[]'::json,
      'form_submissions','[]'::json
    );
  END IF;

  RETURN json_build_object(
    'leaves', (
      SELECT COALESCE(json_agg(row_to_json(l.*) ORDER BY l.created_at DESC), '[]'::json)
      FROM public.leave_requests l
      WHERE (l.employee_id = emp.id OR l.employee = emp.name)
      LIMIT 50
    ),
    'overtimes', (
      SELECT COALESCE(json_agg(row_to_json(o.*) ORDER BY o.created_at DESC), '[]'::json)
      FROM public.overtime_requests o
      WHERE (o.employee_id = emp.id OR o.employee = emp.name)
      LIMIT 50
    ),
    'trips', (
      SELECT COALESCE(json_agg(row_to_json(t.*) ORDER BY t.created_at DESC), '[]'::json)
      FROM public.business_trips t
      WHERE t.employee = emp.name
      LIMIT 50
    ),
    'expenses', (
      SELECT COALESCE(json_agg(row_to_json(e.*) ORDER BY e.created_at DESC), '[]'::json)
      FROM public.expenses e
      WHERE e.employee = emp.name
      LIMIT 50
    ),
    'corrections', (
      SELECT COALESCE(json_agg(row_to_json(c.*) ORDER BY c.created_at DESC), '[]'::json)
      FROM public.clock_corrections c
      WHERE c.employee = emp.name
      LIMIT 50
    ),
    'expense_requests', (
      SELECT COALESCE(json_agg(row_to_json(er.*) ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      WHERE er.employee = emp.name
      LIMIT 50
    ),
    -- ★ 自訂表單（form_submissions）含駁回附件
    'form_submissions', (
      SELECT COALESCE(json_agg(json_build_object(
        'id',                s.id,
        'template_id',       s.template_id,
        'template_name',     t.name,
        'template_fields',   t.fields,
        'applicant_id',      s.applicant_id,
        'data',              s.data,
        'data_resolved',     public._resolve_form_submission_data(s.data, t.fields),
        'status',            s.status,
        'created_at',        s.created_at,
        'reject_reason',     s.reject_reason,
        'reject_attachments', s.reject_attachments
      ) ORDER BY s.created_at DESC), '[]'::json)
      FROM public.form_submissions s
      JOIN public.form_templates t ON t.id = s.template_id
      WHERE s.applicant_id = emp.id
      LIMIT 50
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_my_submissions(text) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
