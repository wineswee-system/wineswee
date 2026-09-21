-- ════════════════════════════════════════════════════════════════════════════
-- 門市業績獎金：紀律/獎勵分級
-- 2026-06-22
--
-- 扣項：缺失 / 小過 / 大過(新增)
-- 加項：小功 / 大功(取代原本單一「記功」)
--
-- 金額由使用者在「角色/扣項設定」自填（新欄預設 0）。
-- 遷移：把舊「記功」視為「小功」保留（merit_amount→minor_merit_amount、
--   merit_count→minor_merit_count，只在新欄還沒值時），確保既有資料不變。
-- recalc：merit_bonus 改小功+大功、audit 加大過；★ 保留上一版的 custom_adjust。
-- 全 idempotent。其餘 profit/達標/補卡/custom_adjust 逐字不動。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 角色設定新增金額欄（使用者自填，預設 0）──────────────────────────────
ALTER TABLE public.store_bonus_role_config
  ADD COLUMN IF NOT EXISTS major_offense_deduct NUMERIC(10,2) NOT NULL DEFAULT 0;  -- 大過扣/筆
ALTER TABLE public.store_bonus_role_config
  ADD COLUMN IF NOT EXISTS minor_merit_amount   NUMERIC(10,2) NOT NULL DEFAULT 0;  -- 小功獎金/筆
ALTER TABLE public.store_bonus_role_config
  ADD COLUMN IF NOT EXISTS major_merit_amount   NUMERIC(10,2) NOT NULL DEFAULT 0;  -- 大功獎金/筆

-- ─── 2. 員工明細新增次數欄 ───────────────────────────────────────────────────
ALTER TABLE public.store_bonus_employee
  ADD COLUMN IF NOT EXISTS major_offense_count INT NOT NULL DEFAULT 0;  -- 大過次
ALTER TABLE public.store_bonus_employee
  ADD COLUMN IF NOT EXISTS minor_merit_count   INT NOT NULL DEFAULT 0;  -- 小功次
ALTER TABLE public.store_bonus_employee
  ADD COLUMN IF NOT EXISTS major_merit_count   INT NOT NULL DEFAULT 0;  -- 大功次

-- ─── 3. 一次性遷移：舊「記功」→「小功」（只補沒值的，重跑無副作用）──────────
UPDATE public.store_bonus_role_config
   SET minor_merit_amount = merit_amount
 WHERE minor_merit_amount = 0 AND COALESCE(merit_amount,0) > 0;

UPDATE public.store_bonus_employee
   SET minor_merit_count = merit_count
 WHERE minor_merit_count = 0 AND COALESCE(merit_count,0) > 0;

-- ─── 4. recalc：merit=小功+大功、audit 加大過；保留 custom_adjust ────────────
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
  v_custom_adjust NUMERIC;
BEGIN
  SELECT * INTO v_monthly FROM store_bonus_monthly WHERE id = p_monthly_id;
  IF v_monthly.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

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

    -- ★ 加項：小功 + 大功
    v_merit_b := v_emp.minor_merit_count * COALESCE(v_cfg.minor_merit_amount, 0)
               + v_emp.major_merit_count * COALESCE(v_cfg.major_merit_amount, 0);

    -- ★ 扣項：缺失 + 小過 + 大過
    v_audit_d := -(v_emp.absence_count       * COALESCE(v_cfg.absence_deduct, 1000)
                 + v_emp.minor_offense_count * COALESCE(v_cfg.minor_offense_deduct, 2000)
                 + v_emp.major_offense_count * COALESCE(v_cfg.major_offense_deduct, 0));

    v_punch_d := -GREATEST(0, v_emp.punch_correction_count - (COALESCE(v_cfg.punch_deduct_start, 5) - 1))
                 * COALESCE(v_cfg.punch_deduct_amount, 200);

    -- 自訂欄位加減（保留上一版邏輯）
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

    v_total := v_profit + v_target_b + v_merit_b;
    v_net := GREATEST(0, v_total + v_audit_d + v_punch_d + v_emp.prev_month_supplement + v_custom_adjust);

    UPDATE store_bonus_employee SET
      weight_ratio    = round(v_ratio::numeric, 6),
      profit_bonus    = v_profit,
      target_bonus    = v_target_b,
      merit_bonus     = v_merit_b,
      audit_deduction = v_audit_d,
      punch_deduction = v_punch_d,
      custom_adjust   = v_custom_adjust,
      total_bonus     = v_total,
      net_bonus       = v_net
    WHERE id = v_emp.id;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.recalculate_store_bonus(INT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
