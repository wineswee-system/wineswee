-- 營運獎金辦法 Phase2b:店層團隊扣(稽核/客訴/盤損 人工填總額)從管理獎金池扣後再分配 — 2026-09-14
ALTER TABLE public.store_bonus_monthly ADD COLUMN IF NOT EXISTS team_deduction numeric(12,2) DEFAULT 0;

CREATE OR REPLACE FUNCTION public.recalculate_store_bonus(p_monthly_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_m store_bonus_monthly; v_org int;
  v_hq numeric; v_net numeric; v_rate numeric; v_tier numeric; v_pool numeric;
  v_is_target boolean; v_total_weight numeric;
  v_mstart date; v_mend date;
  r record; v_cfg store_bonus_role_config;
  v_ratio numeric; v_mgmt numeric; v_target numeric; v_merit numeric;
  v_audit numeric; v_punch numeric; v_custom numeric; v_total numeric; v_net_bonus numeric;
  v_wh numeric; v_join date; v_elig boolean; v_reason text;
  cf record; v_val numeric;
BEGIN
  SELECT * INTO v_m FROM store_bonus_monthly WHERE id = p_monthly_id;
  IF v_m.id IS NULL THEN RETURN; END IF;
  v_org := v_m.organization_id;
  v_mstart := (v_m.year_month || '-01')::date;
  v_mend   := (v_mstart + INTERVAL '1 month - 1 day')::date;

  -- 店層:總部成本→淨利→淨利率→分級→管理獎金池
  v_hq   := round(COALESCE(v_m.actual_revenue,0) * COALESCE(v_m.hq_cost_pct,0.07), 2);
  v_net  := COALESCE(v_m.gross_profit,0) - COALESCE(v_m.operating_expense,0) - COALESCE(v_m.tax_loss,0) - v_hq;
  v_rate := CASE WHEN COALESCE(v_m.actual_revenue,0) > 0 THEN v_net / v_m.actual_revenue ELSE 0 END;
  v_tier := CASE WHEN v_rate >= 0.06 THEN 0.10 WHEN v_rate >= 0.03 THEN 0.05 ELSE 0 END;
  v_pool := round(GREATEST(0, v_net) * v_tier, 2);
  v_is_target := (COALESCE(v_m.actual_revenue,0) >= COALESCE(v_m.target_revenue,0) AND COALESCE(v_m.target_revenue,0) > 0);
  SELECT COALESCE(SUM(weight),0) INTO v_total_weight FROM store_bonus_employee WHERE monthly_id = p_monthly_id;

  UPDATE store_bonus_monthly SET
    net_profit = round(v_net,2), net_profit_rate = round(v_rate,4),
    mgmt_tier_pct = v_tier, mgmt_bonus_pool = v_pool, bonus_pool = v_pool,
    is_target_achieved = v_is_target, total_weight = v_total_weight, updated_at = now()
  WHERE id = p_monthly_id;

  FOR r IN SELECT * FROM store_bonus_employee WHERE monthly_id = p_monthly_id LOOP
    SELECT * INTO v_cfg FROM store_bonus_role_config WHERE organization_id = v_org AND role = r.role;
    v_ratio  := CASE WHEN v_total_weight > 0 THEN r.weight / v_total_weight ELSE 0 END;
    v_mgmt   := round(GREATEST(0, v_pool - COALESCE(v_m.team_deduction,0)) * v_ratio, 2);
    v_target := CASE WHEN v_is_target THEN COALESCE(v_cfg.target_bonus_amount,0) ELSE 0 END;
    v_merit  := COALESCE(r.minor_merit_count,0)*COALESCE(v_cfg.minor_merit_amount,0)
              + COALESCE(r.major_merit_count,0)*COALESCE(v_cfg.major_merit_amount,0);
    v_audit  := -( COALESCE(r.absence_count,0)*COALESCE(v_cfg.absence_deduct,1000)
                 + COALESCE(r.minor_offense_count,0)*COALESCE(v_cfg.minor_offense_deduct,2000)
                 + COALESCE(r.major_offense_count,0)*COALESCE(v_cfg.major_offense_deduct,0) );
    v_punch  := -GREATEST(0, COALESCE(r.punch_correction_count,0) - (COALESCE(v_cfg.punch_deduct_start,5)-1))
                 * COALESCE(v_cfg.punch_deduct_amount,200);

    -- 自訂欄位加/扣
    v_custom := 0;
    FOR cf IN SELECT * FROM store_bonus_custom_fields
              WHERE organization_id = v_org AND is_active AND effect IN ('add','deduct') AND value_type='number' LOOP
      BEGIN v_val := NULLIF(r.custom_values->>cf.id::text,'')::numeric; EXCEPTION WHEN OTHERS THEN v_val := 0; END;
      v_val := COALESCE(v_val,0);
      v_custom := v_custom + CASE WHEN cf.effect='add' THEN v_val ELSE -v_val END;
    END LOOP;
    v_custom := round(v_custom,2);

    v_total := v_mgmt + v_target + v_merit;

    -- 資格閘:最低工時 / 入職次月才發
    SELECT round(COALESCE(SUM(total_hours),0),2) INTO v_wh FROM attendance_records
      WHERE employee_id = r.employee_id AND date BETWEEN v_mstart AND v_mend;
    SELECT join_date INTO v_join FROM employees WHERE id = r.employee_id;
    v_elig := true; v_reason := NULL;
    IF COALESCE(v_cfg.min_work_hours,0) > 0 AND v_wh < v_cfg.min_work_hours THEN
      v_elig := false; v_reason := '當月工時 '||v_wh||' 未滿 '||v_cfg.min_work_hours||' 小時';
    ELSIF COALESCE(v_cfg.bonus_from_next_month,false) AND v_join IS NOT NULL AND date_trunc('month', v_join) >= v_mstart THEN
      v_elig := false; v_reason := '入職當月不發（次月起）';
    END IF;
    v_net_bonus := CASE WHEN v_elig
      THEN GREATEST(0, v_total + v_audit + v_punch + COALESCE(r.prev_month_supplement,0) + v_custom)
      ELSE 0 END;

    UPDATE store_bonus_employee SET
      weight_ratio = round(v_ratio,6),
      mgmt_bonus = v_mgmt, profit_bonus = 0,
      target_bonus = v_target, merit_bonus = v_merit,
      audit_deduction = v_audit, punch_deduction = v_punch,
      custom_adjust = v_custom, total_bonus = v_total,
      net_bonus = v_net_bonus, work_hours = v_wh,
      eligible = v_elig, ineligible_reason = v_reason, updated_at = now()
    WHERE id = r.id;
  END LOOP;
END $function$
;

NOTIFY pgrst, 'reload schema';
