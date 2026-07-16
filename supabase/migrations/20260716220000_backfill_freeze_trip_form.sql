-- 回填在飛的出差/表單簽核單 frozen_emp_ids（20260716210000 的兩條尾巴）— 2026-07-16
-- 需在 20260716200000 引擎之後跑。只動待審 + frozen IS NULL,idempotent。
-- 出差 trip → business_trips(employee_id, status='待審核');表單 → form_submissions(applicant_id, status='申請中')

-- 出差
UPDATE public.request_chain_snapshots s
SET frozen_emp_ids = NULLIF(ARRAY(
      SELECT r.emp_id
      FROM public.resolve_snapshot_step_approvers(s.request_type, s.request_id, s.step_order, src.employee_id) r
    ), '{}')
FROM public.business_trips src
WHERE s.request_type = 'trip'
  AND s.request_id   = src.id
  AND src.status     = '待審核'
  AND s.frozen_emp_ids IS NULL;

-- 表單簽核（applicant 欄位是 applicant_id、待審狀態是「申請中」）
UPDATE public.request_chain_snapshots s
SET frozen_emp_ids = NULLIF(ARRAY(
      SELECT r.emp_id
      FROM public.resolve_snapshot_step_approvers(s.request_type, s.request_id, s.step_order, src.applicant_id) r
    ), '{}')
FROM public.form_submissions src
WHERE s.request_type = 'form_submission'
  AND s.request_id   = src.id
  AND src.status     = '申請中'
  AND src.deleted_at IS NULL
  AND s.frozen_emp_ids IS NULL;

DO $$
DECLARE v_ct INT;
BEGIN
  SELECT COUNT(*) INTO v_ct FROM public.request_chain_snapshots WHERE frozen_emp_ids IS NOT NULL;
  RAISE NOTICE '已凍結簽核人的快照列數(累計): %', v_ct;
END $$;
