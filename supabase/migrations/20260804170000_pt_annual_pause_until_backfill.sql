-- PT 特休「實排折算」暫停,待班表匯齊再開 — 2026-08-04
-- ════════════════════════════════════════════════════════════════════════════
-- 背景:leave_annual_entitlement 對 PT(hourly)用「近6個月實排時數 ÷ 40」折算特休。
--   但歷史班表尚未匯齊,近182天視窗內多數 PT 只有零星近期資料(如王澤昇僅 4/01~今
--   ≈4.2個月、2個月空窗被分母排除)→ 不是真正的6個月平均,折算失真(王澤昇被算成 37h)。
-- 決策(老闆):暫停 PT 實排折算,PT 特休顯示 0 +「待班表匯入」;等班表補齊再開回來重算。
-- 作法:加布林開關 v_pt_actual_enabled(預設 false)。false → pt_hours=0、回傳 pt_paused=true。
--   ★班表補齊後:把 v_pt_actual_enabled 改成 true(一行)即恢復實排折算,無需改別處。
--   仍照算 pt_avg_weekly_hours/pt_ratio 放進回傳(供對帳參考),只是不套用到 pt_hours。
-- 影響面:計薪引擎/資遣費/preview/generate 皆未呼叫本 RPC(已核) → 純顯示層,不動計薪折現。
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.leave_annual_entitlement(p_emp_id integer, p_ref_year integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_emp      public.employees;
  v_years    numeric;
  v_cy       int;
  v_ft_days  int;
  v_is_pt    boolean;
  v_avg_wk   numeric;
  v_ratio    numeric;
  v_pt_hours numeric;
  v_pt_actual_enabled boolean := false;   -- ★班表補齊後改 true 即恢復 PT 實排折算
BEGIN
  SELECT * INTO v_emp FROM public.employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL OR v_emp.join_date IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_JOIN_DATE', 'ft_days', 0, 'pt_hours', 0, 'years_worked', 0);
  END IF;

  IF p_ref_year IS NULL THEN
    v_years := EXTRACT(EPOCH FROM (now() - v_emp.join_date::timestamptz)) / (365.25 * 86400);
    v_cy    := NULL;
  ELSE
    v_cy    := p_ref_year - EXTRACT(YEAR FROM v_emp.join_date)::int;
    v_years := v_cy + 0.5;
  END IF;

  -- §38 年資階梯(逐字對齊 leavePolicy calcEntitlement)
  v_ft_days := CASE
    WHEN v_years < 0.5 THEN 0
    WHEN v_years < 1  THEN 3
    WHEN v_years < 2  THEN 7
    WHEN v_years < 3  THEN 10
    WHEN v_years < 5  THEN 14
    WHEN v_years < 10 THEN 15
    ELSE LEAST(30, 15 + (FLOOR(v_years)::int - 10))
  END;

  v_is_pt := (v_emp.salary_type = 'hourly');

  v_avg_wk := NULL; v_ratio := NULL; v_pt_hours := NULL;
  IF v_is_pt THEN
    v_avg_wk := public.leave_pt_avg_weekly_hours(p_emp_id);   -- 仍算,供對帳參考
    v_ratio  := LEAST(1, COALESCE(v_avg_wk, 0) / 40.0);
    IF v_pt_actual_enabled THEN
      v_pt_hours := v_ft_days * 8 * v_ratio;                  -- 正式:實排折算
    ELSE
      v_pt_hours := 0;                                        -- 暫停:班表未匯齊 → 顯示 0
    END IF;
  END IF;

  RETURN json_build_object(
    'ok', true,
    'is_pt', v_is_pt,
    'pt_paused', (v_is_pt AND NOT v_pt_actual_enabled),       -- 前端標「待班表匯入」
    'ref_year', p_ref_year,
    'completed_years', v_cy,
    'years_worked', ROUND(v_years, 1),
    'ft_days', v_ft_days,
    'pt_avg_weekly_hours', v_avg_wk,
    'pt_ratio', v_ratio,
    'pt_hours', v_pt_hours
  );
END $function$;

NOTIFY pgrst, 'reload schema';
