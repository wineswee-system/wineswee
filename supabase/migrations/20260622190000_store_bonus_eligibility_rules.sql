-- ════════════════════════════════════════════════════════════════════════════
-- 門市業績獎金：兩條領取資格原則
-- 2026-06-22
--
-- 1. 兼職：當月實際上班時數需 ≥ 最低工時(預設 80h)，否則不發。
-- 2. 正職：入職「次月」起才可領（入職當月不發）。
--
-- 做成角色設定可調(不寫死)：role_config 加 min_work_hours / bonus_from_next_month。
-- 預設只對 兼職(min 80) / 正職(次月) 生效；店長不受限。
-- 工時來源：attendance_records.total_hours 當月加總。
-- recalc：算出 work_hours + eligible，不符資格 → net_bonus = 0(各項照算供透明)。
--   ★ 保留上一版 custom_adjust + 小功/大功/大過。其餘逐字不動。idempotent。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 角色設定：資格參數 ───────────────────────────────────────────────────
ALTER TABLE public.store_bonus_role_config
  ADD COLUMN IF NOT EXISTS min_work_hours        NUMERIC(8,2) NOT NULL DEFAULT 0;     -- 0=不限；兼職預設 80
ALTER TABLE public.store_bonus_role_config
  ADD COLUMN IF NOT EXISTS bonus_from_next_month BOOLEAN      NOT NULL DEFAULT false; -- true=入職次月才可領

-- ─── 2. 員工明細：資格結果 ───────────────────────────────────────────────────
ALTER TABLE public.store_bonus_employee
  ADD COLUMN IF NOT EXISTS work_hours        NUMERIC(8,2) NOT NULL DEFAULT 0;
ALTER TABLE public.store_bonus_employee
  ADD COLUMN IF NOT EXISTS eligible          BOOLEAN      NOT NULL DEFAULT true;
ALTER TABLE public.store_bonus_employee
  ADD COLUMN IF NOT EXISTS ineligible_reason TEXT;

-- ─── 3. 設定預設(只補沒設定過的；店長維持不限)──────────────────────────────
UPDATE public.store_bonus_role_config SET min_work_hours = 80
 WHERE role = '兼職' AND min_work_hours = 0;
UPDATE public.store_bonus_role_config SET bonus_from_next_month = true
 WHERE role = '正職' AND bonus_from_next_month = false;

