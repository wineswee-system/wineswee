-- ════════════════════════════════════════════════════════════════════════════
-- web_list_my_pending_approval_ids — 補 off_requests + task_confirmations
--
-- 之前漏掉這 2 種，導致 Dashboard ApprovalCenter 對應 sub-tab 永遠 canApprove=false
-- 加進來後跟 LIFF 對齊（LIFF 已支援 off_requests, task_confirmations 走獨立 RPC）
--
-- 對齊 web 既有 logic：
--   - off_requests: 走 HR 組織圖 _resolve_hr_approver_ids（同請假/加班 pattern）
--   - task_confirmations: 看 approver = emp.name + status='pending'
--   - 都加 self-exclude
--
-- 不動其他段（leave/overtime/...）
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.web_list_my_pending_approval_ids()
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  emp employees;
  result json;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT * INTO emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF emp.id IS NULL THEN
    RETURN json_build_object('error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT json_build_object(
    -- HR 5 表（chain-aware + HR fallback）
    'leave_requests', (
      SELECT COALESCE(json_agg(l.id), '[]'::json)
      FROM public.leave_requests l
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = l.approval_chain_id AND cs.step_order = l.current_step
      WHERE l.organization_id = emp.organization_id
        AND l.status = '待審核'
        AND COALESCE(l.employee_id, -1) <> emp.id
        AND (
          (l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id))
          OR (l.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(l.employee_id)))
        )
    ),
    'overtime_requests', (
      SELECT COALESCE(json_agg(o.id), '[]'::json)
      FROM public.overtime_requests o
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = o.approval_chain_id AND cs.step_order = o.current_step
      WHERE o.organization_id = emp.organization_id
        AND o.status = '待審核'
        AND COALESCE(o.employee_id, -1) <> emp.id
        AND (
          (o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id))
          OR (o.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(o.employee_id)))
        )
    ),
    'business_trips', (
      SELECT COALESCE(json_agg(t.id), '[]'::json)
      FROM public.business_trips t
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = t.approval_chain_id AND cs.step_order = t.current_step
      LEFT JOIN LATERAL (
        SELECT id FROM employees WHERE name = t.employee AND organization_id = t.organization_id LIMIT 1
      ) e_app ON true
      WHERE t.organization_id = emp.organization_id
        AND t.status = '待審核'
        AND COALESCE(e_app.id, -1) <> emp.id
        AND (
          (t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (t.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(COALESCE(e_app.id, -1))))
        )
    ),
    'clock_corrections', (
      SELECT COALESCE(json_agg(c.id), '[]'::json)
      FROM public.clock_corrections c
      JOIN public.employees e_app
        ON e_app.name = c.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = c.approval_chain_id AND cs.step_order = c.current_step
      WHERE c.status = '待審核'
        AND e_app.id <> emp.id
        AND (
          (c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (c.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)))
        )
    ),
    'expenses', (
      SELECT COALESCE(json_agg(ex.id), '[]'::json)
      FROM public.expenses ex
      JOIN public.employees e_app
        ON e_app.name = ex.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = ex.approval_chain_id AND cs.step_order = ex.current_step
      WHERE ex.status = '待審核'
        AND e_app.id <> emp.id
        AND (
          (ex.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (ex.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)))
        )
    ),
    'expense_requests', (
      SELECT COALESCE(json_agg(er.id), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chain_steps cur_step
        ON cur_step.chain_id = er.approval_chain_id AND cur_step.step_order = er.current_step
      WHERE er.organization_id = emp.organization_id
        AND er.status = '申請中'
        AND COALESCE(er.employee_id, -1) <> emp.id
        AND er.approval_chain_id IS NOT NULL
        AND cur_step.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id)
    ),
    'expense_settles', (
      SELECT COALESCE(json_agg(er.id), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chain_steps cur_step
        ON cur_step.chain_id = er.settle_chain_id AND cur_step.step_order = er.settle_current_step
      WHERE er.organization_id = emp.organization_id
        AND er.status = '待核銷'
        AND COALESCE(er.employee_id, -1) <> emp.id
        AND er.settle_chain_id IS NOT NULL
        AND cur_step.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id)
    ),
    'resignation_requests', (
      SELECT COALESCE(json_agg(r.id), '[]'::json)
      FROM public.resignation_requests r
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id
        AND r.status = '申請中'
        AND COALESCE(r.employee_id, -1) <> emp.id
        AND r.approval_chain_id IS NOT NULL
        AND cs.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id)
    ),
    'leave_of_absence_requests', (
      SELECT COALESCE(json_agg(r.id), '[]'::json)
      FROM public.leave_of_absence_requests r
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id
        AND r.status = '申請中'
        AND COALESCE(r.employee_id, -1) <> emp.id
        AND r.approval_chain_id IS NOT NULL
        AND cs.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id)
    ),
    'personnel_transfer_requests', (
      SELECT COALESCE(json_agg(r.id), '[]'::json)
      FROM public.personnel_transfer_requests r
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id
        AND r.status = '申請中'
        AND COALESCE(r.employee_id, -1) <> emp.id
        AND r.approval_chain_id IS NOT NULL
        AND cs.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id)
    ),
    'shift_swaps', (
      SELECT COALESCE(json_agg(ss.id), '[]'::json)
      FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id
        AND (
          (ss.status = '待對方同意' AND ss.target_id = emp.id AND ss.source_id <> emp.id)
          OR (ss.status = '待主管核准'
              AND (EXISTS (SELECT 1 FROM stores WHERE id = ss.store_id AND manager_id = emp.id)
                   OR public.liff_employee_has_permission(emp.id, 'schedule.approve'))
              AND ss.source_id <> emp.id AND ss.target_id <> emp.id)
        )
    ),

    -- ★ 新增（2026-05-17） ───────────────────────────────────────────
    'off_requests', (
      SELECT COALESCE(json_agg(ofr.id), '[]'::json)
      FROM public.off_requests ofr
      WHERE ofr.organization_id = emp.organization_id
        AND ofr.status = '待審核'
        AND ofr.employee <> emp.name  -- self-exclude（off_requests.employee 是 TEXT 姓名）
        AND emp.id IN (
          SELECT public._resolve_hr_approver_ids(
            (SELECT id FROM employees WHERE name = ofr.employee AND organization_id = ofr.organization_id LIMIT 1)
          )
        )
    ),
    'task_confirmations', (
      SELECT COALESCE(json_agg(tc.id), '[]'::json)
      FROM public.task_confirmations tc
      WHERE tc.approver = emp.name
        AND tc.status = 'pending'
    )
  ) INTO result;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.web_list_my_pending_approval_ids() TO authenticated;
NOTIFY pgrst, 'reload schema';
