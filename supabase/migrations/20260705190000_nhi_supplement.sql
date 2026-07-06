-- ============================================================
-- 20260705190000_nhi_supplement.sql
-- F-B4 二代健保補充保費（PLAN_fin-tax-inv_2026-07-04 二/F-B4.2）
--
-- 1. nhi_supplement_params   — 法規參數表（年度費率/門檻，可隨年度調整、只改資料不 deploy）
-- 2. nhi_supplement_records  — 每月代扣明細（6 類扣費，冪等 upsert by unique key）
-- 3. nhi_employer_records    — 公司（投保單位）負擔：(薪資支出總額 − 投保金額總額) × 費率
-- 4. RPC secure_calculate_nhi_supplement(p_period) — 高額獎金類 server-side 計算
--    （**獨立的 post-payroll 步驟**：只讀 salary_records / salary_structures，
--      不動 generate_payroll、不寫 annual_bonus_tracker — 年度累計由 salary_records
--      直接推導，重跑冪等）
-- 5. RPC secure_calculate_nhi_employer(p_period)  — 雇主負擔計算 + upsert
-- 6. RPC secure_add_nhi_record(...)               — 手動登錄其餘 5 類
--
-- 註：兼職所得/執行業務/股利/利息/租金 5 類目前由「手動登錄」
--     （secure_add_nhi_record）或未來付款模組整合自動彙入；本系統薪資引擎
--     只有高額獎金類可自動推導。
--
-- 門檻資料來源（2026/115 年度種子）：
--   - 費率 2.11%（健保法 §31，115 年現行費率）
--   - 高額獎金：年度累計獎金 > 4 × 當月投保金額，超額部分計費（bonus_multiple = 4）
--   - 兼職（非投保單位）薪資：單次給付達「基本工資」起扣 —
--     2026 基本工資 NT$29,500（勞動部公告，對齊 src/lib/payroll.js 2026/115 費率檔頭）
--   - 執行業務/股利/利息/租金：單次給付 ≥ NT$20,000 起扣（other_income_threshold）
--   - 單次給付計費上限 NT$10,000,000（payment_cap）
--
-- 冪等：可重複執行。organizations.id 為 BIGINT（同 20260705120000 慣例）。
-- ============================================================

-- ═══ 1. 法規參數表（全域、非 org 範疇 — 法定值）═══

CREATE TABLE IF NOT EXISTS public.nhi_supplement_params (
  effective_year           INT           PRIMARY KEY,
  rate                     NUMERIC(6,4)  NOT NULL DEFAULT 0.0211,
  bonus_multiple           NUMERIC(4,1)  NOT NULL DEFAULT 4,
  -- 兼職所得單次給付起扣門檻（基本工資連動：2026 = 29,500）
  single_payment_threshold NUMERIC(12,2) NOT NULL,
  -- 執行業務/股利/利息/租金 單次給付起扣門檻（法定 NT$20,000）
  other_income_threshold   NUMERIC(12,2) NOT NULL DEFAULT 20000,
  -- 單次給付計費上限（1,000 萬）
  payment_cap              NUMERIC(14,2) NOT NULL DEFAULT 10000000,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (effective_year)
);

COMMENT ON TABLE public.nhi_supplement_params IS
  '二代健保補充保費法規參數（F-B4）：年度費率/門檻，年度更新只改資料不 deploy';
COMMENT ON COLUMN public.nhi_supplement_params.single_payment_threshold IS
  '兼職所得單次給付起扣門檻 = 基本工資（2026: 29,500，勞動部公告、對齊 src/lib/payroll.js）';
COMMENT ON COLUMN public.nhi_supplement_params.other_income_threshold IS
  '執行業務/股利/利息/租金 單次給付起扣門檻（健保法規定：NT$20,000）';

INSERT INTO public.nhi_supplement_params
  (effective_year, rate, bonus_multiple, single_payment_threshold, other_income_threshold, payment_cap)
VALUES (2026, 0.0211, 4, 29500, 20000, 10000000)
ON CONFLICT (effective_year) DO NOTHING;

-- ═══ 2. 每月代扣明細表 ═══

