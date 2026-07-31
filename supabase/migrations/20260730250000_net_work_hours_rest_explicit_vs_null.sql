-- net_work_hours:區分「明確 rest=0」vs「短班無 rest 但上超過(OT)」— 2026-07-30
-- ════════════════════════════════════════════════════════════════════════════
-- 240000 的 D 分支(有班但無休息窗 → 不扣)對兩種情況都不扣,但這兩種該不同:
--   - rest_minutes 明確設值(含 0):尊重班表 → 不額外扣(如 18-00 晚班 rest=0 → span 全給)。
--   - rest_minutes 為 NULL(短班公式算 0)但實際打卡上超過(有申請加班)→ 照 span 階梯給休息
--       (如排 4h 卻上 9.5h OT → 9.5h 該有 1h 休息 = 8.58h,而非不扣的 9.58h)。
-- 其餘分支不變。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.net_work_hours(
  p_emp_id integer, p_date date, p_clock_in time, p_clock_out time
) RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  ctx    record;
  v_cat  text;
  v_srest integer;
  v_ci   numeric; v_co numeric; v_span numeric;
  v_bs   numeric; v_be numeric; v_ovl numeric;
  v_rest integer;
BEGIN
  IF p_clock_in IS NULL OR p_clock_out IS NULL THEN RETURN NULL; END IF;

  v_ci := EXTRACT(EPOCH FROM p_clock_in) / 60;
  v_co := EXTRACT(EPOCH FROM p_clock_out) / 60;
  IF v_co < v_ci THEN v_co := v_co + 1440; END IF;   -- 嚴格<:相等→0(壞紀錄)
  v_span := v_co - v_ci;
  IF v_span <= 0 THEN RETURN 0; END IF;

  SELECT ss.employment_category INTO v_cat
    FROM public.employees e
    LEFT JOIN public.salary_structures ss ON ss.employee_id = e.id
   WHERE e.id = p_emp_id;

  SELECT * INTO ctx FROM public._shift_break_context(p_emp_id, p_date);

  IF ctx.shift_start IS NULL AND ctx.break_start IS NULL THEN
    -- E. 完全無班表 → span 公式
    v_rest := CASE WHEN v_span >= 540 THEN 60 WHEN v_span >= 300 THEN 30 ELSE 0 END;
    RETURN ROUND(GREATEST(0, v_span - v_rest) / 60.0, 2);
  END IF;

  IF ctx.break_start IS NULL THEN
    -- D. 有班但無休息窗:分「明確 rest」vs「短班無 rest」
    SELECT rest_minutes INTO v_srest
      FROM public.schedules
     WHERE employee_id = p_emp_id AND date = p_date
     ORDER BY (leave_request_id IS NULL) DESC LIMIT 1;
    IF v_srest IS NOT NULL THEN
      -- 明確設 rest(含 0)→ 尊重班表,不額外扣
      RETURN ROUND(GREATEST(0, v_span - v_srest) / 60.0, 2);
    ELSE
      -- 短班無 rest,但實際上超過(OT)→ 照 span 給休息
      v_rest := CASE WHEN v_span >= 540 THEN 60 WHEN v_span >= 300 THEN 30 ELSE 0 END;
      RETURN ROUND(GREATEST(0, v_span - v_rest) / 60.0, 2);
    END IF;
  END IF;

  -- 休息窗 ∩ 打卡(以打卡上班為基準錨點)
  v_bs := EXTRACT(EPOCH FROM ctx.break_start) / 60; IF v_bs <  v_ci THEN v_bs := v_bs + 1440; END IF;
  v_be := EXTRACT(EPOCH FROM ctx.break_end)   / 60; IF v_be <= v_bs THEN v_be := v_be + 1440; END IF;
  v_ovl := GREATEST(0, LEAST(v_co, v_be) - GREATEST(v_ci, v_bs));

  IF v_ovl > 0 OR COALESCE(v_cat, '') = 'admin' THEN
    RETURN ROUND(GREATEST(0, v_span - v_ovl) / 60.0, 2);
  ELSE
    -- 門市但休息窗沒 overlap 到打卡(對不上班)→ span 公式
    v_rest := CASE WHEN v_span >= 540 THEN 60 WHEN v_span >= 300 THEN 30 ELSE 0 END;
    RETURN ROUND(GREATEST(0, v_span - v_rest) / 60.0, 2);
  END IF;
END $function$;

NOTIFY pgrst, 'reload schema';
