-- ============================================================
-- Global updated_at maintenance
--
-- Many tables have an updated_at column but no trigger to maintain it.
-- This installs a generic BEFORE UPDATE trigger on every table that
-- has an updated_at TIMESTAMPTZ column and doesn't already have one.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DO $$
DECLARE
  t RECORD;
  trigger_name TEXT;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tab USING (table_schema, table_name)
    WHERE c.table_schema='public'
      AND c.column_name='updated_at'
      AND tab.table_type='BASE TABLE'
  LOOP
    trigger_name := 'trg_set_updated_at_' || t.table_name;
    -- Drop any same-named trigger first so this is idempotent
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trigger_name, t.table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at()',
      trigger_name, t.table_name
    );
  END LOOP;
END $$;

-- Validation: count of tables with the trigger should equal count with the column
DO $$
DECLARE
  with_col INT;
  with_trg INT;
BEGIN
  SELECT count(*) INTO with_col FROM information_schema.columns c
  JOIN information_schema.tables tab USING (table_schema, table_name)
  WHERE c.table_schema='public' AND c.column_name='updated_at' AND tab.table_type='BASE TABLE';

  SELECT count(*) INTO with_trg FROM information_schema.triggers
  WHERE trigger_schema='public' AND trigger_name LIKE 'trg_set_updated_at_%';

  IF with_col <> with_trg THEN
    RAISE WARNING 'updated_at coverage mismatch: % tables with column, % with trigger', with_col, with_trg;
  END IF;
END $$;

COMMIT;
