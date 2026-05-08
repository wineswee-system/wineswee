-- ============================================================
-- 資遣費（勞退新制）計算 + 紀錄 + payroll 整合欄位
--
-- 規則（勞退新制／勞工退休金條例第 12 條）：
--   - 服務年資 × 0.5 月平均工資 = 資遣費
--   - 封頂 6 個月
--   - 預告工資（勞基法第 16 條）：
--       3 月-1 年   → 10 日
--       1 年-3 年   → 20 日
--       3 年以上    → 30 日
--   - 平均工資 = 離職前 6 個月 payroll_records.gross_salary 平均
--     沒紀錄則 fallback 到 salary_structures.base_salary
-- ============================================================

BEGIN;

-- ═══ 1. severance_records 主表 ═══
CREATE TABLE IF NOT EXISTS public.severance_records (
  id                       SERIAL PRIMARY KEY,
  employee_id              INT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  -- 計算當下快照（避免員工資料後來變動影響舊紀錄）
  employee_name_snapshot   TEXT,
  join_date                DATE NOT NULL,
  termination_date         DATE NOT NULL,
  reason                   TEXT,                     -- 業務縮編 / 不能勝任 / 虧損 / 不適任 ...
  -- 計算結果
  service_years            NUMERIC(6,3) NOT NULL,    -- 服務年資（小數，例 3.583）
  average_monthly_wage     NUMERIC(12,2) NOT NULL,   -- 平均月薪（資遣計算基底）
  severance_months         NUMERIC(5,2) NOT NULL,    -- 資遣月數（封頂 6）
  severance_amount         NUMERIC(12,2) NOT NULL,   -- 資遣金 = severance_months × average_monthly_wage
  notice_days              INT NOT NULL DEFAULT 0,   -- 預告天數 10/20/30
  notice_wage              NUMERIC(12,2) NOT NULL DEFAULT 0,  -- 預告工資（未實際預告才付）
  notice_paid              BOOLEAN NOT NULL DEFAULT true,     -- 是否實際給預告（true=有給=不付 notice_wage）
  unused_leave_days        NUMERIC(6,2) DEFAULT 0,    -- 特休未休天數
  unused_leave_wage        NUMERIC(12,2) DEFAULT 0,   -- 特休未休折算工資
  total_amount             NUMERIC(12,2) NOT NULL,    -- 總額 = severance + notice (if not paid) + unused_leave
  -- 狀態
  status                   TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','paid','cancelled')),
  paid_at                  TIMESTAMPTZ,
  paid_in_payroll_run_id   INT REFERENCES public.payroll_runs(id) ON DELETE SET NULL,
  notes                    TEXT,
  organization_id          INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  created_by               TEXT,
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_severance_emp ON public.severance_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_severance_status ON public.severance_records(status);
CREATE INDEX IF NOT EXISTS idx_severance_term_date ON public.severance_records(termination_date);
CREATE INDEX IF NOT EXISTS idx_severance_org ON public.severance_records(organization_id);

ALTER TABLE public.severance_records ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='severance_records' AND policyname='allow_all_severance') THEN
    CREATE POLICY allow_all_severance ON public.severance_records FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ═══ 2. payroll_records 加資遣相關欄位 ═══
ALTER TABLE public.payroll_records
  ADD COLUMN IF NOT EXISTS severance_amount     NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notice_wage          NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unused_leave_wage    NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS severance_total      NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS severance_record_id  INT REFERENCES public.severance_records(id) ON DELETE SET NULL;


