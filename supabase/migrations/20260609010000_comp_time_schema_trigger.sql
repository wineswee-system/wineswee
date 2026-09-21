-- ════════════════════════════════════════════════════════════════════════════
-- 加班可選「加班費」或「補休」— Schema + Trigger + RPC
--
-- 業務規則：
--   1. 員工申請加班時就選 pay / comp_time（送出後鎖死）
--   2. 補休 1:1 換算（加班 2hr → 補休 2hr）
--   3. 期限：加班日 + 1 年 - 1 天（4/1 加班 → 隔年 3/31 是最後一天）
--   4. 過期未用 → 月結時自動兌現為加班費（金額 = 凍結 OT 金額 × 剩餘比例）
--   5. 兌現金額用「申請當下時薪 × 倍率」凍結，後續調薪不影響
--   6. 補休是 per-ledger 獨立記錄，請補休時 FIFO 扣（最早到期先用，可跨筆扣）
--
-- 沿用既有欄位 overtime_requests.ot_type：
--   'pay'        → 給加班費（現行）
--   'comp_time'  → 給補休（新）
-- 既有 payroll 已過濾 ot_type='pay' or NULL，所以 'comp_time' 不會被算進實領加班費。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. comp_time_ledger ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comp_time_ledger (
  id BIGSERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES public.employees(id),
  overtime_request_id INT NOT NULL REFERENCES public.overtime_requests(id),
  organization_id INT NOT NULL REFERENCES public.organizations(id),

  hours NUMERIC(5,2) NOT NULL CHECK (hours > 0),
  hours_used NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (hours_used >= 0),

  ot_date DATE NOT NULL,
  expires_at DATE NOT NULL,

  frozen_hourly_rate NUMERIC(10,2) NOT NULL,
  frozen_ot_amount NUMERIC(10,2) NOT NULL,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'exhausted', 'expired_settled')),
  settled_payroll_run_id INT REFERENCES public.payroll_runs(id),
  settled_at TIMESTAMPTZ,
  settled_amount NUMERIC(10,2),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_hours_used_le_hours CHECK (hours_used <= hours),
  CONSTRAINT uq_comp_time_ot_request UNIQUE (overtime_request_id)
);

