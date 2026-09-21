-- =============================================
-- 自訂表單建立器 MVP
-- 1. form_templates    表單模板（admin 用 builder 建出來的）
-- 2. form_submissions  員工填的表單
-- =============================================

BEGIN;

-- ── 1. 模板 ──
CREATE TABLE IF NOT EXISTS form_templates (
  id              SERIAL PRIMARY KEY,
  organization_id INT REFERENCES organizations(id),
  name            TEXT NOT NULL,                     -- 表單名稱
  category        TEXT NOT NULL DEFAULT 'other',     -- attendance / personnel / expense / other
  description     TEXT,
  icon            TEXT DEFAULT 'FileText',           -- lucide icon name
  color           TEXT DEFAULT 'cyan',               -- accent color key
  approval_chain_id INT REFERENCES approval_chains(id) ON DELETE SET NULL,
  fields          JSONB NOT NULL DEFAULT '[]',       -- [{ key, label, type, options, required, ... }]
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 0,
  created_by      INT REFERENCES employees(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_form_templates_active ON form_templates(is_active, category);

COMMENT ON COLUMN form_templates.fields IS
  '欄位定義 JSONB array，每筆: { key, label, type (text/textarea/number/date/select/checkbox/file), options?, required?, placeholder?, rows?, default? }';

-- ── 2. 提交記錄 ──
CREATE TABLE IF NOT EXISTS form_submissions (
  id              SERIAL PRIMARY KEY,
  organization_id INT REFERENCES organizations(id),
  template_id     INT NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
  applicant_id    INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  data            JSONB NOT NULL DEFAULT '{}',       -- 員工填的內容
  status          TEXT NOT NULL DEFAULT '申請中',     -- 申請中 / 已核准 / 已駁回 / 已取消
  approver_id     INT REFERENCES employees(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  reject_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_form_subs_applicant ON form_submissions(applicant_id, status);
CREATE INDEX IF NOT EXISTS idx_form_subs_template ON form_submissions(template_id, status);

-- ── 3. updated_at trigger ──
DROP TRIGGER IF EXISTS trg_form_templates_updated_at ON form_templates;
CREATE TRIGGER trg_form_templates_updated_at BEFORE UPDATE ON form_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_form_submissions_updated_at ON form_submissions;
CREATE TRIGGER trg_form_submissions_updated_at BEFORE UPDATE ON form_submissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ── 4. RLS ──
ALTER TABLE form_templates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "form_templates_read" ON form_templates;
CREATE POLICY "form_templates_read" ON form_templates FOR SELECT USING (true);

DROP POLICY IF EXISTS "form_templates_write" ON form_templates;
CREATE POLICY "form_templates_write" ON form_templates FOR ALL USING (
  EXISTS (SELECT 1 FROM employees e WHERE e.auth_user_id = auth.uid() AND e.role IN ('super_admin','admin'))
);

DROP POLICY IF EXISTS "form_submissions_read" ON form_submissions;
CREATE POLICY "form_submissions_read" ON form_submissions FOR SELECT USING (true);

DROP POLICY IF EXISTS "form_submissions_write" ON form_submissions;
CREATE POLICY "form_submissions_write" ON form_submissions FOR ALL USING (true);

COMMIT;
