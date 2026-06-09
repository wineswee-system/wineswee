-- ════════════════════════════════════════════════════════════════════════════
-- 商品調撥 — 加簽 guard + 重送 RPC + extra_signer trigger 擴充
--
-- 改了 3 件事：
--   1. _extra_step_allowed_tables() 加 'goods_transfer_requests'
--      → 讓 request_extra_signer() RPC 接受對商品調撥單發起加簽
--   2. _trg_extra_signer_inserted/_updated trigger 擴充
--      → 加簽 LINE 通知對接 _gt_post_notify（不另寫 flex，hr-notify 處理）
--   3. goods_transfer_approve() 開頭加 pending_extra_step guard
--      → 加簽人沒簽完前，原本當關不准 advance
--   4. 新增 goods_transfer_resubmit() + liff_resubmit_transfer_request()
--      → 已駁回 → 申請審核中（重置 chain + 重建 snapshot）
--
-- 對應 hr-notify 同步加 4 個新 event type：
--   goods_transfer_extra_assigned       — 通知加簽人
--   goods_transfer_extra_approved_back  — 加簽人簽完通知發起人
--   goods_transfer_extra_rejected_back  — 加簽人退回通知發起人
--   goods_transfer_extra_cancelled_info — 取消加簽通知加簽人
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 0. _gt_build_details 補 id（hr-notify 才能組 LIFF URL）──────────────
CREATE OR REPLACE FUNCTION public._gt_build_details(p_req_id INT, p_extras JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v RECORD;
  v_type_label TEXT;
  v_count INT;
BEGIN
  SELECT * INTO v FROM goods_transfer_requests WHERE id = p_req_id;
  IF v.id IS NULL THEN RETURN '{}'::jsonb; END IF;

  v_type_label := CASE v.transfer_type
    WHEN 'warehouse_to_store' THEN '總倉 → 門市'
    WHEN 'store_to_store'     THEN '門市 → 門市'
    WHEN 'store_to_warehouse' THEN '門市 → 總倉'
    ELSE v.transfer_type
  END;

  SELECT COUNT(*) INTO v_count FROM goods_transfer_items WHERE transfer_request_id = p_req_id;

  RETURN jsonb_build_object(
    'id',                  v.id,
    'document_no',         v.document_no,
    'applicant_name',      v.applicant_name,
    'transfer_type_label', v_type_label,
    'from_label',          v.from_label,
    'to_label',            v.to_label,
    'items_count',         v_count
  ) || p_extras;
END $$;

-- ─── 1. 擴白名單 ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._extra_step_allowed_tables()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    -- HR Forms (5)
    'leave_requests', 'overtime_requests', 'business_trips',
    'clock_corrections', 'expenses',
    -- HR Personnel Changes (3)
    'resignation_requests', 'personnel_transfer_requests', 'leave_of_absence_requests',
    -- Expense Applications
    'expense_requests',
    -- Task Chain Unified
    'tasks',
    -- 商品調撥
    'goods_transfer_requests'
  ]::text[]
$$;

-- ─── 2. INSERT trigger 擴 goods_transfer ────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_extra_signer_inserted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

  IF NEW.source_table = 'expense_requests' THEN
    PERFORM public._notify_extra_signer(NEW.id, NEW.assignee_id, 'extra_assigned');
  ELSIF NEW.source_table = 'goods_transfer_requests' THEN
    -- 商品調撥：透過 _gt_post_notify 走 hr-notify 統一渲染 flex
    PERFORM public._gt_post_notify(
      'goods_transfer_extra_assigned',
      NEW.assignee_id,
      public._gt_build_details(
        NEW.source_id,
        jsonb_build_object(
          'extra_step_id', NEW.id,
          'reason', COALESCE(NEW.reason, ''),
          'requested_by_name', (SELECT name FROM employees WHERE id = NEW.requested_by_id)
        )
      )
    );
  END IF;

  RETURN NEW;
END
$$;

