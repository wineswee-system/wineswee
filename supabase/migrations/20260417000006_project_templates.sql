-- ============================================================
-- 專案模板 (Project Templates)
-- 一鍵部署 → 自動建立專案 + 流程 + 任務
-- ============================================================

CREATE TABLE IF NOT EXISTS project_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT '通用',
  -- workflows: [{ name, tasks: [{ title, role, priority, description }] }]
  workflows JSONB DEFAULT '[]',
  default_priority TEXT DEFAULT '中',
  estimated_days INT,
  estimated_budget NUMERIC(12,2),
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE project_templates ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'project_templates' AND policyname = 'anon_project_templates') THEN
    CREATE POLICY anon_project_templates ON project_templates FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'project_templates' AND policyname = 'auth_project_templates') THEN
    CREATE POLICY auth_project_templates ON project_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Seed demo templates
INSERT INTO project_templates (name, description, category, workflows, default_priority, estimated_days, estimated_budget, created_by) VALUES
  ('門市裝潢翻新', '門市外觀及內部翻新工程標準流程', '展店', '[
    {"name":"設計規劃","tasks":[
      {"title":"現場丈量與拍照","role":"營運部","priority":"高"},
      {"title":"設計圖繪製","role":"營運部","priority":"高"},
      {"title":"設計圖確認簽核","role":"主管","priority":"高"}
    ]},
    {"name":"採購建材","tasks":[
      {"title":"材料詢價比價","role":"採購部","priority":"高"},
      {"title":"建材訂購","role":"採購部","priority":"中"},
      {"title":"到貨驗收","role":"採購部","priority":"高"}
    ]},
    {"name":"施工驗收","tasks":[
      {"title":"舊裝潢拆除","role":"營運部","priority":"高"},
      {"title":"新裝潢施工","role":"營運部","priority":"高"},
      {"title":"完工清潔","role":"營運部","priority":"中"},
      {"title":"驗收確認","role":"主管","priority":"高"}
    ]}
  ]'::jsonb, '高', 14, 80000, '系統'),

  ('新人到職 SOP', '新進員工到職標準流程', 'HR', '[
    {"name":"行政作業","tasks":[
      {"title":"人事資料建檔","role":"人資部","priority":"高"},
      {"title":"勞健保加保","role":"人資部","priority":"高"},
      {"title":"薪轉帳戶設定","role":"人資部","priority":"中"},
      {"title":"系統帳號開通","role":"總務部","priority":"高"}
    ]},
    {"name":"教育訓練","tasks":[
      {"title":"公司制度說明","role":"人資部","priority":"中"},
      {"title":"門市營運 SOP 教學","role":"營運部","priority":"高"},
      {"title":"POS 系統實操訓練","role":"營運部","priority":"高"},
      {"title":"實習跟班（3天）","role":"營運部","priority":"中"}
    ]}
  ]'::jsonb, '中', 7, NULL, '系統'),

  ('月底門市盤點', '全門市例行庫存盤點', '營運', '[
    {"name":"盤點作業","tasks":[
      {"title":"建立盤點清單","role":"倉儲物流部","priority":"高"},
      {"title":"通知各門市準備","role":"倉儲物流部","priority":"中"},
      {"title":"執行盤點","role":"門市","priority":"高"},
      {"title":"差異報告彙整","role":"倉儲物流部","priority":"高"},
      {"title":"差異處理簽核","role":"主管","priority":"高"}
    ]}
  ]'::jsonb, '中', 5, NULL, '系統')
ON CONFLICT DO NOTHING;