-- ═══ 3. RPC calc_severance：給前端試算用（不寫進 DB） ═══
-- 回傳所有計算欄位，前端可調 average_monthly_wage 後才存
CREATE OR REPLACE FUNCTION public.calc_severance(
  p_employee_id     INT,
  p_termination_date DATE,
  p_avg_wage_override NUMERIC DEFAULT NULL  -- 手動指定平均工資（可選；NULL = 自動算）
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp                employees;
  v_service_days       INT;
  v_service_years      NUMERIC;
  v_avg_wage           NUMERIC;
  v_severance_months   NUMERIC;
  v_severance_amount   NUMERIC;
  v_notice_days        INT;
  v_notice_wage        NUMERIC;
  v_total              NUMERIC;
  v_payroll_avg        NUMERIC;
  v_struct_base        NUMERIC;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id;
  IF v_emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;
  IF v_emp.join_date IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_JOIN_DATE',
                             'message', '此員工沒設到職日，無法計算服務年資');
  END IF;
  IF p_termination_date <= v_emp.join_date THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_TERMINATION_DATE',
                             'message', '離職日不可早於到職日');
  END IF;

  -- 服務年資（精確到天 → 年）
  v_service_days  := p_termination_date - v_emp.join_date;
  v_service_years := ROUND(v_service_days::numeric / 365.25, 3);

  -- 平均工資：撈離職前 6 個月 payroll_records.gross_salary 平均
  -- pay_period 格式 'YYYY-MM'
  IF p_avg_wage_override IS NOT NULL AND p_avg_wage_override > 0 THEN
    v_avg_wage := p_avg_wage_override;
  ELSE
    SELECT AVG(gross_salary) INTO v_payroll_avg
      FROM payroll_records
     WHERE employee_id = p_employee_id
       AND gross_salary > 0
       AND pay_period >= to_char(p_termination_date - INTERVAL '6 months', 'YYYY-MM')
       AND pay_period <  to_char(p_termination_date, 'YYYY-MM');

    IF v_payroll_avg IS NOT NULL AND v_payroll_avg > 0 THEN
      v_avg_wage := ROUND(v_payroll_avg, 2);
    ELSE
      -- fallback 到 salary_structures.base_salary
      SELECT base_salary INTO v_struct_base
        FROM salary_structures
       WHERE employee_id = p_employee_id
       ORDER BY effective_date DESC NULLS LAST, id DESC
       LIMIT 1;
      v_avg_wage := COALESCE(v_struct_base, 0);
    END IF;
  END IF;

  -- 資遣月數 = min(服務年資 × 0.5, 6)
  v_severance_months := LEAST(v_service_years * 0.5, 6.0);
  v_severance_amount := ROUND(v_severance_months * v_avg_wage, 2);

  -- 預告天數（勞基法 16 條）
  IF v_service_days < 90 THEN
    v_notice_days := 0;  -- 未滿 3 個月不需預告
  ELSIF v_service_years < 1 THEN
    v_notice_days := 10;
  ELSIF v_service_years < 3 THEN
    v_notice_days := 20;
  ELSE
    v_notice_days := 30;
  END IF;

  -- 預告工資（如未實際預告才付）：日薪 × 預告天數
  -- 日薪以「平均月薪 ÷ 30」估算
  v_notice_wage := ROUND(v_avg_wage / 30 * v_notice_days, 2);

  v_total := v_severance_amount + v_notice_wage;

  RETURN json_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'employee_name', v_emp.name,
    'employee_number', v_emp.employee_number,
    'join_date', v_emp.join_date,
    'termination_date', p_termination_date,
    'service_days', v_service_days,
    'service_years', v_service_years,
    'service_label', floor(v_service_years)::text || ' 年 ' ||
                     round((v_service_years - floor(v_service_years)) * 12)::text || ' 個月',
    'average_monthly_wage', v_avg_wage,
    'avg_wage_source', CASE
      WHEN p_avg_wage_override IS NOT NULL THEN 'manual'
      WHEN v_payroll_avg IS NOT NULL THEN 'payroll_6m_avg'
      ELSE 'salary_structure'
    END,
    'severance_months', v_severance_months,
    'severance_amount', v_severance_amount,
    'notice_days', v_notice_days,
    'notice_wage', v_notice_wage,
    'total_amount', v_total
  );
END $$;

GRANT EXECUTE ON FUNCTION public.calc_severance(INT, DATE, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
