-- ════════════════════════════════════════════════════════════════════════════
-- 門市業績獎金系統
-- ────────────────────────────────────────────────────────────────────────────
-- 3 個表：
--   1. store_bonus_role_config  - 角色權重 / 獎金 / 扣項規則（per organization）
--   2. store_bonus_monthly      - 門市月度結算（業績 / 損益兩平 / 目標）
--   3. store_bonus_employee     - 員工月度明細（每人損益獎金 + 扣項 + 應發）
--
-- 2 個 RPC：
--   - initialize_store_bonus(store_id, ym) → 開單，自動拉在職員工
--   - recalculate_store_bonus(monthly_id)  → 重算所有員工 net_bonus
--
-- 計算邏輯：
--   獎金池 = max(0, 業績 - 損益兩平) × reward_pct (預設 2%)
--   個人權重比 = weight / 該店總權重
--   損益獎金 = 獎金池 × 個人權重比
--   達標獎金 = (業績 >= 目標) ? config.target_bonus_amount : 0
--   記功獎金 = merit_count × config.merit_amount  (店長 3000 / 正職 2000 / 兼職 0)
--   稽核扣項 = -(缺失 × 1000 + 小過 × 2000)
--   補卡扣項 = -max(0, 補卡次數 - 4) × 200  (第 5 次起每次 -200)
--   應發 = max(0, 損益 + 達標 + 記功 + 稽核 + 補卡 + 前月補發)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 角色權重 / 獎金 / 扣項設定 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_bonus_role_config (
  id                    SERIAL PRIMARY KEY,
  organization_id       INT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role                  TEXT NOT NULL CHECK (role IN ('店長','正職','兼職')),
  weight                NUMERIC(6,2) NOT NULL DEFAULT 1,         -- 2 / 1.5 / 1
  merit_amount          NUMERIC(10,2) NOT NULL DEFAULT 0,        -- 記功每筆獎金（店長 3000 / 正職 2000 / 兼職 0）
  target_bonus_amount   NUMERIC(10,2) NOT NULL DEFAULT 0,        -- 達標獎金（店長/正職 2000，兼職 0）
  absence_deduct        NUMERIC(10,2) NOT NULL DEFAULT 1000,     -- 每筆缺失扣
  minor_offense_deduct  NUMERIC(10,2) NOT NULL DEFAULT 2000,     -- 每筆小過扣
  punch_deduct_start    INT NOT NULL DEFAULT 5,                  -- 第幾次起扣補卡
  punch_deduct_amount   NUMERIC(10,2) NOT NULL DEFAULT 200,      -- 每次扣多少
  reward_pct            NUMERIC(5,4) NOT NULL DEFAULT 0.02,      -- 獎勵 %（個別 role 可調，通常統一）
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, role)
);

