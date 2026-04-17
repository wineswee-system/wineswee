-- ============================================================
-- 為所有啟用 RLS 的表加入 authenticated 角色的存取策略
-- 修復：登入後 authenticated 角色被 RLS 擋住無法讀取
-- ============================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  -- 所有有 RLS 的表都加入 authenticated 角色的 policy
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename IN (
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    )
  LOOP
    -- 檢查表是否啟用了 RLS
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity = true
    ) THEN
      -- 檢查是否已有 authenticated policy
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t AND policyname = 'auth_' || t
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
          'auth_' || t, t
        );
        RAISE NOTICE 'Added authenticated policy for: %', t;
      END IF;
    END IF;
  END LOOP;
END $$;
