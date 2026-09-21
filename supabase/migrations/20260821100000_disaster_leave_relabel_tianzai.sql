-- 天災停班自動產生的假:標籤從「無薪假」改成「天災假」(仍無薪,計薪金額不變)。
-- ①disaster_settle_no_shows: unpaid→'天災假'  ②計薪無薪扣清單加'天災假'/'天災'/'disaster'(DO block idempotent)
-- ③回填舊單  ④leave_types天災假 paid對齊false。leave_types早就有天災假(code=disaster)只是自動產生寫錯字。

-- ① 自動產生(全量對齊live)
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
              WHEN 'unpaid'       THEN '天災假'
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
END $function$
;

-- ② 計薪:把天災假也算進無薪扣(idempotent,只在舊字串存在時替換)
DO $$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc WHERE proname='_compute_payroll_for_employee';
  IF position('''天災假''' in v_def)=0 THEN
    v_new := replace(v_def, 'lr.type IN (''事假'',''personal'',''無薪假'',''unpaid'')',
                            'lr.type IN (''事假'',''personal'',''無薪假'',''unpaid'',''天災假'',''天災'',''disaster'')');
    EXECUTE v_new;
  END IF;
END $$;

-- ③ 回填舊的天災停班無薪假 → 天災假
UPDATE public.leave_requests SET type='天災假'
 WHERE type='無薪假' AND reason LIKE '天災停班%自動產生%';

-- ④ leave_types 天災假 = 無薪(對齊實際)
UPDATE public.leave_types SET paid=false WHERE code='disaster';
