-- ════════════════════════════════════════════════════════════════════════════
-- 薪資閘門：班表鎖定後，薪資才能寫進 DB（防止薪資依據的班表事後被改 → 爭議）
-- 2026-06-16
--
-- 規則：每筆薪資要寫進 payroll_records 的那一刻，檢查「該員工所屬門市 + 該薪資月份」
--   是否已在 schedule_month_locks（= 該月班表已鎖定/凍結）。沒鎖 → 擋下、整筆結算 rollback。
--
-- ★ 用 BEFORE INSERT trigger，**完全不碰 generate_payroll 這支巨型核心函式**（風險最低），
--   且任何寫 payroll_records 的路徑都擋得到，無法繞過。
-- ★ 沒門市的員工（總部/行政固定工時，不在門市班表上）→ 跳過檢查，照常結算。
--
-- idempotent：CREATE OR REPLACE + DROP TRIGGER IF EXISTS。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_payroll_requires_locked_schedule()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id   INT;
  v_store_name TEXT;
BEGIN
  SELECT e.store_id INTO v_store_id FROM employees e WHERE e.id = NEW.employee_id;

  -- 沒門市（固定行政工時，無變動班表可鎖）→ 放行
  IF v_store_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 有門市 → 該月班表必須已鎖定
  IF NOT EXISTS (
    SELECT 1 FROM schedule_month_locks l
    WHERE l.store_id = v_store_id
      AND l.month = NEW.pay_period
  ) THEN
    SELECT name INTO v_store_name FROM stores WHERE id = v_store_id;
    RAISE EXCEPTION '「%」% 班表尚未鎖定，無法結算薪資',
      COALESCE(v_store_name, '門市#' || v_store_id), NEW.pay_period
      USING HINT = '請先到排班頁鎖定此門市的該月份，再結算薪資';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payroll_requires_locked_schedule ON public.payroll_records;
CREATE TRIGGER trg_payroll_requires_locked_schedule
  BEFORE INSERT ON public.payroll_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payroll_requires_locked_schedule();

COMMIT;

NOTIFY pgrst, 'reload schema';
