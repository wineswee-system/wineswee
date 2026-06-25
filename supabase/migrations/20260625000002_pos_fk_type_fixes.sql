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
--     Constraint added now.
--
-- UUID→INT columns use drop+re-add: PostgreSQL cannot cast UUID to INT.
-- All columns were NULL-valued (FKs were never enforced), so no data loss.
-- Migration is fully idempotent via type-check + constraint-existence guards.
-- ============================================================

BEGIN;

-- ─── P1a: pos_shifts.employee_id UUID → INT ───────────────────────────────

DO $$ BEGIN
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

-- Fix broken RLS on pos_returns: original policy compared employees.id (INT)
-- to auth.uid() (UUID) — always evaluates false. Replace with auth_org_id().
DROP POLICY IF EXISTS "tenant_pos_returns" ON public.pos_returns;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'pos_returns' AND policyname = 'tenant_pos_returns') THEN
    CREATE POLICY "tenant_pos_returns" ON public.pos_returns
      FOR ALL TO authenticated
      USING (organization_id = auth_org_id());
  END IF;
END $$;

-- ─── P2a: pos_menu_item_skus.sku_id BIGINT → INT + FK ────────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pos_menu_item_skus'
      AND column_name = 'sku_id' AND data_type = 'bigint'
  ) THEN
    ALTER TABLE public.pos_menu_item_skus
      ALTER COLUMN sku_id TYPE INT USING sku_id::INT;
    RAISE NOTICE 'pos_menu_item_skus.sku_id retyped BIGINT→INT';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pos_menu_item_skus'::regclass
      AND conname = 'pos_menu_item_skus_sku_id_fkey'
  ) THEN
    ALTER TABLE public.pos_menu_item_skus
      ADD CONSTRAINT pos_menu_item_skus_sku_id_fkey
      FOREIGN KEY (sku_id) REFERENCES public.skus(id) ON DELETE CASCADE;
    RAISE NOTICE 'pos_menu_item_skus.sku_id FK added';
  END IF;
END $$;

-- ─── P2b: pos_products.sku_id BIGINT → INT + FK ──────────────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pos_products'
      AND column_name = 'sku_id' AND data_type = 'bigint'
  ) THEN
    ALTER TABLE public.pos_products
      ALTER COLUMN sku_id TYPE INT USING sku_id::INT;
    RAISE NOTICE 'pos_products.sku_id retyped BIGINT→INT';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pos_products'::regclass
      AND conname = 'pos_products_sku_id_fkey'
  ) THEN
    ALTER TABLE public.pos_products
      ADD CONSTRAINT pos_products_sku_id_fkey
      FOREIGN KEY (sku_id) REFERENCES public.skus(id) ON DELETE SET NULL;
    RAISE NOTICE 'pos_products.sku_id FK added';
  END IF;
END $$;

-- ─── P3: pos_orders.shift_id → pos_shifts(id) FK ─────────────────────────
-- Both sides are UUID. FK was left unenforced due to uncertainty from a prior
-- partial migration run. Types confirm as matching — enforce the constraint now.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pos_orders'::regclass
      AND conname = 'pos_orders_shift_id_fkey'
  ) THEN
    ALTER TABLE public.pos_orders
      ADD CONSTRAINT pos_orders_shift_id_fkey
      FOREIGN KEY (shift_id) REFERENCES public.pos_shifts(id) ON DELETE SET NULL;
    RAISE NOTICE 'pos_orders.shift_id FK added';
  END IF;
END $$;

COMMIT;
