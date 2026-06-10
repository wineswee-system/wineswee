-- ════════════════════════════════════════════════════════════════════════════
-- 商品調撥 Phase A — 補齊審計 / 顯示 / Dashboard 三件事
--
-- 對應 2026-06-09 audit 發現的 5 個 gap 裡的 3 個（後端能 fix 的）：
--   1. goods_transfer_approve 寫 ash 時補 entered_at / step_label / approver_name
--      → PDF 簽呈 / Timeline 停留時間 / 關卡名稱才會對
--   2. employees.name UPDATE → goods_transfer_requests.applicant_name 跟著動
--      （TEXT denorm sync trigger，員工改名後舊單顯示新名）
--   3. web_list_my_pending_approval_ids 加 goods_transfer_apply_requests +
--      goods_transfer_receipt_requests 兩個 key → 主系統 Dashboard 簽核中心
--      看得到商品調撥待簽
--
-- 對應 memory：
--   feedback_new_form_full_checklist — 新表單 7 連發鐵則
--   feedback_minimize_touching_existing — 改既有 function 只加分支不重寫
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. goods_transfer_approve：補 entered_at + step_label + approver_name ─
CREATE OR REPLACE FUNCTION public.goods_transfer_approve(
  p_id          INT,
  p_approver_id INT,
  p_action      TEXT,
  p_reason      TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_record         goods_transfer_requests;
  v_stage          TEXT;
  v_request_type   TEXT;
  v_total_steps    INT;
  v_is_last        BOOLEAN;
  v_new_status     TEXT;
  v_extra          public.approval_extra_steps;
  v_entered_at     TIMESTAMPTZ;
  v_step_label     TEXT;
  v_approver_name  TEXT;
BEGIN
  SELECT * INTO v_record FROM goods_transfer_requests WHERE id = p_id;

  IF v_record.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_record.status NOT IN ('申請審核中', '驗收審核中') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_STATUS', 'current', v_record.status);
  END IF;
  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  -- 加簽 guard
  v_extra := public.get_pending_extra_step(
    'goods_transfer_requests', p_id, COALESCE(v_record.current_step, 0)
  );
  IF v_extra.id IS NOT NULL THEN
    RETURN json_build_object(
      'ok', false,
      'error', 'PENDING_EXTRA_SIGNER',
      'extra_step_id', v_extra.id,
      'extra_assignee_id', v_extra.assignee_id,
      'message', '此單據有加簽請求進行中，請等加簽人完成後再簽核'
    );
  END IF;

  v_stage := v_record.current_stage;
  v_request_type := CASE v_stage WHEN 'apply' THEN 'goods_transfer_apply' ELSE 'goods_transfer_receipt' END;

  -- ★ NEW：lookup step_label（從 snapshot）
  SELECT label INTO v_step_label
    FROM request_chain_snapshots
   WHERE request_type = v_request_type
     AND request_id   = p_id
     AND step_order   = v_record.current_step;

  -- ★ NEW：lookup approver_name
  SELECT name INTO v_approver_name FROM employees WHERE id = p_approver_id;

  -- ★ NEW：lookup entered_at — 前一步的 exited_at；step 0 用 stage 起始時間
  SELECT exited_at INTO v_entered_at
    FROM approval_step_history
   WHERE request_type = v_request_type
     AND request_id   = p_id
     AND step_order   = v_record.current_step - 1
   ORDER BY exited_at DESC NULLS LAST
   LIMIT 1;
  IF v_entered_at IS NULL THEN
    v_entered_at := CASE v_stage
      WHEN 'apply'   THEN v_record.created_at
      ELSE COALESCE(v_record.receipt_submitted_at, v_record.created_at)
    END;
  END IF;

  -- ash audit（補齊所有欄位）
  INSERT INTO approval_step_history (
    request_type, request_id, organization_id, chain_id, step_order,
    step_label, approver_id, approver_name, action,
    entered_at, exited_at, notes
  ) VALUES (
    v_request_type, p_id, v_record.organization_id, v_record.current_chain_id, v_record.current_step,
    v_step_label, p_approver_id, v_approver_name,
    CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
    v_entered_at, NOW(),
    CASE WHEN p_action = 'reject' THEN btrim(p_reason) ELSE NULL END
  );

  -- 駁回
  IF p_action = 'reject' THEN
    UPDATE goods_transfer_requests SET
      status = '已駁回',
      reject_reason = btrim(p_reason),
      rejected_at = NOW(),
      current_chain_id = NULL,
      current_step = 0,
      current_stage = NULL
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'action', 'rejected');
  END IF;

  -- 核准：是否為最後一關？
  SELECT COUNT(*) INTO v_total_steps
    FROM approval_chain_steps
   WHERE chain_id = v_record.current_chain_id;
  v_is_last := (v_record.current_step + 1 >= v_total_steps);

  IF v_is_last THEN
    IF v_stage = 'apply' THEN
      v_new_status := '待驗收';
      UPDATE goods_transfer_requests SET
        status = v_new_status,
        apply_approver_id = p_approver_id,
        apply_approved_at = NOW(),
        current_chain_id = NULL, current_step = 0, current_stage = NULL
      WHERE id = p_id;
    ELSE
      v_new_status := '已完成';
      UPDATE goods_transfer_requests SET
        status = v_new_status,
        receipt_approver_id = p_approver_id,
        receipt_approved_at = NOW(),
        current_chain_id = NULL, current_step = 0, current_stage = NULL
      WHERE id = p_id;
    END IF;
    RETURN json_build_object('ok', true, 'action', 'approved_final', 'new_status', v_new_status);
  ELSE
    UPDATE goods_transfer_requests SET current_step = current_step + 1 WHERE id = p_id;
    RETURN json_build_object('ok', true, 'action', 'advanced', 'next_step', v_record.current_step + 1);
  END IF;
END $$;


-- ─── 2. applicant_name sync trigger ─────────────────────────────────────
-- employees.name UPDATE → goods_transfer_requests.applicant_name 跟著動
CREATE OR REPLACE FUNCTION public._sync_goods_transfer_applicant_name()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.goods_transfer_requests
       SET applicant_name = NEW.name
     WHERE applicant_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_goods_transfer_applicant_name ON public.employees;
CREATE TRIGGER trg_sync_goods_transfer_applicant_name
  AFTER UPDATE OF name ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public._sync_goods_transfer_applicant_name();


-- ─── 3. web_list_my_pending_approval_ids 加 goods_transfer 兩 key ────────
-- 保留所有既有 keys，只在尾巴加 goods_transfer_apply_requests / receipt
-- 用 snapshot-aware resolve_snapshot_step_approvers 判斷我是不是當關 approver
CREATE OR REPLACE FUNCTION public.web_list_my_pending_approval_ids()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

COMMENT ON FUNCTION public.web_list_my_pending_approval_ids IS
  '主系統簽核中心待簽核 ID list — 含 8 HR 表單 + shift_swaps + off_requests + task_confirmations + 商品調撥(申請+驗收)';

COMMIT;

NOTIFY pgrst, 'reload schema';
