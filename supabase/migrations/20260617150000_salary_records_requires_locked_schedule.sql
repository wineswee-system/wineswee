-- ════════════════════════════════════════════════════════════════════════════
-- 薪資閘門 v2：批次計薪「確認儲存（finalized）」也要班表鎖定後才能寫進 DB
-- 2026-06-17
--
-- 背景：20260616090000 的閘門掛在 payroll_records（薪資發放，目前 0 筆、未使用），
--   但實際「批次計薪 → 確認儲存」走的是 secure_upsert_salary_v2 → 寫入 salary_records，
--   完全沒被擋（四月班表沒鎖也能結算）。本 migration 把同樣的閘門補到 salary_records。
--
-- 規則：salary_records 寫入（INSERT 或 UPDATE）且 status='finalized' 時，檢查
--   「該員工所屬門市 + NEW.month」是否已在 schedule_month_locks（該月班表已鎖定）。
--   沒鎖 → RAISE EXCEPTION，整筆結算失敗。
--
-- ★ status='draft'（存為草稿，逐筆調整用）→ 放行，不擋；只擋正式結算 finalized。
-- ★ INSERT + UPDATE 都擋：四月已有 85 筆，重存是 UPDATE（upsert），只擋 INSERT 會漏。
-- ★ 沒門市的員工（總部/行政固定工時，不在門市班表上）→ 跳過檢查，照常結算。
-- ★ 計件（salary_structures.employment_category='piece'）→ 放行：按件數計薪、不排班不看考勤，
--   要求鎖班表才能結薪不合理。
-- ★ 不碰 secure_upsert_salary_v2 巨型函式（風險最低），任何寫入路徑都擋得到。
--
-- idempotent：CREATE OR REPLACE + DROP TRIGGER IF EXISTS。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_salary_requires_locked_schedule()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id   INT;
  v_store_name TEXT;
  v_category   TEXT;
BEGIN
  -- 只擋正式結算；草稿（試算暫存、逐筆調整前）放行
  IF COALESCE(NEW.status, 'finalized') <> 'finalized' THEN
    RETURN NEW;
  END IF;

  -- 計件（按件數計薪、不排班不看考勤）→ 放行，不需班表鎖定
  SELECT s.employment_category INTO v_category
    FROM salary_structures s
    WHERE s.employee_id = NEW.employee_id
    ORDER BY s.id DESC
    LIMIT 1;
  IF v_category = 'piece' THEN
    RETURN NEW;
  END IF;

  SELECT e.store_id INTO v_store_id FROM employees e WHERE e.id = NEW.employee_id;

  -- 沒門市（固定行政工時，無變動班表可鎖）或查不到員工 → 放行
  IF v_store_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 有門市 → 該月班表必須已鎖定
  IF NOT EXISTS (
    SELECT 1 FROM schedule_month_locks l
    WHERE l.store_id = v_store_id
      AND l.month = NEW.month
  ) THEN
    SELECT name INTO v_store_name FROM stores WHERE id = v_store_id;
    RAISE EXCEPTION '「%」% 班表尚未鎖定，無法結算薪資',
      COALESCE(v_store_name, '門市#' || v_store_id), NEW.month
      USING HINT = '請先到排班頁鎖定此門市的該月份，再結算薪資';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_salary_requires_locked_schedule ON public.salary_records;
CREATE TRIGGER trg_salary_requires_locked_schedule
  BEFORE INSERT OR UPDATE ON public.salary_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_salary_requires_locked_schedule();

COMMIT;

NOTIFY pgrst, 'reload schema';
