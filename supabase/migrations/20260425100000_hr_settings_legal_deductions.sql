-- ============================================================
-- HR 設定擴充：薪資自訂津貼 + 法扣 + 加班/請假最小單位
--
-- 4 個變動：
--   1. salary_structures 加 custom_allowances JSONB
--      → 廠商可自訂任意數量的津貼項目（夜班/主管/證照/外語...）
--      → 結構：[{"name": "夜班津貼", "amount": 3000}, ...]
--
--   2. 新表 legal_deductions（法扣）
--      → 員工/標題/總額/每月金額/已扣金額/已扣月數/開始月份/狀態
--      → 多筆並存、進度追蹤
--      → 當月薪水不夠扣 → 該月扣多少算多少，未扣完延後
--
--   3. stores 加 overtime_step_hours（加班最小單位倍數）
--      → 預設 0.5 hr，廠商可設 0.25 / 0.5 / 1 等
--      → 申請時只能是 step 的整數倍（0.5 → 0.5, 1, 1.5, 2...）
--
--   4. 新表 leave_step_settings（每假別的最小單位倍數）
--      → per store + per leave_code 設定 step
--      → 沒設定 fallback 到 leavePolicy.js 預設值
--
-- 加 1 支 LIFF RPC：liff_get_my_unit_steps
-- 給 LIFF 申請頁面查「我這店的加班 step + 各假別 step」
-- ============================================================

-- ═══ 1. salary_structures 加 custom_allowances ═══
ALTER TABLE public.salary_structures
  ADD COLUMN IF NOT EXISTS custom_allowances JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.salary_structures.custom_allowances IS
  '廠商自訂津貼陣列，例如 [{"name":"夜班津貼","amount":3000},{"name":"外語津貼","amount":1500}]';


-- ═══ 2. legal_deductions 法扣表 ═══
CREATE TABLE IF NOT EXISTS public.legal_deductions (
  id              SERIAL PRIMARY KEY,
  employee_id     INT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  total_amount    NUMERIC(12,2) NOT NULL CHECK (total_amount > 0),
  monthly_amount  NUMERIC(12,2) NOT NULL CHECK (monthly_amount > 0),
  paid_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_months     INT NOT NULL DEFAULT 0,
  started_month   TEXT NOT NULL,
  case_number     TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT '進行中'
                  CHECK (status IN ('進行中', '已完成', '已停止')),
  organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legal_deductions_emp ON public.legal_deductions(employee_id);
CREATE INDEX IF NOT EXISTS idx_legal_deductions_status ON public.legal_deductions(status);

COMMENT ON TABLE public.legal_deductions IS
  '法院強制扣薪紀錄。每月薪資結算時依此扣款；當月薪水不夠扣，該筆 monthly_amount 部分扣、剩餘自動延後到下個月。';
COMMENT ON COLUMN public.legal_deductions.started_month IS '格式 YYYY-MM，例如 2026-05';


-- ═══ 3. stores 加 overtime_step_hours ═══
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS overtime_step_hours NUMERIC(3,2) DEFAULT 0.5;

COMMENT ON COLUMN public.stores.overtime_step_hours IS
  '此店加班申請時數的最小單位倍數，例如 0.5 表示只能 0.5/1/1.5/2/...';


-- ═══ 4. leave_step_settings 請假最小單位 ═══
CREATE TABLE IF NOT EXISTS public.leave_step_settings (
  id           SERIAL PRIMARY KEY,
  store_id     INT REFERENCES public.stores(id) ON DELETE CASCADE,
  leave_code   TEXT NOT NULL,
  step         NUMERIC(4,2) NOT NULL CHECK (step > 0),
  unit         TEXT NOT NULL CHECK (unit IN ('day', 'hour')),
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (store_id, leave_code)
);

CREATE INDEX IF NOT EXISTS idx_leave_step_store ON public.leave_step_settings(store_id);

COMMENT ON TABLE public.leave_step_settings IS
  '每店每假別的最小單位倍數覆寫表。store_id NULL 表示全公司預設；沒設則 fallback 到 leavePolicy.js 內建值。';


-- ═══ 5. LIFF RPC：liff_get_my_unit_steps ═══
-- 給 LIFF 加班 / 請假頁面用，一次撈回該員工所屬店的所有 step 設定
CREATE OR REPLACE FUNCTION public.liff_get_my_unit_steps(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp           employees;
  store_ot_step numeric;
  result        json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 加班 step：先查所屬店，沒有就用 0.5 預設
  SELECT overtime_step_hours INTO store_ot_step
  FROM public.stores WHERE id = emp.store_id;
  store_ot_step := COALESCE(store_ot_step, 0.5);

  -- 請假 step：所屬店覆寫 > 全公司覆寫 > 留給前端 fallback
  SELECT json_build_object(
    'ok',                true,
    'overtime_step_hours', store_ot_step,
    'leave_steps', (
      WITH ranked AS (
        SELECT
          leave_code, step, unit,
          ROW_NUMBER() OVER (
            PARTITION BY leave_code
            ORDER BY (store_id IS NOT NULL AND store_id = emp.store_id) DESC,
                     (store_id IS NULL) DESC,
                     id DESC
          ) AS rn
        FROM public.leave_step_settings
        WHERE store_id IS NULL OR store_id = emp.store_id
      )
      SELECT COALESCE(json_object_agg(leave_code, json_build_object('step', step, 'unit', unit)), '{}'::json)
      FROM ranked WHERE rn = 1
    )
  ) INTO result;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_my_unit_steps(text) TO anon, authenticated;


-- ═══ 6. RPC：legal_deductions 自助 / 給薪資結算用的扣款計算 ═══
-- 計算當月該扣的金額（不會真的更新 paid_*，那由 payroll 流程在結算時做）
-- 用途：薪資結算 preview / 顯示
CREATE OR REPLACE FUNCTION public.calc_legal_deduction_for_month(
  p_employee_id    int,
  p_available_net  numeric  -- 可扣金額（已減完所得稅、勞健保後的可動用淨額）
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  rec          record;
  remaining    numeric;
  to_deduct    numeric;
  deductions   json := '[]'::json;
  total_ded    numeric := 0;
  available    numeric := p_available_net;
BEGIN
  FOR rec IN
    SELECT id, title, monthly_amount, total_amount, paid_amount
    FROM public.legal_deductions
    WHERE employee_id = p_employee_id AND status = '進行中'
    ORDER BY id
  LOOP
    remaining := rec.total_amount - rec.paid_amount;
    -- 應扣 = min(monthly_amount, remaining_total, available)
    to_deduct := LEAST(rec.monthly_amount, remaining);
    to_deduct := LEAST(to_deduct, available);
    to_deduct := GREATEST(to_deduct, 0);

    deductions := deductions::jsonb || jsonb_build_object(
      'id',             rec.id,
      'title',          rec.title,
      'monthly_amount', rec.monthly_amount,
      'remaining',      remaining,
      'to_deduct',      to_deduct,
      'shortfall',      rec.monthly_amount - to_deduct
    );

    available := available - to_deduct;
    total_ded := total_ded + to_deduct;

    EXIT WHEN available <= 0;
  END LOOP;

  RETURN json_build_object(
    'total_deduction', total_ded,
    'remaining_net',   GREATEST(available, 0),
    'breakdown',       deductions
  );
END $$;

GRANT EXECUTE ON FUNCTION public.calc_legal_deduction_for_month(int, numeric) TO anon, authenticated;
