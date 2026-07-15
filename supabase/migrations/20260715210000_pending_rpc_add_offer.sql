-- 簽核中心 pending RPC 加錄取(offer_letters)— 2026-07-15
-- web_list_my_pending_approval_ids 原 17 種表沒 offer_letters → 錄取永遠不進簽核中心。
-- 外科加一個 key(dump 後只插入,不整支重寫):走專屬 offer_approval_steps,當關簽核人=我才回。其餘不動。

CREATE OR REPLACE FUNCTION public.web_list_my_pending_approval_ids()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  emp employees;
  result json;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF emp.id IS NULL THEN RETURN json_build_object('error', 'EMPLOYEE_NOT_FOUND'); END IF;

  SELECT json_build_object(
    'leave_requests', (
      SELECT COALESCE(json_agg(l.id), '[]'::json)
      FROM public.leave_requests l
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = l.approval_chain_id AND cs.step_order = l.current_step
      WHERE l.organization_id = emp.organization_id AND l.status = '待審核'
        AND l.deleted_at IS NULL
        AND ((l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id))
          OR (l.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(l.employee_id)) AND COALESCE(l.employee_id, -1) <> emp.id))
    ),
    'overtime_requests', (
      SELECT COALESCE(json_agg(o.id), '[]'::json)
      FROM public.overtime_requests o
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = o.approval_chain_id AND cs.step_order = o.current_step
      WHERE o.organization_id = emp.organization_id AND o.status = '待審核'
        AND o.deleted_at IS NULL
        AND ((o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id))
          OR (o.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(o.employee_id)) AND COALESCE(o.employee_id, -1) <> emp.id))
    ),
    'business_trips', (
      SELECT COALESCE(json_agg(t.id), '[]'::json)
      FROM public.business_trips t
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = t.approval_chain_id AND cs.step_order = t.current_step
      LEFT JOIN LATERAL (SELECT id FROM employees WHERE name = t.employee AND organization_id = t.organization_id LIMIT 1) e_app ON true
      WHERE t.organization_id = emp.organization_id AND t.status = '待審核'
        AND t.deleted_at IS NULL
        AND ((t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (t.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(COALESCE(e_app.id, -1))) AND COALESCE(e_app.id, -1) <> emp.id))
    ),
    'clock_corrections', (
      SELECT COALESCE(json_agg(c.id), '[]'::json)
      FROM public.clock_corrections c
      JOIN public.employees e_app ON e_app.name = c.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = c.approval_chain_id AND cs.step_order = c.current_step
      WHERE c.status = '待審核'
        AND c.deleted_at IS NULL
        AND ((c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (c.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)) AND e_app.id <> emp.id))
    ),
    'expenses', (
      SELECT COALESCE(json_agg(ex.id), '[]'::json)
      FROM public.expenses ex
      JOIN public.employees e_app ON e_app.name = ex.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = ex.approval_chain_id AND cs.step_order = ex.current_step
      WHERE ex.status = '待審核'
        AND ((ex.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (ex.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)) AND e_app.id <> emp.id))
    ),
    'expense_requests', (
      SELECT COALESCE(json_agg(er.id), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = er.approval_chain_id AND cs.step_order = er.current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '申請中'
        AND er.deleted_at IS NULL
        AND er.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cs.id, er.employee_id)
    ),
    'expense_settles', (
      SELECT COALESCE(json_agg(er.id), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = er.settle_chain_id AND cs.step_order = er.settle_current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '待核銷'
        AND er.deleted_at IS NULL
        AND er.settle_chain_id IS NOT NULL AND cs.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cs.id, er.employee_id)
    ),
    'resignation_requests', (
      SELECT COALESCE(json_agg(r.id), '[]'::json)
      FROM public.resignation_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id)
    ),
    'leave_of_absence_requests', (
      SELECT COALESCE(json_agg(r.id), '[]'::json)
      FROM public.leave_of_absence_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id)
    ),
    'personnel_transfer_requests', (
      SELECT COALESCE(json_agg(r.id), '[]'::json)
      FROM public.personnel_transfer_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id)
    ),
    'headcount_requests', (
      SELECT COALESCE(json_agg(h.id), '[]'::json)
      FROM public.headcount_requests h
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = h.approval_chain_id AND cs.step_order = h.current_step
      WHERE h.organization_id = emp.organization_id AND h.status = '申請中'
        AND h.deleted_at IS NULL
        AND h.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cs.id, h.employee_id)
    ),

    -- 錄取(offer_letters):走專屬 offer_approval_steps,當關簽核人=我才回
    'offer_letters', (
      SELECT COALESCE(json_agg(o.id), '[]'::json)
      FROM public.offer_letters o
      JOIN public.offer_approval_steps s
        ON s.offer_id = o.id AND s.step_order = o.current_step AND s.status = '待審'
      WHERE o.organization_id = emp.organization_id
        AND o.status = '待審'
        AND s.approver_id = emp.id
    ),
    'form_submissions', (
      SELECT COALESCE(json_agg(s.id), '[]'::json)
      FROM public.form_submissions s
      JOIN public.form_templates t ON t.id = s.template_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = t.approval_chain_id AND cs.step_order = s.current_step
      WHERE s.organization_id = emp.organization_id AND s.status = '申請中'
        AND s.deleted_at IS NULL
        AND t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cs.id, s.applicant_id)
    ),
    'shift_swaps', (
      SELECT COALESCE(json_agg(ss.id), '[]'::json)
      FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id
        AND ss.deleted_at IS NULL
        AND ((ss.status = '待對方同意' AND ss.target_id = emp.id AND ss.requester_id <> emp.id)
          OR (ss.status = '待主管核准'
              AND ss.requester_id <> emp.id AND ss.target_id <> emp.id
              AND (EXISTS (SELECT 1 FROM stores WHERE id = ss.store_id AND manager_id = emp.id)
                   OR public.liff_employee_has_permission(emp.id, 'schedule.approve'))))
    ),
    'off_requests', (
      SELECT COALESCE(json_agg(orr.id), '[]'::json)
      FROM public.off_requests orr
      WHERE orr.organization_id = emp.organization_id
        AND orr.status = '待審核'
        AND COALESCE(orr.employee_id, -1) <> emp.id
        AND (
          EXISTS (
            SELECT 1 FROM public.stores s
            WHERE s.name = orr.store
              AND s.organization_id = emp.organization_id
              AND s.manager_id = emp.id
          )
          OR public.liff_employee_has_permission(emp.id, 'schedule.approve')
        )
    ),
    'task_confirmations', (
      SELECT COALESCE(json_agg(tc.id), '[]'::json)
      FROM public.task_confirmations tc
      JOIN public.tasks t ON t.id = tc.task_id
      WHERE t.organization_id = emp.organization_id
        AND tc.status = 'pending'
        AND tc.approver = emp.name
    ),
    -- ★ 新增：商品調撥申請 — snapshot-aware
    'goods_transfer_apply_requests', (
      SELECT COALESCE(json_agg(g.id), '[]'::json)
      FROM public.goods_transfer_requests g
      WHERE g.organization_id = emp.organization_id
        AND g.status = '申請審核中'
        AND g.deleted_at IS NULL
        AND g.current_chain_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.resolve_snapshot_step_approvers(
            'goods_transfer_apply', g.id, g.current_step, g.applicant_id
          ) a WHERE a.emp_id = emp.id
        )
    ),
    -- ★ 新增：商品調撥驗收
    'goods_transfer_receipt_requests', (
      SELECT COALESCE(json_agg(g.id), '[]'::json)
      FROM public.goods_transfer_requests g
      WHERE g.organization_id = emp.organization_id
        AND g.status = '驗收審核中'
        AND g.deleted_at IS NULL
        AND g.current_chain_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.resolve_snapshot_step_approvers(
            'goods_transfer_receipt', g.id, g.current_step, g.applicant_id
          ) a WHERE a.emp_id = emp.id
        )
    )
  ) INTO result;
  RETURN result;
END
$function$;

NOTIFY pgrst, 'reload schema';