CREATE TABLE IF NOT EXISTS public.nhi_supplement_records (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  BIGINT        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period           TEXT          NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),  -- 'YYYY-MM'
  employee_id      INT           NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  category         TEXT          NOT NULL
                                 CHECK (category IN ('高額獎金','兼職所得','執行業務','股利','利息','租金')),
  payment_amount   NUMERIC(14,2) NOT NULL,            -- 本次給付金額（高額獎金 = 本月獎金）
  insured_salary   NUMERIC(12,2),                      -- 計算當下投保金額（高額獎金類）
  cumulative_bonus NUMERIC(14,2),                      -- 含本次的年度累計獎金（高額獎金類）
  taxable_base     NUMERIC(14,2) NOT NULL DEFAULT 0,   -- 計費基礎（超額/達門檻部分，已套上限）
  premium          NUMERIC(12,2) NOT NULL DEFAULT 0,   -- 補充保費 = round(taxable_base × rate)
  source_type      TEXT          NOT NULL DEFAULT 'manual',  -- 'payroll' | 'manual'
  source_id        TEXT          NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, period, employee_id, category, source_id)
);

CREATE INDEX IF NOT EXISTS idx_nhi_supp_rec_org_period
  ON public.nhi_supplement_records (organization_id, period);

COMMENT ON TABLE public.nhi_supplement_records IS
  '二代健保補充保費代扣明細（F-B4）：6 類扣費，高額獎金由 secure_calculate_nhi_supplement 產生，其餘 5 類手動登錄（secure_add_nhi_record）';

-- ═══ 3. 雇主（投保單位）負擔表 ═══

CREATE TABLE IF NOT EXISTS public.nhi_employer_records (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id BIGINT        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period          TEXT          NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  salary_total    NUMERIC(14,2) NOT NULL DEFAULT 0,  -- Σ 薪資支出總額
  insured_total   NUMERIC(14,2) NOT NULL DEFAULT 0,  -- Σ 健保投保金額總額
  premium         NUMERIC(12,2) NOT NULL DEFAULT 0,  -- GREATEST(差額,0) × rate
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, period)
);

COMMENT ON TABLE public.nhi_employer_records IS
  '二代健保雇主負擔（F-B4）：(受雇者薪資支出總額 − 健保投保金額總額) × 費率，下限 0';

-- ═══ 4. RPC：高額獎金類計算（post-payroll，冪等）═══
-- 累計邏輯：對每位當月有獎金（bonus + attendance_bonus > 0）的員工，
--   累計前 = Σ 同年度較早月份的獎金（由 salary_records 直接推導，不讀 annual_bonus_tracker）
--   門檻   = 當月健保投保金額 × bonus_multiple（4 倍）
--   計費基礎 = GREATEST(0, (累計前 + 本次) − GREATEST(門檻, 累計前))  ← 只課「本次落在門檻以上」的部分
--   再套單次計費上限 payment_cap；保費 = ROUND(計費基礎 × rate)
-- 投保金額推導：salary_structures.base_insured 優先，否則以本薪對 _health_bracket_row 級距表覈實。

