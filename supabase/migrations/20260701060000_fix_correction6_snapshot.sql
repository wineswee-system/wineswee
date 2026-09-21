-- 修正 補打卡申請 id=6 的 chain snapshot
-- 刪除舊鏈 3 步，重建 chain 32（行政人員）4 步

DELETE FROM public.request_chain_snapshots
WHERE request_type = 'correction' AND request_id = 6;

INSERT INTO public.request_chain_snapshots
  (request_type, request_id, chain_id, step_order, label, role_name,
   target_type, target_emp_id, target_role_id, target_dept_id,
   target_store_id, target_section_id, snapshotted_at, auto_skipped, skip_if_no_approver)
VALUES
  -- Step 0: 部門主管 初核（解析黃蘊珊的部門主管）
  ('correction', 6, 32, 0, '部門主管 初核', '部門主管 初核',
   'applicant_dept_manager',
   (SELECT d.manager_id FROM public.employees e
    JOIN public.departments d ON d.id = e.department_id
    WHERE e.name = '黃蘊珊' AND e.organization_id = 1 LIMIT 1),
   NULL, NULL, NULL, NULL, NOW(), false, false),
  -- Step 1: 執行長 覆核（fixed_emp id=52）
  ('correction', 6, 32, 1, '執行長 覆核', '執行長 覆核',
   'fixed_emp', 52, NULL, NULL, NULL, NULL, NOW(), false, true),
  -- Step 2: 董事長 決核（fixed_emp id=48）
  ('correction', 6, 32, 2, '董事長 決核', '董事長 決核',
   'fixed_emp', 48, NULL, NULL, NULL, NULL, NOW(), false, false),
  -- Step 3: 人資主管 備查（specific_dept_manager dept_id=26）
  ('correction', 6, 32, 3, '人資主管 備查', '人資主管 備查',
   'specific_dept_manager', NULL, NULL, 26, NULL, NULL, NOW(), false, false);

NOTIFY pgrst, 'reload schema';
