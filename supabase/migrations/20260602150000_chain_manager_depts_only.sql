-- 部門主管判斷只看 departments.manager_id，門市店長算一般員工
-- 同時清除 departments 兩筆錯誤的 manager_id 資料

-- 1. 清除資料：外部接案(Snow)、財務部(游如梅) 不是部門主管
UPDATE public.departments SET manager_id = NULL
WHERE id IN (10, 25);  -- 10=外部接案, 25=財務部

-- 2. 修正 _auto_apply_hr_form_chain trigger function（移除 stores 檢查）
CREATE OR REPLACE FUNCTION public._auto_apply_hr_form_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_form_type        TEXT;
  v_org_id           INTEGER;
  v_applicant_id     INTEGER;
  v_is_manager       BOOLEAN := FALSE;
  v_specific_type    TEXT;
  v_chain_id         INTEGER;
  v_snap_id          INTEGER;
BEGIN
  -- 解 form_type
  v_form_type := TG_ARGV[0];

  -- 取 organization_id
  v_org_id := NEW.organization_id;
  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 取申請人 employee_id（跳過已設過的）
  v_applicant_id := NEW.employee_id;
  IF NEW.approval_chain_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 判斷申請人是否為部門主管（只看 departments，門市店長算一般員工）
  IF v_applicant_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.departments
      WHERE manager_id = v_applicant_id
        AND organization_id = v_org_id
    ) INTO v_is_manager;
  END IF;

  v_specific_type := CASE WHEN v_is_manager THEN 'manager' ELSE 'staff' END;

  -- 先找 specific type，fallback 'all'
  SELECT chain_id INTO v_chain_id
  FROM public.form_chain_configs
  WHERE form_type       = v_form_type
    AND organization_id = v_org_id
    AND is_active       = TRUE
    AND applicant_type  = v_specific_type
  LIMIT 1;

  IF v_chain_id IS NULL THEN
    SELECT chain_id INTO v_chain_id
    FROM public.form_chain_configs
    WHERE form_type       = v_form_type
      AND organization_id = v_org_id
      AND is_active       = TRUE
      AND applicant_type  = 'all'
    LIMIT 1;
  END IF;

  IF v_chain_id IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.approval_chain_id := v_chain_id;

  -- 建快照
  BEGIN
    SELECT id INTO v_snap_id
    FROM public.request_chain_snapshots
    WHERE request_type = v_form_type
      AND request_id   = NEW.id
    LIMIT 1;

    IF v_snap_id IS NULL THEN
      INSERT INTO public.request_chain_snapshots
        (request_type, request_id, chain_id, snapshotted_at)
      VALUES
        (v_form_type, NEW.id, v_chain_id, NOW())
      ON CONFLICT (request_type, request_id) DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- 快照失敗不阻擋主流程
    NULL;
  END;

  RETURN NEW;
END;
$$;
