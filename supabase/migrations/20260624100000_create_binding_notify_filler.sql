-- ════════════════════════════════════════════════════════════════════════════
-- create_task_form_binding：建立綁定時若指定「他人填」(other+assignee)，
-- 直接推 LINE 通知被指派人（沿用 assign_task_form_binding_filler）。
-- 2026-06-24
--
-- 為什麼：使用者要在「新增任務」當下就指定誰填 + 立即通知。
-- 各建任務路徑(Tasks/Projects/Workflows/DeployWizard…) 都呼叫此 RPC，
-- 把通知放在 RPC 內 → 所有路徑自動生效，不必每處各補一次。
-- 純加法、idempotent。self 模式行為不變。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

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
    'expense_apply', 'expense_settle', 'goods_transfer_apply', 'goods_transfer_receipt'
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
  END;

  -- 同 task 同 type+template 不重複建
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

  -- 他人填 + 有指定人 → 立即推 LINE 通知被指派人（沿用既有 RPC，內含 v_employee_line_resolved 預檢）
  IF v_fill_mode = 'other' AND p_assignee_id IS NOT NULL THEN
    PERFORM public.assign_task_form_binding_filler(v_id, p_assignee_id);
  END IF;

  RETURN json_build_object('ok', true, 'binding_id', v_id, 'reused', false);
END $$;

GRANT EXECUTE ON FUNCTION public.create_task_form_binding(INT, TEXT, INT, TEXT, INT) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
