-- ① 獎懲對齊《公司獎懲制度辦法》:三級一致 嘉獎+500/小功+1500/大功+4500、申誡-500/小過-1500/大過-4500
ALTER TABLE public.store_bonus_role_config ADD COLUMN IF NOT EXISTS commend_amount   numeric(12,2) DEFAULT 500;
ALTER TABLE public.store_bonus_role_config ADD COLUMN IF NOT EXISTS reprimand_deduct numeric(12,2) DEFAULT 500;
ALTER TABLE public.store_bonus_employee    ADD COLUMN IF NOT EXISTS commend_count   int DEFAULT 0;
ALTER TABLE public.store_bonus_employee    ADD COLUMN IF NOT EXISTS reprimand_count int DEFAULT 0;

UPDATE public.store_bonus_role_config SET
  commend_amount=500, minor_merit_amount=1500, major_merit_amount=4500,
  reprimand_deduct=500, minor_offense_deduct=1500, major_offense_deduct=4500
WHERE organization_id = 1;

CREATE OR REPLACE FUNCTION public.recalculate_store_bonus(p_monthly_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_m store_bonus_monthly; v_org int;
  v_hq numeric; v_net numeric; v_rate numeric; v_tier numeric; v_pool numeric;
  v_is_target boolean; v_total_weight numeric; v_has_mgr boolean;
  v_mstart date; v_mend date;
  r record; v_cfg store_bonus_role_config;
  v_ratio numeric; v_mgmt numeric; v_target numeric; v_merit numeric;
  v_audit numeric; v_punch numeric; v_custom numeric; v_total numeric; v_net_bonus numeric;
  v_wh numeric; v_join date; v_elig boolean; v_reason text;
  cf record; v_val numeric;
  v_yr int; v_mon int; v_qend_mon int; v_qend date; v_seniority int;
BEGIN
  SELECT * INTO v_m FROM store_bonus_monthly WHERE id = p_monthly_id;
  IF v_m.id IS NULL THEN RETURN; END IF;
  v_org := v_m.organization_id;
  v_mstart := (v_m.year_month || '-01')::date;
  v_mend   := (v_mstart + INTERVAL '1 month - 1 day')::date;

  -- 淨利:營業毛利 − 費用 − 稅損 − 營業額×總部成本%
  v_hq   := round(COALESCE(v_m.actual_revenue,0) * COALESCE(v_m.hq_cost_pct,0.07), 2);
  v_net  := COALESCE(v_m.gross_profit,0) - COALESCE(v_m.operating_expense,0) - COALESCE(v_m.tax_loss,0) - v_hq;
  v_rate := CASE WHEN COALESCE(v_m.actual_revenue,0) > 0 THEN v_net / v_m.actual_revenue ELSE 0 END;
  v_tier := CASE WHEN v_rate >= 0.06 THEN 0.10 WHEN v_rate >= 0.03 THEN 0.05 ELSE 0 END;
  v_pool := round(GREATEST(0, v_net) * v_tier, 2);
  v_is_target := (COALESCE(v_m.actual_revenue,0) >= COALESCE(v_m.target_revenue,0) AND COALESCE(v_m.target_revenue,0) > 0);
  v_has_mgr := EXISTS (SELECT 1 FROM store_bonus_employee WHERE monthly_id = p_monthly_id AND role = '店長');

  -- 本月所屬季的結算日(季末月最後一天)— 供年資滿90天判定
  v_yr  := split_part(v_m.year_month,'-',1)::int;
  v_mon := split_part(v_m.year_month,'-',2)::int;
  SELECT max(x.mm) INTO v_qend_mon FROM (
    SELECT unnest(months) mm, months FROM store_bonus_quarter_def WHERE organization_id = v_org
  ) x WHERE v_mon = ANY(x.months);
  IF v_qend_mon IS NULL THEN v_qend_mon := (ceil(v_mon/3.0)*3)::int; END IF;
  v_qend := (make_date(v_yr, v_qend_mon, 1) + INTERVAL '1 month - 1 day')::date;

  -- === 第一段:逐人判定資格(最低工時 / 年資滿90天) ===
  FOR r IN SELECT * FROM store_bonus_employee WHERE monthly_id = p_monthly_id LOOP
    SELECT * INTO v_cfg FROM store_bonus_role_config WHERE organization_id = v_org AND role = r.role;
    SELECT round(COALESCE(SUM(total_hours),0),2) INTO v_wh FROM attendance_records
      WHERE employee_id = r.employee_id AND date BETWEEN v_mstart AND v_mend;
    SELECT join_date INTO v_join FROM employees WHERE id = r.employee_id;
    v_elig := true; v_reason := NULL;
    IF COALESCE(v_cfg.min_work_hours,0) > 0 AND v_wh < v_cfg.min_work_hours THEN
      v_elig := false; v_reason := '本月工時 '||v_wh||' 未達 '||v_cfg.min_work_hours||' 小時';
    ELSIF COALESCE(v_cfg.bonus_from_next_month,false) AND v_join IS NOT NULL THEN
      v_seniority := (v_qend - v_join);
      IF v_seniority < 90 THEN
        v_elig := false; v_reason := '年資 '||v_seniority||' 天,未滿90天(當季結算日)';
      END IF;
    END IF;
    UPDATE store_bonus_employee SET work_hours = v_wh, eligible = v_elig, ineligible_reason = v_reason WHERE id = r.id;
  END LOOP;

  -- === 分母:只加「符合資格」的份數(有店長時代理/督導不佔管理份) ===
  SELECT COALESCE(SUM(CASE WHEN v_has_mgr AND role IN ('代理人','督導') THEN 0 ELSE weight END),0)
    INTO v_total_weight FROM store_bonus_employee WHERE monthly_id = p_monthly_id AND eligible;

  UPDATE store_bonus_monthly SET
    net_profit = round(v_net,2), net_profit_rate = round(v_rate,4),
    mgmt_tier_pct = v_tier, mgmt_bonus_pool = v_pool, bonus_pool = v_pool,
    is_target_achieved = v_is_target, total_weight = v_total_weight, updated_at = now()
  WHERE id = p_monthly_id;

  -- === 第二段:依「符合資格份數」分配 ===
  FOR r IN SELECT * FROM store_bonus_employee WHERE monthly_id = p_monthly_id LOOP
    SELECT * INTO v_cfg FROM store_bonus_role_config WHERE organization_id = v_org AND role = r.role;

    -- 不符資格:整列歸0(保留 eligible/reason/work_hours)
    IF NOT r.eligible THEN
      UPDATE store_bonus_employee SET
        weight_ratio = 0, mgmt_bonus = 0, profit_bonus = 0,
        target_bonus = 0, merit_bonus = 0, audit_deduction = 0, punch_deduction = 0,
        custom_adjust = 0, total_bonus = 0, net_bonus = 0, updated_at = now()
      WHERE id = r.id;
      CONTINUE;
    END IF;

    v_ratio  := CASE WHEN v_total_weight > 0 THEN (CASE WHEN v_has_mgr AND r.role IN ('代理人','督導') THEN 0 ELSE r.weight END) / v_total_weight ELSE 0 END;
    v_mgmt   := round(GREATEST(0, v_pool - COALESCE(v_m.team_deduction,0) + COALESCE(v_m.team_addition,0)) * v_ratio, 2);
    v_target := CASE WHEN v_is_target THEN COALESCE(v_cfg.target_bonus_amount,0) ELSE 0 END;
    v_merit  := COALESCE(r.minor_merit_count,0)*COALESCE(v_cfg.minor_merit_amount,0)
              + COALESCE(r.major_merit_count,0)*COALESCE(v_cfg.major_merit_amount,0)
              + COALESCE(r.commend_count,0)*COALESCE(v_cfg.commend_amount,0);
    v_audit  := -( COALESCE(r.absence_count,0)*COALESCE(v_cfg.absence_deduct,1000)
                 + COALESCE(r.minor_offense_count,0)*COALESCE(v_cfg.minor_offense_deduct,2000)
                 + COALESCE(r.major_offense_count,0)*COALESCE(v_cfg.major_offense_deduct,0)
                 + COALESCE(r.sick_leave_count,0)*COALESCE(v_cfg.sick_leave_deduct,100)
                 + COALESCE(r.personal_leave_count,0)*COALESCE(v_cfg.personal_leave_deduct,200)
                 + COALESCE(r.annual_leave_count,0)*COALESCE(v_cfg.annual_leave_deduct,200)
                 + COALESCE(r.complaint_count,0)*COALESCE(v_cfg.complaint_deduct,500)
                 + COALESCE(r.reprimand_count,0)*COALESCE(v_cfg.reprimand_deduct,500) );
    v_punch  := -GREATEST(0, COALESCE(r.punch_correction_count,0) - (COALESCE(v_cfg.punch_deduct_start,5)-1))
                 * COALESCE(v_cfg.punch_deduct_amount,200);

    -- 自訂加/扣項
    v_custom := 0;
    FOR cf IN SELECT * FROM store_bonus_custom_fields
              WHERE organization_id = v_org AND is_active AND effect IN ('add','deduct') AND value_type='number' LOOP
      BEGIN v_val := NULLIF(r.custom_values->>cf.id::text,'')::numeric; EXCEPTION WHEN OTHERS THEN v_val := 0; END;
      v_val := COALESCE(v_val,0);
      v_custom := v_custom + CASE WHEN cf.effect='add' THEN v_val ELSE -v_val END;
    END LOOP;
    v_custom := round(v_custom,2);

    v_total := v_mgmt + v_target + v_merit;
    v_net_bonus := GREATEST(0, v_total + v_audit + v_punch + COALESCE(r.prev_month_supplement,0) + v_custom);

    UPDATE store_bonus_employee SET
      weight_ratio = round(v_ratio,6),
      mgmt_bonus = v_mgmt, profit_bonus = 0,
      target_bonus = v_target, merit_bonus = v_merit,
      audit_deduction = v_audit, punch_deduction = v_punch,
      custom_adjust = v_custom, total_bonus = v_total,
      net_bonus = v_net_bonus, updated_at = now()
    WHERE id = r.id;
  END LOOP;
END $function$
;

NOTIFY pgrst, 'reload schema';
