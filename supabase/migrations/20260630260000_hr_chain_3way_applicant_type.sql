-- ════════════════════════════════════════════════════════════════════════════
-- HR 表單簽核：三路分流 store_staff / admin_staff / dept_manager
--
-- 問題：原本只有 manager / staff / all，門市人員爬 supervisor_id 鏈
--       遇到「店長兼課長」會跳層或重複。
--
-- 新分類（只影響 HR A-type trigger）：
--   manager     → departments.manager_id = 申請人  OR  stores.manager_id = 申請人
--                 （對應 UI「部門主管」tab，沿用現有 key）
--   store_staff → employee.store_id IS NOT NULL（且非主管）（新 key）
--   staff       → 其他（行政/總部員工）（沿用現有 key）
--
-- fallback 順序：specific_type → 'all'
-- （若未設 specific type 的 chain，就沿用現有 'all' chain）
--
-- 注意：此 migration 只改 trigger function，
--       你還需要在 UI 建三條 chain 並在 form_chain_configs 設定。
-- ════════════════════════════════════════════════════════════════════════════

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
  v_applicant_store  INTEGER;
  v_specific_type    TEXT;
  v_chain_id         INTEGER;
  v_snap_id          INTEGER;
BEGIN
  v_form_type    := TG_ARGV[0];
  v_org_id       := NEW.organization_id;
  IF v_org_id IS NULL THEN RETURN NEW; END IF;

  v_applicant_id := NEW.employee_id;
  IF NEW.approval_chain_id IS NOT NULL THEN RETURN NEW; END IF;

  -- ── 三路分類 ──────────────────────────────────────────────────────────
  IF v_applicant_id IS NOT NULL THEN
    -- 取申請人 store_id
    SELECT store_id INTO v_applicant_store
      FROM public.employees WHERE id = v_applicant_id;

    IF
      -- 是部門主管（departments 層級）
      EXISTS (
        SELECT 1 FROM public.departments
         WHERE manager_id = v_applicant_id
           AND organization_id = v_org_id
      )
      OR
      -- 是門市店長 / 資深店長（管理某門市的人也走主管鏈）
      EXISTS (
        SELECT 1 FROM public.stores
         WHERE manager_id = v_applicant_id
           AND organization_id = v_org_id
      )
    THEN
      v_specific_type := 'manager';      -- 對應 UI「部門主管」tab

    ELSIF v_applicant_store IS NOT NULL THEN
      v_specific_type := 'store_staff';  -- 新增「門市人員」tab

    ELSE
      v_specific_type := 'staff';        -- 對應 UI「行政人員」tab
    END IF;
  ELSE
    v_specific_type := 'staff';
  END IF;

  -- ── 查 chain（specific → fallback 'all'）────────────────────────────
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

  -- ── 建快照 ────────────────────────────────────────────────────────────
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
    NULL;
  END;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
