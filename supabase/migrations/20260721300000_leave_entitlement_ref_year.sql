-- 特休額度 RPC 加「基準年」參數 + 修第一年滿6個月=3天 — 2026-07-21 [收斂階段1]
--
-- 背景(特休大檢查):§38 年資階梯全庫複刻 7+ 份、3 種基準日並存,同一人不同頁天數不一。
--   收斂方向 = 把 leave_annual_entitlement 變唯一真相,其餘前端逐步改走它。
--
-- 本階段只動這支 RPC(不碰前端):
--   1. 加 p_ref_year(=假勤明細頁的年度下拉):回「該到職週年期」的額度,不再只算今天。
--      → 週年期(labeled Y) 對應員工第 (Y - 到職年) 個服務年;完成年數 cy 決定 §38 天數。
--   2. 修第一年 0 bug:cy=0(第一個週年期)依 §38 給 3 天(滿6個月),不再回 0。
--      技巧:把「完成年數 cy」轉成 y = cy + 0.5 餵進同一個階梯 CASE,
--            cy=0→y=0.5→3、cy=1→1.5→7、cy=2→2.5→10… 與「今天基準」對當期完全一致。
--   3. p_ref_year 省略(NULL)= 維持原本「今天」語意 → 完全向後相容。
--
-- overload 安全:舊 1 參數版無任何呼叫端(前端只用 leave_pt_avg_weekly_hours);
--   為免 42725 ambiguity(1 參呼叫同時吻合 (int) 與 (int,int DEFAULT)),先 DROP 舊版再建 2 參版。
--   對齊 [[feedback_pg_function_overload_ambiguity]]。

DROP FUNCTION IF EXISTS public.leave_annual_entitlement(int);

CREATE OR REPLACE FUNCTION public.leave_annual_entitlement(p_emp_id int, p_ref_year int DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_emp      public.employees;
  v_years    numeric;      -- 餵階梯的「等效年資」(今天=實際年資;週年期=cy+0.5)
  v_cy       int;          -- 週年期完成年數(僅 p_ref_year 模式)
  v_ft_days  int;
  v_is_pt    boolean;
  v_avg_wk   numeric;
  v_ratio    numeric;
  v_pt_hours numeric;
BEGIN
  SELECT * INTO v_emp FROM public.employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL OR v_emp.join_date IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_JOIN_DATE', 'ft_days', 0, 'pt_hours', 0, 'years_worked', 0);
  END IF;

  IF p_ref_year IS NULL THEN
    -- 今天基準(原語意,對齊 JS (now-join)/365.25)
    v_years := EXTRACT(EPOCH FROM (now() - v_emp.join_date::timestamptz)) / (365.25 * 86400);
    v_cy    := NULL;
  ELSE
    -- 週年期基準:該期完成年數 = 期起年 - 到職年;轉 y=cy+0.5 餵同一階梯(第一年→3天)
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
    v_avg_wk   := public.leave_pt_avg_weekly_hours(p_emp_id);
    v_ratio    := LEAST(1, COALESCE(v_avg_wk, 0) / 40.0);
    v_pt_hours := v_ft_days * 8 * v_ratio;
  END IF;

  RETURN json_build_object(
    'ok', true,
    'is_pt', v_is_pt,
    'ref_year', p_ref_year,                -- NULL=今天基準
    'completed_years', v_cy,               -- 週年期模式才有值
    'years_worked', ROUND(v_years, 1),
    'ft_days', v_ft_days,
    'pt_avg_weekly_hours', v_avg_wk,
    'pt_ratio', v_ratio,
    'pt_hours', v_pt_hours
  );
END $$;

GRANT EXECUTE ON FUNCTION public.leave_annual_entitlement(int, int) TO authenticated;

NOTIFY pgrst, 'reload schema';
