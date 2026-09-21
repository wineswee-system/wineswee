-- 天災「沒來人員結算」改吃區間 — 2026-07-13
-- 原本用單一 v_d.date 產一天假單;改成 loop [start_at::date, end_at::date] 每一天各產一天,
--   讓跨天宣告(門市跨日班)區間內每天都覆蓋到。無 start_at 時 fallback 單日 date(向下相容)。
-- 其餘不變:idempotent(同員工同日已建則跳過)、SET skip_chain_notify、已核准直接入。

CREATE OR REPLACE FUNCTION public.disaster_settle_no_shows(
  p_disaster_id  int,
  p_employee_ids int[]
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_d      public.disaster_days;
  v_type   text;
  v_cnt    int := 0;
  v_eid    int;
  v_name   text;
  v_org    int;
  v_start  date;
  v_end    date;
  v_day    date;
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

  -- 區間內每一天(fallback 單日)
  v_start := COALESCE(v_d.start_at::date, v_d.date);
  v_end   := COALESCE(v_d.end_at::date,   v_d.date);
  IF v_end < v_start THEN v_end := v_start; END IF;

  -- 抑制簽核 LINE 通知（這批是 HR 決定的，直接已核准）
  PERFORM set_config('app.skip_chain_notify', 'true', true);

  FOREACH v_eid IN ARRAY COALESCE(p_employee_ids, ARRAY[]::int[]) LOOP
    SELECT name, organization_id INTO v_name, v_org FROM public.employees WHERE id = v_eid;
    IF v_name IS NULL THEN CONTINUE; END IF;

    FOR v_day IN SELECT d::date FROM generate_series(v_start, v_end, INTERVAL '1 day') d LOOP
      -- 已建過同日天災假單 → 跳過（idempotent）
      IF EXISTS (
        SELECT 1 FROM public.leave_requests
         WHERE employee_id = v_eid AND start_date = v_day
           AND reason LIKE '天災停班%' AND deleted_at IS NULL
      ) THEN CONTINUE; END IF;

      INSERT INTO public.leave_requests
        (employee_id, employee, type, start_date, end_date, days,
         reason, status, organization_id, current_step, approved_at)
      VALUES
        (v_eid, v_name, v_type, v_day, v_day, 1,
         '天災停班（' || v_d.disaster_type || '）自動產生', '已核准',
         COALESCE(v_org, v_d.organization_id), 0, now());

      v_cnt := v_cnt + 1;
    END LOOP;
  END LOOP;

  RETURN json_build_object('ok', true, 'created', v_cnt, 'leave_type', v_type);
END $$;

GRANT EXECUTE ON FUNCTION public.disaster_settle_no_shows(int, int[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
