-- ============================================================
-- Lock down SECURITY DEFINER functions: pin search_path
--
-- Without an explicit search_path, a SECURITY DEFINER function inherits
-- the caller's search_path. An attacker with CREATE on any schema can
-- shadow built-in functions and operators, escalating to the function
-- owner's privileges. Pinning search_path = public, pg_temp makes the
-- function ignore caller-injected schemas.
--
-- Risk: LOW. ALTER FUNCTION SET is non-blocking; behavior unchanged for
-- legitimate callers. Idempotent.
-- ============================================================

BEGIN;

DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT n.nspname AS schema_name, p.proname AS func_name,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND (p.proconfig IS NULL
           OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SECURITY DEFINER SET search_path = public, pg_temp',
      fn.func_name, fn.args
    );
    RAISE NOTICE 'Locked search_path on public.%(%)', fn.func_name, fn.args;
  END LOOP;
END $$;

-- Validation: should be 0
DO $$
DECLARE
  remaining INT;
BEGIN
  SELECT count(*) INTO remaining
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef=true
    AND (p.proconfig IS NULL
         OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'));
  IF remaining > 0 THEN
    RAISE EXCEPTION '% SECURITY DEFINER functions still lack search_path', remaining;
  END IF;
END $$;

COMMIT;
