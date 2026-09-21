-- migrate-step-roles.sql
-- Normalises free-text step.role values in sop_templates.steps (JSONB)
-- to match actual department names in the departments table.
--
-- Run this in Supabase Dashboard → SQL Editor (runs as postgres, bypasses RLS).
-- Safe to re-run: steps already matching a department name are left untouched.

DO $$
DECLARE
  changed_count INT := 0;
BEGIN

  WITH

  -- Known aliases → canonical department name.
  -- Right-hand side must match the name column in your departments table exactly.
  alias_map(alias, canonical) AS (
    VALUES
      ('HR',          '人力資源部'),
      ('hr',          '人力資源部'),
      ('人資',         '人力資源部'),
      ('人資部',        '人力資源部'),
      ('人力資源',       '人力資源部'),
      ('工務',         '工務部'),
      ('總務',         '總務部'),
      ('管理部',        '管理部'),
      ('財務',         '財務部'),
      ('倉儲',         '倉儲物流部'),
      ('物流',         '倉儲物流部'),
      ('倉儲物流',      '倉儲物流部'),
      ('採購',         '採購部'),
      ('營運',         '營運部'),
      ('督導',         '營運部'),
      ('行銷',         '品牌行銷部'),
      ('品牌行銷',      '品牌行銷部'),
      ('展店',         '加盟展店事業部'),
      ('加盟展店',      '加盟展店事業部'),
      ('展店事業部',    '加盟展店事業部'),
      ('總經理室',      '總經理室')
  ),

  -- Only keep alias → canonical pairs where the canonical exists in departments
  resolved(alias, canonical) AS (
    SELECT am.alias, am.canonical
    FROM alias_map am
    INNER JOIN departments d ON d.name = am.canonical
  ),

  -- For each template, rebuild the steps array with roles mapped
  remapped AS (
    SELECT
      t.id,
      jsonb_agg(
        CASE
          WHEN r.canonical IS NOT NULL
            THEN jsonb_set(step, '{role}', to_jsonb(r.canonical))
          ELSE step
        END
        ORDER BY ordinality
      ) AS new_steps,
      bool_or(r.canonical IS NOT NULL AND step->>'role' != r.canonical) AS did_change
    FROM sop_templates t
    CROSS JOIN LATERAL jsonb_array_elements(t.steps) WITH ORDINALITY AS j(step, ordinality)
    LEFT JOIN resolved r
      ON r.alias = step->>'role'
     AND NOT EXISTS (SELECT 1 FROM departments d WHERE d.name = step->>'role')
    GROUP BY t.id
  )

  UPDATE sop_templates t
  SET steps = rm.new_steps
  FROM remapped rm
  WHERE t.id = rm.id
    AND rm.did_change = TRUE;

  GET DIAGNOSTICS changed_count = ROW_COUNT;
  RAISE NOTICE 'Done — % template(s) updated.', changed_count;

END $$;

-- Preview what would be changed (run this SELECT first if you want to verify):
/*
WITH alias_map(alias, canonical) AS (
  VALUES
    ('HR','人力資源部'),('hr','人力資源部'),('人資','人力資源部'),('人資部','人力資源部'),
    ('人力資源','人力資源部'),('工務','工務部'),('總務','總務部'),('管理部','管理部'),
    ('財務','財務部'),('倉儲','倉儲物流部'),('物流','倉儲物流部'),('倉儲物流','倉儲物流部'),
    ('採購','採購部'),('營運','營運部'),('督導','營運部'),('行銷','品牌行銷部'),
    ('品牌行銷','品牌行銷部'),('展店','加盟展店事業部'),('加盟展店','加盟展店事業部'),
    ('展店事業部','加盟展店事業部'),('總經理室','總經理室')
),
resolved AS (
  SELECT am.alias, am.canonical FROM alias_map am
  INNER JOIN departments d ON d.name = am.canonical
)
SELECT
  t.id, t.name AS template_name,
  step->>'title' AS step_title,
  step->>'role'  AS old_role,
  r.canonical    AS new_role
FROM sop_templates t
CROSS JOIN LATERAL jsonb_array_elements(t.steps) step
JOIN resolved r ON r.alias = step->>'role'
ORDER BY t.name, step->>'title';
*/
