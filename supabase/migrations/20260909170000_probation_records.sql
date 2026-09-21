-- 試用期管理 probation_records:UI(/hr/probation ProbationTracker)+ sidebar + 權限 + i18n
--   + hr.probation.expiring 事件全都在,但此表從未被任何 migration 建立 → 前端 404。
--   本支補建表(對齊 src/lib/db/hr.js 的 getProbation/create/update 與 ProbationTracker.jsx 用到的欄位)。
-- 欄位來源:create={employee,start_date,end_date,mentor,notes,status};
--          eval  ={evaluations(jsonb array),status,result,decided_at};
--          query =.eq('organization_id',orgId).order('end_date')。
CREATE TABLE IF NOT EXISTS public.probation_records (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id integer,
  employee        text NOT NULL,                         -- 員工姓名(對齊 employees.name)
  start_date      date NOT NULL,                          -- 試用開始
  end_date        date NOT NULL,                          -- 試用結束(通常到職 +3 月)
  mentor          text,                                    -- 指導人姓名
  notes           text,                                    -- 備註
  status          text NOT NULL DEFAULT '試用中',          -- 試用中 / 已通過 / 未通過 / 延長試用
  evaluations     jsonb NOT NULL DEFAULT '[]'::jsonb,      -- [{date,score,comment,result}] 歷次評核
  result          text,                                    -- 最終結果(決議時寫)
  decided_at      date,                                    -- 決議日期
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION public._probation_records_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_probation_records_touch ON public.probation_records;
CREATE TRIGGER trg_probation_records_touch BEFORE UPDATE ON public.probation_records
  FOR EACH ROW EXECUTE FUNCTION public._probation_records_touch_updated_at();

-- INSERT 未帶 organization_id → 由 set_org_default 補當前租戶
DROP TRIGGER IF EXISTS trg_probation_records_set_org ON public.probation_records;
CREATE TRIGGER trg_probation_records_set_org BEFORE INSERT ON public.probation_records
  FOR EACH ROW EXECUTE FUNCTION public.set_org_default();

-- RLS:同 org 的 staff 可讀寫;單一 FOR ALL policy 避免多條 OR 破洞
--   (.insert().select().single() 需 SELECT 也過 → org_visible+is_staff 對建立者同 org 成立)
ALTER TABLE public.probation_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS probation_records_all ON public.probation_records;
CREATE POLICY probation_records_all ON public.probation_records FOR ALL
  USING (org_visible(organization_id) AND is_staff())
  WITH CHECK (org_visible(organization_id) AND is_staff());

CREATE INDEX IF NOT EXISTS idx_probation_records_org_end ON public.probation_records (organization_id, end_date);

NOTIFY pgrst, 'reload schema';
