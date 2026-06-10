-- ════════════════════════════════════════════════════════════════
-- 排班鎖定 + 草稿續排 session
--
-- 需求：
-- 1. schedules 加 status (draft/published) → 區分預排 vs 已發布
-- 2. 發布按 cycle 為單位（不是按月），鎖定後 trigger 擋 UPDATE/DELETE
-- 3. admin 可以 unpublish 解鎖
-- 4. wizard 草稿 session — 中斷後可續排
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. schedules 加 status 欄 ──
ALTER TABLE public.schedules
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published'));

CREATE INDEX IF NOT EXISTS idx_schedules_status_date
  ON public.schedules(status, date);

-- ── 2. schedule_publish_status 擴充為 cycle-keyed + 鎖定欄 ──
ALTER TABLE public.schedule_publish_status
  ADD COLUMN IF NOT EXISTS cycle_start DATE,
  ADD COLUMN IF NOT EXISTS cycle_end   DATE,
  ADD COLUMN IF NOT EXISTS locked_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by   INT REFERENCES public.employees(id);

-- 拆掉舊 UNIQUE(store_id, month)，改用 cycle-based uniqueness
-- 否則同月多 cycle 會撞
ALTER TABLE public.schedule_publish_status
  DROP CONSTRAINT IF EXISTS schedule_publish_status_store_id_month_key;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_publish_status_cycle
  ON public.schedule_publish_status(store_id, cycle_start, cycle_end)
  WHERE cycle_start IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_publish_status_cycle
  ON public.schedule_publish_status(store_id, cycle_start, cycle_end);

COMMENT ON COLUMN public.schedule_publish_status.cycle_start
  IS '發布範圍起日（cycle-level publish；舊資料用 month 推算）';
COMMENT ON COLUMN public.schedule_publish_status.cycle_end
  IS '發布範圍迄日（cycle-level publish；舊資料用 month 推算）';
COMMENT ON COLUMN public.schedule_publish_status.locked_at
  IS '鎖定時間戳，NULL = 未鎖（草稿）';

