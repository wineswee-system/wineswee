-- ════════════════════════════════════════════════════════════════════════════
-- 商品調撥 — Workflow triggers + RPCs
--
-- Triggers:
--   BEFORE INSERT：依 transfer_type 自動 resolve apply_chain_id + receipt_chain_id
--   AFTER  INSERT：build snapshot for apply phase（goods_transfer_apply）
--
-- RPCs:
--   goods_transfer_approve(id, approver_id, action, reason) — 簽核（approve/reject）
--   goods_transfer_submit_receipt(id, items[], attachments) — 員工填實收送驗收
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. BEFORE INSERT trigger：resolve chains ────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_goods_transfer_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_apply_chain_name TEXT;
  v_apply_chain_id   INT;
  v_recv_chain_id    INT;
BEGIN
  IF NEW.transfer_type IN ('warehouse_to_store', 'store_to_warehouse') THEN
    v_apply_chain_name := '商品調撥-申請-倉↔門市';
  ELSE
    v_apply_chain_name := '商品調撥-申請-門市↔門市';
  END IF;

  SELECT id INTO v_apply_chain_id
    FROM approval_chains
   WHERE organization_id = NEW.organization_id AND name = v_apply_chain_name;

  SELECT id INTO v_recv_chain_id
    FROM approval_chains
   WHERE organization_id = NEW.organization_id AND name = '商品調撥-驗收';

  NEW.apply_chain_id    := v_apply_chain_id;
  NEW.receipt_chain_id  := v_recv_chain_id;
  NEW.current_chain_id  := v_apply_chain_id;
  NEW.current_stage     := 'apply';
  NEW.current_step      := 0;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_goods_transfer_resolve_chains ON public.goods_transfer_requests;
CREATE TRIGGER trg_goods_transfer_resolve_chains
  BEFORE INSERT ON public.goods_transfer_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_goods_transfer_before_insert();


-- ─── 2. AFTER INSERT trigger：build snapshot ─────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_goods_transfer_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.apply_chain_id IS NOT NULL THEN
    PERFORM public._snapshot_chain_for_request('goods_transfer_apply', NEW.id, NEW.apply_chain_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_goods_transfer_build_snapshot ON public.goods_transfer_requests;
CREATE TRIGGER trg_goods_transfer_build_snapshot
  AFTER INSERT ON public.goods_transfer_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_goods_transfer_after_insert();


-- ─── 3. 簽核 RPC ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.goods_transfer_approve(
  p_id          INT,
  p_approver_id INT,
  p_action      TEXT,
  p_reason      TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record      goods_transfer_requests;
  v_stage       TEXT;
  v_request_type TEXT;
  v_total_steps INT;
  v_is_last     BOOLEAN;
  v_new_status  TEXT;
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

  -- 駁回：reset chain，狀態歸 '已駁回'
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
    ELSE  -- receipt stage
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
    -- 推進下一關
    UPDATE goods_transfer_requests SET current_step = current_step + 1 WHERE id = p_id;
    RETURN json_build_object('ok', true, 'action', 'advanced', 'next_step', v_record.current_step + 1);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.goods_transfer_approve(INT, INT, TEXT, TEXT) TO authenticated, anon;


-- ─── 4. 員工送驗收 RPC ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.goods_transfer_submit_receipt(
  p_id          INT,
  p_items       JSONB,   -- [{ id: line_id, received_qty: N }, ...]
  p_attachments JSONB DEFAULT '[]'::jsonb
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record goods_transfer_requests;
  v_item   JSONB;
BEGIN
  SELECT * INTO v_record FROM goods_transfer_requests WHERE id = p_id;

  IF v_record.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_record.status <> '待驗收' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_PENDING_RECEIPT', 'current', v_record.status);
  END IF;
  IF v_record.receipt_chain_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_RECEIPT_CHAIN');
  END IF;

  -- 更新實收數量
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    UPDATE goods_transfer_items
       SET received_qty = NULLIF(v_item->>'received_qty', '')::NUMERIC
     WHERE id = (v_item->>'id')::INT
       AND transfer_request_id = p_id;
  END LOOP;

  -- 切換狀態 + 重置 chain 到驗收鏈
  UPDATE goods_transfer_requests SET
    status = '驗收審核中',
    current_chain_id = receipt_chain_id,
    current_stage = 'receipt',
    current_step = 0,
    receipt_submitted_at = NOW(),
    receipt_attachments = p_attachments
  WHERE id = p_id;

  -- Build snapshot for receipt phase
  PERFORM public._snapshot_chain_for_request('goods_transfer_receipt', p_id, v_record.receipt_chain_id);

  RETURN json_build_object('ok', true, 'status', '驗收審核中');
END $$;

GRANT EXECUTE ON FUNCTION public.goods_transfer_submit_receipt(INT, JSONB, JSONB) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
