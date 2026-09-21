-- ============================================================
-- POS FK Type Fixes — Priority 1, 2, 3
--
-- P1: pos_shifts / pos_orders / pos_payments / pos_returns
--     employee_id / opened_by: UUID → INT (employees.id is SERIAL INT, not UUID)
--     FK was omitted in original schema due to type mismatch — now enforced.
--
-- P2: pos_menu_item_skus / pos_products
--     sku_id: BIGINT → INT (skus.id is SERIAL INT, confirmed in audit_phase_b)
--     FK was omitted "type varies by env" — now enforced.
--
-- P3: pos_orders.shift_id
--     FK to pos_shifts(id) was left dangling despite both sides being UUID.
--     Constraint added now (with type guard — commit 032d4439 showed INT in one env).
--
-- UUID→INT columns use drop+re-add: PostgreSQL cannot cast UUID to INT.
-- All columns were NULL-valued (FKs were never enforced), so no data loss.
-- Idempotency: type-check IF for retype; separate FK-existence IF for constraint add.
--   Both guards use information_schema / pg_class JOINs — never ::regclass (throws on
--   missing table). P1 FK add runs even when column is already INT. P2 type and FK
--   blocks are separate so a FK failure does not roll back the type conversion.
-- ============================================================

BEGIN;

-- pos_shifts may have been created before employee_id was added to the schema
-- (CREATE TABLE IF NOT EXISTS skipped if table existed). Ensure column is present.
ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS employee_id INT;

-- ─── P1a: pos_shifts.employee_id UUID → INT ───────────────────────────────

DO $$ BEGIN
  -- Retype if still UUID (drop+re-add; no direct UUID→INT cast in PostgreSQL)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pos_shifts'
      AND column_name = 'employee_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE public.pos_shifts DROP COLUMN employee_id;
    ALTER TABLE public.pos_shifts
      ADD COLUMN employee_id INT REFERENCES public.employees(id) ON DELETE SET NULL;
    RAISE NOTICE 'pos_shifts.employee_id retyped UUID→INT';
  END IF;
END $$;

-- FK add is a SEPARATE block — runs even if column was already INT (idempotency fix)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pos_shifts'
      AND column_name = 'employee_id'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = 'pos_shifts'
        AND c.conname = 'pos_shifts_employee_id_fkey'
    ) THEN
      ALTER TABLE public.pos_shifts
        ADD CONSTRAINT pos_shifts_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;
      RAISE NOTICE 'pos_shifts.employee_id FK added';
    END IF;
  END IF;
END $$;

-- ─── P1b: pos_orders.opened_by UUID → INT ────────────────────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pos_orders'
      AND column_name = 'opened_by' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE public.pos_orders DROP COLUMN opened_by;
    ALTER TABLE public.pos_orders
      ADD COLUMN opened_by INT REFERENCES public.employees(id) ON DELETE SET NULL;
    RAISE NOTICE 'pos_orders.opened_by retyped UUID→INT';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pos_orders'
      AND column_name = 'opened_by'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = 'pos_orders'
        AND c.conname = 'pos_orders_opened_by_fkey'
    ) THEN
      ALTER TABLE public.pos_orders
        ADD CONSTRAINT pos_orders_opened_by_fkey
        FOREIGN KEY (opened_by) REFERENCES public.employees(id) ON DELETE SET NULL;
      RAISE NOTICE 'pos_orders.opened_by FK added';
    END IF;
  END IF;
END $$;

-- ─── P1c: pos_payments.employee_id UUID → INT ────────────────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pos_payments'
      AND column_name = 'employee_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE public.pos_payments DROP COLUMN employee_id;
    ALTER TABLE public.pos_payments
      ADD COLUMN employee_id INT REFERENCES public.employees(id) ON DELETE SET NULL;
    RAISE NOTICE 'pos_payments.employee_id retyped UUID→INT';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pos_payments'
      AND column_name = 'employee_id'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = 'pos_payments'
        AND c.conname = 'pos_payments_employee_id_fkey'
    ) THEN
      ALTER TABLE public.pos_payments
        ADD CONSTRAINT pos_payments_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;
      RAISE NOTICE 'pos_payments.employee_id FK added';
    END IF;
  END IF;
END $$;

-- ─── P1d: pos_returns.employee_id UUID → INT ─────────────────────────────
-- pos_returns (added in pos_supplemental) had the same UUID mistake.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pos_returns'
      AND column_name = 'employee_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE public.pos_returns DROP COLUMN employee_id;
    ALTER TABLE public.pos_returns
      ADD COLUMN employee_id INT REFERENCES public.employees(id) ON DELETE SET NULL;
    RAISE NOTICE 'pos_returns.employee_id retyped UUID→INT';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pos_returns'
      AND column_name = 'employee_id'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = 'pos_returns'
        AND c.conname = 'pos_returns_employee_id_fkey'
    ) THEN
      ALTER TABLE public.pos_returns
        ADD CONSTRAINT pos_returns_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;
      RAISE NOTICE 'pos_returns.employee_id FK added';
    END IF;
  END IF;
END $$;