-- ── 3. trigger：published 狀態 schedules 不准 UPDATE/DELETE ──
-- 透過 GUC 'schedules.bypass_lock' 讓 admin RPC 可繞過
CREATE OR REPLACE FUNCTION public.enforce_schedule_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- INSERT 不擋（新建排班一律允許）
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- UPDATE/DELETE：OLD 是 published 且沒設 bypass → 擋
  IF OLD.status = 'published'
     AND current_setting('schedules.bypass_lock', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION '排班已發布鎖定，無法修改（% % %）',
      OLD.employee, OLD.date, OLD.shift
      USING HINT = '如需修改請先解鎖此排班週期';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_schedule_lock ON public.schedules;
CREATE TRIGGER trg_enforce_schedule_lock
  BEFORE UPDATE OR DELETE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.enforce_schedule_lock();

-- ── 4. publish RPC：把 schedules cycle 內全部從 draft → published ──
CREATE OR REPLACE FUNCTION public.publish_schedule_cycle(
  p_store_id    INT,
  p_cycle_start DATE,
  p_cycle_end   DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp_id   INT;
  v_emp_name TEXT;
  v_count    INT;
BEGIN
  -- 抓當前 employee
  SELECT id, name INTO v_emp_id, v_emp_name
  FROM employees
  WHERE auth_user_id = auth.uid()
     OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  LIMIT 1;

  -- 翻 schedules status
  UPDATE schedules s
  SET status = 'published'
  WHERE s.date BETWEEN p_cycle_start AND p_cycle_end
    AND s.employee IN (
      SELECT name FROM employees WHERE store_id = p_store_id
    )
    AND s.status = 'draft';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- upsert publish_status — 用 cycle-based unique
  DELETE FROM schedule_publish_status
   WHERE store_id = p_store_id
     AND cycle_start = p_cycle_start
     AND cycle_end   = p_cycle_end;

  INSERT INTO schedule_publish_status (
    store_id, month, cycle_start, cycle_end,
    status, published_at, published_by, locked_at, locked_by
  ) VALUES (
    p_store_id,
    to_char(p_cycle_start, 'YYYY-MM'),
    p_cycle_start, p_cycle_end,
    'published', now(), v_emp_name, now(), v_emp_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'locked_rows', v_count,
    'cycle_start', p_cycle_start,
    'cycle_end',   p_cycle_end
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_schedule_cycle(INT, DATE, DATE) TO authenticated;

-- ── 5. unpublish RPC：解鎖（admin only）──
CREATE OR REPLACE FUNCTION public.unpublish_schedule_cycle(
  p_store_id    INT,
  p_cycle_start DATE,
  p_cycle_end   DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role  TEXT;
  v_count INT;
BEGIN
  -- 只 admin / super_admin 可解
  SELECT role INTO v_role FROM employees
  WHERE auth_user_id = auth.uid()
     OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  LIMIT 1;

  IF v_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION '只有管理員可以解鎖排班週期';
  END IF;

  -- 設 bypass 才能改 published schedules
  PERFORM set_config('schedules.bypass_lock', 'on', true);

  UPDATE schedules s
  SET status = 'draft'
  WHERE s.date BETWEEN p_cycle_start AND p_cycle_end
    AND s.employee IN (
      SELECT name FROM employees WHERE store_id = p_store_id
    )
    AND s.status = 'published';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- 更新 publish_status：清掉鎖
  UPDATE schedule_publish_status
  SET status    = 'draft',
      locked_at = NULL,
      locked_by = NULL
  WHERE store_id = p_store_id
    AND cycle_start = p_cycle_start
    AND cycle_end   = p_cycle_end;

  RETURN jsonb_build_object(
    'ok', true,
    'unlocked_rows', v_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.unpublish_schedule_cycle(INT, DATE, DATE) TO authenticated;

-- ── 6. wizard 草稿 session ──
CREATE TABLE IF NOT EXISTS public.schedule_draft_sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_by      INT REFERENCES public.employees(id),
  organization_id INT REFERENCES public.organizations(id),
  store_ids       INT[] NOT NULL,
  selected_period_idx INT DEFAULT 0,
  cycle_start     DATE,
  cycle_end       DATE,
  step            INT NOT NULL DEFAULT 1,
  mode            TEXT NOT NULL DEFAULT 'manual' CHECK (mode IN ('auto', 'manual')),
  store_start_overrides JSONB DEFAULT '{}'::JSONB,
  emp_rest_map    JSONB DEFAULT '{}'::JSONB,
  status          TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draft_sessions_creator
  ON public.schedule_draft_sessions(created_by, status);

-- RLS：自己看自己的 + admin 看全部
ALTER TABLE public.schedule_draft_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS draft_sessions_select ON public.schedule_draft_sessions;
CREATE POLICY draft_sessions_select ON public.schedule_draft_sessions
  FOR SELECT TO authenticated
  USING (
    created_by = current_employee_id()
    OR current_employee_role() IN ('admin', 'super_admin')
  );

DROP POLICY IF EXISTS draft_sessions_write ON public.schedule_draft_sessions;
CREATE POLICY draft_sessions_write ON public.schedule_draft_sessions
  FOR ALL TO authenticated
  USING (
    created_by = current_employee_id()
    OR current_employee_role() IN ('admin', 'super_admin')
  )
  WITH CHECK (
    created_by = current_employee_id()
    OR current_employee_role() IN ('admin', 'super_admin')
  );

-- updated_at trigger
CREATE OR REPLACE FUNCTION public._touch_draft_session_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_draft_session_updated ON public.schedule_draft_sessions;
CREATE TRIGGER trg_draft_session_updated
  BEFORE UPDATE ON public.schedule_draft_sessions
  FOR EACH ROW EXECUTE FUNCTION public._touch_draft_session_updated_at();

COMMIT;
