-- Add structured condition/action JSON columns to support visual trigger builder UI
ALTER TABLE triggers
  ADD COLUMN IF NOT EXISTS conditions_json jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS actions_json    jsonb DEFAULT '[]'::jsonb;
