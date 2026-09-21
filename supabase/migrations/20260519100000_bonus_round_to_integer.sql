-- ════════════════════════════════════════════════════════════════════════════
-- 獎金金額四捨五入到整數（不能有小數點）
-- ────────────────────────────────────────────────────────────────────────────
-- 1:1 重寫 recalculate_store_bonus，唯一變動是 round(..., 2) → round(..., 0)
-- 涵蓋：bonus_pool / profit_bonus / target / merit / audit / punch / total / net
-- weight_ratio 維持 6 位小數（比例不是錢）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.recalculate_store_bonus(p_monthly_id INT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_monthly       store_bonus_monthly;
  v_excess        NUMERIC;
  v_pool          NUMERIC;
  v_total_weight  NUMERIC;
  v_is_target     BOOLEAN;
  v_emp           store_bonus_employee;
  v_cfg           store_bonus_role_config;
  v_ratio         NUMERIC;
  v_profit        NUMERIC;
  v_target_b      NUMERIC;
  v_merit_b       NUMERIC;
  v_audit_d       NUMERIC;
  v_punch_d       NUMERIC;
  v_total         NUMERIC;
  v_net           NUMERIC;
BEGIN
  SELECT * INTO v_monthly FROM store_bonus_monthly WHERE id = p_monthly_id;
  IF v_monthly.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  -- 1. 算門市層
  v_excess := GREATEST(0, v_monthly.actual_revenue - v_monthly.breakeven);
  v_pool   := v_excess * v_monthly.reward_pct;
  v_is_target := (v_monthly.actual_revenue >= v_monthly.target_revenue AND v_monthly.target_revenue > 0);
  SELECT COALESCE(SUM(weight), 0) INTO v_total_weight
    FROM store_bonus_employee WHERE monthly_id = p_monthly_id;

  UPDATE store_bonus_monthly SET
    bonus_pool         = round(v_pool::numeric, 0),
    is_target_achieved = v_is_target,
    total_weight       = v_total_weight
  WHERE id = p_monthly_id;

  -- 2. 算每個員工
  FOR v_emp IN
    SELECT * FROM store_bonus_employee WHERE monthly_id = p_monthly_id ORDER BY id
  LOOP
    SELECT * INTO v_cfg FROM store_bonus_role_config
     WHERE organization_id = v_monthly.organization_id AND role = v_emp.role;

    v_ratio    := CASE WHEN v_total_weight > 0 THEN v_emp.weight / v_total_weight ELSE 0 END;
    v_profit   := round((v_pool * v_ratio)::numeric, 0);
    v_target_b := CASE WHEN v_is_target THEN round(COALESCE(v_cfg.target_bonus_amount, 0)::numeric, 0) ELSE 0 END;
    v_merit_b  := round((v_emp.merit_count * COALESCE(v_cfg.merit_amount, 0))::numeric, 0);
    v_audit_d  := round(-(v_emp.absence_count * COALESCE(v_cfg.absence_deduct, 1000)
                        + v_emp.minor_offense_count * COALESCE(v_cfg.minor_offense_deduct, 2000))::numeric, 0);
    v_punch_d  := round(-GREATEST(0, v_emp.punch_correction_count - (COALESCE(v_cfg.punch_deduct_start, 5) - 1))
                        * COALESCE(v_cfg.punch_deduct_amount, 200)::numeric, 0);
    v_total    := round((v_profit + v_target_b + v_merit_b)::numeric, 0);
    v_net      := round(GREATEST(0, v_total + v_audit_d + v_punch_d + v_emp.prev_month_supplement)::numeric, 0);

    UPDATE store_bonus_employee SET
      weight_ratio    = round(v_ratio::numeric, 6),
      profit_bonus    = v_profit,
      target_bonus    = v_target_b,
      merit_bonus     = v_merit_b,
      audit_deduction = v_audit_d,
      punch_deduction = v_punch_d,
      total_bonus     = v_total,
      net_bonus       = v_net
    WHERE id = v_emp.id;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.recalculate_store_bonus(INT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
