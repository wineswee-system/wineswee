-- ════════════════════════════════════════════════════════════════════════════
-- AI 離職預測：風險快照
--
-- AttritionPrediction.jsx「儲存快照」按鈕會 upsert 到這表。
-- 每員工每日一筆（onConflict employee + snapshot_date）。
-- 用來看趨勢（同員工 risk_score 隨時間變化）跟 cross-system attrition impact。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.attrition_risk_snapshots (
  id                  SERIAL PRIMARY KEY,
  organization_id     INT REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee            TEXT NOT NULL,
  snapshot_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  risk_score          INT,
  risk_level          TEXT,          -- '高' / '中' / '低'
  factors             JSONB DEFAULT '[]'::jsonb,
  tenure_months       NUMERIC,
  late_count_90d      INT,
  leave_count_90d     INT,
  performance_score   NUMERIC,
  salary_percentile   NUMERIC,
  engagement_score    NUMERIC,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 每員工每日一筆（upsert 用）
CREATE UNIQUE INDEX IF NOT EXISTS uq_attrition_risk_snapshots_emp_date
  ON public.attrition_risk_snapshots (employee, snapshot_date);

CREATE INDEX IF NOT EXISTS idx_attrition_risk_snapshots_org_date
  ON public.attrition_risk_snapshots (organization_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_attrition_risk_snapshots_risk
  ON public.attrition_risk_snapshots (risk_score DESC);

ALTER TABLE public.attrition_risk_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attrition_risk_snapshots_select ON public.attrition_risk_snapshots;
CREATE POLICY attrition_risk_snapshots_select ON public.attrition_risk_snapshots
FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS attrition_risk_snapshots_write ON public.attrition_risk_snapshots;
CREATE POLICY attrition_risk_snapshots_write ON public.attrition_risk_snapshots
FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE public.attrition_risk_snapshots IS
  'AI 離職風險快照 — 每員工每日一筆，記錄當下 risk_score + 構成因子。AttritionPrediction.jsx 寫入。';

COMMIT;

NOTIFY pgrst, 'reload schema';
