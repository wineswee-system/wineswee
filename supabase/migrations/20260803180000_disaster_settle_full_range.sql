-- 修:天災「沒來結算」逐日涵蓋整個區間(不再只做主日期)— 2026-08-03
-- ============================================================================
-- 病灶:disaster_settle_no_shows 只用 v_d.date 產一張無薪假 → 多日天災(如 7/10~7/11)
--   只扣到 7/10、7/11 漏掉(UI 卻寫「區間內每一天各產一張」)。
-- 修:改為 start_at..end_at 逐日產生。並加正確性防護:
--   ① 當天要有「上班班別」(schedules.actual_start 非空、非休/例假)才建 —— 排休/例假/沒排班
--      的日子本來就不用上班,不建無薪假(避免誤扣正職的休息日)。
--   ② 當天已有其他核准請假 → 跳過(不疊)。
--   ③ 同日已建過天災停班單 → 跳過(idempotent,可安全重跑補日)。
-- 其餘(照給薪 paid 直接跳過、type 映射、skip_chain_notify)與原版一致。
-- 重跑方式:改後在天災頁再按一次「結算」→ 已建的 7/10 略過、補建 7/11。
-- ============================================================================
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

  -- 天災區間(start_at~end_at,fallback 單日 date)→ 逐日
  v_start := COALESCE(v_d.start_at::date, v_d.date);
  v_end   := COALESCE(v_d.end_at::date,   v_d.date);

  -- 抑制簽核 LINE 通知（這批是 HR 決定的，直接已核准）
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

NOTIFY pgrst, 'reload schema';
