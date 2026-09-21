-- LIFF 我的簽核進度:補 form_submission 動態關 + HR B(離職/留停/異動/人力需求) — 2026-07-23
-- ════════════════════════════════════════════════════════════════════════════
-- 續 20260723110000。排查發現另兩缺口:
--  #1 form_submission:liff_get_request_chain CASE 沒它→v_applicant NULL→動態關(部門主管/督導)
--     簽核人名字 null。加分支(form_submissions 用 applicant_id)。
--  #2 HR B(resignation/loa/transfer/headcount):liff_list_my_submissions 沒回這4種
--     +liff_get_request_chain CASE 沒它們→LIFF 完全看不到。加進去。
--     (resignation 有3筆資料;loa/transfer/headcount 空表,先接好之後有單自動顯示)
--     headcount status 是英文(pending/approved)→ v_approved 多納 'approved'。
-- 兩函式其餘 body 與 live 逐字一致(dump 驗證)。
-- ════════════════════════════════════════════════════════════════════════════

-- ── liff_get_request_chain:加 form_submission + 4 HR B 分支 ──
CREATE OR REPLACE FUNCTION public.liff_get_request_chain(p_type text, p_id integer)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_snap_type text;
  v_applicant int;
  v_status    text;
  v_approved  boolean;
  v_result json;
BEGIN
  -- snapshot 的 request_type(長名)
  v_snap_type := CASE p_type
    WHEN 'leave'    THEN 'leave_request'
    WHEN 'overtime' THEN 'overtime_request'
    ELSE p_type
  END;

  -- 申請人 employee_id + 單子最終狀態(依 request_type 對應表)
  CASE p_type
    WHEN 'leave'           THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.leave_requests     WHERE id = p_id;
    WHEN 'overtime'        THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.overtime_requests  WHERE id = p_id;
    WHEN 'correction'      THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.clock_corrections  WHERE id = p_id;
    WHEN 'trip'            THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.business_trips      WHERE id = p_id;
    WHEN 'expense_request' THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.expense_requests   WHERE id = p_id;
    WHEN 'expense'         THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.expenses           WHERE id = p_id;
    WHEN 'form_submission' THEN SELECT applicant_id, status INTO v_applicant, v_status FROM public.form_submissions  WHERE id = p_id;
    WHEN 'resignation'     THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.resignation_requests        WHERE id = p_id;
    WHEN 'loa'             THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.leave_of_absence_requests   WHERE id = p_id;
    WHEN 'transfer'        THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.personnel_transfer_requests WHERE id = p_id;
    WHEN 'headcount'       THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.headcount_requests          WHERE id = p_id;
    ELSE v_applicant := NULL;
  END CASE;

  -- 已核准/通過 → 所有關卡視為 completed(current_step 舊單不可靠,只信最終狀態)
  -- 'approved' 為 headcount 英文狀態
  v_approved := v_status IN ('已核准', '已通過', '已核銷', '已結案', 'approved');

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
        WHEN v_approved THEN 'completed'
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
END $function$;

-- ── liff_list_my_submissions:加 resignations/loas/transfers/headcounts 4 key ──
CREATE OR REPLACE FUNCTION public.liff_list_my_submissions(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object(
      'leaves','[]'::json,'overtimes','[]'::json,'trips','[]'::json,
      'expenses','[]'::json,'corrections','[]'::json,'expense_requests','[]'::json,
      'form_submissions','[]'::json,
      'resignations','[]'::json,'loas','[]'::json,'transfers','[]'::json,'headcounts','[]'::json
    );
  END IF;

  RETURN json_build_object(
    'leaves', (
      SELECT COALESCE(json_agg(row_to_json(l.*) ORDER BY l.created_at DESC), '[]'::json)
      FROM public.leave_requests l
      WHERE (l.employee_id = emp.id OR l.employee = emp.name)
        AND l.deleted_at IS NULL
      LIMIT 50
    ),
    'overtimes', (
      SELECT COALESCE(json_agg(row_to_json(o.*) ORDER BY o.created_at DESC), '[]'::json)
      FROM public.overtime_requests o
      WHERE (o.employee_id = emp.id OR o.employee = emp.name)
        AND o.deleted_at IS NULL
      LIMIT 50
    ),
    'trips', (
      SELECT COALESCE(json_agg(row_to_json(t.*) ORDER BY t.created_at DESC), '[]'::json)
      FROM public.business_trips t
      WHERE t.employee = emp.name
        AND t.deleted_at IS NULL
      LIMIT 50
    ),
    'expenses', (
      -- expenses 表沒 deleted_at 欄位（不在 soft-delete 範圍）
      SELECT COALESCE(json_agg(row_to_json(e.*) ORDER BY e.created_at DESC), '[]'::json)
      FROM public.expenses e
      WHERE e.employee = emp.name
      LIMIT 50
    ),
    'corrections', (
      SELECT COALESCE(json_agg(row_to_json(c.*) ORDER BY c.created_at DESC), '[]'::json)
      FROM public.clock_corrections c
      WHERE c.employee = emp.name
        AND c.deleted_at IS NULL
      LIMIT 50
    ),
    'expense_requests', (
      SELECT COALESCE(json_agg(row_to_json(er.*) ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      WHERE er.employee = emp.name
        AND er.deleted_at IS NULL
      LIMIT 50
    ),
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
        'reject_attachments', s.reject_attachments,
        'attachments', (
          SELECT COALESCE(json_agg(json_build_object(
            'id', a.id,
            'file_name', a.file_name,
            'storage_bucket', a.storage_bucket,
            'storage_path', a.storage_path,
            'mime_type', a.mime_type,
            'file_size', a.file_size
          ) ORDER BY a.created_at), '[]'::json)
          FROM public.form_attachments a
          WHERE a.form_type = 'form_submissions' AND a.form_id = s.id
        )
      ) ORDER BY s.created_at DESC), '[]'::json)
      FROM public.form_submissions s
      JOIN public.form_templates t ON t.id = s.template_id
      WHERE s.applicant_id = emp.id
        AND s.deleted_at IS NULL
      LIMIT 50
    ),
    'resignations', (
      SELECT COALESCE(json_agg(row_to_json(rr.*) ORDER BY rr.created_at DESC), '[]'::json)
      FROM public.resignation_requests rr
      WHERE rr.employee_id = emp.id
      LIMIT 50
    ),
    'loas', (
      SELECT COALESCE(json_agg(row_to_json(la.*) ORDER BY la.created_at DESC), '[]'::json)
      FROM public.leave_of_absence_requests la
      WHERE la.employee_id = emp.id
      LIMIT 50
    ),
    'transfers', (
      SELECT COALESCE(json_agg(row_to_json(pt.*) ORDER BY pt.created_at DESC), '[]'::json)
      FROM public.personnel_transfer_requests pt
      WHERE pt.employee_id = emp.id
      LIMIT 50
    ),
    'headcounts', (
      SELECT COALESCE(json_agg(row_to_json(hc.*) ORDER BY hc.created_at DESC), '[]'::json)
      FROM public.headcount_requests hc
      WHERE hc.employee_id = emp.id
        AND hc.deleted_at IS NULL
      LIMIT 50
    )
  );
END
$function$;

GRANT EXECUTE ON FUNCTION public.liff_get_request_chain(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_list_my_submissions(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
