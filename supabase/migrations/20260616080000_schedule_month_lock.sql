-- ════════════════════════════════════════════════════════════════════════════
-- 排班「按月鎖定」— 對齊薪資結算（發布按 cycle、鎖定按月）
-- 2026-06-16
--
-- 設計：
--   發布(cycle)：排班是按四週變形 cycle 排的，排完發布該 cycle 給員工看（LINE）。
--                發布後仍可微調 → schedules.status 維持 'draft'（trigger 不擋）。
--   鎖定(月)  ：對齊薪資（薪資按月結算）。鎖定某月 → 該月該店所有排班 status→'published'，
--                既有 trigger enforce_schedule_lock 就會擋掉 UPDATE/DELETE（= 凍結）。
--   解鎖(月)  ：admin / super_admin 限定。
--
-- ★ 完全不動既有 trigger enforce_schedule_lock（published=已鎖），只新增月級鎖定表 + RPC。
-- ★ 鎖定單位是「月」，故一個跨月 cycle 的不同片段，會隨各自所屬月份分別鎖定。
--
-- idempotent：CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. 月鎖表（store_id + month 唯一）──
CREATE TABLE IF NOT EXISTS public.schedule_month_locks (
  store_id  INT  NOT NULL REFERENCES public.stores(id),
  month     TEXT NOT NULL,                          -- 'YYYY-MM'
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by INT REFERENCES public.employees(id),
  PRIMARY KEY (store_id, month)
);

ALTER TABLE public.schedule_month_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS month_locks_read ON public.schedule_month_locks;
CREATE POLICY month_locks_read ON public.schedule_month_locks
  FOR SELECT TO authenticated USING (true);   -- 鎖定狀態前端要讀（判斷哪些月鎖了）

-- 寫一律走下方 SECURITY DEFINER RPC（含權限檢查），不開放直接 DML
DROP POLICY IF EXISTS month_locks_no_direct_write ON public.schedule_month_locks;
CREATE POLICY month_locks_no_direct_write ON public.schedule_month_locks
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ── 2. 鎖定整月：該月該店 draft 排班 → published（trigger 之後擋改）+ 記月鎖 ──
CREATE OR REPLACE FUNCTION public.lock_schedule_month(
  p_store_id INT,
  p_month    TEXT                                   -- 'YYYY-MM'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp_id INT;
  v_start  DATE := (p_month || '-01')::date;
  v_end    DATE := ((p_month || '-01')::date + INTERVAL '1 month - 1 day')::date;
  v_count  INT;
BEGIN
  SELECT id INTO v_emp_id FROM employees
   WHERE auth_user_id = auth.uid()
      OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
   LIMIT 1;

  UPDATE schedules s SET status = 'published'
   WHERE s.date BETWEEN v_start AND v_end
     AND s.employee IN (SELECT name FROM employees WHERE store_id = p_store_id)
     AND s.status = 'draft';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO schedule_month_locks (store_id, month, locked_at, locked_by)
  VALUES (p_store_id, p_month, now(), v_emp_id)
  ON CONFLICT (store_id, month) DO UPDATE
    SET locked_at = now(), locked_by = EXCLUDED.locked_by;

  RETURN jsonb_build_object('ok', true, 'locked_rows', v_count, 'month', p_month);
END $$;

GRANT EXECUTE ON FUNCTION public.lock_schedule_month(INT, TEXT) TO authenticated;

-- ── 3. 解鎖整月（admin / super_admin only）──
CREATE OR REPLACE FUNCTION public.unlock_schedule_month(
  p_store_id INT,
  p_month    TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role  TEXT;
  v_start DATE := (p_month || '-01')::date;
  v_end   DATE := ((p_month || '-01')::date + INTERVAL '1 month - 1 day')::date;
  v_count INT;
BEGIN
  SELECT role INTO v_role FROM employees
   WHERE auth_user_id = auth.uid()
      OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
   LIMIT 1;

  IF v_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION '只有管理員（admin/super_admin）可以解鎖月份排班';
  END IF;

  PERFORM set_config('schedules.bypass_lock', 'on', true);

  UPDATE schedules s SET status = 'draft'
   WHERE s.date BETWEEN v_start AND v_end
     AND s.employee IN (SELECT name FROM employees WHERE store_id = p_store_id)
     AND s.status = 'published';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  DELETE FROM schedule_month_locks WHERE store_id = p_store_id AND month = p_month;

  RETURN jsonb_build_object('ok', true, 'unlocked_rows', v_count, 'month', p_month);
END $$;

GRANT EXECUTE ON FUNCTION public.unlock_schedule_month(INT, TEXT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
