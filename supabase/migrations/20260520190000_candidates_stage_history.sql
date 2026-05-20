-- 候選人階段歷程紀錄
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS stage_history JSONB DEFAULT '[]';
