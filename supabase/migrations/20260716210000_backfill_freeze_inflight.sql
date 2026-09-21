-- 回填「現在還在飛的待審單」的 frozen_emp_ids — 2026-07-16
-- 必須在 20260716200000_freeze_chain_approvers 之後跑(需 frozen_emp_ids 欄 + resolve guard)。
-- 目的:主管大異動前,把既有待審單的簽核人凍成「現在(=開單當下最接近值)」,異動後不漂移。
-- 原理:此刻 frozen 還是 NULL → resolve_snapshot 走動態解析 → 回傳現任簽核人 → 凍住。
-- 只動 status=待審核 且 frozen_emp_ids IS NULL 的列。已簽完的單不碰。idempotent(重跑無害)。
-- 涵蓋三大宗:加班(overtime_request)/請假(leave_request)/補打卡(correction),applicant=employee_id。

-- 加班
UPDATE public.request_chain_snapshots s
SET frozen_emp_ids = NULLIF(ARRAY(
      SELECT r.emp_id
      FROM public.resolve_snapshot_step_approvers(s.request_type, s.request_id, s.step_order, src.employee_id) r
    ), '{}')
FROM public.overtime_requests src
WHERE s.request_type = 'overtime_request'
  AND s.request_id   = src.id
  AND src.status     = '待審核'
  AND s.frozen_emp_ids IS NULL;

-- 請假
UPDATE public.request_chain_snapshots s
SET frozen_emp_ids = NULLIF(ARRAY(
      SELECT r.emp_id
      FROM public.resolve_snapshot_step_approvers(s.request_type, s.request_id, s.step_order, src.employee_id) r
    ), '{}')
FROM public.leave_requests src
WHERE s.request_type = 'leave_request'
  AND s.request_id   = src.id
  AND src.status     = '待審核'
  AND s.frozen_emp_ids IS NULL;

-- 補打卡
UPDATE public.request_chain_snapshots s
SET frozen_emp_ids = NULLIF(ARRAY(
      SELECT r.emp_id
      FROM public.resolve_snapshot_step_approvers(s.request_type, s.request_id, s.step_order, src.employee_id) r
    ), '{}')
FROM public.clock_corrections src
WHERE s.request_type = 'correction'
  AND s.request_id   = src.id
  AND src.status     = '待審核'
  AND s.frozen_emp_ids IS NULL;

-- 回填結果自查(跑完看 NOTICE)
DO $$
DECLARE v_ct INT;
BEGIN
  SELECT COUNT(*) INTO v_ct FROM public.request_chain_snapshots WHERE frozen_emp_ids IS NOT NULL;
  RAISE NOTICE '已凍結簽核人的快照列數: %', v_ct;
END $$;
