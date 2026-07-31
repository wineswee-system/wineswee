-- net_work_hours 補洞:壞紀錄/對不上班/rest=0 全處理 — 2026-07-30
-- ════════════════════════════════════════════════════════════════════════════
-- 230000 的班表窗版本在大量預覽下露出邊界問題,修正:
--   A. 打卡上=下(壞紀錄,clock_in=clock_out)→ 之前被當跨午夜算成 23.5h;改嚴格 <,相等→span 0→回 0。
--   B. 兩頭班(rest_minutes=270 等)照班表扣(用戶決策:依班別算)→ 休息窗 overlap 到就扣。
--   C. 打卡跟班表對不上(休息窗沒 overlap 到打卡)→ 門市退回 span 階梯公式(不溢付);
--      行政午休在打卡外(overlap=0)則不扣(打卡不含午休,如 13:15 打卡=5.2h)。
--   D. rest_minutes=0 或短班(無休息窗)→ 不扣(尊重班表設 0,如 6h 晚班=span)。
--   E. 完全無班表 → span 階梯公式。
-- 一律 ROUND(,2)。_shift_break_context 不動。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.net_work_hours(
  p_emp_id integer, p_date date, p_clock_in time, p_clock_out time
) RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  ctx    record;
  v_cat  text;
  v_ci   numeric; v_co numeric; v_span numeric;
  v_bs   numeric; v_be numeric; v_ovl numeric;
  v_rest integer;
BEGIN
  IF p_clock_in IS NULL OR p_clock_out IS NULL THEN RETURN NULL; END IF;

  v_ci := EXTRACT(EPOCH FROM p_clock_in) / 60;
  v_co := EXTRACT(EPOCH FROM p_clock_out) / 60;
  IF v_co < v_ci THEN v_co := v_co + 1440; END IF;   -- 嚴格<:相等→0(壞紀錄不當24h)
  v_span := v_co - v_ci;
  IF v_span <= 0 THEN RETURN 0; END IF;              -- A

  SELECT ss.employment_category INTO v_cat
    FROM public.employees e
    LEFT JOIN public.salary_structures ss ON ss.employee_id = e.id
   WHERE e.id = p_emp_id;

  SELECT * INTO ctx FROM public._shift_break_context(p_emp_id, p_date);

  IF ctx.shift_start IS NULL AND ctx.break_start IS NULL THEN
    -- E. 完全無班表/辦公 → span 公式
    v_rest := CASE WHEN v_span >= 540 THEN 60 WHEN v_span >= 300 THEN 30 ELSE 0 END;
    RETURN ROUND(GREATEST(0, v_span - v_rest) / 60.0, 2);
  END IF;

  IF ctx.break_start IS NULL THEN
    -- D. 有班但無休息窗(rest=0 或短班)→ 不扣
    RETURN ROUND(v_span / 60.0, 2);
  END IF;

  -- 休息窗 ∩ 打卡(以打卡上班為基準錨點)
  v_bs := EXTRACT(EPOCH FROM ctx.break_start) / 60; IF v_bs <  v_ci THEN v_bs := v_bs + 1440; END IF;
  v_be := EXTRACT(EPOCH FROM ctx.break_end)   / 60; IF v_be <= v_bs THEN v_be := v_be + 1440; END IF;
  v_ovl := GREATEST(0, LEAST(v_co, v_be) - GREATEST(v_ci, v_bs));

  IF v_ovl > 0 OR COALESCE(v_cat, '') = 'admin' THEN
    -- B/尤致皓:有 overlap 就扣;行政 overlap=0(午休在打卡外)不扣
    RETURN ROUND(GREATEST(0, v_span - v_ovl) / 60.0, 2);
  ELSE
    -- C. 門市但休息窗沒 overlap 到打卡(對不上班)→ 退 span 公式,不溢付
    v_rest := CASE WHEN v_span >= 540 THEN 60 WHEN v_span >= 300 THEN 30 ELSE 0 END;
    RETURN ROUND(GREATEST(0, v_span - v_rest) / 60.0, 2);
  END IF;
END $function$;

NOTIFY pgrst, 'reload schema';