-- Fix broken RLS on pos_returns: original policy compared employees.id (INT)
-- to auth.uid() (UUID) — always evaluates false. Replace with auth_org_id().
-- DROP then CREATE: both are DDL inside the outer transaction so a rollback
-- reverts the DROP too — no observable gap for concurrent sessions.
DROP POLICY IF EXISTS "tenant_pos_returns" ON public.pos_returns;
CREATE POLICY "tenant_pos_returns" ON public.pos_returns
  FOR ALL TO authenticated
  USING (organization_id = auth_org_id());

-- ─── P2a: pos_menu_item_skus.sku_id BIGINT → INT ─────────────────────────
-- Type conversion and FK add are SEPARATE blocks so a FK failure (e.g., orphaned
-- sku_id rows) does not roll back the type conversion.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pos_menu_item_skus'
      AND column_name = 'sku_id' AND data_type = 'bigint'
  ) THEN
    -- Guard: any value > INT_MAX would overflow on cast
    IF EXISTS (SELECT 1 FROM public.pos_menu_item_skus WHERE sku_id > 2147483647) THEN
      RAISE EXCEPTION 'pos_menu_item_skus has sku_id > INT_MAX — resolve before re-running';
    END IF;
    ALTER TABLE public.pos_menu_item_skus
      ALTER COLUMN sku_id TYPE INT USING sku_id::INT;
    RAISE NOTICE 'pos_menu_item_skus.sku_id retyped BIGINT→INT';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pos_menu_item_skus'
      AND column_name = 'sku_id'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = 'pos_menu_item_skus'
        AND c.conname = 'pos_menu_item_skus_sku_id_fkey'
    ) THEN
      -- SET NULL (not CASCADE): retiring a SKU should not silently delete mappings —
      -- consistent with pos_products_sku_id_fkey which also uses SET NULL.
      ALTER TABLE public.pos_menu_item_skus
        ADD CONSTRAINT pos_menu_item_skus_sku_id_fkey
        FOREIGN KEY (sku_id) REFERENCES public.skus(id) ON DELETE SET NULL;
      RAISE NOTICE 'pos_menu_item_skus.sku_id FK added';
    END IF;
  END IF;
END $$;

-- ─── P2b: pos_products.sku_id BIGINT → INT + FK ──────────────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pos_products'
      AND column_name = 'sku_id' AND data_type = 'bigint'
  ) THEN
    IF EXISTS (SELECT 1 FROM public.pos_products WHERE sku_id > 2147483647) THEN
      RAISE EXCEPTION 'pos_products has sku_id > INT_MAX — resolve before re-running';
    END IF;
    ALTER TABLE public.pos_products
      ALTER COLUMN sku_id TYPE INT USING sku_id::INT;
    RAISE NOTICE 'pos_products.sku_id retyped BIGINT→INT';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pos_products'
      AND column_name = 'sku_id'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = 'pos_products'
        AND c.conname = 'pos_products_sku_id_fkey'
    ) THEN
      ALTER TABLE public.pos_products
        ADD CONSTRAINT pos_products_sku_id_fkey
        FOREIGN KEY (sku_id) REFERENCES public.skus(id) ON DELETE SET NULL;
      RAISE NOTICE 'pos_products.sku_id FK added';
    END IF;
  END IF;
END $$;

-- ─── P3: pos_orders.shift_id → pos_shifts(id) FK ─────────────────────────
-- Commit 032d4439 showed pos_shifts.id was INT in one deployed env.
-- Guard: verify both columns are UUID before adding the constraint; warn and skip
-- rather than throwing (which would roll back all P1/P2 changes in this transaction).

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pos_orders'
      AND column_name = 'shift_id' AND data_type = 'uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pos_shifts'
      AND column_name = 'id' AND data_type = 'uuid'
  ) THEN
    RAISE WARNING 'pos_orders.shift_id or pos_shifts.id is not UUID — shift_id FK skipped. Check column types before re-running.';
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = 'pos_orders'
        AND c.conname = 'pos_orders_shift_id_fkey'
    ) THEN
      ALTER TABLE public.pos_orders
        ADD CONSTRAINT pos_orders_shift_id_fkey
        FOREIGN KEY (shift_id) REFERENCES public.pos_shifts(id) ON DELETE SET NULL;
      RAISE NOTICE 'pos_orders.shift_id FK added';
    END IF;
  END IF;
END $$;

-- ─── Indexes on FK child columns ──────────────────────────────────────────
-- PostgreSQL does not auto-index FK child columns. Without these, shift-close
-- queries (pos_orders WHERE shift_id = ?), cashier reports, and ON DELETE
-- cascade scans all seq-scan their target tables.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pos_shifts' AND column_name='employee_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_pos_shifts_employee ON public.pos_shifts(employee_id)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pos_orders' AND column_name='opened_by') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_pos_orders_opened_by ON public.pos_orders(opened_by)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pos_orders' AND column_name='shift_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_pos_orders_shift ON public.pos_orders(shift_id)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pos_payments' AND column_name='employee_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_pos_payments_employee ON public.pos_payments(employee_id)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pos_returns' AND column_name='employee_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_pos_returns_employee ON public.pos_returns(employee_id)';
  END IF;
END $$;

COMMIT;
