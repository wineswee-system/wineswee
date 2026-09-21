-- ============================================================
-- Categories — user-managed 分類 across entity scopes
--   scope: workflow | project | task | checklist | approval
-- Tags — cross-entity 標籤
-- ============================================================

CREATE TABLE IF NOT EXISTS workflow_categories (
  id SERIAL PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'workflow'
    CHECK (scope IN ('workflow','project','task','checklist','approval')),
  name TEXT NOT NULL,
  color TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (scope, name)
);

CREATE INDEX IF NOT EXISTS idx_workflow_categories_scope
  ON workflow_categories (scope, sort_order);

INSERT INTO workflow_categories (scope, name, sort_order) VALUES
  ('workflow','HR', 10), ('workflow','營運', 20), ('workflow','採購', 30), ('workflow','展店', 40),
  ('workflow','倉管', 50), ('workflow','財務', 60), ('workflow','行銷', 70), ('workflow','客服', 80),
  ('project','內部', 10), ('project','客戶', 20), ('project','研發', 30),
  ('task','一般', 10), ('task','緊急', 20), ('task','日常', 30),
  ('checklist','開店', 10), ('checklist','收店', 20), ('checklist','週檢', 30),
  ('approval','請款', 10), ('approval','請假', 20), ('approval','採購', 30)
ON CONFLICT (scope, name) DO NOTHING;

CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tags_sort ON tags (sort_order);
