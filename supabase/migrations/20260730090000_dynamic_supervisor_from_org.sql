-- 直屬主管改「浮動式」:依組織圖自動推導 + 換人自動同步 — 2026-07-30
-- ════════════════════════════════════════════════════════════════════════════
-- 需求:員工直屬主管(supervisor_id)不再手設,改由組織位置自動推導;換店長/督導/經理
--   或員工調店時自動更新。簽核鏈(applicant_supervisor 讀 supervisor_id)不用改;在飛的單
--   有凍結快照不受影響,只有新單用新主管。
-- 推導階梯(角色優先,乾跑驗證 79/83 一致、4 筆為修正/補上):
--   1. 督導(某課 supervisor)→ 該課部門經理
--   2. 部門經理(某 dept manager)→ 執行長(執行長→董事長)
--   3. 真門市(store 有掛課 section_id)的店員→店長→督導→部門經理
--   4. 總部/其他 → 自己部門經理
--   5. 頂 → 執行長(董事長=頂,無主管)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._emp_derived_supervisor(
  p_emp_id int, p_store_id int, p_department_id int, p_position text, p_org int
) RETURNS int
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ceo int; v_chair int;
  v_sec public.department_sections;
  v_dept public.departments;
  v_store public.stores;
BEGIN
  IF p_position = '董事長' THEN RETURN NULL; END IF;   -- 頂,無主管
  SELECT id INTO v_ceo   FROM public.employees WHERE organization_id=p_org AND position='執行長' AND status='在職' LIMIT 1;
  SELECT id INTO v_chair FROM public.employees WHERE organization_id=p_org AND position='董事長' AND status='在職' LIMIT 1;

  -- 1. 督導(是某課的 supervisor)→ 該課所屬部門的經理
  SELECT * INTO v_sec FROM public.department_sections
   WHERE supervisor_id=p_emp_id AND organization_id=p_org LIMIT 1;
  IF v_sec.id IS NOT NULL THEN
    SELECT * INTO v_dept FROM public.departments WHERE id=v_sec.department_id;
    IF v_dept.manager_id IS NOT NULL AND v_dept.manager_id IS DISTINCT FROM p_emp_id THEN RETURN v_dept.manager_id; END IF;
    RETURN CASE WHEN p_emp_id IS DISTINCT FROM v_ceo THEN v_ceo ELSE v_chair END;
  END IF;

  -- 2. 部門經理(是某 dept 的 manager)→ 執行長(執行長本人→董事長)
  IF EXISTS (SELECT 1 FROM public.departments WHERE manager_id=p_emp_id AND organization_id=p_org) THEN
    RETURN CASE WHEN p_emp_id IS DISTINCT FROM v_ceo THEN v_ceo ELSE v_chair END;
  END IF;

  -- 3. 真門市(store 掛在課下)→ 店員→店長→督導→部門經理
  SELECT * INTO v_store FROM public.stores WHERE id=p_store_id;
  IF v_store.id IS NOT NULL AND v_store.section_id IS NOT NULL THEN
    IF v_store.manager_id IS NOT NULL AND v_store.manager_id IS DISTINCT FROM p_emp_id THEN RETURN v_store.manager_id; END IF;
    SELECT * INTO v_sec FROM public.department_sections WHERE id=v_store.section_id;
    IF v_sec.supervisor_id IS NOT NULL AND v_sec.supervisor_id IS DISTINCT FROM p_emp_id THEN RETURN v_sec.supervisor_id; END IF;
    SELECT * INTO v_dept FROM public.departments WHERE id=p_department_id;
    IF v_dept.manager_id IS NOT NULL AND v_dept.manager_id IS DISTINCT FROM p_emp_id THEN RETURN v_dept.manager_id; END IF;
    RETURN v_ceo;
  END IF;

  -- 4. 總部/其他 → 自己部門經理
  SELECT * INTO v_dept FROM public.departments WHERE id=p_department_id;
  IF v_dept.manager_id IS NOT NULL AND v_dept.manager_id IS DISTINCT FROM p_emp_id THEN RETURN v_dept.manager_id; END IF;

  -- 5. 頂
  RETURN CASE WHEN p_emp_id IS DISTINCT FROM v_ceo THEN v_ceo ELSE v_chair END;
END $function$;

-- 整組織重算(組織結構一變就全部重推;83 人成本極低,不用算「受影響誰」)
CREATE OR REPLACE FUNCTION public._recompute_org_supervisors(p_org int)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.employees e
     SET supervisor_id = public._emp_derived_supervisor(e.id, e.store_id, e.department_id, e.position, e.organization_id)
   WHERE e.organization_id = p_org;
END $function$;

-- ── 員工自身異動(調店/換部門/職稱)→ 自動重推自己的主管 ──
CREATE OR REPLACE FUNCTION public._trg_emp_derive_supervisor()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  NEW.supervisor_id := public._emp_derived_supervisor(NEW.id, NEW.store_id, NEW.department_id, NEW.position, NEW.organization_id);
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_emp_derive_supervisor ON public.employees;
CREATE TRIGGER trg_emp_derive_supervisor
  BEFORE INSERT OR UPDATE OF store_id, department_id, position ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public._trg_emp_derive_supervisor();

-- ── 組織結構異動(換店長/督導/經理/門市掛課)→ 全 org 重推 ──
CREATE OR REPLACE FUNCTION public._trg_org_recompute_supervisors()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._recompute_org_supervisors(COALESCE(NEW.organization_id, OLD.organization_id));
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_stores_recompute_sup ON public.stores;
CREATE TRIGGER trg_stores_recompute_sup
  AFTER UPDATE OF manager_id, section_id ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public._trg_org_recompute_supervisors();

DROP TRIGGER IF EXISTS trg_sections_recompute_sup ON public.department_sections;
CREATE TRIGGER trg_sections_recompute_sup
  AFTER UPDATE OF supervisor_id, department_id ON public.department_sections
  FOR EACH ROW EXECUTE FUNCTION public._trg_org_recompute_supervisors();

DROP TRIGGER IF EXISTS trg_departments_recompute_sup ON public.departments;
CREATE TRIGGER trg_departments_recompute_sup
  AFTER UPDATE OF manager_id ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public._trg_org_recompute_supervisors();

-- ── 回填:現有所有 org 全部重推一次 ──
DO $do$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.organizations LOOP
    PERFORM public._recompute_org_supervisors(r.id);
  END LOOP;
END $do$;

NOTIFY pgrst, 'reload schema';
