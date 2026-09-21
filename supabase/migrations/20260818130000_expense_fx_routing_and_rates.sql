-- ════════════════════════════════════════════════════════════════════════════
-- 費用申請分流換匯 + 復活匯率管理 UI 後端 — 2026-08-18
-- ════════════════════════════════════════════════════════════════════════════
-- 問題:挑簽核鏈時 estimated_amount 直接比台幣級距、沒換匯(USD 668 被當台幣走小額鏈)。
--   而前端 finance/ExchangeRates.jsx(匯率管理)讀寫 exchange_rates 表,但該表根本沒建
--   → UI 是死的。此 migration:①建 exchange_rates 表 + RLS + 種子匯率(復活 UI);
--   ② fx_to_twd() 換匯 helper;③ 分流兩處(web 用的 trigger auto_apply_expense_approval_chain
--   + LIFF liff_insert_expense_request)改成換算台幣再比 min/max_amount。
-- 全 idempotent;函式抓 live 定義只改換匯那幾行。
-- ════════════════════════════════════════════════════════════════════════════

-- ① 匯率表(對齊 lib/currency.js:from_currency/to_currency='NTD'/rate/effective_date/source)
CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_currency  text NOT NULL,
  to_currency    text NOT NULL DEFAULT 'NTD',
  rate           numeric NOT NULL CHECK (rate > 0),
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  source         text DEFAULT 'manual',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup
  ON public.exchange_rates (from_currency, to_currency, effective_date DESC);

ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exchange_rates TO authenticated;
DROP POLICY IF EXISTS exchange_rates_read  ON public.exchange_rates;
CREATE POLICY exchange_rates_read  ON public.exchange_rates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS exchange_rates_write ON public.exchange_rates;
CREATE POLICY exchange_rates_write ON public.exchange_rates FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 種子匯率(只在該幣別尚無 rate 時插入;老闆之後在「匯率管理」UI 自行調)
INSERT INTO public.exchange_rates (from_currency, to_currency, rate, effective_date, source)
SELECT v.cur, 'NTD', v.rate, CURRENT_DATE, 'seed'
FROM (VALUES ('USD',32.15),('EUR',34.80),('JPY',0.215),('CNY',4.42),('NZD',20.0),('AUD',21.0)) AS v(cur,rate)
WHERE NOT EXISTS (SELECT 1 FROM public.exchange_rates e WHERE e.from_currency=v.cur AND e.to_currency='NTD');

-- ② 換匯 helper:回傳「以台幣計」的金額(查最新 effective_date<=今天的匯率;無匯率 fallback 原值)
CREATE OR REPLACE FUNCTION public.fx_to_twd(p_amount numeric, p_currency text)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fx$
DECLARE v_rate numeric;
BEGIN
  IF p_amount IS NULL THEN RETURN 0; END IF;
  IF p_currency IS NULL OR p_currency IN ('TWD','NTD','') THEN RETURN p_amount; END IF;
  SELECT rate INTO v_rate FROM public.exchange_rates
   WHERE from_currency = p_currency AND to_currency = 'NTD' AND effective_date <= CURRENT_DATE
   ORDER BY effective_date DESC LIMIT 1;
  RETURN p_amount * COALESCE(v_rate, 1);
END $fx$;
GRANT EXECUTE ON FUNCTION public.fx_to_twd(numeric, text) TO anon, authenticated, service_role;

-- ③a web 路徑:分流 trigger 換匯
CREATE OR REPLACE FUNCTION public.auto_apply_expense_approval_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_chain_id INT;
  v_amount   NUMERIC;
  v_force    BOOLEAN := false;
  v_order    BOOLEAN := (NEW.doc_type = 'order');
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.is_expense IS DISTINCT FROM NEW.is_expense THEN
    NEW.approval_chain_id := NULL;
    v_force := true;
  END IF;
  IF NOT v_force AND NEW.approval_chain_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.is_expense = false THEN
    IF v_order THEN
      SELECT id INTO v_chain_id FROM public.approval_chains
       WHERE category = '叫貨-非費用申請' AND COALESCE(is_active, true) = true
       ORDER BY id DESC LIMIT 1;
    END IF;
    IF v_chain_id IS NULL THEN
      SELECT id INTO v_chain_id FROM public.approval_chains
       WHERE category = '非費用申請' AND COALESCE(is_active, true) = true
       ORDER BY id DESC LIMIT 1;
    END IF;
  ELSE
    v_amount := public.fx_to_twd(COALESCE(NEW.estimated_amount, 0), NEW.currency);  -- ★換匯:外幣先換台幣再比級距
    IF v_order THEN
      SELECT id INTO v_chain_id FROM public.approval_chains
       WHERE category = '叫貨申請' AND COALESCE(is_active, true) = true
         AND (min_amount IS NULL OR min_amount <= v_amount)
         AND (max_amount IS NULL OR max_amount >= v_amount)
       ORDER BY COALESCE(min_amount, 0) DESC LIMIT 1;
    END IF;
    IF v_chain_id IS NULL THEN
      SELECT id INTO v_chain_id FROM public.approval_chains
       WHERE category = '費用申請' AND COALESCE(is_active, true) = true
         AND (min_amount IS NULL OR min_amount <= v_amount)
         AND (max_amount IS NULL OR max_amount >= v_amount)
       ORDER BY COALESCE(min_amount, 0) DESC LIMIT 1;
    END IF;
  END IF;

  IF v_chain_id IS NOT NULL THEN
    NEW.approval_chain_id := v_chain_id;
  END IF;
  RETURN NEW;