-- 預設配置（org 自動帶 3 個 role）
CREATE OR REPLACE FUNCTION public._ensure_store_bonus_role_config(p_org INT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.store_bonus_role_config
    (organization_id, role, weight, merit_amount, target_bonus_amount)
  VALUES
    (p_org, '店長',   2.00, 3000, 2000),
    (p_org, '正職',   1.50, 2000, 2000),
    (p_org, '兼職',   1.00,    0,    0)
  ON CONFLICT (organization_id, role) DO NOTHING;
END $$;


-- ─── 2. 門市月度結算 ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_bonus_monthly (
  id                SERIAL PRIMARY KEY,
  organization_id   INT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id          INT NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  year_month        TEXT NOT NULL,                     -- 'YYYY-MM'
  -- 主管輸入
  breakeven         NUMERIC(12,2) NOT NULL DEFAULT 0,  -- 損益兩平
  target_revenue    NUMERIC(12,2) NOT NULL DEFAULT 0,  -- 目標
  actual_revenue    NUMERIC(12,2) NOT NULL DEFAULT 0,  -- 本月業績
  reward_pct        NUMERIC(5,4)  NOT NULL DEFAULT 0.02,
  -- 計算後（recalculate 時更新）
  bonus_pool        NUMERIC(12,2) NOT NULL DEFAULT 0,  -- 獎金池
  is_target_achieved BOOLEAN     NOT NULL DEFAULT false,
  total_weight      NUMERIC(8,2) NOT NULL DEFAULT 0,   -- 該店在職員工總權重
  -- 結算狀態
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized')),
  finalized_at      TIMESTAMPTZ,
  finalized_by      INT REFERENCES public.employees(id) ON DELETE SET NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_store_bonus_monthly_org_ym
  ON public.store_bonus_monthly(organization_id, year_month);


-- ─── 3. 員工月度獎金明細 ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_bonus_employee (
  id                       SERIAL PRIMARY KEY,
  monthly_id               INT NOT NULL REFERENCES public.store_bonus_monthly(id) ON DELETE CASCADE,
  employee_id              INT NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  employee_name            TEXT NOT NULL,                     -- snapshot
  role                     TEXT NOT NULL,                     -- snapshot ('店長'/'正職'/'兼職')
  weight                   NUMERIC(6,2) NOT NULL,             -- snapshot
  weight_ratio             NUMERIC(8,6) NOT NULL DEFAULT 0,   -- weight / total_weight
  -- 計算結果（recalculate 時更新）
  profit_bonus             NUMERIC(10,2) NOT NULL DEFAULT 0,  -- 損益獎金 = bonus_pool × weight_ratio
  target_bonus             NUMERIC(10,2) NOT NULL DEFAULT 0,  -- 達標獎金
  merit_bonus              NUMERIC(10,2) NOT NULL DEFAULT 0,  -- 記功獎金 = merit_count × merit_amount
  audit_deduction          NUMERIC(10,2) NOT NULL DEFAULT 0,  -- 稽核扣項（負數）
  punch_deduction          NUMERIC(10,2) NOT NULL DEFAULT 0,  -- 補卡扣項（負數）
  total_bonus              NUMERIC(10,2) NOT NULL DEFAULT 0,  -- profit + target + merit
  net_bonus                NUMERIC(10,2) NOT NULL DEFAULT 0,  -- 應發 = max(0, total + audit + punch + supplement)
  -- 主管輸入（草稿可改）
  merit_count              INT NOT NULL DEFAULT 0,            -- 記功次數
  absence_count            INT NOT NULL DEFAULT 0,            -- 缺失次數
  minor_offense_count      INT NOT NULL DEFAULT 0,            -- 小過次數
  punch_correction_count   INT NOT NULL DEFAULT 0,            -- 補卡達扣薪次數
  prev_month_supplement    NUMERIC(10,2) NOT NULL DEFAULT 0,  -- 前月補發
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (monthly_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_store_bonus_emp_monthly
  ON public.store_bonus_employee(monthly_id);


-- ─── 4. updated_at trigger（共用） ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._store_bonus_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sb_role_config_touch  ON public.store_bonus_role_config;
DROP TRIGGER IF EXISTS trg_sb_monthly_touch      ON public.store_bonus_monthly;
DROP TRIGGER IF EXISTS trg_sb_employee_touch     ON public.store_bonus_employee;
CREATE TRIGGER trg_sb_role_config_touch  BEFORE UPDATE ON public.store_bonus_role_config FOR EACH ROW EXECUTE FUNCTION public._store_bonus_touch_updated_at();
CREATE TRIGGER trg_sb_monthly_touch      BEFORE UPDATE ON public.store_bonus_monthly     FOR EACH ROW EXECUTE FUNCTION public._store_bonus_touch_updated_at();
CREATE TRIGGER trg_sb_employee_touch     BEFORE UPDATE ON public.store_bonus_employee    FOR EACH ROW EXECUTE FUNCTION public._store_bonus_touch_updated_at();


-- ─── 5. 員工 role 判定 helper ─────────────────────────────────────────────
-- 從 employees.position 字串 + stores.manager_id 推 role：
--   - employees.id = stores.manager_id (該店店長) → '店長'
--   - position 含「PT」「兼職」「工讀」「實習」→ '兼職'
--   - 其他 → '正職'
CREATE OR REPLACE FUNCTION public._guess_employee_bonus_role(p_emp_id INT, p_store_id INT)
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_pos TEXT;
  v_is_manager BOOLEAN;
BEGIN
  SELECT position INTO v_pos FROM employees WHERE id = p_emp_id;
  SELECT (manager_id = p_emp_id) INTO v_is_manager FROM stores WHERE id = p_store_id;
  IF v_is_manager IS TRUE THEN RETURN '店長'; END IF;
  IF v_pos ~* '(PT|兼職|工讀|實習|part)' THEN RETURN '兼職'; END IF;
  RETURN '正職';
END $$;


-- ─── 6. initialize_store_bonus（開單） ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.initialize_store_bonus(
  p_store_id   INT,
  p_year_month TEXT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org_id   INT;
  v_monthly_id INT;
  v_emp      RECORD;
  v_role     TEXT;
  v_weight   NUMERIC;
BEGIN
  SELECT organization_id INTO v_org_id FROM stores WHERE id = p_store_id;
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'STORE_NOT_FOUND'; END IF;

  -- 確保 role_config 有預設值
  PERFORM public._ensure_store_bonus_role_config(v_org_id);

  -- 找現有的 monthly 或新建
  SELECT id INTO v_monthly_id FROM store_bonus_monthly
   WHERE store_id = p_store_id AND year_month = p_year_month;

  IF v_monthly_id IS NULL THEN
    INSERT INTO store_bonus_monthly (organization_id, store_id, year_month)
    VALUES (v_org_id, p_store_id, p_year_month)
    RETURNING id INTO v_monthly_id;
  END IF;

  -- 不要動已 finalized 的單
  IF (SELECT status FROM store_bonus_monthly WHERE id = v_monthly_id) = 'finalized' THEN
    RAISE EXCEPTION 'ALREADY_FINALIZED';
  END IF;

  -- 拉該店在職員工（包含 store_id 直接 link 跟 store 名字 fallback）
  FOR v_emp IN
    SELECT e.id, e.name
      FROM employees e
     WHERE e.organization_id = v_org_id
       AND e.status = '在職'
       AND e.store_id = p_store_id
     ORDER BY e.id
  LOOP
    v_role := public._guess_employee_bonus_role(v_emp.id, p_store_id);
    SELECT weight INTO v_weight FROM store_bonus_role_config
     WHERE organization_id = v_org_id AND role = v_role;

    INSERT INTO store_bonus_employee (
      monthly_id, employee_id, employee_name, role, weight
    ) VALUES (
      v_monthly_id, v_emp.id, v_emp.name, v_role, COALESCE(v_weight, 1)
    )
    ON CONFLICT (monthly_id, employee_id) DO UPDATE
      SET employee_name = EXCLUDED.employee_name,
          role          = EXCLUDED.role,
          weight        = EXCLUDED.weight;
  END LOOP;

  -- 第一輪 recalculate（業績欄都 0 所以 bonus_pool=0，員工只先建出 row）
  PERFORM public.recalculate_store_bonus(v_monthly_id);

  RETURN v_monthly_id;
END $$;

GRANT EXECUTE ON FUNCTION public.initialize_store_bonus(INT, TEXT) TO authenticated;


-- ─── 7. recalculate_store_bonus（重算） ───────────────────────────────────
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
    v_total := v_profit + v_target_b + v_merit_b;
    v_net := GREATEST(0, v_total + v_audit_d + v_punch_d + v_emp.prev_month_supplement);

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


-- ─── 8. finalize（結算鎖定） ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_store_bonus(
  p_monthly_id INT,
  p_finalizer_emp_id INT
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.recalculate_store_bonus(p_monthly_id);
  UPDATE store_bonus_monthly SET
    status        = 'finalized',
    finalized_at  = NOW(),
    finalized_by  = p_finalizer_emp_id
  WHERE id = p_monthly_id AND status = 'draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ALREADY_FINALIZED_OR_NOT_FOUND';
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.finalize_store_bonus(INT, INT) TO authenticated;


-- ─── 9. RLS（authenticated 全開，對齊既有 HR 表）─────────────────────────
ALTER TABLE public.store_bonus_role_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_bonus_monthly     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_bonus_employee    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sb_role_config_auth_all ON public.store_bonus_role_config;
DROP POLICY IF EXISTS sb_monthly_auth_all     ON public.store_bonus_monthly;
DROP POLICY IF EXISTS sb_employee_auth_all    ON public.store_bonus_employee;
CREATE POLICY sb_role_config_auth_all ON public.store_bonus_role_config FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY sb_monthly_auth_all     ON public.store_bonus_monthly     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY sb_employee_auth_all    ON public.store_bonus_employee    FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_bonus_role_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_bonus_monthly     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_bonus_employee    TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.store_bonus_role_config_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.store_bonus_monthly_id_seq     TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.store_bonus_employee_id_seq    TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
