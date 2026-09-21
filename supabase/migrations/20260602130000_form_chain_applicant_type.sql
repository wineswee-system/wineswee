-- ════════════════════════════════════════════════════════════
-- form_chain_configs 加 applicant_type — 讓同一張表可以依申請人
-- 角色掛不同簽核鏈（部門主管 vs 一般員工）
--
-- 修改範圍：
--   1. form_chain_configs 加 applicant_type TEXT（'all'|'manager'|'staff'）
--   2. 舊 UNIQUE(form_type, organization_id) → UNIQUE(form_type, organization_id, applicant_type)
--   3. _auto_apply_hr_form_chain() 改為先試 'manager'/'staff' specific chain，
--      找不到再 fallback 'all'
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 加 applicant_type 欄位 ───
ALTER TABLE public.form_chain_configs
  ADD COLUMN IF NOT EXISTS applicant_type TEXT NOT NULL DEFAULT 'all';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.form_chain_configs'::regclass
       AND conname = 'chk_form_chain_applicant_type'
  ) THEN
    ALTER TABLE public.form_chain_configs
      ADD CONSTRAINT chk_form_chain_applicant_type
      CHECK (applicant_type IN ('all', 'manager', 'staff'));
  END IF;
END $$;

-- ─── 2. 換 UNIQUE constraint ───
-- 舊的 UNIQUE(form_type, organization_id)
ALTER TABLE public.form_chain_configs
  DROP CONSTRAINT IF EXISTS form_chain_configs_form_type_organization_id_key;

-- 相容另一個命名的 constraint（不同遷移版本可能有不同名）
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.form_chain_configs'::regclass
       AND contype = 'u'
  LOOP
    EXECUTE 'ALTER TABLE public.form_chain_configs DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
  END LOOP;
END $$;

-- 去除重複的 (form_type, organization_id, applicant_type)，保留 id 最大的
DELETE FROM public.form_chain_configs a
 USING public.form_chain_configs b
 WHERE a.form_type        = b.form_type
   AND a.organization_id IS NOT DISTINCT FROM b.organization_id
   AND a.applicant_type   = b.applicant_type
   AND a.id               < b.id;

ALTER TABLE public.form_chain_configs
  ADD CONSTRAINT uq_form_chain_org_type
  UNIQUE (form_type, organization_id, applicant_type);

DROP INDEX IF EXISTS public.idx_form_chain_configs_form;
CREATE INDEX IF NOT EXISTS idx_form_chain_configs_form
  ON public.form_chain_configs(form_type, organization_id, applicant_type);


-- ─── 3. 更新 _auto_apply_hr_form_chain：依申請人角色選 chain ───
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

  -- 解申請人 employee_id（leave/overtime 直接有欄位；其他靠 name 反查）
  IF TG_TABLE_NAME IN ('leave_requests', 'overtime_requests') THEN
    v_applicant_id := NEW.employee_id;
  ELSE
    SELECT id INTO v_applicant_id FROM public.employees
     WHERE name = NEW.employee
       AND (organization_id = v_org_id OR v_org_id IS NULL)
     LIMIT 1;
  END IF;

  -- 判斷是否為主管角色（manager / admin / super_admin）
  IF v_applicant_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.employees e
      JOIN public.roles r ON r.id = e.role_id
      WHERE e.id = v_applicant_id
        AND r.name IN ('manager', 'admin', 'super_admin')
    ) INTO v_is_manager;
  END IF;

  v_specific_type := CASE WHEN v_is_manager THEN 'manager' ELSE 'staff' END;

  -- 先試 specific type（精準 org 優先，NULL org 也接受）
  SELECT chain_id INTO v_chain_id
    FROM public.form_chain_configs
   WHERE form_type    = v_form_type
     AND applicant_type = v_specific_type
     AND COALESCE(is_active, true) = true
     AND (organization_id = v_org_id OR organization_id IS NULL)
   ORDER BY (organization_id = v_org_id) DESC NULLS LAST
   LIMIT 1;

  -- fallback to 'all'
  IF v_chain_id IS NULL THEN
    SELECT chain_id INTO v_chain_id
      FROM public.form_chain_configs
     WHERE form_type    = v_form_type
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
