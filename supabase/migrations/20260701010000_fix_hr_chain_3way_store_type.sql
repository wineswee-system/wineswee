-- ════════════════════════════════════════════════════════════════════════════
-- 修正 HR 三路分流
--
-- 問題 1：威耀總部/台中總倉 store_type='retail' → HQ 員工被分到門市人員
-- 問題 2：店長（stores.manager_id）被分到部門主管，應為門市人員
-- 問題 3：督導（黃蘊珊等）store_id=20(hq) → 應為行政人員
--
-- 分類規則（修正後）：
--   部門主管 → 只有 departments.manager_id（HQ部門主管/課長/課督）
--   門市人員 → store_type='retail'（含店長/資深店長/一般門市員工）
--   行政人員 → 其他（store 為 null / hq / warehouse）
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. 修正 store_type ─────────────────────────────────────────────────────
UPDATE public.stores SET store_type = 'hq'        WHERE id = 20; -- 威耀總部
UPDATE public.stores SET store_type = 'warehouse'  WHERE id = 36; -- 台中總倉

-- ── 2. 更新 trigger function：用 store_type='retail' 判斷門市人員 ───────────
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
  v_store_type       TEXT;
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
    -- 取申請人 store_id 及 store_type
    SELECT e.store_id, s.store_type
      INTO v_applicant_store, v_store_type
      FROM public.employees e
      LEFT JOIN public.stores s ON s.id = e.store_id
     WHERE e.id = v_applicant_id;

    IF
      -- 只有 departments.manager_id 才是部門主管（課長/課督/HQ部門主管）
      -- 店長/資深店長/督導不走這條（改走 store_type 分流）
      EXISTS (
        SELECT 1 FROM public.departments
         WHERE manager_id     = v_applicant_id
           AND organization_id = v_org_id
      )
    THEN
      v_specific_type := 'manager';

    ELSIF v_applicant_store IS NOT NULL AND v_store_type = 'retail' THEN
      -- 有門市且是真正零售門市 → 門市人員
      v_specific_type := 'store_staff';

    ELSE
      -- store 為 null / hq / warehouse → 行政人員
      v_specific_type := 'staff';
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