-- ─── 3. UPDATE trigger 擴 goods_transfer ────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_extra_signer_updated()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_req_exp expense_requests;
  v_req_gt  goods_transfer_requests;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  -- expense_request 流程（保持既有邏輯）
  IF NEW.source_table = 'expense_requests' THEN
    IF OLD.status = 'pending' AND NEW.status = 'approved' THEN
      PERFORM public._notify_extra_signer(NEW.id, NEW.requested_by_id, 'extra_approved_back');
    ELSIF OLD.status = 'pending' AND NEW.status = 'rejected' THEN
      SELECT * INTO v_req_exp FROM expense_requests WHERE id = NEW.source_id;
      IF v_req_exp.id IS NOT NULL AND v_req_exp.status IN ('申請中', '待審') THEN
        UPDATE expense_requests
        SET status = '已駁回',
            reject_reason = '加簽人 ' || COALESCE(
              (SELECT name FROM employees WHERE id = NEW.assignee_id), '未知'
            ) || ' 退回：' || COALESCE(NEW.reject_reason, ''),
            approved_at = NOW()
        WHERE id = NEW.source_id;
      END IF;
      PERFORM public._notify_extra_signer(NEW.id, NEW.requested_by_id, 'extra_rejected_back');
    ELSIF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
      PERFORM public._notify_extra_signer(NEW.id, NEW.assignee_id, 'extra_cancelled_info');
    END IF;
    RETURN NEW;
  END IF;

  -- 商品調撥流程
  IF NEW.source_table = 'goods_transfer_requests' THEN
    IF OLD.status = 'pending' AND NEW.status = 'approved' THEN
      PERFORM public._gt_post_notify(
        'goods_transfer_extra_approved_back', NEW.requested_by_id,
        public._gt_build_details(
          NEW.source_id,
          jsonb_build_object(
            'assignee_name', (SELECT name FROM employees WHERE id = NEW.assignee_id)
          )
        )
      );
    ELSIF OLD.status = 'pending' AND NEW.status = 'rejected' THEN
      SELECT * INTO v_req_gt FROM goods_transfer_requests WHERE id = NEW.source_id;
      IF v_req_gt.id IS NOT NULL AND v_req_gt.status IN ('申請審核中', '驗收審核中') THEN
        UPDATE goods_transfer_requests
        SET status = '已駁回',
            reject_reason = '加簽人 ' || COALESCE(
              (SELECT name FROM employees WHERE id = NEW.assignee_id), '未知'
            ) || ' 退回：' || COALESCE(NEW.reject_reason, ''),
            rejected_at = NOW(),
            current_chain_id = NULL, current_step = 0, current_stage = NULL
        WHERE id = NEW.source_id;
      END IF;
      PERFORM public._gt_post_notify(
        'goods_transfer_extra_rejected_back', NEW.requested_by_id,
        public._gt_build_details(
          NEW.source_id,
          jsonb_build_object('rejection_reason', COALESCE(NEW.reject_reason, ''))
        )
      );
    ELSIF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
      PERFORM public._gt_post_notify(
        'goods_transfer_extra_cancelled_info', NEW.assignee_id,
        public._gt_build_details(NEW.source_id)
      );
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END
$$;


-- ─── 4. goods_transfer_approve 加加簽 guard ─────────────────────────────
-- 在最前面 SELECT * INTO v_record 之後、status check 之前插入 pending_extra check
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
  v_record       goods_transfer_requests;
  v_stage        TEXT;
  v_request_type TEXT;
  v_total_steps  INT;
  v_is_last      BOOLEAN;
  v_new_status   TEXT;
  v_extra        public.approval_extra_steps;
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

  -- ★ 加簽 guard：當前 step 若有 pending 加簽，禁止推進
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

  -- 寫 ash audit
  INSERT INTO approval_step_history (
    request_type, request_id, organization_id, chain_id, step_order,
    approver_id, action, exited_at, notes
  ) VALUES (
    v_request_type, p_id, v_record.organization_id, v_record.current_chain_id, v_record.current_step,
    p_approver_id, p_action, NOW(),
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


-- ─── 5. 重送 RPC ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.goods_transfer_resubmit(
  p_id INT,
  p_applicant_id INT
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_record goods_transfer_requests;
BEGIN
  SELECT * INTO v_record FROM goods_transfer_requests WHERE id = p_id;
  IF v_record.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_record.applicant_id <> p_applicant_id THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_APPLICANT');
  END IF;
  IF v_record.status <> '已駁回' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_REJECTED', 'current', v_record.status);
  END IF;
  IF v_record.apply_chain_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_APPLY_CHAIN');
  END IF;

  -- 重置 chain 回申請鏈
  UPDATE goods_transfer_requests SET
    status = '申請審核中',
    current_chain_id = apply_chain_id,
    current_stage = 'apply',
    current_step = 0,
    reject_reason = NULL,
    rejected_at = NULL
  WHERE id = p_id;

  -- 清舊 snapshot 重建（避免 chain 設定有改過）
  DELETE FROM request_chain_snapshots
   WHERE request_type IN ('goods_transfer_apply', 'goods_transfer_receipt')
     AND request_id = p_id;
  PERFORM public._snapshot_chain_for_request('goods_transfer_apply', p_id, v_record.apply_chain_id);

  RETURN json_build_object('ok', true, 'status', '申請審核中');
END $$;

GRANT EXECUTE ON FUNCTION public.goods_transfer_resubmit(INT, INT) TO authenticated, anon;


-- ─── 6. LIFF 重送 wrapper ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_resubmit_transfer_request(
  p_line_user_id text,
  p_id INT
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMP'); END IF;
  RETURN public.goods_transfer_resubmit(p_id, emp.id);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_resubmit_transfer_request(text, INT) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
