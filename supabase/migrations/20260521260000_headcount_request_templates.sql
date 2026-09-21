-- 人力需求申請範本
CREATE TABLE IF NOT EXISTS headcount_request_templates (
  id               SERIAL PRIMARY KEY,
  organization_id  INT  REFERENCES organizations(id) ON DELETE CASCADE,
  name             VARCHAR(100) NOT NULL,
  description      TEXT,
  template_data    JSONB NOT NULL DEFAULT '{}',
  created_by       INT  REFERENCES employees(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hrt_org ON headcount_request_templates(organization_id);

ALTER TABLE headcount_request_templates ENABLE ROW LEVEL SECURITY;

-- 同組織成員可讀
DO $$ BEGIN
  CREATE POLICY "hrt_select" ON headcount_request_templates
    FOR SELECT USING (
      organization_id IN (
        SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 同組織成員可建立
DO $$ BEGIN
  CREATE POLICY "hrt_insert" ON headcount_request_templates
    FOR INSERT WITH CHECK (
      organization_id IN (
        SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 同組織成員可更新
DO $$ BEGIN
  CREATE POLICY "hrt_update" ON headcount_request_templates
    FOR UPDATE USING (
      organization_id IN (
        SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 同組織成員可刪除
DO $$ BEGIN
  CREATE POLICY "hrt_delete" ON headcount_request_templates
    FOR DELETE USING (
      organization_id IN (
        SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION set_hrt_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_hrt_updated_at
  BEFORE UPDATE ON headcount_request_templates
  FOR EACH ROW EXECUTE FUNCTION set_hrt_updated_at();
