-- Migration: 20260623000000_template_enhancements
-- Adds status, tags, permissions, relative_durations columns to sop_templates
-- Creates sop_template_analytics view

-- 1. Add status column
DO $$ BEGIN
  ALTER TABLE sop_templates ADD COLUMN status text NOT NULL DEFAULT 'published';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 2. Add CHECK constraint on status (idempotent via DO block)
DO $$ BEGIN
  ALTER TABLE sop_templates
    ADD CONSTRAINT sop_templates_status_check
    CHECK (status IN ('draft', 'published', 'archived'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Add tags column
DO $$ BEGIN
  ALTER TABLE sop_templates ADD COLUMN tags text[] DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 4. Add permissions column
DO $$ BEGIN
  ALTER TABLE sop_templates ADD COLUMN permissions jsonb DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 5. Add relative_durations column (map of step_index → integer days)
DO $$ BEGIN
  ALTER TABLE sop_templates ADD COLUMN relative_durations jsonb DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 6. Create sop_template_analytics view
--    Joins sop_templates to workflow_instances on template_name
--    deploy_count    = total instances created from this template
--    completed_count = instances with status = 'completed'
--    completion_rate = completed_count / deploy_count (0 when no deploys)
CREATE OR REPLACE VIEW sop_template_analytics AS
SELECT
  t.id                                                        AS template_id,
  t.name                                                      AS template_name,
  COUNT(wi.id)                                                AS deploy_count,
  COUNT(wi.id) FILTER (WHERE wi.status = 'completed')         AS completed_count,
  CASE
    WHEN COUNT(wi.id) = 0 THEN 0
    ELSE ROUND(
      COUNT(wi.id) FILTER (WHERE wi.status = 'completed')::numeric
      / COUNT(wi.id)::numeric * 100,
      2
    )
  END                                                         AS completion_rate
FROM sop_templates t
LEFT JOIN workflow_instances wi ON wi.template_name = t.name
GROUP BY t.id, t.name;
