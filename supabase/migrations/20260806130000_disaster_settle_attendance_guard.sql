-- ════════════════════════════════════════════════════════════════════════════
-- 天災「沒來結算」修正：有打卡的人不該被掛無薪假（有來要支薪）
-- 2026-08-06
--
-- 病灶：DisasterManagement 前端查當日出勤時 select 了不存在的欄位 `store`
--   （attendance_records 實際是 store_id）→ 整包查詢報錯回空 → 前端以為「全部人
--   都沒打卡」→ 沒來清單含有來的人 → 結算把有打卡的人也產了無薪假（誤扣薪）。
--   實查：28 人有打卡卻被掛「天災停班」無薪假（7/10、7/11）。
--
-- 修：
--   ① 資料：撤銷（軟刪）所有「天災停班」假單中、當天其實有打卡（clock_in 非空）的
--      → 這些人有來，該支薪，不該掛無薪假。可還原（deleted_at）。
--   ② RPC：disaster_settle_no_shows 加一條守門「當天有打卡 → 跳過」，
--      日後即使前端誤傳有來的人，也不會再建無薪假（治本防呆）。
--   （前端 store→store_id 另於 DisasterManagement.jsx 修）
-- idempotent。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ① 撤銷「有打卡卻被掛天災無薪假/特休」的假單（軟刪）
UPDATE public.leave_requests lr
   SET deleted_at = now()
 WHERE lr.reason LIKE '天災停班%'
   AND lr.deleted_at IS NULL
   AND EXISTS (
     SELECT 1 FROM public.attendance_records ar
      WHERE ar.employee_id = lr.employee_id
        AND ar.date = lr.start_date
        AND ar.clock_in IS NOT NULL
   );

-- ② RPC 重建（照 20260803180000 完整版 + 新增守門 ④「當天有打卡 → 跳過」）
CREATE OR REPLACE FUNCTION public.disaster_settle_no_shows(p_disaster_id integer, p_employee_ids integer[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_d     public.disaster_days;
  v_type  text;
  v_cnt   int := 0;
  v_eid   int;
  v_name  text;
  v_org   int;
  v_start date;
  v_end   date;
  v_cur   date;
BEGIN
  SELECT * INTO v_d FROM public.disaster_days WHERE id = p_disaster_id;
  IF v_d.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;

  IF v_d.no_show_handling = 'paid' THEN
    RETURN json_build_object('ok', true, 'created', 0, 'note', '照給薪，無需產生假單');
  END IF;

  v_type := CASE v_d.no_show_handling
              WHEN 'annual_leave' THEN '特休'
              WHEN 'unpaid'       THEN '無薪假'
            END;

  v_start := COALESCE(v_d.start_at::date, v_d.date);
  v_end   := COALESCE(v_d.end_at::date,   v_d.date);

  PERFORM set_config('app.skip_chain_notify', 'true', true);

  FOREACH v_eid IN ARRAY COALESCE(p_employee_ids, ARRAY[]::int[]) LOOP
    SELECT name, organization_id INTO v_name, v_org FROM public.employees WHERE id = v_eid;
    IF v_name IS NULL THEN CONTINUE; END IF;

    v_cur := v_start;
    WHILE v_cur <= v_end LOOP
      -- ③ 同日已建過天災停班單 → 跳過（idempotent）
      IF EXISTS (
        SELECT 1 FROM public.leave_requests
         WHERE employee_id = v_eid AND start_date = v_cur
           AND reason LIKE '天災停班%' AND deleted_at IS NULL
      ) THEN v_cur := v_cur + 1; CONTINUE; END IF;

      -- ① 當天要有「上班班別」才算沒來（排休/例假/沒排班 → 不建無薪假）
      IF NOT EXISTS (
        SELECT 1 FROM public.schedules s
         WHERE s.employee_id = v_eid AND s.date = v_cur
           AND s.actual_start IS NOT NULL
           AND COALESCE(s.shift,'') NOT IN ('休','休息','例假','補休')
      ) THEN v_cur := v_cur + 1; CONTINUE; END IF;

      -- ② 當天已有其他核准請假 → 跳過（不疊）
      IF EXISTS (
        SELECT 1 FROM public.leave_requests
         WHERE employee_id = v_eid AND status = '已核准'
           AND start_date <= v_cur AND end_date >= v_cur AND deleted_at IS NULL
      ) THEN v_cur := v_cur + 1; CONTINUE; END IF;

      -- ④ 當天有打卡（實際有來）→ 跳過，不建無薪假（有來要支薪）★新增
      IF EXISTS (
        SELECT 1 FROM public.attendance_records ar
         WHERE ar.employee_id = v_eid AND ar.date = v_cur AND ar.clock_in IS NOT NULL
      ) THEN v_cur := v_cur + 1; CONTINUE; END IF;

      INSERT INTO public.leave_requests
        (employee_id, employee, type, start_date, end_date, days,
         reason, status, organization_id, current_step, approved_at)
      VALUES
        (v_eid, v_name, v_type, v_cur, v_cur, 1,
         '天災停班（' || v_d.disaster_type || '）自動產生', '已核准',
         COALESCE(v_org, v_d.organization_id), 0, now());

      v_cnt := v_cnt + 1;
      v_cur := v_cur + 1;
    END LOOP;
  END LOOP;

  RETURN json_build_object('ok', true, 'created', v_cnt, 'leave_type', v_type);
END $function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
