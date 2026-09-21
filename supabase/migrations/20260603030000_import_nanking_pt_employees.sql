-- 匯入三名南京建國門市員工（來源：104 匯出 CSV「員工資料匯出 (2).csv」, 2026-06-03）
-- 公司：威耀時代股份有限公司（統編 90370708）
-- 員工編號衝突時略過（idempotent）

INSERT INTO public.employees (
  name, employee_number, id_number, birth_date, gender,
  email, join_date, employment_type, salary_type, status,
  store_id, store, role, role_id, organization_id
) VALUES
  (
    '陳苡慧', 'L2026120', 'H224524221', '1994-09-24', '女',
    'st120349@yahoo.com.tw', '2026-06-01', '兼職', 'hourly', '在職',
    24, '南京建國', 'store_staff', 5, 1
  ),
  (
    '賴德旻', 'P20260041', 'F129549386', '1995-10-25', '男',
    'allen6303allen6303@yahoo.com.tw', '2026-06-01', '兼職', 'hourly', '在職',
    24, '南京建國', 'store_staff', 5, 1
  ),
  (
    '鄭力瑄', 'P20260042', 'F229228839', '1996-10-02', '女',
    'imliiiixuan@gmail.com', '2026-06-01', '兼職', 'hourly', '在職',
    24, '南京建國', 'store_staff', 5, 1
  )
ON CONFLICT (employee_number) DO NOTHING;

-- 賴德旻：免役
UPDATE public.employees
SET military_status = '免役'
WHERE employee_number = 'P20260041'
  AND (military_status IS NULL OR military_status = '後備役');

-- 薪資結構：兼職時薪 220
INSERT INTO public.salary_structures (
  employee_id, salary_type, hourly_rate, base_salary, effective_from
)
SELECT e.id, 'hourly', 220, 0, '2026-06-01'::date
FROM public.employees e
WHERE e.employee_number IN ('L2026120', 'P20260041', 'P20260042')
ON CONFLICT (employee_id) DO UPDATE
  SET salary_type    = EXCLUDED.salary_type,
      hourly_rate    = EXCLUDED.hourly_rate,
      effective_from = EXCLUDED.effective_from,
      updated_at     = now();

-- 直屬主管：南京建國店長（從 stores.manager_id 動態抓，未來換店長也跟著走）
UPDATE public.employees e
SET supervisor_id = s.manager_id,
    reporting_to  = s.manager_id,
    supervisor    = mgr.name
FROM public.stores s
JOIN public.employees mgr ON mgr.id = s.manager_id
WHERE s.id = e.store_id
  AND e.employee_number IN ('L2026120', 'P20260041', 'P20260042');

-- 校驗：若上面 UPDATE 沒寫入（南京建國 stores.manager_id 是 NULL），拋警告
DO $$
DECLARE
  v_missing INT;
BEGIN
  SELECT COUNT(*) INTO v_missing
  FROM public.employees
  WHERE employee_number IN ('L2026120', 'P20260041', 'P20260042')
    AND supervisor_id IS NULL;
  IF v_missing > 0 THEN
    RAISE WARNING '南京建國店長 supervisor_id 未設定，% 名新員工 supervisor 仍為 NULL（請檢查 stores.manager_id WHERE id = 24）', v_missing;
  END IF;
END $$;