CREATE OR REPLACE FUNCTION public.secure_calculate_nhi_supplement(p_period TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org           INT;
  v_year          INT;
  v_params        public.nhi_supplement_params%ROWTYPE;
  r               RECORD;
  v_base_insured  NUMERIC;
  v_ss_base       NUMERIC;
  v_probe         NUMERIC;
  v_insured       NUMERIC;
  v_threshold     NUMERIC;
  v_taxable       NUMERIC;
  v_premium       NUMERIC;
  v_count         INT := 0;
  v_skipped       INT := 0;
  v_total_premium NUMERIC := 0;
BEGIN
  IF p_period IS NULL OR p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION '期別格式錯誤，需為 YYYY-MM（收到 %）', p_period;
  END IF;

  v_org := current_employee_org();
  IF v_org IS NULL THEN RAISE EXCEPTION '無法識別租戶'; END IF;

  v_year := split_part(p_period, '-', 1)::INT;

  -- 年度參數（找不到當年 → 取 ≤ 當年最近一年）
  SELECT * INTO v_params FROM public.nhi_supplement_params
   WHERE effective_year <= v_year ORDER BY effective_year DESC LIMIT 1;
  IF v_params.effective_year IS NULL THEN
    RAISE EXCEPTION '尚未建立 % 年度二代健保參數（nhi_supplement_params）', v_year;
  END IF;

  -- 清掉本期已不存在來源的舊 payroll 列（薪資改單後重算冪等）
  DELETE FROM public.nhi_supplement_records n
   WHERE n.organization_id = v_org
     AND n.period = p_period
     AND n.category = '高額獎金'
     AND n.source_type = 'payroll'
     AND NOT EXISTS (
       SELECT 1 FROM public.salary_records sr
        WHERE sr.organization_id = v_org
          AND sr.month = p_period
          AND ('salary:' || sr.id) = n.source_id
          AND COALESCE(sr.bonus, 0) + COALESCE(sr.attendance_bonus, 0) > 0
     );

  FOR r IN
    SELECT sr.employee_id,
           sr.id AS salary_id,
           COALESCE(sr.bonus, 0) + COALESCE(sr.attendance_bonus, 0) AS this_bonus,
           COALESCE((
             SELECT SUM(COALESCE(s2.bonus, 0) + COALESCE(s2.attendance_bonus, 0))
               FROM public.salary_records s2
              WHERE s2.employee_id = sr.employee_id
                AND s2.organization_id = v_org
                AND s2.month LIKE (v_year::TEXT || '-%')
                AND s2.month < p_period
           ), 0) AS cum_before
      FROM public.salary_records sr
     WHERE sr.organization_id = v_org
       AND sr.month = p_period
       AND sr.employee_id IS NOT NULL
       AND COALESCE(sr.bonus, 0) + COALESCE(sr.attendance_bonus, 0) > 0
  LOOP
    -- 投保金額：salary_structures.base_insured 優先，否則以本薪覈實對健保級距
    v_base_insured := NULL; v_ss_base := NULL;
    SELECT COALESCE(ss.base_insured, 0), COALESCE(ss.base_salary, 0)
      INTO v_base_insured, v_ss_base
      FROM public.salary_structures ss
     WHERE ss.employee_id = r.employee_id
     LIMIT 1;

    IF COALESCE(v_base_insured, 0) > 0 THEN
      v_probe := v_base_insured;
    ELSE
      SELECT COALESCE(NULLIF(COALESCE(v_ss_base, 0), 0), e.base_salary, 0)
        INTO v_probe
        FROM public.employees e WHERE e.id = r.employee_id;
    END IF;

    v_insured := NULL;
    IF COALESCE(v_probe, 0) > 0 THEN
      SELECT h.insured_salary INTO v_insured
        FROM public._health_bracket_row(v_year, v_probe) h;
    END IF;

    -- 無投保金額（未在本單位投保健保）→ 不屬「高額獎金」類（對齊 generate_payroll 既有守則）
    IF COALESCE(v_insured, 0) <= 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_threshold := v_insured * v_params.bonus_multiple;
    -- 只課「本次給付落在 4 倍門檻以上」的部分（跨月累計正確：門檻已被先前月份吃掉時本次全額計費）
    v_taxable := GREATEST(0, (r.cum_before + r.this_bonus) - GREATEST(v_threshold, r.cum_before));
    v_taxable := LEAST(v_taxable, v_params.payment_cap);
    v_premium := ROUND(v_taxable * v_params.rate);

    INSERT INTO public.nhi_supplement_records (
      organization_id, period, employee_id, category,
      payment_amount, insured_salary, cumulative_bonus,
      taxable_base, premium, source_type, source_id
    ) VALUES (
      v_org, p_period, r.employee_id, '高額獎金',
      r.this_bonus, v_insured, r.cum_before + r.this_bonus,
      v_taxable, v_premium, 'payroll', 'salary:' || r.salary_id
    )
    ON CONFLICT (organization_id, period, employee_id, category, source_id) DO UPDATE SET
      payment_amount   = EXCLUDED.payment_amount,
      insured_salary   = EXCLUDED.insured_salary,
      cumulative_bonus = EXCLUDED.cumulative_bonus,
      taxable_base     = EXCLUDED.taxable_base,
      premium          = EXCLUDED.premium;

    v_count := v_count + 1;
    v_total_premium := v_total_premium + v_premium;
  END LOOP;

  RETURN jsonb_build_object(
    'period', p_period,
    'calculated', v_count,
    'skipped_no_insured', v_skipped,
    'total_premium', v_total_premium,
    'rate', v_params.rate,
    'bonus_multiple', v_params.bonus_multiple
  );
END;
$$;

REVOKE ALL ON FUNCTION public.secure_calculate_nhi_supplement(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.secure_calculate_nhi_supplement(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.secure_calculate_nhi_supplement(TEXT) TO authenticated, service_role;

-- ═══ 5. RPC：雇主負擔計算 ═══
-- 公式：(Σ 薪資支出總額 − Σ 健保投保金額總額) × rate，下限 0。
-- 薪資支出總額以 salary_records legacy 合計欄位推導：base_salary + allowance + overtime + bonus
--（secure_upsert_salary_v2 慣例：allowance = 津貼合計、overtime = 加班費合計，與 bonus 互斥不重複計）。

CREATE OR REPLACE FUNCTION public.secure_calculate_nhi_employer(p_period TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org           INT;
  v_year          INT;
  v_params        public.nhi_supplement_params%ROWTYPE;
  v_salary_total  NUMERIC := 0;
  v_insured_total NUMERIC := 0;
  v_premium       NUMERIC := 0;
  r               RECORD;
  v_base_insured  NUMERIC;
  v_ss_base       NUMERIC;
  v_probe         NUMERIC;
  v_insured       NUMERIC;
  v_row           public.nhi_employer_records%ROWTYPE;
BEGIN
  IF p_period IS NULL OR p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION '期別格式錯誤，需為 YYYY-MM（收到 %）', p_period;
  END IF;

  v_org := current_employee_org();
  IF v_org IS NULL THEN RAISE EXCEPTION '無法識別租戶'; END IF;

  v_year := split_part(p_period, '-', 1)::INT;

  SELECT * INTO v_params FROM public.nhi_supplement_params
   WHERE effective_year <= v_year ORDER BY effective_year DESC LIMIT 1;
  IF v_params.effective_year IS NULL THEN
    RAISE EXCEPTION '尚未建立 % 年度二代健保參數（nhi_supplement_params）', v_year;
  END IF;

  -- Σ 薪資支出總額（legacy 合計欄位）
  SELECT COALESCE(SUM(
           COALESCE(base_salary, 0) + COALESCE(allowance, 0)
         + COALESCE(overtime, 0)    + COALESCE(bonus, 0)
         ), 0)
    INTO v_salary_total
    FROM public.salary_records
   WHERE organization_id = v_org AND month = p_period;

  -- Σ 健保投保金額（逐員工覈實：base_insured 優先，否則本薪對級距）
  FOR r IN
    SELECT DISTINCT sr.employee_id
      FROM public.salary_records sr
     WHERE sr.organization_id = v_org
       AND sr.month = p_period
       AND sr.employee_id IS NOT NULL
  LOOP
    v_base_insured := NULL; v_ss_base := NULL;
    SELECT COALESCE(ss.base_insured, 0), COALESCE(ss.base_salary, 0)
      INTO v_base_insured, v_ss_base
      FROM public.salary_structures ss
     WHERE ss.employee_id = r.employee_id
     LIMIT 1;

    IF COALESCE(v_base_insured, 0) > 0 THEN
      v_probe := v_base_insured;
    ELSE
      SELECT COALESCE(NULLIF(COALESCE(v_ss_base, 0), 0), e.base_salary, 0)
        INTO v_probe
        FROM public.employees e WHERE e.id = r.employee_id;
    END IF;

    v_insured := NULL;
    IF COALESCE(v_probe, 0) > 0 THEN
      SELECT h.insured_salary INTO v_insured
        FROM public._health_bracket_row(v_year, v_probe) h;
    END IF;

    v_insured_total := v_insured_total + COALESCE(v_insured, 0);
  END LOOP;

  v_premium := GREATEST(0, ROUND(GREATEST(v_salary_total - v_insured_total, 0) * v_params.rate));

  INSERT INTO public.nhi_employer_records (organization_id, period, salary_total, insured_total, premium)
  VALUES (v_org, p_period, v_salary_total, v_insured_total, v_premium)
  ON CONFLICT (organization_id, period) DO UPDATE SET
    salary_total  = EXCLUDED.salary_total,
    insured_total = EXCLUDED.insured_total,
    premium       = EXCLUDED.premium,
    updated_at    = NOW()
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.secure_calculate_nhi_employer(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.secure_calculate_nhi_employer(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.secure_calculate_nhi_employer(TEXT) TO authenticated, service_role;

-- ═══ 6. RPC：手動登錄其餘 5 類（兼職/執行業務/股利/利息/租金）═══
-- 門檻驗證：兼職所得 → single_payment_threshold（基本工資連動）；其餘 → other_income_threshold。
-- 未達門檻直接擋（無需登錄）；達門檻 → 計費基礎 = LEAST(給付額, payment_cap)。

CREATE OR REPLACE FUNCTION public.secure_add_nhi_record(
  p_period      TEXT,
  p_employee_id INT,
  p_category    TEXT,
  p_amount      NUMERIC,
  p_source_id   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org       INT;
  v_year      INT;
  v_params    public.nhi_supplement_params%ROWTYPE;
  v_threshold NUMERIC;
  v_taxable   NUMERIC;
  v_premium   NUMERIC;
  v_row       public.nhi_supplement_records%ROWTYPE;
BEGIN
  IF p_period IS NULL OR p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION '期別格式錯誤，需為 YYYY-MM（收到 %）', p_period;
  END IF;
  IF p_category IS NULL OR p_category NOT IN ('兼職所得','執行業務','股利','利息','租金') THEN
    RAISE EXCEPTION '類別 % 不可手動登錄（高額獎金請用 secure_calculate_nhi_supplement）', p_category;
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION '給付金額必須大於 0';
  END IF;

  v_org := current_employee_org();
  IF v_org IS NULL THEN RAISE EXCEPTION '無法識別租戶'; END IF;

  -- 員工必須屬於當前租戶
  IF NOT EXISTS (
    SELECT 1 FROM public.employees e
     WHERE e.id = p_employee_id AND e.organization_id = v_org
  ) THEN
    RAISE EXCEPTION '員工 % 不存在或不在當前租戶', p_employee_id;
  END IF;

  v_year := split_part(p_period, '-', 1)::INT;

  SELECT * INTO v_params FROM public.nhi_supplement_params
   WHERE effective_year <= v_year ORDER BY effective_year DESC LIMIT 1;
  IF v_params.effective_year IS NULL THEN
    RAISE EXCEPTION '尚未建立 % 年度二代健保參數（nhi_supplement_params）', v_year;
  END IF;

  v_threshold := CASE WHEN p_category = '兼職所得'
                      THEN v_params.single_payment_threshold
                      ELSE v_params.other_income_threshold END;

  IF p_amount < v_threshold THEN
    RAISE EXCEPTION '% 單次給付 NT$% 未達起扣門檻 NT$%，免扣補充保費、無需登錄',
      p_category, p_amount, v_threshold;
  END IF;

  v_taxable := LEAST(p_amount, v_params.payment_cap);
  v_premium := ROUND(v_taxable * v_params.rate);

  INSERT INTO public.nhi_supplement_records (
    organization_id, period, employee_id, category,
    payment_amount, taxable_base, premium, source_type, source_id
  ) VALUES (
    v_org, p_period, p_employee_id, p_category,
    p_amount, v_taxable, v_premium, 'manual',
    COALESCE(NULLIF(p_source_id, ''), gen_random_uuid()::TEXT)
  )
  ON CONFLICT (organization_id, period, employee_id, category, source_id) DO UPDATE SET
    payment_amount = EXCLUDED.payment_amount,
    taxable_base   = EXCLUDED.taxable_base,
    premium        = EXCLUDED.premium
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.secure_add_nhi_record(TEXT, INT, TEXT, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.secure_add_nhi_record(TEXT, INT, TEXT, NUMERIC, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.secure_add_nhi_record(TEXT, INT, TEXT, NUMERIC, TEXT) TO authenticated, service_role;

-- ═══ 7. RLS ═══

ALTER TABLE public.nhi_supplement_params  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nhi_supplement_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nhi_employer_records   ENABLE ROW LEVEL SECURITY;

-- 參數：法定全域值 — 登入者可讀；寫入僅 service role（無 authenticated 寫入 policy）
DROP POLICY IF EXISTS nhi_supplement_params_sel ON public.nhi_supplement_params;
CREATE POLICY nhi_supplement_params_sel ON public.nhi_supplement_params
  FOR SELECT TO authenticated
  USING (TRUE);

-- 代扣明細：org 內可讀；寫入一律經 SECURITY DEFINER RPC；手動列允許 org 內刪除（登錯撤回）
DROP POLICY IF EXISTS nhi_supplement_records_org_sel ON public.nhi_supplement_records;
CREATE POLICY nhi_supplement_records_org_sel ON public.nhi_supplement_records
  FOR SELECT TO authenticated
  USING (org_visible(organization_id));

DROP POLICY IF EXISTS nhi_supplement_records_manual_del ON public.nhi_supplement_records;
CREATE POLICY nhi_supplement_records_manual_del ON public.nhi_supplement_records
  FOR DELETE TO authenticated
  USING (org_visible(organization_id) AND source_type = 'manual');

-- 雇主負擔：org 內可讀；寫入僅經 RPC
DROP POLICY IF EXISTS nhi_employer_records_org_sel ON public.nhi_employer_records;
CREATE POLICY nhi_employer_records_org_sel ON public.nhi_employer_records
  FOR SELECT TO authenticated
  USING (org_visible(organization_id));

NOTIFY pgrst, 'reload schema';
