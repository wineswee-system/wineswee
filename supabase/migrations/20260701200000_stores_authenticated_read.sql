-- stores 表補 authenticated 讀 policy
-- 原本只有 guest_qr_read (anon, qr 限定) → authenticated 查 stores 會空陣列
-- 所有登入員工都要能看到同 org 的門市（新增任務下拉、TaskDetailPanel 等）
-- idempotent

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'stores' AND policyname = 'stores_org_sel'
  ) THEN
    CREATE POLICY stores_org_sel ON public.stores
      FOR SELECT TO authenticated
      USING (public.org_visible(organization_id));
  END IF;
END $$;

-- 確保 RLS 已啟用（冪等，已啟用的不會報錯）
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
