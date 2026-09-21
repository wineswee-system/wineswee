-- Multi-store support (跨店)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS additional_stores TEXT[] DEFAULT '{}';

-- Insurance detail fields (勞健保詳細)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS labor_ins_grade INT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS labor_ins_start DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS labor_ins_end DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS health_ins_grade INT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS health_ins_start DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS pension_rate NUMERIC(4,2) DEFAULT 6;
