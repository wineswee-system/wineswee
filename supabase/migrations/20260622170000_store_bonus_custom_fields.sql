-- ════════════════════════════════════════════════════════════════════════════
-- 門市業績獎金：自訂欄位系統（員工層，可進計算）
-- 2026-06-22
--
-- 讓使用者自行新增員工表欄位、定義(名稱/型別/效果)、調整顯示順序。
-- 效果 add/deduct 的數字欄位會「加進/扣掉」應發(net_bonus)。
--
-- 純加法：recalculate_store_bonus 只新增「custom_adjust」一項，
--   既有 profit/target/merit/audit/punch 計算逐字不動。
-- 全 idempotent。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 自訂欄位定義表（org 層，套用所有門市）────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_bonus_custom_fields (
  id              SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  value_type      TEXT NOT NULL DEFAULT 'number' CHECK (value_type IN ('number','text')),
  effect          TEXT NOT NULL DEFAULT 'none'   CHECK (effect IN ('none','add','deduct')),
  sort_order      INT  NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 進計算(加/扣)的欄位必須是數字型別
  CONSTRAINT sbcf_effect_requires_number CHECK (effect = 'none' OR value_type = 'number')
);

CREATE INDEX IF NOT EXISTS idx_sbcf_org_active
  ON public.store_bonus_custom_fields(organization_id, is_active, sort_order);

-- updated_at trigger（沿用既有共用函式）
DROP TRIGGER IF EXISTS trg_sbcf_touch ON public.store_bonus_custom_fields;
CREATE TRIGGER trg_sbcf_touch BEFORE UPDATE ON public.store_bonus_custom_fields
  FOR EACH ROW EXECUTE FUNCTION public._store_bonus_touch_updated_at();


-- ─── 2. store_bonus_employee 加自訂值 + 計算後加減總額（加法）─────────────────
ALTER TABLE public.store_bonus_employee
  ADD COLUMN IF NOT EXISTS custom_values JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.store_bonus_employee
  ADD COLUMN IF NOT EXISTS custom_adjust NUMERIC(10,2) NOT NULL DEFAULT 0;


-- ─── 3. recalculate_store_bonus：只「加一項 custom_adjust」，其餘逐字不動 ──────
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
  v_custom_adjust NUMERIC;   -- ★ 新增：自訂欄位加減總額
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
    bonus_pool         = round(v_pool::numeric, 2),
    is_target_achieved = v_is_target,
    total_weight       = v_total_weight
  WHERE id = p_monthly_id;

  -- 2. 算每個員工
  FOR v_emp IN
    SELECT * FROM store_bonus_employee WHERE monthly_id = p_monthly_id ORDER BY id
  LOOP
    SELECT * INTO v_cfg FROM store_bonus_role_config
     WHERE organization_id = v_monthly.organization_id AND role = v_emp.role;

    v_ratio := CASE WHEN v_total_weight > 0 THEN v_emp.weight / v_total_weight ELSE 0 END;
    v_profit := round((v_pool * v_ratio)::numeric, 2);
    v_target_b := CASE WHEN v_is_target THEN COALESCE(v_cfg.target_bonus_amount, 0) ELSE 0 END;
    v_merit_b := v_emp.merit_count * COALESCE(v_cfg.merit_amount, 0);
    v_audit_d := -(v_emp.absence_count * COALESCE(v_cfg.absence_deduct, 1000)
                 + v_emp.minor_offense_count * COALESCE(v_cfg.minor_offense_deduct, 2000));
    v_punch_d := -GREATEST(0, v_emp.punch_correction_count - (COALESCE(v_cfg.punch_deduct_start, 5) - 1))
                 * COALESCE(v_cfg.punch_deduct_amount, 200);

    -- ★ 自訂欄位加減：只取 is_active + number + 效果 add/deduct；值非數字一律當 0（不炸 recalc）
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


-- ─── 4. RLS / grants（比照其他 store_bonus 表，authenticated 全開）───────────
ALTER TABLE public.store_bonus_custom_fields ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sbcf_auth_all ON public.store_bonus_custom_fields;
CREATE POLICY sbcf_auth_all ON public.store_bonus_custom_fields FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_bonus_custom_fields TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.store_bonus_custom_fields_id_seq TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
