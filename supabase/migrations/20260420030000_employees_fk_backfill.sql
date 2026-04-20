-- ============================================================
--  Backfill employees.department_id / store_id from legacy TEXT
--  columns, if those columns still exist (i.e. run before the
--  phase3_1 drop has been applied on this environment).
--
--  Safe no-op when dept/store are already dropped — the DO blocks
--  check information_schema first.
-- ============================================================

-- department_id from dept TEXT
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='employees' AND column_name='dept'
  ) THEN
    EXECUTE $sql$
      UPDATE public.employees e
      SET department_id = d.id
      FROM public.departments d
      WHERE e.department_id IS NULL
        AND e.dept IS NOT NULL
        AND btrim(e.dept) <> ''
        AND btrim(e.dept) = btrim(d.name);
    $sql$;
  END IF;
END $$;

-- store_id from store TEXT
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='employees' AND column_name='store'
  ) THEN
    EXECUTE $sql$
      UPDATE public.employees e
      SET store_id = s.id
      FROM public.stores s
      WHERE e.store_id IS NULL
        AND e.store IS NOT NULL
        AND btrim(e.store) <> ''
        AND btrim(e.store) = btrim(s.name);
    $sql$;
  END IF;
END $$;

-- supervisor_id from supervisor TEXT (match on employee name)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='employees' AND column_name='supervisor'
  ) THEN
    EXECUTE $sql$
      UPDATE public.employees e
      SET supervisor_id = sup.id
      FROM public.employees sup
      WHERE e.supervisor_id IS NULL
        AND e.supervisor IS NOT NULL
        AND btrim(e.supervisor) <> ''
        AND btrim(e.supervisor) = btrim(sup.name)
        AND sup.id <> e.id;
    $sql$;
  END IF;
END $$;

-- Report leftover gaps so the diagnostic is visible in migration logs.
DO $$
DECLARE
  null_dept  INT;
  null_store INT;
BEGIN
  SELECT count(*) INTO null_dept  FROM public.employees WHERE department_id IS NULL;
  SELECT count(*) INTO null_store FROM public.employees WHERE store_id IS NULL;
  RAISE NOTICE 'employees.department_id still NULL: %', null_dept;
  RAISE NOTICE 'employees.store_id still NULL: %',      null_store;
END $$;
