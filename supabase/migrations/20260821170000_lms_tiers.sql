-- 教育訓練:課程分級門檻(金/銀/銅)+ 結業證書分級。
-- 銅 = 及格線 = 既有的 passing_score(達銅才算結業、才發證);銀/金為更高門檻。
-- idempotent。
ALTER TABLE lms_courses    ADD COLUMN IF NOT EXISTS tier_silver_score integer DEFAULT 80;
ALTER TABLE lms_courses    ADD COLUMN IF NOT EXISTS tier_gold_score   integer DEFAULT 90;
ALTER TABLE lms_certificates ADD COLUMN IF NOT EXISTS tier text; -- '金' / '銀' / '銅'
