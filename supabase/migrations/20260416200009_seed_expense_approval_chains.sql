-- ============================================================
-- Seed: 費用申請簽核鏈（三級金額分流）
-- ============================================================

INSERT INTO approval_chains (name, description, category, min_amount, max_amount, is_active, steps) VALUES
  ('小額費用申請', '3,000 以下由直屬主管核准', '費用申請', 0, 3000, true,
   '[{"role":"直屬主管","label":"主管審核"}]'::jsonb),

  ('中額費用申請', '3,001~10,000 由主管 + 部門主管核准', '費用申請', 3001, 10000, true,
   '[{"role":"直屬主管","label":"主管審核"},{"role":"部門主管","label":"部門主管審核"}]'::jsonb),

  ('大額費用申請', '10,001 以上需主管 + 部門主管 + 財務三關', '費用申請', 10001, NULL, true,
   '[{"role":"直屬主管","label":"主管審核"},{"role":"部門主管","label":"部門主管審核"},{"role":"財務","label":"財務確認"}]'::jsonb)

ON CONFLICT DO NOTHING;

-- 順便把舊的 approval_chains is_active=NULL 補為 true
UPDATE approval_chains SET is_active = true WHERE is_active IS NULL;
