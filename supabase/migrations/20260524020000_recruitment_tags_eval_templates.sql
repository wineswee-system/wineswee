-- ════════════════════════════════════════════════════════════════════════════
-- 招募系統：標籤 + 多維度面試評核 + 評核範本
-- ----------------------------------------------------------------------------
-- 1. candidates.tags TEXT[]
--    自由標籤，可重複/可自訂（例：積極、有興趣加薪、拖延）
--
-- 2. interview_evaluation_templates
--    定義不同職缺的評核維度（業務 vs 工程師 vs 客服）
--    dimensions JSONB: [{key, label, weight?, max?}, ...]
--
-- 3. recruitment_jobs.evaluation_template_id
--    每職缺指定要用哪套評核範本（NULL = 用 default 1-5 評分）
--
-- 4. interviews.scores JSONB
--    多維度評分結果，例：{"專業": 4, "溝通": 5, "穩定度": 3, "動機": 4}
--    保留既有 interviews.score INT（總分/平均）給舊資料 + 沒用範本的面試
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. candidates.tags ────────────────────────────────────────────────
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE INDEX IF NOT EXISTS idx_candidates_tags
  ON public.candidates USING GIN(tags);


-- ─── 2. 評核範本表 ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.interview_evaluation_templates (
  id              SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  -- 維度定義：[{ key, label, max, weight? }]
  --   key: 內部識別字 (e.g. "professional")
  --   label: 顯示名 (e.g. "專業能力")
  --   max: 最大分（預設 5）
  --   weight: 權重（預設 1，加總算總分用）
  dimensions      JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      INT REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eval_tpl_org
  ON public.interview_evaluation_templates(organization_id);


-- ─── 3. recruitment_jobs.evaluation_template_id ──────────────────────────
ALTER TABLE public.recruitment_jobs
  ADD COLUMN IF NOT EXISTS evaluation_template_id INT
    REFERENCES public.interview_evaluation_templates(id) ON DELETE SET NULL;


-- ─── 4. interviews.scores ──────────────────────────────────────────────
-- 多維度評分結果（鍵值對）
ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS scores JSONB DEFAULT '{}'::jsonb;


-- ─── 5. RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public.interview_evaluation_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "eval_tpl_org" ON public.interview_evaluation_templates;
CREATE POLICY "eval_tpl_org" ON public.interview_evaluation_templates
  USING (organization_id = (
    SELECT organization_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1
  ));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.interview_evaluation_templates TO authenticated;
GRANT USAGE, SELECT
  ON SEQUENCE public.interview_evaluation_templates_id_seq TO authenticated;


-- ─── 6. 自動 updated_at ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._touch_eval_tpl_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_eval_tpl_touch ON public.interview_evaluation_templates;
CREATE TRIGGER trg_eval_tpl_touch
  BEFORE UPDATE ON public.interview_evaluation_templates
  FOR EACH ROW EXECUTE FUNCTION public._touch_eval_tpl_updated_at();


-- ─── 7. 種子資料：3 套常用範本（讓 HR 一進來就有東西用）─────────────────
-- 用 DO block 避免每次重跑都重複塞
DO $$
DECLARE
  v_org_id INT;
BEGIN
  FOR v_org_id IN SELECT id FROM organizations LOOP
    -- 業務銷售類
    IF NOT EXISTS (
      SELECT 1 FROM interview_evaluation_templates
       WHERE organization_id = v_org_id AND name = '業務銷售職'
    ) THEN
      INSERT INTO interview_evaluation_templates (organization_id, name, description, dimensions, is_default)
      VALUES (v_org_id, '業務銷售職', '適用：業務、客戶經理、銷售人員',
        '[
          {"key":"communication","label":"溝通表達","max":5,"weight":2},
          {"key":"motivation","label":"企圖心","max":5,"weight":2},
          {"key":"stress","label":"抗壓性","max":5,"weight":1},
          {"key":"culture_fit","label":"文化契合度","max":5,"weight":1},
          {"key":"experience","label":"相關經驗","max":5,"weight":2}
        ]'::jsonb,
        FALSE);
    END IF;

    -- 一般職位（門市/行政）
    IF NOT EXISTS (
      SELECT 1 FROM interview_evaluation_templates
       WHERE organization_id = v_org_id AND name = '一般職位（門市 / 行政）'
    ) THEN
      INSERT INTO interview_evaluation_templates (organization_id, name, description, dimensions, is_default)
      VALUES (v_org_id, '一般職位（門市 / 行政）', '適用：門市人員、行政助理、PT 工讀',
        '[
          {"key":"attitude","label":"工作態度","max":5,"weight":2},
          {"key":"stability","label":"穩定度","max":5,"weight":2},
          {"key":"learning","label":"學習意願","max":5,"weight":1},
          {"key":"availability","label":"班別配合度","max":5,"weight":2}
        ]'::jsonb,
        TRUE);
    END IF;

    -- 專業技術類
    IF NOT EXISTS (
      SELECT 1 FROM interview_evaluation_templates
       WHERE organization_id = v_org_id AND name = '專業技術職'
    ) THEN
      INSERT INTO interview_evaluation_templates (organization_id, name, description, dimensions, is_default)
      VALUES (v_org_id, '專業技術職', '適用：工程師、財會、設計、行銷專員',
        '[
          {"key":"professional","label":"專業能力","max":5,"weight":3},
          {"key":"problem_solving","label":"解題能力","max":5,"weight":2},
          {"key":"communication","label":"溝通協作","max":5,"weight":1},
          {"key":"learning","label":"學習力","max":5,"weight":1},
          {"key":"experience","label":"相關經驗","max":5,"weight":2}
        ]'::jsonb,
        FALSE);
    END IF;
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
