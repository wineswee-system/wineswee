-- ════════════════════════════════════════════════════════════
-- 修正 _auto_apply_hr_form_chain：
-- 改用組織圖判斷部門主管（departments.manager_id / stores.manager_id），
-- 不再用 roles.name（角色設定不一定跟組織圖同步）
-- ════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._auto_apply_hr_form_chain()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_form_type      text;
  v_org_id         int;
  v_chain_id       int;
  v_applicant_id   int;
  v_is_manager     boolean := false;
  v_specific_type  text;
BEGIN
  IF NEW.approval_chain_id IS NOT NULL THEN RETURN NEW; END IF;

  v_form_type := CASE TG_TABLE_NAME
    WHEN 'leave_requests'      THEN 'leave'
    WHEN 'overtime_requests'   THEN 'overtime'
    WHEN 'business_trips'      THEN 'trip'
    WHEN 'clock_corrections'   THEN 'correction'
    WHEN 'expenses'            THEN 'expense'
    ELSE NULL
  END;
  IF v_form_type IS NULL THEN RETURN NEW; END IF;

  v_org_id := NEW.organization_id;

  -- 解申請人 employee_id
  IF TG_TABLE_NAME IN ('leave_requests', 'overtime_requests') THEN
    v_applicant_id := NEW.employee_id;
  ELSE
    SELECT id INTO v_applicant_id FROM public.employees
     WHERE name = NEW.employee
       AND (organization_id = v_org_id OR v_org_id IS NULL)
     LIMIT 1;
  END IF;

  -- 依組織圖判斷：此員工是否為某部門或門市的主管
  IF v_applicant_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.departments WHERE manager_id = v_applicant_id
      UNION ALL
      SELECT 1 FROM public.stores      WHERE manager_id = v_applicant_id
    ) INTO v_is_manager;
  END IF;

  v_specific_type := CASE WHEN v_is_manager THEN 'manager' ELSE 'staff' END;

  -- 先試 specific type，fallback 'all'
  SELECT chain_id INTO v_chain_id
    FROM public.form_chain_configs
   WHERE form_type      = v_form_type
     AND applicant_type = v_specific_type
     AND COALESCE(is_active, true) = true
     AND (organization_id = v_org_id OR organization_id IS NULL)
   ORDER BY (organization_id = v_org_id) DESC NULLS LAST
   LIMIT 1;

  IF v_chain_id IS NULL THEN
    SELECT chain_id INTO v_chain_id
      FROM public.form_chain_configs
     WHERE form_type      = v_form_type
       AND applicant_type = 'all'
       AND COALESCE(is_active, true) = true
       AND (organization_id = v_org_id OR organization_id IS NULL)
     ORDER BY (organization_id = v_org_id) DESC NULLS LAST
     LIMIT 1;
  END IF;

  IF v_chain_id IS NOT NULL THEN
    NEW.approval_chain_id := v_chain_id;
    NEW.current_step      := 0;
  END IF;

  RETURN NEW;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
