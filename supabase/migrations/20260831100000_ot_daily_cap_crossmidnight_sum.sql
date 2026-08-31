-- 單日加班12h上限修正:原本只比「本單」時數→跨午夜拆單/同日多張都逃掉。
-- 改為:排定淨工時 + 「同一班日(換日線前的凌晨加班歸前一天班)已排加班總數」 + 本次 <= 12h。
-- 實測周佳霖8/28:#2488(2h)在→重送00:00-02:00的2h被擋;8/29的1.5h仍放行。

CREATE OR REPLACE FUNCTION public.chk_overtime_labor_law()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_eff_date    DATE;
  v_eff_hours   NUMERIC;
  v_month_start DATE;
  v_month_end   DATE;
  v_month_total NUMERIC;
BEGIN
  -- 特例旁路
  IF COALESCE(NEW.is_exception, false) THEN
    RETURN NEW;
  END IF;

  -- UPDATE 若關鍵欄沒變 → 跳過（避免簽核 status 改動被擋）
  IF TG_OP = 'UPDATE' THEN
    IF NEW.ot_hours     IS NOT DISTINCT FROM OLD.ot_hours
      AND NEW.hours        IS NOT DISTINCT FROM OLD.hours
      AND NEW.request_date IS NOT DISTINCT FROM OLD.request_date
      AND NEW.date         IS NOT DISTINCT FROM OLD.date
      AND NEW.employee_id  IS NOT DISTINCT FROM OLD.employee_id THEN
      RETURN NEW;
    END IF;
  END IF;

  v_eff_date  := COALESCE(NEW.request_date, NEW.date);
  v_eff_hours := COALESCE(NEW.ot_hours, NEW.hours);
  IF v_eff_hours IS NULL THEN
    RETURN NEW;
  END IF;

  -- 單筆 > 12h 視為明顯異常（防 typo）
  IF v_eff_hours > 12 THEN
    RAISE EXCEPTION 'OT_HOURS_ABNORMAL: 單筆加班時數異常（最多 12 小時），本次 % 小時', v_eff_hours
      USING HINT = 'sanity_cap';
  END IF;

  -- 每月上限 46h（同員工、薪資月、非退回、非特例）
  IF v_eff_date IS NOT NULL THEN
    v_month_start := DATE_TRUNC('month', v_eff_date)::DATE;
    v_month_end   := (v_month_start + INTERVAL '1 month - 1 day')::DATE;

    SELECT COALESCE(SUM(COALESCE(ot_hours, hours)), 0) INTO v_month_total
      FROM public.overtime_requests
     WHERE employee_id IS NOT DISTINCT FROM NEW.employee_id
       AND COALESCE(request_date, date) BETWEEN v_month_start AND v_month_end
       AND COALESCE(NULLIF(status, ''), '申請中') NOT IN ('已退回', '已駁回', '已取消', '已拒絕')
       AND id IS DISTINCT FROM NEW.id
       AND NOT COALESCE(is_exception, false);

    IF v_month_total + v_eff_hours > 46 THEN
      RAISE EXCEPTION 'OT_MONTHLY_EXCEED: 本月加班已達上限（46 小時），當月已 % 小時，本次 % 小時，合計 %', v_month_total, v_eff_hours, v_month_total + v_eff_hours
        USING HINT = 'monthly_cap';
    END IF;
  END IF;

  -- ── 單日加班上限:當天排定淨工時 + 本次加班 <= 12h(無排班以標準 8h 計)──
  --   額外加班(is_exception)已於函式開頭 bypass → 天災/變形工時等特例改用「額外加班」可繞過。
  IF NEW.employee_id IS NOT NULL AND v_eff_date IS NOT NULL THEN
    DECLARE
      v_sched numeric;
      v_cap   numeric;
      v_boundary int;
      v_workday  date;
      v_day_ot   numeric;
    BEGIN
      SELECT COALESCE(NULLIF(o.settings->>'day_boundary_hour','')::int,6) INTO v_boundary FROM public.employees e JOIN public.organizations o ON o.id=e.organization_id WHERE e.id=NEW.employee_id;
      v_boundary := COALESCE(v_boundary,6);
      v_workday := CASE WHEN NEW.start_time IS NOT NULL AND NEW.start_time < make_time(v_boundary,0,0) THEN v_eff_date - 1 ELSE v_eff_date END;
      v_sched := public._sched_net_hours_day(NEW.employee_id, v_workday);
      IF v_sched IS NULL OR v_sched = 0 THEN v_sched := 8; END IF;
      v_cap := 12 - v_sched;
      SELECT COALESCE(SUM(COALESCE(ot.ot_hours,ot.hours)),0) INTO v_day_ot FROM public.overtime_requests ot WHERE ot.employee_id IS NOT DISTINCT FROM NEW.employee_id AND ot.id IS DISTINCT FROM NEW.id AND COALESCE(NULLIF(ot.status,''),'申請中') NOT IN ('已退回','已駁回','已取消','已拒絕') AND NOT COALESCE(ot.is_exception,false) AND (CASE WHEN ot.start_time IS NOT NULL AND ot.start_time < make_time(v_boundary,0,0) THEN COALESCE(ot.request_date,ot.date)-1 ELSE COALESCE(ot.request_date,ot.date) END)=v_workday;
      IF v_day_ot + v_eff_hours > v_cap + 0.01 THEN
        RAISE EXCEPTION 'OT_DAILY_CAP: 當天排定 % 小時,單日加班上限約 % 小時,本次 % 小時已超過(單日總工時逾 12 小時)。特殊情況請改用「額外加班」。',
          round(v_sched, 1), round(GREATEST(v_cap - v_day_ot, 0), 1), v_eff_hours
          USING HINT = 'daily_cap';
      END IF;
    END;
  END IF;

  RETURN NEW;
END $function$