CREATE INDEX IF NOT EXISTS idx_comp_time_ledger_employee_active
  ON public.comp_time_ledger (employee_id, expires_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_comp_time_ledger_expires
  ON public.comp_time_ledger (expires_at)
  WHERE status = 'active';

COMMENT ON TABLE public.comp_time_ledger IS
  '補休 ledger — 每筆「OT 核准選補休」獨立一行，FIFO 扣 + 過期月結自動兌現';


-- ─── 2. comp_time_usages（請補休的扣款明細）─────────────────────────────
CREATE TABLE IF NOT EXISTS public.comp_time_usages (
  id BIGSERIAL PRIMARY KEY,
  leave_request_id INT NOT NULL REFERENCES public.leave_requests(id),
  comp_time_ledger_id BIGINT NOT NULL REFERENCES public.comp_time_ledger(id),
  hours_used NUMERIC(5,2) NOT NULL CHECK (hours_used > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comp_time_usages_leave
  ON public.comp_time_usages (leave_request_id);

CREATE INDEX IF NOT EXISTS idx_comp_time_usages_ledger
  ON public.comp_time_usages (comp_time_ledger_id);


-- ─── 3. Helper: 算 OT pay（依 ot_category 倍率）────────────────────────
-- 沿用 generate_payroll 既有 2-bucket 邏輯（weekday vs restday-tiered）
CREATE OR REPLACE FUNCTION public._compute_ot_pay(
  p_hours NUMERIC,
  p_hourly_rate NUMERIC,
  p_category TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_hours IS NULL OR p_hours <= 0 OR p_hourly_rate IS NULL OR p_hourly_rate <= 0 THEN
    RETURN 0;
  END IF;

  IF p_category = 'weekday' THEN
    RETURN ROUND(
      LEAST(p_hours, 2) * p_hourly_rate * 1.34
      + GREATEST(p_hours - 2, 0) * p_hourly_rate * 1.67
    , 2);
  END IF;

  -- restday / weekly_off / holiday → 用 restday tiered
  RETURN ROUND(
    LEAST(p_hours, 2) * p_hourly_rate * 1.34
    + LEAST(GREATEST(p_hours - 2, 0), 6) * p_hourly_rate * 1.67
    + GREATEST(p_hours - 8, 0) * p_hourly_rate * 2.67
  , 2);
END $$;


-- ─── 4. Trigger: OT 核准且 ot_type='comp_time' → 自動建 ledger ──────────
CREATE OR REPLACE FUNCTION public.trg_create_comp_time_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hours        NUMERIC;
  v_date         DATE;
  v_base         NUMERIC;
  v_hourly_rate  NUMERIC;
  v_amount       NUMERIC;
  v_org_id       INT;
  v_category     TEXT;
BEGIN
  -- 只在 status = '已核准' 且 ot_type = 'comp_time' 時觸發
  IF NEW.status <> '已核准' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = '已核准' THEN
    RETURN NEW;  -- 已經是核准了，不重發
  END IF;
  IF COALESCE(NEW.ot_type, 'pay') <> 'comp_time' THEN
    RETURN NEW;
  END IF;

  v_hours := COALESCE(NEW.ot_hours, NEW.hours);
  v_date  := COALESCE(NEW.request_date, NEW.date);

  IF v_hours IS NULL OR v_hours <= 0 OR v_date IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(ss.base_salary, 0), e.organization_id
    INTO v_base, v_org_id
    FROM employees e
    LEFT JOIN salary_structures ss ON ss.employee_id = e.id
   WHERE e.id = NEW.employee_id;

  IF v_base IS NULL OR v_base <= 0 THEN
    RAISE NOTICE 'comp_time ledger skipped: employee % has no base_salary', NEW.employee_id;
    RETURN NEW;
  END IF;

  v_hourly_rate := ROUND(v_base / 30.0 / 8.0, 2);

  v_category := COALESCE(
    NEW.ot_category,
    public.classify_overtime_category_v2(v_date, NEW.employee_id)
  );

  v_amount := public._compute_ot_pay(v_hours, v_hourly_rate, v_category);

  INSERT INTO public.comp_time_ledger (
    employee_id, overtime_request_id, organization_id,
    hours, ot_date, expires_at,
    frozen_hourly_rate, frozen_ot_amount,
    status
  ) VALUES (
    NEW.employee_id, NEW.id, COALESCE(v_org_id, NEW.organization_id),
    v_hours, v_date, v_date + INTERVAL '1 year' - INTERVAL '1 day',
    v_hourly_rate, v_amount,
    'active'
  )
  ON CONFLICT (overtime_request_id) DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_overtime_comp_time_ledger ON public.overtime_requests;
CREATE TRIGGER trg_overtime_comp_time_ledger
  AFTER INSERT OR UPDATE OF status ON public.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_create_comp_time_ledger();


-- ─── 5. Helper: 月結時兌現過期 ledger（generate_payroll 內呼叫）─────────
CREATE OR REPLACE FUNCTION public._settle_expired_comp_time(
  p_employee_id     INT,
  p_payroll_run_id  INT,
  p_month_end       DATE
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total NUMERIC := 0;
  v_amt   NUMERIC;
  rec     RECORD;
BEGIN
  FOR rec IN
    SELECT id, hours, hours_used, frozen_ot_amount
      FROM comp_time_ledger
     WHERE employee_id = p_employee_id
       AND status = 'active'
       AND expires_at < p_month_end
       AND (hours - hours_used) > 0
  LOOP
    -- 按剩餘比例兌現（避免凍結金額是 0 的邊界）
    v_amt := ROUND(
      rec.frozen_ot_amount * (rec.hours - rec.hours_used) / NULLIF(rec.hours, 0)
    , 2);
    v_amt := COALESCE(v_amt, 0);

    UPDATE comp_time_ledger
       SET status = 'expired_settled',
           settled_payroll_run_id = p_payroll_run_id,
           settled_at = NOW(),
           settled_amount = v_amt
     WHERE id = rec.id;

    v_total := v_total + v_amt;
  END LOOP;

  RETURN v_total;
END $$;


-- ─── 6. RPC: 員工請補休 → FIFO 扣 ledger（跨 ledger 可扣）───────────────
CREATE OR REPLACE FUNCTION public.deduct_comp_time(
  p_leave_request_id INT,
  p_employee_id      INT,
  p_hours            NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining NUMERIC := p_hours;
  v_available NUMERIC;
  v_take      NUMERIC;
  v_used      JSON[] := ARRAY[]::JSON[];
  rec         RECORD;
BEGIN
  IF p_hours IS NULL OR p_hours <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_hours');
  END IF;

  SELECT COALESCE(SUM(hours - hours_used), 0) INTO v_available
    FROM comp_time_ledger
   WHERE employee_id = p_employee_id AND status = 'active';

  IF v_available < p_hours THEN
    RETURN json_build_object(
      'ok', false, 'error', 'insufficient_balance',
      'available', v_available, 'requested', p_hours
    );
  END IF;

  FOR rec IN
    SELECT id, hours, hours_used, (hours - hours_used) AS remaining
      FROM comp_time_ledger
     WHERE employee_id = p_employee_id
       AND status = 'active'
       AND (hours - hours_used) > 0
     ORDER BY expires_at ASC, id ASC
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_take := LEAST(rec.remaining, v_remaining);

    UPDATE comp_time_ledger
       SET hours_used = hours_used + v_take,
           status = CASE
             WHEN (hours_used + v_take) >= hours THEN 'exhausted'
             ELSE 'active'
           END
     WHERE id = rec.id;

    INSERT INTO comp_time_usages (leave_request_id, comp_time_ledger_id, hours_used)
    VALUES (p_leave_request_id, rec.id, v_take);

    v_used := v_used || json_build_object('ledger_id', rec.id, 'hours', v_take);
    v_remaining := v_remaining - v_take;
  END LOOP;

  RETURN json_build_object('ok', true, 'deductions', array_to_json(v_used));
END $$;

GRANT EXECUTE ON FUNCTION public.deduct_comp_time(INT, INT, NUMERIC) TO authenticated;


-- ─── 7. RPC: 查員工補休餘額（給前端顯示用）──────────────────────────────
CREATE OR REPLACE FUNCTION public.get_comp_time_balance(p_employee_id INT)
RETURNS TABLE(
  ledger_id BIGINT,
  ot_date DATE,
  expires_at DATE,
  hours NUMERIC,
  hours_used NUMERIC,
  hours_remaining NUMERIC,
  frozen_ot_amount NUMERIC,
  days_to_expire INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.id,
    l.ot_date,
    l.expires_at,
    l.hours,
    l.hours_used,
    (l.hours - l.hours_used)::NUMERIC,
    l.frozen_ot_amount,
    (l.expires_at - CURRENT_DATE)::INT
  FROM public.comp_time_ledger l
  WHERE l.employee_id = p_employee_id
    AND l.status = 'active'
    AND (l.hours - l.hours_used) > 0
  ORDER BY l.expires_at ASC;
END $$;

GRANT EXECUTE ON FUNCTION public.get_comp_time_balance(INT) TO authenticated;


-- ─── 8. 開放讀取補休 ledger 給用戶看自己的（簡單 RLS）─────────────────
ALTER TABLE public.comp_time_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comp_time_usages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comp_time_ledger_read ON public.comp_time_ledger;
CREATE POLICY comp_time_ledger_read ON public.comp_time_ledger
  FOR SELECT
  USING (true);  -- 暫時全開讀；之後 tenant 隔離可加 organization_id 比對

DROP POLICY IF EXISTS comp_time_usages_read ON public.comp_time_usages;
CREATE POLICY comp_time_usages_read ON public.comp_time_usages
  FOR SELECT
  USING (true);

COMMIT;

NOTIFY pgrst, 'reload schema';
