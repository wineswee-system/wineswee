-- ============================================================
--  Stores: auto-generate store_code on INSERT + backfill gaps.
--
--  Background: store_code was added in 20260416100002 with a
--  one-shot backfill (S-001..S-NNN). Stores created through the
--  UI afterwards could be saved with store_code = NULL because
--  the form field is optional. This migration:
--
--   1. Introduces a sequence synced to the current max S-NNN.
--   2. Installs a BEFORE INSERT trigger that fills store_code
--      when the caller leaves it NULL or blank.
--   3. Backfills any remaining NULL/blank rows.
--   4. Adds a partial unique index so manual entries and
--      trigger-generated codes never collide silently.
-- ============================================================

-- 1. Sequence + sync with existing S-NNN codes
CREATE SEQUENCE IF NOT EXISTS stores_store_code_seq START WITH 1;

DO $$
DECLARE
  max_num INT;
BEGIN
  SELECT COALESCE(MAX((SUBSTRING(store_code FROM '^S-(\d+)$'))::INT), 0)
    INTO max_num
  FROM public.stores
  WHERE store_code ~ '^S-\d+$';

  PERFORM setval('stores_store_code_seq', GREATEST(max_num, 1), max_num > 0);
END $$;

-- 2. Trigger function: assign next S-NNN when store_code is NULL/empty.
--    Loops past any manually-used S-NNN value to avoid collisions.
CREATE OR REPLACE FUNCTION public.fn_stores_assign_store_code()
RETURNS TRIGGER AS $$
DECLARE
  candidate TEXT;
BEGIN
  IF NEW.store_code IS NULL OR btrim(NEW.store_code) = '' THEN
    LOOP
      candidate := 'S-' || LPAD(nextval('stores_store_code_seq')::TEXT, 3, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.stores WHERE store_code = candidate);
    END LOOP;
    NEW.store_code := candidate;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stores_assign_store_code ON public.stores;
CREATE TRIGGER trg_stores_assign_store_code
BEFORE INSERT ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.fn_stores_assign_store_code();

-- 3. Backfill existing NULL/blank store_code values
DO $$
DECLARE
  r RECORD;
  candidate TEXT;
BEGIN
  FOR r IN
    SELECT id FROM public.stores
    WHERE store_code IS NULL OR btrim(store_code) = ''
    ORDER BY id
  LOOP
    LOOP
      candidate := 'S-' || LPAD(nextval('stores_store_code_seq')::TEXT, 3, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.stores WHERE store_code = candidate);
    END LOOP;
    UPDATE public.stores SET store_code = candidate WHERE id = r.id;
  END LOOP;
END $$;

-- 4. Partial unique index (NULL allowed by Postgres default,
--    but after backfill + trigger there should be none).
CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_store_code_unique
  ON public.stores(store_code)
  WHERE store_code IS NOT NULL;

-- Diagnostic
DO $$
DECLARE
  null_codes INT;
BEGIN
  SELECT count(*) INTO null_codes
  FROM public.stores
  WHERE store_code IS NULL OR btrim(store_code) = '';
  RAISE NOTICE 'stores with missing store_code after backfill: %', null_codes;
END $$;
