-- ════════════════════════════════════════════════════════════════════════════
-- 例假日（weekly_off）選加班費的正職/行政員工 → 強制自動建 8h 補休 ledger
--
-- 業務規則（勞基法 §40）：
--   例假因特殊事由出勤 → 雇主須給加倍工資（已在 payrollCalc 的 weeklyOff × 1.0 處理）
--   另外「應給予補假一天」→ 本 migration 補實作此部分
--
-- 實作邏輯（修改 trg_create_comp_time_ledger）：
--   原情況一（不變）：ot_type = 'comp_time' → 建 OT hours 數的 ledger
--   新增情況二：ot_category = 'weekly_off' + ot_type = 'pay' (or NULL)
--             + 非時薪 + 非計件 → 建 8h（一天）mandatory comp time ledger
--
-- 說明：
--   - 選 comp_time 的人已在情況一拿到 OT 小時數的補休，不再疊加
--   - 選 pay 的人目前只有現金，沒有補休 → 本 migration 補建
--   - hours = 8（固定一天，不管當天實際打幾小時）
--   - frozen_ot_amount = hourly_rate × 8（過期月結時兌現）
-- ════════════════════════════════════════════════════════════════════════════

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
  v_salary_type  TEXT;
  v_emp_category TEXT;
BEGIN
  -- 只在 status 轉為「已核准」時觸發
  IF NEW.status <> '已核准' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = '已核准' THEN
    RETURN NEW;  -- 已經是核准了，不重發
  END IF;

  v_hours := COALESCE(NEW.ot_hours, NEW.hours);
  v_date  := COALESCE(NEW.request_date, NEW.date);

  IF v_hours IS NULL OR v_hours <= 0 OR v_date IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(ss.base_salary, 0),
    e.organization_id,
    COALESCE(ss.salary_type, 'monthly'),
    COALESCE(ss.employment_category, '')
  INTO v_base, v_org_id, v_salary_type, v_emp_category
  FROM public.employees e
  LEFT JOIN public.salary_structures ss ON ss.employee_id = e.id
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

  -- ─── 情況一（原有邏輯）：員工選補休 ────────────────────────────────────
  IF COALESCE(NEW.ot_type, 'pay') = 'comp_time' THEN
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
  END IF;

  -- ─── 情況二（新增）：例假日選加班費 + 正職/行政 → 強制建 8h 補休 ──────
  -- 兼職(hourly)和計件(piece)不適用：兼職已拿 ×2 現金，計件無 OT
  IF v_category = 'weekly_off'
     AND v_salary_type <> 'hourly'
     AND v_emp_category <> 'piece' THEN

    INSERT INTO public.comp_time_ledger (
      employee_id, overtime_request_id, organization_id,
      hours, ot_date, expires_at,
      frozen_hourly_rate, frozen_ot_amount,
      status
    ) VALUES (
      NEW.employee_id, NEW.id, COALESCE(v_org_id, NEW.organization_id),
      8,        -- 固定一天 = 8 小時
      v_date,
      v_date + INTERVAL '1 year' - INTERVAL '1 day',
      v_hourly_rate,
      ROUND(v_hourly_rate * 8, 2),  -- 一天工資，過期兌現用
      'active'
    )
    ON CONFLICT (overtime_request_id) DO NOTHING;

  END IF;

  RETURN NEW;
END $$;

-- Trigger 已在 20260609010000 建立，直接 CREATE OR REPLACE function 即可生效
-- 確認 trigger 還掛著
DROP TRIGGER IF EXISTS trg_overtime_comp_time_ledger ON public.overtime_requests;
CREATE TRIGGER trg_overtime_comp_time_ledger
  AFTER INSERT OR UPDATE OF status ON public.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_create_comp_time_ledger();

NOTIFY pgrst, 'reload schema';
