-- ════════════════════════════════════════════════════════════
-- 薪資結構完整化（對齊台灣業界普遍二元薪資制 + 完整加班分項）
--
-- 目標：salary_structures 跟 payroll_records 補齊欄位，讓月結能完整
-- 反映 CSV 上看到的所有項目（本薪/底薪雙欄、4 種加班、各類津貼）。
-- 「有多也沒關係 多的留給真的需要的時候用」原則：寧可多欄不夠 0，
-- 不要等到要用才改 schema。
--
-- 變更清單：
--   salary_structures 加：
--     base_insured             投保底薪（雙基薪制下的「底薪」）
--     supervisor_allowance     主管加給
--     night_shift_allowance    夜班津貼
--     cross_store_allowance    跨區/跨店津貼
--     insurance_grade_id FK    對到 insurance_grades 級距
--
--   payroll_records 加：
--     -- 基薪
--     base_insured             投保底薪
--     -- 津貼
--     supervisor_allowance     主管加給
--     night_shift_allowance    夜班津貼
--     cross_store_allowance    跨區津貼
--     -- 加班分四種（勞基法 §32 / §24 / §39 / §40）
--     overtime_pay_weekday     平日延長工時加班費
--     overtime_pay_restday     休息日加班費
--     overtime_pay_holiday     例假日加班費
--     overtime_pay_national    國定假日加班費
--     ot_hours_restday         休息日加班時數
--     ot_hours_national        國定加班時數
--     -- 其他應付
--     rest_day_unused_pay      休息未休補償
--     back_pay_adjustment      補發前期差額
--     performance_bonus        績效獎金
--     commission               業績獎金
--     festival_bonus           三節獎金
--     -- 扣項細分
--     paid_leave_deduction     有薪請假扣款
--     unpaid_leave_deduction   無薪請假扣款（leave_deduction 將被視為 legacy 合計）
--     advance_recovery         預支薪資扣回
--     -- 公司負擔細分
--     occupational_injury_employer  職災保險（公司端，通常含於勞保）
--     nhi_supplementary_employer    二代健保補充保費（雇主端）
--     -- 計算/匯總
--     earnings_subtotal        應發小計（A 區總和）
--     employer_total_cost      公司總成本（gross + 公司負擔）
--     -- Metadata
--     insurance_grade_id FK    當期投保級距
--     attendance_days NUMERIC  該月出勤天數
--     notes TEXT
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. salary_structures ═══
ALTER TABLE public.salary_structures
  ADD COLUMN IF NOT EXISTS base_insured            NUMERIC,
  ADD COLUMN IF NOT EXISTS supervisor_allowance    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS night_shift_allowance   NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cross_store_allowance   NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS insurance_grade_id      INT;

-- 既有資料：若沒設定 base_insured，預設為 base_salary（單基薪舊資料）
UPDATE public.salary_structures
   SET base_insured = base_salary
 WHERE base_insured IS NULL;


-- ═══ 2. payroll_records ═══
ALTER TABLE public.payroll_records
  -- 基薪
  ADD COLUMN IF NOT EXISTS base_insured            NUMERIC DEFAULT 0,
  -- 津貼
  ADD COLUMN IF NOT EXISTS supervisor_allowance    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS night_shift_allowance   NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cross_store_allowance   NUMERIC DEFAULT 0,
  -- 加班分項
  ADD COLUMN IF NOT EXISTS overtime_pay_weekday    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_pay_restday    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_pay_holiday    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_pay_national   NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ot_hours_restday        NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ot_hours_national       NUMERIC DEFAULT 0,
  -- 其他應付
  ADD COLUMN IF NOT EXISTS rest_day_unused_pay     NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS back_pay_adjustment     NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS performance_bonus       NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission              NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS festival_bonus          NUMERIC DEFAULT 0,
  -- 扣項細分
  ADD COLUMN IF NOT EXISTS paid_leave_deduction    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unpaid_leave_deduction  NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS advance_recovery        NUMERIC DEFAULT 0,
  -- 公司負擔細分
  ADD COLUMN IF NOT EXISTS occupational_injury_employer NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nhi_supplementary_employer   NUMERIC DEFAULT 0,
  -- 計算
  ADD COLUMN IF NOT EXISTS earnings_subtotal       NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS employer_total_cost     NUMERIC DEFAULT 0,
  -- Metadata
  ADD COLUMN IF NOT EXISTS insurance_grade_id      INT,
  ADD COLUMN IF NOT EXISTS attendance_days         NUMERIC,
  ADD COLUMN IF NOT EXISTS notes                   TEXT;


-- ═══ 3. 索引 ═══
CREATE INDEX IF NOT EXISTS idx_payroll_records_grade
  ON public.payroll_records(insurance_grade_id);
CREATE INDEX IF NOT EXISTS idx_payroll_records_period_emp
  ON public.payroll_records(pay_period, employee_id);


-- ═══ 4. 觸發器：寫入時自動算 earnings_subtotal / employer_total_cost ═══
-- gross_salary / total_deductions / net_salary 由前端 / RPC 自行計算（保留彈性）
-- earnings_subtotal 是「所有應發 A 區」總和，方便對 CSV 那欄
CREATE OR REPLACE FUNCTION public._trg_payroll_records_compute_subtotals()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.earnings_subtotal := COALESCE(NEW.base_salary, 0)
                         + COALESCE(NEW.base_insured, 0)
                         + COALESCE(NEW.role_allowance, 0)
                         + COALESCE(NEW.supervisor_allowance, 0)
                         + COALESCE(NEW.meal_allowance, 0)
                         + COALESCE(NEW.transport_allowance, 0)
                         + COALESCE(NEW.night_shift_allowance, 0)
                         + COALESCE(NEW.cross_store_allowance, 0)
                         + COALESCE(NEW.attendance_bonus_earned, 0)
                         + COALESCE(NEW.overtime_pay, 0)
                         + COALESCE(NEW.overtime_pay_weekday, 0)
                         + COALESCE(NEW.overtime_pay_restday, 0)
                         + COALESCE(NEW.overtime_pay_holiday, 0)
                         + COALESCE(NEW.overtime_pay_national, 0)
                         + COALESCE(NEW.rest_day_unused_pay, 0)
                         + COALESCE(NEW.back_pay_adjustment, 0)
                         + COALESCE(NEW.performance_bonus, 0)
                         + COALESCE(NEW.commission, 0)
                         + COALESCE(NEW.festival_bonus, 0)
                         + COALESCE(NEW.year_end_bonus, 0)
                         + COALESCE(NEW.other_bonus, 0)
                         + COALESCE(NEW.unused_leave_payout, 0)
                         + COALESCE(NEW.custom_allowances_total, 0);

  -- 公司總成本 = gross_salary + 公司負擔（保險、退休金、職災、二代）
  NEW.employer_total_cost := COALESCE(NEW.gross_salary, NEW.earnings_subtotal, 0)
                           + COALESCE(NEW.labor_ins_employer, 0)
                           + COALESCE(NEW.health_ins_employer, 0)
                           + COALESCE(NEW.labor_pension_employer, 0)
                           + COALESCE(NEW.occupational_injury_employer, 0)
                           + COALESCE(NEW.nhi_supplementary_employer, 0);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payroll_records_compute_subtotals ON public.payroll_records;
CREATE TRIGGER trg_payroll_records_compute_subtotals
  BEFORE INSERT OR UPDATE ON public.payroll_records
  FOR EACH ROW EXECUTE FUNCTION public._trg_payroll_records_compute_subtotals();


COMMIT;

NOTIFY pgrst, 'reload schema';
