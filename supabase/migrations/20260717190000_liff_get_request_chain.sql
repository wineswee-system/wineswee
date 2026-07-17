-- LIFF 員工端「我的簽核進度」看完整簽核鏈 — 2026-07-17
-- 給 (type, id) 回所有關卡 + 每關簽核人 + 狀態(completed/current/rejected/pending)。
-- 資料源:request_chain_snapshots(所有關)+ approval_step_history(已過/當前+誰簽) + resolve(未到關的現任簽核人)。
-- 注意:history 用短名(leave/overtime)、snapshot 用長名(leave_request/overtime_request),內部對應。
-- 凍結後 resolve 會回凍結的人(吃開單當下的鏈)。SECURITY DEFINER 繞 anon RLS。

CREATE OR REPLACE FUNCTION public.liff_get_request_chain(p_type text, p_id integer)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_snap_type text;
  v_applicant int;
  v_result json;
BEGIN
  -- snapshot 的 request_type(長名)
  v_snap_type := CASE p_type
    WHEN 'leave'    THEN 'leave_request'
    WHEN 'overtime' THEN 'overtime_request'
    ELSE p_type
  END;

  -- 申請人 employee_id(給 resolve 解動態主管用)
  v_applicant := CASE p_type
    WHEN 'leave'           THEN (SELECT employee_id FROM public.leave_requests     WHERE id = p_id)
    WHEN 'overtime'        THEN (SELECT employee_id FROM public.overtime_requests  WHERE id = p_id)
    WHEN 'correction'      THEN (SELECT employee_id FROM public.clock_corrections  WHERE id = p_id)
    WHEN 'trip'            THEN (SELECT employee_id FROM public.business_trips      WHERE id = p_id)
    WHEN 'expense_request' THEN (SELECT employee_id FROM public.expense_requests   WHERE id = p_id)
    ELSE NULL
  END;

  SELECT json_agg(row_to_json(x) ORDER BY x.step_order) INTO v_result FROM (
    SELECT
      s.step_order,
      s.label,
      COALESCE(
        h.approver_name,  -- 已簽關:實際簽核人
        (SELECT string_agg(r.emp_name, '、')
           FROM public.resolve_snapshot_step_approvers(v_snap_type, p_id, s.step_order, v_applicant) r)  -- 未到關:現任
      ) AS name,
      CASE
        WHEN h.action IN ('rejected','returned','退回','駁回') THEN 'rejected'
        WHEN h.exited_at IS NOT NULL THEN 'completed'
        WHEN h.entered_at IS NOT NULL THEN 'current'
        ELSE 'pending'
      END AS status,
      h.notes AS reject_reason
    FROM public.request_chain_snapshots s
    LEFT JOIN LATERAL (
      SELECT hh.* FROM public.approval_step_history hh
       WHERE hh.request_type = p_type AND hh.request_id = p_id AND hh.step_order = s.step_order
       ORDER BY hh.entered_at DESC LIMIT 1   -- 取最新一筆(重工/退回會有多筆)
    ) h ON true
    WHERE s.request_type = v_snap_type AND s.request_id = p_id
      AND COALESCE(s.auto_skipped, false) = false
  ) x;

  RETURN COALESCE(v_result, '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_request_chain(text, integer) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
