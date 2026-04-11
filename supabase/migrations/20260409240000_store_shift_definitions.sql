-- Drop unique constraint on name (same shift name can exist per store)
ALTER TABLE shift_definitions DROP CONSTRAINT IF EXISTS shift_definitions_name_key;

-- Add store_id to shift_definitions for store-specific shifts
ALTER TABLE shift_definitions ADD COLUMN IF NOT EXISTS store_id INT REFERENCES stores(id) ON DELETE SET NULL;
-- NULL store_id = global shift (available to all stores)

-- Add employee_type filter (正職 / PT)
ALTER TABLE shift_definitions ADD COLUMN IF NOT EXISTS employee_type TEXT DEFAULT 'all'; -- all, full_time, pt

-- Seed store-specific shifts based on real schedule data
-- First clear existing and re-seed with proper data
DELETE FROM shift_definitions;

-- ══ Global shifts (shared across most stores) ══
INSERT INTO shift_definitions (name, start_time, end_time, color, sort_order, store_id, employee_type) VALUES
  ('11-20', '11:00', '20:00', '#06b6d4', 1, NULL, 'all'),
  ('15-24', '15:00', '00:00', '#8b5cf6', 2, NULL, 'all'),
  ('16-01', '16:00', '01:00', '#ec4899', 3, NULL, 'all'),
  ('13-22', '13:00', '22:00', '#f59e0b', 4, NULL, 'full_time'),
  ('14-23', '14:00', '23:00', '#f97316', 5, NULL, 'full_time'),
  ('16-24', '16:00', '00:00', '#a855f7', 6, NULL, 'all'),
  ('11-22', '11:00', '22:00', '#0ea5e9', 7, NULL, 'full_time'),
  ('11-24', '11:00', '00:00', '#0891b2', 8, NULL, 'full_time'),
  -- PT common
  ('11-18', '11:00', '18:00', '#22d3ee', 10, NULL, 'pt'),
  ('18-24', '18:00', '00:00', '#d946ef', 11, NULL, 'pt'),
  ('18-01', '18:00', '01:00', '#c026d3', 12, NULL, 'pt'),
  ('19-24', '19:00', '00:00', '#7c3aed', 13, NULL, 'pt'),
  ('19-01', '19:00', '01:00', '#6d28d9', 14, NULL, 'pt'),
  ('19-00', '19:00', '00:00', '#7c3aed', 15, NULL, 'pt'),
  ('18-22', '18:00', '22:00', '#a78bfa', 16, NULL, 'pt'),
  ('20-24', '20:00', '00:00', '#c084fc', 17, NULL, 'pt');

-- ══ 微風 specific ══
DO $$
DECLARE v_store_id INT;
BEGIN
  SELECT id INTO v_store_id FROM stores WHERE name LIKE '%微風%' LIMIT 1;
  IF v_store_id IS NOT NULL THEN
    INSERT INTO shift_definitions (name, start_time, end_time, color, sort_order, store_id, employee_type) VALUES
      ('1030-1930', '10:30', '19:30', '#06b6d4', 1, v_store_id, 'full_time'),
      ('1600-0100', '16:00', '01:00', '#ec4899', 2, v_store_id, 'full_time'),
      ('1630-0130', '16:30', '01:30', '#ec4899', 3, v_store_id, 'full_time'),
      ('1100-2000', '11:00', '20:00', '#0ea5e9', 4, v_store_id, 'full_time'),
      ('1200-2100', '12:00', '21:00', '#f59e0b', 5, v_store_id, 'full_time');
  END IF;
END $$;

-- ══ 南港 specific (includes split shifts) ══
DO $$
DECLARE v_store_id INT;
BEGIN
  SELECT id INTO v_store_id FROM stores WHERE name LIKE '%南港%' LIMIT 1;
  IF v_store_id IS NOT NULL THEN
    INSERT INTO shift_definitions (name, start_time, end_time, color, sort_order, store_id, employee_type) VALUES
      ('1030-1930', '10:30', '19:30', '#06b6d4', 1, v_store_id, 'full_time'),
      ('1500-2400', '15:00', '00:00', '#8b5cf6', 2, v_store_id, 'full_time'),
      ('1200-1400+1800-2400', '12:00', '00:00', '#f59e0b', 3, v_store_id, 'full_time'),
      ('1130-1330+1800-2400', '11:30', '00:00', '#f97316', 4, v_store_id, 'full_time');
  END IF;
END $$;

-- ══ 高雄 specific ══
DO $$
DECLARE v_store_id INT;
BEGIN
  SELECT id INTO v_store_id FROM stores WHERE name LIKE '%高雄%' LIMIT 1;
  IF v_store_id IS NOT NULL THEN
    INSERT INTO shift_definitions (name, start_time, end_time, color, sort_order, store_id, employee_type) VALUES
      ('1530-2430', '15:30', '00:30', '#8b5cf6', 1, v_store_id, 'full_time'),
      ('1630-0130', '16:30', '01:30', '#ec4899', 2, v_store_id, 'full_time');
  END IF;
END $$;

-- ══ 松江 specific ══
DO $$
DECLARE v_store_id INT;
BEGIN
  SELECT id INTO v_store_id FROM stores WHERE name LIKE '%松江%' LIMIT 1;
  IF v_store_id IS NOT NULL THEN
    INSERT INTO shift_definitions (name, start_time, end_time, color, sort_order, store_id, employee_type) VALUES
      ('12-24', '12:00', '00:00', '#0ea5e9', 1, v_store_id, 'full_time'),
      ('17-24', '17:00', '00:00', '#a855f7', 2, v_store_id, 'full_time'),
      ('17-01', '17:00', '01:00', '#7c3aed', 3, v_store_id, 'full_time');
  END IF;
END $$;
