-- ============================================================
-- Hotfix：20260507400000 的 _resolve_task_chain_meta 用了
-- v_task.created_by，但 tasks 表沒有這欄位（PG 報 42703）。
-- 整個簽核 chain trigger 因此炸掉 → liff_complete_task_v2 回 400。
--
-- 對任務 chain 來說，「申請人」= 任務執行人 = v_task.assignee。
-- 直接拿掉 created_by 引用，改用 assignee。
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._resolve_task_chain_meta(p_task_id int)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_task        tasks;
  v_er          expense_requests;
  v_type_label  text;
  v_type_color  text;
  v_applicant   text;
  v_dept        text;
  v_store       text;
  v_app_line    text;
  v_amount      text;
  v_account     text;
  v_description text;
  v_signed      jsonb := '[]'::jsonb;
  v_pending     jsonb := '[]'::jsonb;
  v_total       int;
BEGIN
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF v_task.id IS NULL THEN RETURN '{}'::jsonb; END IF;

  -- 經費 chain：用 approval_chain_id 反查 expense_requests
  IF v_task.approval_chain_id IS NOT NULL THEN
    SELECT * INTO v_er FROM expense_requests er
     WHERE er.approval_chain_id = v_task.approval_chain_id
       AND (er.organization_id = v_task.organization_id
            OR er.organization_id IS NULL
            OR v_task.organization_id IS NULL)
     ORDER BY er.created_at DESC
     LIMIT 1;
  END IF;

  -- 類型 + 顏色
  IF v_er.id IS NOT NULL THEN
    v_type_label := '經費'; v_type_color := '#f97316';
  ELSIF COALESCE(v_task.category, '') ~* '(人事|hr|leave|請假|離職|異動|轉調)'
     OR COALESCE(v_task.bucket,   '') ~* '(人事|hr)' THEN
    v_type_label := '人事'; v_type_color := '#3b82f6';
  ELSIF COALESCE(v_task.category, '') ~* '(排班|班表|shift|調班|加班)'
     OR COALESCE(v_task.bucket,   '') ~* '(排班|shift)' THEN
    v_type_label := '排班'; v_type_color := '#a855f7';
  ELSE
    v_type_label := '一般'; v_type_color := '#6b7280';
  END IF;

  -- 申請人 / 部門 / 店別
  -- ★ 修：tasks 沒有 created_by 欄位（之前用了會 42703）；任務 chain 的「申請人」就是執行人 = assignee
  IF v_er.id IS NOT NULL THEN
    v_applicant := v_er.employee;
    v_dept      := v_er.department;
    v_store     := v_er.store;
  ELSE
    v_applicant := v_task.assignee;
    SELECT e.department INTO v_dept
      FROM employees e
     WHERE e.name = v_applicant
       AND (e.organization_id = v_task.organization_id OR v_task.organization_id IS NULL)
     LIMIT 1;
    v_store := v_task.store;
    IF (v_store IS NULL OR v_store = '') AND v_task.store_id IS NOT NULL THEN
      SELECT s.name INTO v_store FROM stores s WHERE s.id = v_task.store_id;
    END IF;
  END IF;

  v_app_line := array_to_string(
    ARRAY(
      SELECT x FROM unnest(ARRAY[v_applicant, v_dept, v_store]) AS x
       WHERE x IS NOT NULL AND btrim(x) <> ''
    ),
    ' · '
  );
  IF v_app_line = '' THEN v_app_line := NULL; END IF;

  -- 金額 + 會計科目（僅經費）
  IF v_er.id IS NOT NULL AND v_er.estimated_amount IS NOT NULL THEN
    v_amount := 'NT$ ' || to_char(v_er.estimated_amount, 'FM999,999,999');
  END IF;
  IF v_er.id IS NOT NULL THEN
    IF NULLIF(v_er.account_name,'') IS NOT NULL AND NULLIF(v_er.account_code,'') IS NOT NULL THEN
      v_account := v_er.account_name || ' (' || v_er.account_code || ')';
    ELSE
      v_account := COALESCE(NULLIF(v_er.account_name,''), NULLIF(v_er.account_code,''));
    END IF;
  END IF;

  -- 說明
  v_description := COALESCE(
    NULLIF(v_er.description, ''),
    NULLIF(v_task.description, ''),
    NULLIF(v_task.notes, '')
  );

  -- 簽核進度
  SELECT COUNT(*) INTO v_total
    FROM approval_chain_steps WHERE chain_id = v_task.approval_chain_id;

  IF v_total > 0 THEN
    SELECT COALESCE(json_agg(json_build_object(
        'step',   tc.step_order + 1,
        'name',   tc.approver,
        'status', tc.status,
        'time',   to_char(tc.responded_at AT TIME ZONE 'Asia/Taipei', 'MM/DD HH24:MI')
      ) ORDER BY tc.step_order, tc.id), '[]'::json)::jsonb INTO v_signed
      FROM task_confirmations tc
     WHERE tc.task_id = v_task.id
       AND tc.status IN ('approved','rejected');

    SELECT COALESCE(json_agg(json_build_object(
        'step', tc.step_order + 1,
        'name', tc.approver
      ) ORDER BY tc.step_order, tc.id), '[]'::json)::jsonb INTO v_pending
      FROM task_confirmations tc
     WHERE tc.task_id = v_task.id
       AND tc.status = 'pending';
  END IF;

  RETURN jsonb_build_object(
    'type_label',     v_type_label,
    'type_color',     v_type_color,
    'applicant_line', v_app_line,
    'amount',         v_amount,
    'account',        v_account,
    'description',    v_description,
    'signed',         v_signed,
    'pending',        v_pending,
    'total',          v_total
  );
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
