-- ════════════════════════════════════════════════════════════════════════════
-- 約聘 & 外籍移工 — 法規連動補強
-- ────────────────────────────────────────────────────────────────────────────
-- 1. payroll_records.fw_deductions        外籍移工扣款欄位
-- 2. calc_annual_leave_entitlement()      勞基法 §38 特休天數計算器
-- 3. tg_sync_contract_status()            合約狀態自動同步 trigger
-- 4. apply_fw_deductions()               外籍移工薪資扣款 RPC
-- 5. v_expiry_alerts                     到期預警 view（合約 + 證件）
-- 6. pg_cron: 每日合約狀態刷新（trigger 只在 end_date 變更時觸發，時間流逝靠 cron 補）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. payroll_records 外籍移工扣款欄位 ─────────────────────────────────
-- 法源：就業服務法 §52、外國人受聘僱從事工作之薪資認定標準
-- 仲介費上限：製造業 NT$1,800/月，其他 NT$1,500/月（由雇主或仲介收取）
ALTER TABLE public.payroll_records
  ADD COLUMN IF NOT EXISTS fw_deductions           NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fw_deductions_breakdown JSONB         NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.payroll_records.fw_deductions IS
  '外籍移工扣款小計（仲介費＋宿舍費＋伙食費＋其他）。法規：就業服務法§52、外國人受聘僱從事工作之薪資認定標準';


-- ─── 2. calc_annual_leave_entitlement() — 勞基法 §38 特休天數 ────────────
-- 勞動基準法 第 38 條（2018年修正）：
--   服務滿 6 個月  →  3 天
--   服務滿 1 年   →  7 天
--   服務滿 2 年   → 10 天
--   服務滿 3 年   → 14 天
--   服務滿 5 年   → 15 天
--   服務滿 10 年  → 每滿 1 年加 1 天，最多 30 天
--
-- 注意：兼職（每週工時 < 20 小時）不在本法適用範圍，應另行議定
-- 注意：外籍移工 適用勞基法，年資自到職日（arrival_date 或 join_date）起算
-- 注意：約聘（定期勞動契約）年資連續累計計算（最高法院判決見解）

CREATE OR REPLACE FUNCTION public.calc_annual_leave_entitlement(
  p_join_date      DATE,
  p_reference_date DATE DEFAULT CURRENT_DATE
) RETURNS INT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_months INT;
  v_years  INT;
BEGIN
  IF p_join_date IS NULL OR p_join_date > p_reference_date THEN RETURN 0; END IF;

  v_months := (EXTRACT(YEAR  FROM AGE(p_reference_date, p_join_date))::INT) * 12
            +  EXTRACT(MONTH FROM AGE(p_reference_date, p_join_date))::INT;
  v_years  :=  EXTRACT(YEAR  FROM AGE(p_reference_date, p_join_date))::INT;

  IF    v_months <  6 THEN RETURN 0;
  ELSIF v_months < 12 THEN RETURN 3;
  ELSIF v_years  <  2 THEN RETURN 7;
  ELSIF v_years  <  3 THEN RETURN 10;
  ELSIF v_years  <  5 THEN RETURN 14;
  ELSIF v_years  < 10 THEN RETURN 15;
  ELSE                     RETURN LEAST(15 + (v_years - 10), 30);
  END IF;
END;
$$;

COMMENT ON FUNCTION public.calc_annual_leave_entitlement IS
  '勞基法 §38：依到職日 vs 基準日計算當年應給特休天數。兼職 <20hr/週不適用，需另議。';


-- ─── 3. 合約狀態自動同步 trigger ─────────────────────────────────────────
-- 規則（勞動部勞動力發展署實務慣例）：
--   距到期 >60 天    → active
--   距到期 1~60 天  → expiring_soon  ← HR 應在 60 天前開始續約評估
--   已過到期日      → expired
--   手動設為 terminated / renewed → 不覆寫

CREATE OR REPLACE FUNCTION public.tg_sync_contract_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('terminated', 'renewed') THEN
    IF CURRENT_DATE > NEW.end_date THEN
      NEW.status := 'expired';
    ELSIF (NEW.end_date - CURRENT_DATE) <= 60 THEN
      NEW.status := 'expiring_soon';
    ELSE
      NEW.status := 'active';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contract_status ON public.employee_contracts;
CREATE TRIGGER trg_contract_status
  BEFORE INSERT OR UPDATE OF end_date ON public.employee_contracts
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_contract_status();

COMMENT ON FUNCTION public.tg_sync_contract_status IS
  '合約 INSERT 或 end_date 變更時自動計算 status（active/expiring_soon/expired）。手動 terminated/renewed 不被覆寫。';


