-- ════════════════════════════════════════════════════════════════════════════
-- 叫貨申請單 任務綁定(Phase C):order_request / order_apply / order_settle
-- 2026-06-25
--
-- 鏡像費用的 expense_request/apply/settle，讓叫貨單也能塞進任務流程當步驟。
-- 叫貨單與費用單同一張 expense_requests 表(doc_type 區分),所以同步邏輯共用,
-- 只在 create_task_form_binding 加型別、_sync 加 order 家族(bootstrap 依 doc_type 選 settle 段)。
-- 完整重現原函式,只加 order 分支。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── create_task_form_binding:加 order_request/order_apply/order_settle ──
DROP FUNCTION IF EXISTS public.create_task_form_binding(INT, TEXT, INT);
CREATE OR REPLACE FUNCTION public.create_task_form_binding(
  p_task_id           INT,
  p_form_type         TEXT,
  p_form_template_id  INT  DEFAULT NULL,
  p_fill_mode         TEXT DEFAULT 'self',
  p_assignee_id       INT  DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_required_status TEXT;
  v_label           TEXT;
  v_id              INT;
  v_fill_mode       TEXT := CASE WHEN p_fill_mode = 'other' THEN 'other' ELSE 'self' END;
BEGIN
  IF p_form_type NOT IN (
    'expense_request', 'expense', 'form_submission', 'store_audit', 'goods_transfer',
    'expense_apply', 'expense_settle', 'goods_transfer_apply', 'goods_transfer_receipt',
    'order_request', 'order_apply', 'order_settle'
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_FORM_TYPE');
  END IF;

  v_required_status := CASE p_form_type
    WHEN 'expense_request' THEN '已核銷'
    WHEN 'expense'         THEN '已核銷'
    WHEN 'form_submission' THEN '已核准'
    WHEN 'store_audit'     THEN '已核准'
    WHEN 'goods_transfer'  THEN '已完成'
    WHEN 'expense_apply'          THEN '已核准'
    WHEN 'expense_settle'         THEN '已核銷'
    WHEN 'goods_transfer_apply'   THEN '待驗收'
    WHEN 'goods_transfer_receipt' THEN '已完成'
    WHEN 'order_request'  THEN '已核銷'
    WHEN 'order_apply'    THEN '已核准'
    WHEN 'order_settle'   THEN '已核銷'
  END;

  v_label := CASE p_form_type
    WHEN 'expense_request' THEN '申請費用'
    WHEN 'expense'         THEN '費用報銷'
    WHEN 'form_submission' THEN COALESCE(
      (SELECT name FROM form_templates WHERE id = p_form_template_id),
      '自訂表單'
    )
    WHEN 'store_audit'     THEN '門市稽核'
    WHEN 'goods_transfer'  THEN '商品調撥'
    WHEN 'expense_apply'          THEN '費用-申請'
    WHEN 'expense_settle'         THEN '費用-核銷(驗收)'
    WHEN 'goods_transfer_apply'   THEN '調撥-申請'
    WHEN 'goods_transfer_receipt' THEN '調撥-入庫驗收'
    WHEN 'order_request'  THEN '叫貨申請'
    WHEN 'order_apply'    THEN '叫貨-申請'
    WHEN 'order_settle'   THEN '叫貨-核銷(驗收)'
  END;

  SELECT id INTO v_id FROM task_form_bindings
   WHERE task_id = p_task_id
     AND form_type = p_form_type
     AND COALESCE(form_template_id, -1) = COALESCE(p_form_template_id, -1)
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN json_build_object('ok', true, 'binding_id', v_id, 'reused', true);
  END IF;

  INSERT INTO task_form_bindings (task_id, form_type, form_template_id, required_status, form_label, fill_mode, assignee_id)
  VALUES (p_task_id, p_form_type, p_form_template_id, v_required_status, v_label, v_fill_mode,
          CASE WHEN v_fill_mode = 'other' THEN p_assignee_id ELSE NULL END)
  RETURNING id INTO v_id;

  IF v_fill_mode = 'other' AND p_assignee_id IS NOT NULL THEN
    PERFORM public.assign_task_form_binding_filler(v_id, p_assignee_id);
  END IF;

  RETURN json_build_object('ok', true, 'binding_id', v_id, 'reused', false);
END $$;

GRANT EXECUTE ON FUNCTION public.create_task_form_binding(INT, TEXT, INT, TEXT, INT) TO authenticated, anon;

-- ── _sync_expense_request_bindings:加 order 家族(bootstrap 依 doc_type 選驗收段)──
CREATE OR REPLACE FUNCTION public._sync_expense_request_bindings(rec public.expense_requests)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b      task_form_bindings;
  v_new  TEXT;
  v_settle_type TEXT := CASE WHEN rec.doc_type = 'order' THEN 'order_settle' ELSE 'expense_settle' END;
BEGIN
  -- bootstrap：把同任務的「核銷(驗收)段」binding 認領到同一張單（form_id 回填）
  IF rec.linked_binding_id IS NOT NULL THEN
    UPDATE task_form_bindings sib
       SET form_id = rec.id
      FROM task_form_bindings cur
     WHERE cur.id = rec.linked_binding_id
       AND sib.task_id = cur.task_id
       AND sib.form_type = v_settle_type
       AND sib.form_id IS NULL;
  END IF;

  FOR b IN
    SELECT * FROM task_form_bindings
     WHERE id = rec.linked_binding_id
        OR (form_id = rec.id AND form_type IN (
             'expense_request','expense_apply','expense_settle',
             'order_request','order_apply','order_settle'))
  LOOP
    v_new := CASE b.form_type
      WHEN 'expense_apply' THEN CASE
        WHEN rec.status IN ('已核准','待核銷','已核銷') THEN '已完成'
        WHEN rec.status = '已駁回'                      THEN '已退回'
        WHEN rec.status = '申請中'                      THEN '簽核中'
        ELSE b.status END
      WHEN 'order_apply' THEN CASE
        WHEN rec.status IN ('已核准','待核銷','已核銷') THEN '已完成'
        WHEN rec.status = '已駁回'                      THEN '已退回'
        WHEN rec.status = '申請中'                      THEN '簽核中'
        ELSE b.status END
      WHEN 'expense_settle' THEN CASE
        WHEN rec.status = '已核銷'                       THEN '已完成'
        WHEN rec.status IN ('已駁回','核銷已退回')        THEN '已退回'
        WHEN rec.status IN ('申請中','已核准','待核銷')   THEN '簽核中'
        ELSE b.status END
      WHEN 'order_settle' THEN CASE
        WHEN rec.status = '已核銷'                       THEN '已完成'
        WHEN rec.status IN ('已駁回','核銷已退回')        THEN '已退回'
        WHEN rec.status IN ('申請中','已核准','待核銷')   THEN '簽核中'
        ELSE b.status END
      -- 整單型別(expense_request / order_request)：已核銷才完成
      ELSE CASE
        WHEN rec.status = '已核銷'                       THEN '已完成'
        WHEN rec.status IN ('已駁回','核銷已退回')        THEN '已退回'
        WHEN rec.status IN ('申請中','待核銷','已核准')   THEN '簽核中'
        ELSE b.status END
    END;

    UPDATE task_form_bindings SET
      form_id      = rec.id,
      status       = v_new,
      completed_at = CASE WHEN v_new = '已完成' THEN NOW() ELSE NULL END
     WHERE id = b.id AND status IS DISTINCT FROM v_new;

    IF v_new = '已完成' THEN PERFORM public._check_task_bindings_complete(b.task_id); END IF;
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
