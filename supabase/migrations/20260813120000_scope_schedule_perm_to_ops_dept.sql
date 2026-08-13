-- 排班資格收斂:只有「營運部 + 系統管理(admin/super)」該有排班能力。
-- manager 角色本身自帶 schedule.edit/algo(非靠角色短路,是角色權限),故對「非營運部的 manager」用個人 revoke override 蓋掉。
-- 另清掉少數 manager 被個別開的 schedule.view_all(看全部門市)grant——只有營運部顧問周容甄該留(她管全店)。
-- 冪等:以「員工姓名(在職)× 權限碼」定位;先刪該員該碼的舊 override,再塞 revoke。可重複執行。
DO $$
DECLARE
  v_org int := 1;
  -- 非營運部、不該有排班資格的人(admin/super 不在此列,他們靠 system.admin 天生全能,不動)
  v_revoke_names text[] := ARRAY['王慧甄','李英顥','測試管理員'];
  -- 被個別開 view_all 但不該看全部門市的人(周容甄=營運部管全店,保留,不列入)
  v_stripviewall_names text[] := ARRAY['張庭瑋','測試管理員'];
  v_edit int; v_algo int; v_viewall int;
  v_name text; v_eid int;
BEGIN
  SELECT id INTO v_edit    FROM permissions WHERE code='schedule.edit';
  SELECT id INTO v_algo    FROM permissions WHERE code='schedule.algo';
  SELECT id INTO v_viewall FROM permissions WHERE code='schedule.view_all';

  -- 1) 非營運部者:revoke schedule.edit / schedule.algo
  FOREACH v_name IN ARRAY v_revoke_names LOOP
    SELECT id INTO v_eid FROM employees WHERE name=v_name AND status='在職' AND organization_id=v_org ORDER BY id LIMIT 1;
    IF v_eid IS NOT NULL THEN
      DELETE FROM employee_permissions WHERE employee_id=v_eid AND permission_id IN (v_edit, v_algo);
      INSERT INTO employee_permissions (employee_id, permission_id, mode, granted_by, reason, created_at, updated_at)
      VALUES (v_eid, v_edit, 'revoke', NULL, '排班資格收斂:非營運部不需排班', now(), now()),
             (v_eid, v_algo, 'revoke', NULL, '排班資格收斂:非營運部不需排班', now(), now());
    END IF;
  END LOOP;

  -- 2) 清掉不該有的 schedule.view_all grant override(縮回只排自己門市)
  FOREACH v_name IN ARRAY v_stripviewall_names LOOP
    SELECT id INTO v_eid FROM employees WHERE name=v_name AND status='在職' AND organization_id=v_org ORDER BY id LIMIT 1;
    IF v_eid IS NOT NULL THEN
      DELETE FROM employee_permissions WHERE employee_id=v_eid AND permission_id=v_viewall AND mode='grant';
    END IF;
  END LOOP;
END $$;
