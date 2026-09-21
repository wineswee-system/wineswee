-- 薪資閘門:豁免行政/計件 + 鎖定六月門市班表(解開六月結算)
-- 2026-07-09  現況:enforce_salary_requires_locked_schedule 只豁免「無 store_id」員工,
--   但行政/計件掛在門市(威耀總部 20、台中總倉 36)有 store_id → 被誤擋。
--   固定薪行政、計件本來就沒變動班表可鎖 → 應豁免。
--   另:schedule_month_locks 整張空,六月從沒鎖過 → 真門市輪班員工也全被擋。
-- 兩步:
--   1) 閘門加豁免 employment_category IN ('admin','piece')(固定/計件,永遠放行)
--   2) 鎖定 2026-06 有輪班員工的門市(locked_by=10 洪伯嘉)
-- idempotent:CREATE OR REPLACE + ON CONFLICT DO NOTHING。

BEGIN;

-- ── 1. 閘門:豁免行政/計件 ──
CREATE OR REPLACE FUNCTION public.enforce_salary_requires_locked_schedule()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id   INT;
  v_store_name TEXT;
  v_cat        TEXT;
BEGIN
  -- 只擋正式結算;草稿放行
  IF COALESCE(NEW.status, 'finalized') <> 'finalized' THEN
    RETURN NEW;
  END IF;

  -- 行政/計件(固定薪、無變動班表)→ 放行
  SELECT ss.employment_category INTO v_cat
    FROM salary_structures ss WHERE ss.employee_id = NEW.employee_id;
  IF COALESCE(v_cat, '') IN ('admin', 'piece') THEN
    RETURN NEW;
  END IF;

  SELECT e.store_id INTO v_store_id FROM employees e WHERE e.id = NEW.employee_id;

  -- 沒門市 → 放行
  IF v_store_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 有門市 → 該月班表必須已鎖定
  IF NOT EXISTS (
    SELECT 1 FROM schedule_month_locks l
    WHERE l.store_id = v_store_id AND l.month = NEW.month
  ) THEN
    SELECT name INTO v_store_name FROM stores WHERE id = v_store_id;
    RAISE EXCEPTION '「%」% 班表尚未鎖定，無法結算薪資',
      COALESCE(v_store_name, '門市#' || v_store_id), NEW.month
      USING HINT = '請先到排班頁鎖定此門市的該月份，再結算薪資';
  END IF;

  RETURN NEW;
END $$;

-- ── 2. 鎖定 2026-06 有輪班員工的門市 ──
INSERT INTO public.schedule_month_locks (store_id, month, locked_at, locked_by)
SELECT s.id, '2026-06', now(), 10
FROM public.stores s
WHERE s.id IN (20, 31, 27, 29, 24, 25, 28, 30, 34, 33, 19, 36)
ON CONFLICT (store_id, month) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
