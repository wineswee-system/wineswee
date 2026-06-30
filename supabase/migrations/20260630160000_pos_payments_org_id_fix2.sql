-- Fix2: RLS 改用 ::TEXT cast（不管 column 是 INT 還是 TEXT 都能比）
-- 先把舊 policy 清掉再重建
-- 2026-06-30

-- ── pos_payments ──────────────────────────────────────────────────────────────

-- 強制刪所有 organization_id 相關 constraint（不管名字）
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.pos_payments'::regclass
       AND pg_get_constraintdef(oid) ILIKE '%organization_id%'
  LOOP
    EXECUTE 'ALTER TABLE public.pos_payments DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
  END LOOP;
END $$;

-- 改 column 型別（::TEXT cast 讓 INT value 變 '1' 之類的字串）
ALTER TABLE public.pos_payments
  ALTER COLUMN organization_id TYPE TEXT USING organization_id::TEXT;

-- RLS：雙邊 ::TEXT 確保 integer 欄和 text 欄都能比
DROP POLICY IF EXISTS "staff" ON public.pos_payments;
CREATE POLICY "staff" ON public.pos_payments
  FOR ALL TO authenticated
  USING (
    organization_id::TEXT = (
      SELECT organization_id::TEXT FROM employees
       WHERE auth_user_id = auth.uid() LIMIT 1
    )
  );

-- ── qr_order_sessions ─────────────────────────────────────────────────────────

DO $$ DECLARE r RECORD; BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.qr_order_sessions'::regclass
       AND pg_get_constraintdef(oid) ILIKE '%organization_id%'
  LOOP
    EXECUTE 'ALTER TABLE public.qr_order_sessions DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
  END LOOP;
END $$;

DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'qr_order_sessions'
         AND column_name = 'organization_id')
     NOT IN ('text','character varying') THEN
    ALTER TABLE public.qr_order_sessions
      ALTER COLUMN organization_id TYPE TEXT USING organization_id::TEXT;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[qr_sessions org_id] %', SQLERRM; END $$;

DROP POLICY IF EXISTS "staff" ON public.qr_order_sessions;
CREATE POLICY "staff" ON public.qr_order_sessions
  FOR ALL TO authenticated
  USING (
    organization_id::TEXT = (
      SELECT organization_id::TEXT FROM employees
       WHERE auth_user_id = auth.uid() LIMIT 1
    )
  );

NOTIFY pgrst, 'reload schema';