END $function$;


-- ③b LIFF 路徑:liff_insert_expense_request 挑鏈換匯
CREATE OR REPLACE FUNCTION public.liff_insert_expense_request(p_line_user_id text, p_payload json)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp                 employees;
  v_is_expense        boolean;
  v_amount            numeric;
  v_currency          text;
  v_chain_id          int;
  v_chain_step_count  int := 0;
  v_supervisor_id     int;
  v_is_owner          boolean := false;
  v_status            text := '申請中';
  new_id              int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RAISE EXCEPTION 'employee not found' USING ERRCODE = 'P0002';
  END IF;

  v_is_expense := COALESCE((p_payload->>'is_expense')::boolean, true);

  v_currency := COALESCE(NULLIF(p_payload->>'currency', ''), 'TWD');
  IF v_currency NOT IN ('TWD', 'USD', 'JPY', 'CNY', 'EUR') THEN
    v_currency := 'TWD';
  END IF;

  IF v_is_expense THEN
    v_amount := COALESCE((p_payload->>'estimated_amount')::numeric, 0);

    SELECT id INTO v_chain_id
      FROM public.approval_chains
     WHERE category = '費用申請'
       AND organization_id = emp.organization_id
       AND COALESCE(is_active, true) = true
       AND public.fx_to_twd(v_amount, v_currency) >= COALESCE(min_amount, 0)  -- ★換匯
       AND (max_amount IS NULL OR public.fx_to_twd(v_amount, v_currency) <= max_amount)
     ORDER BY COALESCE(min_amount, 0) DESC
     LIMIT 1;
  ELSE
    v_amount := NULL;
    v_currency := 'TWD';

    SELECT id INTO v_chain_id
      FROM public.approval_chains
     WHERE category = '非費用申請'
       AND organization_id = emp.organization_id
       AND COALESCE(is_active, true) = true
     ORDER BY id DESC
     LIMIT 1;
  END IF;

  IF v_chain_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_chain_step_count
      FROM public.approval_chain_steps WHERE chain_id = v_chain_id;
    IF v_chain_step_count = 0 THEN v_chain_id := NULL; END IF;
  END IF;

  v_supervisor_id := public._resolve_single_approver(emp.id);
  v_is_owner := (v_supervisor_id IS NULL AND NOT public._is_store_manager(emp.id));

  IF v_is_owner THEN v_status := '已核准'; END IF;

  IF NOT v_is_owner AND v_chain_id IS NULL THEN
    IF v_is_expense THEN
      RAISE EXCEPTION '尚未設定符合金額 NT$% 的「費用申請」簽核鏈，請聯絡管理員', v_amount
        USING ERRCODE = 'P0001',
              HINT = '請到「組織 > 簽核設定」新增 category=費用申請 的 approval_chain';
    ELSE
      RAISE EXCEPTION '尚未設定「非費用申請」簽核鏈，請聯絡管理員'
        USING ERRCODE = 'P0001',
              HINT = '請到「組織 > 簽核設定」新增 category=非費用申請 的 approval_chain';
    END IF;
  END IF;

  INSERT INTO public.expense_requests (
    employee, employee_id, department,
    is_expense,
    account_code, account_name,
    title, description, estimated_amount,
    currency,
    supplier,
    items,
    store, status, organization_id,
    approval_chain_id, current_step,
    settle_assignee_id,                       -- ★ 新增：直接指定驗收人
    settle_department_id, settle_store_id     -- 舊制相容(改選人後前端傳 null)
  )
  VALUES (
    emp.name, emp.id, emp.dept,
    v_is_expense,
    CASE WHEN v_is_expense THEN p_payload->>'account_code' ELSE NULL END,
    CASE WHEN v_is_expense THEN p_payload->>'account_name' ELSE NULL END,
    p_payload->>'title',
    p_payload->>'description',
    v_amount,
    v_currency,
    CASE WHEN v_is_expense THEN p_payload->>'supplier' ELSE NULL END,
    CASE WHEN v_is_expense
         THEN COALESCE((p_payload->'items')::jsonb, '[]'::jsonb)
         ELSE '[]'::jsonb
    END,
    CASE WHEN v_is_expense THEN COALESCE(p_payload->>'store', emp.store) ELSE NULL END,
    v_status,
    emp.organization_id,
    v_chain_id,
    0,
    CASE WHEN v_is_expense THEN NULLIF(p_payload->>'settle_assignee_id', '')::int ELSE NULL END,
    CASE WHEN v_is_expense THEN NULLIF(p_payload->>'settle_department_id', '')::int ELSE NULL END,
    CASE WHEN v_is_expense THEN NULLIF(p_payload->>'settle_store_id', '')::int ELSE NULL END
  )
  RETURNING id INTO new_id;

  RETURN json_build_object(
    'id', new_id,
    'status', v_status,
    'approval_chain_id', v_chain_id,
    'auto_approved', v_is_owner,
    'is_expense', v_is_expense,
    'currency', v_currency
  );
END $function$;

NOTIFY pgrst, 'reload schema';
