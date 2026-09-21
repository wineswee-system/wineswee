-- 簽核人解析:supervisor_id 優先 + 店長先試單一簽核人才退 HR 池 — 2026-08-03
-- ════════════════════════════════════════════════════════════════════════════
-- 症狀:店長送希望休 → LINE 卡片廣發給全 org 所有有 leave.approve 的人(admin/manager
--   一整排,26 人綁 LINE 都收到),而不是推給該簽的那一位。
-- 根因(兩層):
--   (1) _resolve_hr_approver_ids 對「店長本人」直接扇出到全 org leave.approve 池,
--       在解析單一簽核人之前就短路了。
--   (2) _resolve_single_approver 的優先序把「所屬門市 manager」排在「supervisor_id」前面。
--       掛在「威耀總部(店20,manager=陳虹#52)」的 11 位員工(含店長黃蘊珊)因此被解成
--       陳虹,而不是各自真正的 supervisor_id(如張庭瑋#62)。影響全 HR 類型的簽核人解析。
-- 修(老闆已認可「有設 supervisor_id 就一律以它為直屬主管、優先於門市/部門 manager」):
--   ① _resolve_single_approver：supervisor_id 移到第 1 順位。
--   ② _resolve_hr_approver_ids：先試單一簽核人;解得出就給那一位,解不出(通常是店長且
--      無上層 supervisor)才退回 HR 池。
-- 影響面:只有「有設 supervisor_id 且與所屬門市 manager 不同」的 11 位總部員工改解到
--   supervisor(其餘員工 supervisor_id 為 null 或等於門市 manager → 不變);10 位店長的
--   希望休/HR 單改由單一簽核人收單,不再廣發。純解析邏輯,不動通知/鏈/資料。
-- idempotent。
-- ════════════════════════════════════════════════════════════════════════════

-- ① 單一簽核人：supervisor_id 優先
CREATE OR REPLACE FUNCTION public._resolve_single_approver(p_emp_id INT)
RETURNS INT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp        employees;
  v_approver   INT;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL THEN RETURN NULL; END IF;

  -- 1. 直屬主管 supervisor_id（最可靠的直屬關係，優先於門市/部門 manager）
  IF v_emp.supervisor_id IS NOT NULL AND v_emp.supervisor_id <> p_emp_id THEN
    RETURN v_emp.supervisor_id;
  END IF;

  -- 2. 所屬門市店長
  IF v_emp.store_id IS NOT NULL THEN
    SELECT manager_id INTO v_approver FROM stores WHERE id = v_emp.store_id;
    IF v_approver IS NOT NULL AND v_approver <> p_emp_id THEN
      RETURN v_approver;
    END IF;
  END IF;

  -- 3. 部門主管
  IF v_emp.department_id IS NOT NULL THEN
    SELECT manager_id INTO v_approver FROM departments WHERE id = v_emp.department_id;
    IF v_approver IS NOT NULL AND v_approver <> p_emp_id THEN
      RETURN v_approver;
    END IF;
  END IF;

  -- 4. 沿部門樹往上找
  IF v_emp.department_id IS NOT NULL THEN
    WITH RECURSIVE dept_chain AS (
      SELECT id, parent_department_id, manager_id, 1 AS lvl
        FROM departments WHERE id = v_emp.department_id
      UNION ALL
      SELECT d.id, d.parent_department_id, d.manager_id, dc.lvl + 1
        FROM departments d JOIN dept_chain dc ON d.id = dc.parent_department_id
       WHERE dc.lvl < 10
    )
    SELECT manager_id INTO v_approver
      FROM dept_chain
     WHERE manager_id IS NOT NULL AND manager_id <> p_emp_id
     ORDER BY lvl ASC LIMIT 1
       OFFSET 1;  -- skip lvl=1（第 3 步已檢查本部門主管）
    IF v_approver IS NOT NULL THEN RETURN v_approver; END IF;
  END IF;

  -- 5. 全部沒有 → 老闆
  RETURN NULL;
END $$;

GRANT EXECUTE ON FUNCTION public._resolve_single_approver(INT) TO authenticated, anon;

-- ② HR 簽核人：先試單一簽核人，解不出才退 HR 池（限店長）
CREATE OR REPLACE FUNCTION public._resolve_hr_approver_ids(p_applicant_id INT)
RETURNS SETOF INT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp     employees;
  v_single  INT;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_applicant_id;
  IF v_emp.id IS NULL THEN RETURN; END IF;

  -- 先解單一簽核人（supervisor_id 優先）— 店長 / 一般員工都先走這條
  v_single := public._resolve_single_approver(p_applicant_id);
  IF v_single IS NOT NULL THEN
    RETURN NEXT v_single;
    RETURN;
  END IF;

  -- 解不出單一簽核人：若本人是店長（無上層 supervisor）→ 才退回 HR 池
  IF public._is_store_manager(p_applicant_id) THEN
    RETURN QUERY
      SELECT DISTINCT e.id
        FROM employees e
        JOIN role_permissions rp ON rp.role_id = e.role_id
        JOIN permissions p       ON p.id = rp.permission_id
       WHERE p.code = 'leave.approve'
         AND e.organization_id = v_emp.organization_id
         AND e.status = '在職'
         AND e.id <> p_applicant_id;
    RETURN;
  END IF;
  -- 一般員工且無單一簽核人 = 老闆，回空集合
END $$;

GRANT EXECUTE ON FUNCTION public._resolve_hr_approver_ids(INT) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