-- ─── 4. apply_fw_deductions() — 外籍移工薪資扣款 ─────────────────────────
-- 在 generate_payroll() 產生薪資記錄後呼叫。
--
-- 法規根據（就業服務法、外籍勞工僱用管理辦法）：
--   仲介費：製造業上限 NT$1,800/月、服務業上限 NT$1,500/月（由 foreign_worker_profiles.broker_monthly_fee 填入）
--   住宿費：雇主可收取實際費用，但不得以不合理高價剝奪（由 accommodation_fee 填入）
--   伙食費：由 meal_fee 填入
--
-- 注意：依勞動部函釋，上述扣款須事先在工作合約中約定並經移工同意

CREATE OR REPLACE FUNCTION public.apply_fw_deductions(
  p_payroll_run_id INT
) RETURNS TABLE(employee_id INT, fw_total NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  rec           RECORD;
  v_fw          RECORD;
  v_other_total NUMERIC(10,2);
  v_fw_total    NUMERIC(10,2);
BEGIN
  FOR rec IN
    SELECT pr.id AS record_id, pr.employee_id
    FROM   public.payroll_records pr
    JOIN   public.employees e ON e.id = pr.employee_id
    WHERE  pr.payroll_run_id = p_payroll_run_id
      AND  e.employment_type = '外籍'
  LOOP
    SELECT * INTO v_fw
    FROM public.foreign_worker_profiles fwp
    WHERE fwp.employee_id = rec.employee_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    SELECT COALESCE(SUM((item->>'amount')::numeric), 0) INTO v_other_total
    FROM jsonb_array_elements(v_fw.other_deductions) AS item;

    v_fw_total := COALESCE(v_fw.broker_monthly_fee, 0)
               + COALESCE(v_fw.accommodation_fee,   0)
               + COALESCE(v_fw.meal_fee,             0)
               + COALESCE(v_other_total,             0);

    IF v_fw_total > 0 THEN
      UPDATE public.payroll_records SET
        fw_deductions           = v_fw_total,
        fw_deductions_breakdown = jsonb_build_object(
          'broker_monthly_fee', COALESCE(v_fw.broker_monthly_fee, 0),
          'accommodation_fee',  COALESCE(v_fw.accommodation_fee, 0),
          'meal_fee',           COALESCE(v_fw.meal_fee, 0),
          'other',              COALESCE(v_other_total, 0)
        ),
        total_deductions = total_deductions + v_fw_total,
        net_salary       = net_salary       - v_fw_total
      WHERE id = rec.record_id;
    END IF;

    RETURN QUERY SELECT rec.employee_id, v_fw_total;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.apply_fw_deductions IS
  '計算外籍移工仲介費/住宿費/伙食費並寫入 payroll_records。在 generate_payroll 之後執行。';


-- ─── 5. v_expiry_alerts — 到期預警 view ──────────────────────────────────
-- 合併查詢：合約到期 + 外籍移工證件到期
-- days_remaining < 0  → 已過期（顯示於告警清單，方便補件追蹤）
-- days_remaining 0~30 → 緊急（紅）
-- days_remaining 31~90 → 注意（橘）

CREATE OR REPLACE VIEW public.v_expiry_alerts AS
  -- 合約到期
  SELECT
    'contract'                              AS alert_type,
    ec.id                                   AS ref_id,
    e.id                                    AS employee_id,
    e.name                                  AS employee_name,
    e.employment_type,
    ec.contract_type                        AS label,
    ec.end_date                             AS expiry_date,
    (ec.end_date - CURRENT_DATE)::INT       AS days_remaining,
    ec.organization_id
  FROM  public.employee_contracts ec
  JOIN  public.employees e ON e.id = ec.employee_id
  WHERE ec.status NOT IN ('terminated', 'renewed')
    AND ec.end_date >= CURRENT_DATE - INTERVAL '7 days'
UNION ALL
  -- 外籍移工證件到期（工作許可/居留證/健康檢查/護照）
  SELECT
    'doc'                                   AS alert_type,
    fd.id                                   AS ref_id,
    e.id                                    AS employee_id,
    e.name                                  AS employee_name,
    e.employment_type,
    fd.doc_type                             AS label,
    fd.expiry_date,
    (fd.expiry_date - CURRENT_DATE)::INT    AS days_remaining,
    fd.organization_id
  FROM  public.foreign_worker_docs fd
  JOIN  public.employees e ON e.id = fd.employee_id
  WHERE fd.expiry_date >= CURRENT_DATE - INTERVAL '7 days';

COMMENT ON VIEW public.v_expiry_alerts IS
  '到期預警：合約 + 外籍移工證件。days_remaining<0 已過期，0-30 緊急，31-90 注意。法規：工作許可到期 = 非法工作（就業服務法§44，罰 15-75 萬元）。';


-- ─── 6. pg_cron ──────────────────────────────────────────────────────────
-- 合約狀態刷新已整合進 20260521220000_consolidate_daily_8am_cron.sql
-- 由 run_daily_8am_maintenance() 統一處理，此處不再建立獨立 cron


COMMIT;

NOTIFY pgrst, 'reload schema';
