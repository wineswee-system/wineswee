-- ════════════════════════════════════════════════════════════════════════════
-- 員工排班模板：每員工固定的週循環 pattern → 套用到整月
-- 跟 shift_definitions（門市層級的班別預設）是不同概念
--
-- pattern JSONB 格式：
--   { "0": {shift, start, end, source_store}, ..., "6": ... }
--   key 是星期幾 (0=日 ~ 6=六)；value 可為字串(假別) 或物件(時段)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.employee_schedule_patterns (
  id              SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  pattern         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by      INT REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_schedule_patterns_org
  ON public.employee_schedule_patterns (organization_id);

ALTER TABLE public.employee_schedule_patterns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_schedule_patterns_select ON public.employee_schedule_patterns;
CREATE POLICY employee_schedule_patterns_select ON public.employee_schedule_patterns
FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS employee_schedule_patterns_write ON public.employee_schedule_patterns;
CREATE POLICY employee_schedule_patterns_write ON public.employee_schedule_patterns
FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE public.employee_schedule_patterns IS
  '員工排班模板 — 每週固定循環 pattern，套用到員工×整月。跟 shift_definitions（門市班別）不同。';

COMMIT;

NOTIFY pgrst, 'reload schema';
