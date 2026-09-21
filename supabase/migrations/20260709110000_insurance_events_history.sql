-- 投保異動紀錄（完整歷史）+ 眷屬
-- 2026-07-09  對齊保險明細子列：加保/退保/眷屬加保 事件時間軸。
--   單一 employees 欄只能存現況一個日期，存不下歷史 → 用事件表。
--   眷屬名字另存現成 employee_dependents(name/relationship)。idempotent。

CREATE TABLE IF NOT EXISTS public.employee_insurance_events (
  id              BIGSERIAL PRIMARY KEY,
  employee_id     INT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,            -- 勞保加保/健保加保/勞退加保/眷屬加保/退保/轉出...
  effective_date  DATE,                     -- 生效日期
  detail          TEXT,                     -- 內容(投保薪資 X / 眷屬名加保)
  dependent_name  TEXT,                     -- 眷屬加保時的眷屬姓名(方便查/連 employee_dependents)
  source          TEXT DEFAULT '104匯入',
  organization_id INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 同人同類同日同內容視為同一筆，避免重複匯入
  CONSTRAINT uq_ins_event UNIQUE (employee_id, event_type, effective_date, detail)
);

CREATE INDEX IF NOT EXISTS idx_ins_events_emp ON public.employee_insurance_events (employee_id, effective_date DESC);

ALTER TABLE public.employee_insurance_events ENABLE ROW LEVEL SECURITY;

-- 讀：本人 or 幕僚(is_staff)；寫：幕僚
DROP POLICY IF EXISTS ins_events_sel ON public.employee_insurance_events;
CREATE POLICY ins_events_sel ON public.employee_insurance_events FOR SELECT USING (
  public.is_staff() OR employee_id = public.current_employee_id() OR auth.role() = 'service_role'
);
DROP POLICY IF EXISTS ins_events_write ON public.employee_insurance_events;
CREATE POLICY ins_events_write ON public.employee_insurance_events FOR ALL USING (
  public.is_staff() OR auth.role() = 'service_role'
) WITH CHECK (
  public.is_staff() OR auth.role() = 'service_role'
);

COMMENT ON TABLE public.employee_insurance_events IS '投保異動紀錄(加保/退保/眷屬加保時間軸)，來源:保險資料明細';

NOTIFY pgrst, 'reload schema';
