-- Add type column to sop_templates to distinguish workflow SOPs from project templates
ALTER TABLE sop_templates
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'workflow';

-- Classify existing templates by name pattern
UPDATE sop_templates SET type = 'project'
WHERE name ILIKE '%開幕%'
   OR name ILIKE '%開店%'
   OR name ILIKE '%展店%'
   OR category = '展店';
