-- 部分請假淨時數:行政 wrapper + 統一入口(step 1b)— 2026-07-30
-- ════════════════════════════════════════════════════════════════════════════
-- 承 20260730140000(門市 _store_leave_net_hours + 純幾何 _leave_net_minutes)。
-- 這支加「行政」分支 + 統一入口 _leave_net_hours,行政/門市自動分流。純加函式,不接現有邏輯。
--
-- 行政判定:salary_structures.employment_category = 'admin'(對齊計薪引擎)。
-- 行政辦公窗:讀該員工門市 has_office_hours → office_hours_start/end;否則 fallback 09:00–18:00。
-- 行政午休:固定 12:00 起,長度 = COALESCE(office_hours_break_minutes, 60)(預設 12:00–13:00)。
--   浮動 30 不在「請假時數」處理(送單當下沒打卡;請假通常整段蓋住午休,±30 不影響 count)。
--   浮動 30 屬「出勤遲到早退」(step 3)用現有 grace 吸收。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._leave_net_hours(
  p_emp_id      integer,
  p_date        date,
  p_leave_start time,
  p_leave_end   time
) RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_cat        text;
  v_store_id   integer;
  v_has_office boolean;
  v_os         time;
  v_oe         time;
  v_break_min  integer;
BEGIN
  SELECT ss.employment_category, e.store_id
    INTO v_cat, v_store_id
    FROM public.employees e
    LEFT JOIN public.salary_structures ss ON ss.employee_id = e.id
   WHERE e.id = p_emp_id;

  IF COALESCE(v_cat, '') = 'admin' THEN
    -- 行政:辦公時間 + 固定午休
    SELECT st.has_office_hours,
           st.office_hours_start::time,
           st.office_hours_end::time,
           COALESCE(st.office_hours_break_minutes, 60)
      INTO v_has_office, v_os, v_oe, v_break_min
      FROM public.stores st
     WHERE st.id = v_store_id;

    IF NOT COALESCE(v_has_office, false) OR v_os IS NULL OR v_oe IS NULL THEN
      v_os := time '09:00'; v_oe := time '18:00'; v_break_min := COALESCE(v_break_min, 60);
    END IF;

    RETURN public._leave_net_minutes(
      v_os, v_oe,
      time '12:00', (time '12:00' + make_interval(mins => v_break_min)),
      p_leave_start, p_leave_end
    ) / 60.0;
  ELSE
    -- 門市:讀班表
    RETURN public._store_leave_net_hours(p_emp_id, p_date, p_leave_start, p_leave_end);
  END IF;
END $function$;

COMMENT ON FUNCTION public._leave_net_hours(integer,date,time,time)
  IS '部分請假淨小時統一入口:行政(employment_category=admin)走辦公時間+固定午休12-13;其餘走門市班表';

NOTIFY pgrst, 'reload schema';
