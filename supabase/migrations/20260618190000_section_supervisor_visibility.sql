-- ════════════════════════════════════════════════════════════════════════════
-- 課(section)督導可見性：課長/督導看得到「整課」的人與門市
-- 2026-06-18
--
-- 背景：組織是「營運部 → 課(department_sections) → 門市(stores.section_id)」。督導/課長是
--   department_sections.supervisor_id，要管整課所有門市的人(申請/班表/任務)。但原本
--   can_see_request 只走 supervisor_id 直屬鏈 + 店長(stores.manager_id)，店員的直屬主管是
--   店長、不是課督導 → 黃蘊珊(營運二課督導)看不到課內非她直接帶/非她當店長的店(中山國小/
--   中信南港/微風/南京建國/板橋)。本支補上「課督導」這條維度。
--
-- 改兩支 helper(incremental，保留所有既有分支 + 加 section 分支):
--   can_see_request(emp)  : 申請/班表/任務/個資都靠它 → 加「我是該員工門市所屬課的 supervisor」
--   can_see_store(store)  : 門市表 RLS + 前端排班範圍 → 加「我是該門市所屬課的 supervisor」
--
-- 對應:section 2 營運二課 supervisor=黃蘊珊 → 她看得到課內 7 店全部人。羅紹輝(研發課無門市)
--   不受影響。張庭瑋/陳嘉益(admin/已是店長)本就涵蓋。
--
-- idempotent：CREATE OR REPLACE。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.can_see_request(p_applicant_emp_id int)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_me        int := current_employee_id();
  v_my_org    int;
  v_app_org   int;
  v_app_store int;
BEGIN
  IF auth.role() = 'service_role' THEN RETURN true; END IF;
  IF v_me IS NULL OR p_applicant_emp_id IS NULL THEN RETURN false; END IF;

  -- ① 本人
  IF p_applicant_emp_id = v_me THEN RETURN true; END IF;

  SELECT organization_id INTO v_my_org  FROM employees WHERE id = v_me;
  SELECT organization_id, store_id INTO v_app_org, v_app_store FROM employees WHERE id = p_applicant_emp_id;

  IF v_app_org IS DISTINCT FROM v_my_org THEN RETURN false; END IF;

  -- ② admin / super_admin（同 org）
  IF is_admin() THEN RETURN true; END IF;

  -- ④ 我是申請人門市的店長
  IF v_app_store IS NOT NULL AND EXISTS (
    SELECT 1 FROM stores s WHERE s.id = v_app_store AND s.manager_id = v_me
  ) THEN RETURN true; END IF;

  -- ⑤ 我是申請人門市所屬「課(section)」的督導/課長
  IF v_app_store IS NOT NULL AND EXISTS (
    SELECT 1 FROM stores st
      JOIN department_sections ds ON ds.id = st.section_id
     WHERE st.id = v_app_store AND ds.supervisor_id = v_me
  ) THEN RETURN true; END IF;

  -- ③ 我在申請人的直屬主管鏈上（遞迴往上爬 supervisor_id，深度上限防環）
  RETURN EXISTS (
    WITH RECURSIVE chain(id, supervisor_id, depth) AS (
      SELECT e.id, e.supervisor_id, 1
        FROM employees e WHERE e.id = p_applicant_emp_id
      UNION ALL
      SELECT e.id, e.supervisor_id, c.depth + 1
        FROM employees e
        JOIN chain c ON e.id = c.supervisor_id
       WHERE c.depth < 20 AND c.supervisor_id IS NOT NULL
    )
    SELECT 1 FROM chain WHERE supervisor_id = v_me
  );
END $$;

CREATE OR REPLACE FUNCTION public.can_see_store(p_store_id bigint)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me int := current_employee_id();
BEGIN
  IF auth.role() = 'service_role' THEN RETURN true; END IF;
  IF is_admin() THEN RETURN true; END IF;
  IF v_me IS NULL OR p_store_id IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM employees e WHERE e.id = v_me AND e.store_id = p_store_id) THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM stores s WHERE s.id = p_store_id AND s.manager_id = v_me) THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM user_stores us WHERE us.employee_id = v_me AND us.store_id = p_store_id) THEN RETURN true; END IF;
  -- 課(section)督導 → 看得到課內所有門市
  IF EXISTS (
    SELECT 1 FROM stores st
      JOIN department_sections ds ON ds.id = st.section_id
     WHERE st.id = p_store_id AND ds.supervisor_id = v_me
  ) THEN RETURN true; END IF;
  RETURN false;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
