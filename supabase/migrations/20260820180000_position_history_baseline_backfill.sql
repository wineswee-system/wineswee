-- Plan B Phase1:計薪/報表改按月 point-in-time 回推門市。先給每位在職員工補 position_history「基準」列。
-- 有異動列的人基準 end_date 接在第一筆異動生效日−1(如高承揚基準微風到8/31、9/1那列信義)。idempotent(已有 baseline 跳過)。
INSERT INTO public.position_history
    (employee_id, organization_id, effective_date, end_date, department_id, store_id, position, base_salary, role, change_type, reason, source_request_id, changed_by)
SELECT e.id, e.organization_id,
  COALESCE(e.join_date, DATE '2000-01-01'),
  (SELECT MIN(ph.effective_date) - 1 FROM public.position_history ph WHERE ph.employee_id = e.id),
  e.department_id, e.store_id, e.position,
  COALESCE(ss.base_salary, e.base_salary), e.role,
  'baseline', '基準(系統補 point-in-time)', NULL, NULL
FROM public.employees e
LEFT JOIN public.salary_structures ss ON ss.employee_id = e.id
WHERE e.status = '在職'
  AND NOT EXISTS (SELECT 1 FROM public.position_history ph WHERE ph.employee_id = e.id AND ph.change_type = 'baseline');
