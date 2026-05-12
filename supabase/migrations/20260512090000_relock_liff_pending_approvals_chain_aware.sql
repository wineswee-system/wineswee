-- ════════════════════════════════════════════════════════════
-- 重鎖 liff_list_pending_approvals 為 chain-aware 版
-- 2026-05-12
--
-- 慘案：
--   Snow 收到 LINE「請假待簽核」通知，但點開 LIFF「待簽核中心」leaves 為空。
--   經查 #25/#26 是測試管理員申請（無組織圖主管），chain step #86
--   配置「指定員工 Snow (id=44)」。
--   _employee_matches_chain_step(44, 86, applicant_id) = TRUE ✓（chain 邏輯對）
--   _notify_hr_chain_step 推 LINE 也對 Snow 推送 ✓
--
-- 根因：
--   live DB 上的 liff_list_pending_approvals 還停在 20260508150000_fix_employee
--   _matches_chain_step.sql 的版本 — 那版 leaves/overtimes/trips/corrections/
--   expenses 段全部用：
--     emp.id IN (SELECT _resolve_hr_approver_ids(l.employee_id))
--   只看組織圖，完全不看 chain step。
--
--   後來的 20260508180000_hr_a_chain_aware.sql 已重寫成 chain-aware 版（有 chain
--   用 chain step、沒 chain fallback 組織圖），但 live DB 沒套用到（migration
--   被 skip 或執行順序問題，或 20260508150000 後續又有別的 patch 蓋掉）。
--
-- 修：
--   直接 CREATE OR REPLACE 強制覆蓋成 chain-aware 版本（從 20260508180000 取）。
--
-- 影響：
--   leaves / overtimes / trips / corrections / expenses 5 段都加上「chain 優先、
--   組織圖 fallback」雙路。expense_requests 維持只走 chain。
-- ════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.liff_list_pending_approvals(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  result json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object(
      'leaves','[]'::json,'overtimes','[]'::json,'trips','[]'::json,
      'expenses','[]'::json,'corrections','[]'::json,'expense_requests','[]'::json,
      'task_confirmations','[]'::json,
      'shift_swaps_for_peer','[]'::json,'shift_swaps_for_manager','[]'::json,
      'off_requests','[]'::json,
      'can', json_build_object('hr', false, 'finance', false)
    );
  END IF;

  SELECT json_build_object(
    'leaves', (
      SELECT COALESCE(json_agg(row_to_json(l.*) ORDER BY l.created_at DESC), '[]'::json)
      FROM public.leave_requests l
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = l.approval_chain_id AND cs.step_order = l.current_step
      WHERE l.organization_id = emp.organization_id
        AND l.status = '待審核'
        AND (
          (l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id))
          OR (l.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(l.employee_id)))
        )
    ),
    'overtimes', (
      SELECT COALESCE(json_agg(row_to_json(o.*) ORDER BY o.created_at DESC), '[]'::json)
      FROM public.overtime_requests o
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = o.approval_chain_id AND cs.step_order = o.current_step
      WHERE o.organization_id = emp.organization_id
        AND o.status = '待審核'
        AND (
          (o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id))
          OR (o.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(o.employee_id)))
        )
    ),
    'trips', (
      SELECT COALESCE(json_agg(row_to_json(t.*) ORDER BY t.created_at DESC), '[]'::json)
      FROM public.business_trips t
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = t.approval_chain_id AND cs.step_order = t.current_step
      LEFT JOIN LATERAL (
        SELECT id FROM employees WHERE name = t.employee AND organization_id = t.organization_id LIMIT 1
      ) e_app ON true
      WHERE t.organization_id = emp.organization_id
        AND t.status = '待審核'
        AND (
          (t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (t.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(COALESCE(e_app.id, -1))))
        )
    ),
    'corrections', (
      SELECT COALESCE(json_agg(row_to_json(c.*) ORDER BY c.created_at DESC), '[]'::json)
      FROM public.clock_corrections c
      JOIN public.employees e_app
        ON e_app.name = c.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = c.approval_chain_id AND cs.step_order = c.current_step
      WHERE c.status = '待審核'
        AND (
          (c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (c.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)))
        )
    ),
    'expenses', (
      SELECT COALESCE(json_agg(row_to_json(ex.*) ORDER BY ex.created_at DESC), '[]'::json)
      FROM public.expenses ex
      JOIN public.employees e_app
        ON e_app.name = ex.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs
        ON cs.chain_id = ex.approval_chain_id AND cs.step_order = ex.current_step
      WHERE ex.status = '待審核'
        AND (
          (ex.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (ex.approval_chain_id IS NULL
            AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)))
        )
    ),
    'expense_requests', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', er.id, 'employee', er.employee, 'department', er.department,
        'title', er.title, 'description', er.description,
        'estimated_amount', er.estimated_amount,
        'account_code', er.account_code, 'account_name', er.account_name,
        'store', er.store, 'status', er.status,
        'created_at', er.created_at,
        'reject_reason', er.reject_reason,
        'approval_chain_id', er.approval_chain_id,
        'current_step', er.current_step,
        'chain_name', ac.name,
        'chain_total_steps', (SELECT COUNT(*) FROM approval_chain_steps WHERE chain_id = er.approval_chain_id),
        'current_step_label', cur_step.label,
        'current_step_target', cur_step.role_name
      ) ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chains ac ON ac.id = er.approval_chain_id
      LEFT JOIN public.approval_chain_steps cur_step
        ON cur_step.chain_id = er.approval_chain_id AND cur_step.step_order = er.current_step
      WHERE er.organization_id = emp.organization_id
        AND er.status = '申請中'
        AND er.approval_chain_id IS NOT NULL
        AND cur_step.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id)
    ),
    'task_confirmations', '[]'::json,
    'shift_swaps_for_peer', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json)
      FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id AND ss.status = '待對方同意' AND ss.target_id = emp.id
    ),
    'shift_swaps_for_manager', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json)
      FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id AND ss.status = '待主管核准'
        AND (EXISTS (SELECT 1 FROM stores WHERE id = ss.store_id AND manager_id = emp.id)
             OR public.liff_employee_has_permission(emp.id, 'schedule.approve'))
    ),
    'off_requests', (
      SELECT COALESCE(json_agg(row_to_json(ofr.*) ORDER BY ofr.created_at DESC), '[]'::json)
      FROM public.off_requests ofr
      WHERE ofr.organization_id = emp.organization_id AND ofr.status = '待審核'
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(ofr.employee_id))
    ),
    'can', json_build_object(
      'hr', public.liff_employee_has_permission(emp.id, 'leave.approve'),
      'finance', public.liff_employee_has_permission(emp.id, 'finance.edit')
    )
  ) INTO result;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_pending_approvals(text) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