-- 新 org 預設也帶入（ensure 函式 ON CONFLICT DO NOTHING，只影響新建）
CREATE OR REPLACE FUNCTION public._ensure_store_bonus_role_config(p_org INT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.store_bonus_role_config
    (organization_id, role, weight, merit_amount, target_bonus_amount, min_work_hours, bonus_from_next_month)
  VALUES
    (p_org, '店長',   2.00, 3000, 2000,  0, false),
    (p_org, '正職',   1.50, 2000, 2000,  0, true),
    (p_org, '兼職',   1.00,    0,    0, 80, false)
  ON CONFLICT (organization_id, role) DO NOTHING;
END $$;

-- ─── 4. recalc：加 work_hours + eligible 閘（不符 → net 0）────────────────────
CREATE OR REPLACE FUNCTION public.recalculate_store_bonus(p_monthly_id INT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_monthly       store_bonus_monthly;
  v_mstart        date;
  v_mend          date;
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
  v_custom_adjust NUMERIC;
  v_work_hours    NUMERIC;
  v_join          date;
  v_eligible      BOOLEAN;
  v_reason        TEXT;
BEGIN
  SELECT * INTO v_monthly FROM store_bonus_monthly WHERE id = p_monthly_id;
  IF v_monthly.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  v_mstart := to_date(v_monthly.year_month || '-01', 'YYYY-MM-DD');
  v_mend   := (v_mstart + interval '1 month - 1 day')::date;

  v_excess := GREATEST(0, v_monthly.actual_revenue - v_monthly.breakeven);
  v_pool   := v_excess * v_monthly.reward_pct;
  v_is_target := (v_monthly.actual_revenue >= v_monthly.target_revenue AND v_monthly.target_revenue > 0);
  SELECT COALESCE(SUM(weight), 0) INTO v_total_weight
    FROM store_bonus_employee WHERE monthly_id = p_monthly_id;

  UPDATE store_bonus_monthly SET
    bonus_pool         = round(v_pool::numeric, 2),
    is_target_achieved = v_is_target,
    total_weight       = v_total_weight
  WHERE id = p_monthly_id;

  FOR v_emp IN
    SELECT * FROM store_bonus_employee WHERE monthly_id = p_monthly_id ORDER BY id
  LOOP
    SELECT * INTO v_cfg FROM store_bonus_role_config
     WHERE organization_id = v_monthly.organization_id AND role = v_emp.role;

    v_ratio := CASE WHEN v_total_weight > 0 THEN v_emp.weight / v_total_weight ELSE 0 END;
    v_profit := round((v_pool * v_ratio)::numeric, 2);
    v_target_b := CASE WHEN v_is_target THEN COALESCE(v_cfg.target_bonus_amount, 0) ELSE 0 END;

    v_merit_b := v_emp.minor_merit_count * COALESCE(v_cfg.minor_merit_amount, 0)
               + v_emp.major_merit_count * COALESCE(v_cfg.major_merit_amount, 0);

    v_audit_d := -(v_emp.absence_count       * COALESCE(v_cfg.absence_deduct, 1000)
                 + v_emp.minor_offense_count * COALESCE(v_cfg.minor_offense_deduct, 2000)
                 + v_emp.major_offense_count * COALESCE(v_cfg.major_offense_deduct, 0));

    v_punch_d := -GREATEST(0, v_emp.punch_correction_count - (COALESCE(v_cfg.punch_deduct_start, 5) - 1))
                 * COALESCE(v_cfg.punch_deduct_amount, 200);

    SELECT COALESCE(SUM(
      CASE
        WHEN (v_emp.custom_values->>f.id::text) ~ '^-?[0-9]+(\.[0-9]+)?$' THEN
          CASE f.effect
            WHEN 'add'    THEN  (v_emp.custom_values->>f.id::text)::numeric
            WHEN 'deduct' THEN -(v_emp.custom_values->>f.id::text)::numeric
            ELSE 0 END
        ELSE 0
      END
    ), 0)
    INTO v_custom_adjust
    FROM store_bonus_custom_fields f
    WHERE f.organization_id = v_monthly.organization_id
      AND f.is_active = true
      AND f.value_type = 'number'
      AND f.effect IN ('add','deduct');
    v_custom_adjust := round(COALESCE(v_custom_adjust, 0)::numeric, 2);

    -- ★ 領取資格：當月工時 + 入職次月
    SELECT COALESCE(SUM(ar.total_hours), 0) INTO v_work_hours
      FROM attendance_records ar
     WHERE ar.employee_id = v_emp.employee_id
       AND ar.date >= v_mstart AND ar.date <= v_mend;
    v_work_hours := round(COALESCE(v_work_hours, 0)::numeric, 2);

    SELECT join_date INTO v_join FROM employees WHERE id = v_emp.employee_id;

    v_eligible := true;
    v_reason   := NULL;
    IF COALESCE(v_cfg.min_work_hours, 0) > 0 AND v_work_hours < v_cfg.min_work_hours THEN
      v_eligible := false;
      v_reason   := format('當月工時 %s 未滿 %s 小時', v_work_hours, round(v_cfg.min_work_hours, 0));
    END IF;
    IF v_eligible AND COALESCE(v_cfg.bonus_from_next_month, false)
       AND v_join IS NOT NULL AND date_trunc('month', v_join)::date >= v_mstart THEN
      v_eligible := false;
      v_reason   := '入職當月不發（次月起）';
    END IF;

    v_total := v_profit + v_target_b + v_merit_b;
    v_net := CASE WHEN v_eligible
      THEN GREATEST(0, v_total + v_audit_d + v_punch_d + v_emp.prev_month_supplement + v_custom_adjust)
      ELSE 0 END;

    UPDATE store_bonus_employee SET
      weight_ratio      = round(v_ratio::numeric, 6),
      profit_bonus      = v_profit,
      target_bonus      = v_target_b,
      merit_bonus       = v_merit_b,
      audit_deduction   = v_audit_d,
      punch_deduction   = v_punch_d,
      custom_adjust     = v_custom_adjust,
      work_hours        = v_work_hours,
      eligible          = v_eligible,
      ineligible_reason = v_reason,
      total_bonus       = v_total,
      net_bonus         = v_net
    WHERE id = v_emp.id;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.recalculate_store_bonus(INT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
