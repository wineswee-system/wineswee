-- pos_payments.organization_id 是 INT（migration 原設計），
-- 但 pos_orders.organization_id 在 live DB 已被改成 UUID/TEXT 型別，
-- 客端傳 UUID orgId → orders 寫入成功、payments 爆 "invalid input syntax for type integer"。
-- 把 pos_payments.organization_id 改成 TEXT，與實際資料對齊。
-- 2026-06-30

DO $$ BEGIN
  -- 1. 如果還有 FK constraint 就先刪
  ALTER TABLE pos_payments DROP CONSTRAINT IF EXISTS pos_payments_organization_id_fkey;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 2. 型別改 TEXT（幂等：已是 TEXT 也不會出錯）
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'pos_payments' AND column_name = 'organization_id')
     NOT IN ('text','character varying') THEN
    ALTER TABLE pos_payments
      ALTER COLUMN organization_id TYPE TEXT USING organization_id::TEXT;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[pos_payments org_id] %', SQLERRM;
END $$;

-- 3. 同步更新 RLS policy（TEXT = TEXT 比較）
DROP POLICY IF EXISTS "staff" ON pos_payments;
CREATE POLICY "staff" ON pos_payments
  FOR ALL TO authenticated
  USING (
    organization_id = (
      SELECT organization_id::TEXT
      FROM employees
      WHERE auth_user_id = auth.uid()
      LIMIT 1
    )
  );

-- 4. qr_order_sessions 同樣做一次，預防 QR 建立也爆同樣錯
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'qr_order_sessions'
      AND column_name = 'organization_id'
      AND data_type NOT IN ('text','character varying')
  ) THEN
    ALTER TABLE qr_order_sessions DROP CONSTRAINT IF EXISTS qr_order_sessions_organization_id_fkey;
    ALTER TABLE qr_order_sessions
      ALTER COLUMN organization_id TYPE TEXT USING organization_id::TEXT;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[qr_order_sessions org_id] %', SQLERRM;
END $$;

DROP POLICY IF EXISTS "staff" ON qr_order_sessions;
CREATE POLICY "staff" ON qr_order_sessions
  FOR ALL TO authenticated
  USING (
    organization_id = (
      SELECT organization_id::TEXT
      FROM employees
      WHERE auth_user_id = auth.uid()
      LIMIT 1
    )
  );

NOTIFY pgrst, 'reload schema';
