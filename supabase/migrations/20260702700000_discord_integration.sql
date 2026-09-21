-- ════════════════════════════════════════════════════════════════
-- Discord 雙向 Bot 整合 — 帳號綁定 + 一次性綁定碼
-- 2026-07-02
--
-- 內容：
--   1. discord_account_links — Discord user ↔ 員工 對照表
--      （鏡射 employee_line_accounts 的 platform user → employee 模式，
--        但 Discord Interactions 是單一 endpoint，不需要 channel 維度）
--   2. discord_link_codes — 一次性綁定碼（15 分鐘有效，用過即失效）
--   3. RPC generate_discord_link_code() — 登入者在 ERP 內產生綁定碼，
--      再到 Discord 輸入 /link code:<碼> 完成綁定
--
-- 寫入路徑：只有 edge function（service_role）能寫 discord_account_links；
-- authenticated 只能看/解除自己的綁定。discord_link_codes 對 authenticated
-- 完全不開放（由 RPC + service_role 處理）。
-- ════════════════════════════════════════════════════════════════

-- ── 1. Discord 帳號綁定表 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.discord_account_links (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  INT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id      INT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  discord_user_id  TEXT NOT NULL UNIQUE,     -- Discord snowflake ID（字串存，避免 JS 精度問題）
  discord_username TEXT,
  linked_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (employee_id)                        -- 一位員工只綁一個 Discord 帳號
);

CREATE INDEX IF NOT EXISTS idx_discord_links_discord_user
  ON public.discord_account_links (discord_user_id);

COMMENT ON TABLE public.discord_account_links IS
  'Discord user ↔ 員工綁定（鏡射 employee_line_accounts 模式）。只有 discord-bot edge function 以 service_role 寫入。';

-- ── 2. 一次性綁定碼 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.discord_link_codes (
  code            TEXT PRIMARY KEY,           -- 8 碼隨機（大寫十六進位）
  employee_id     INT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  organization_id INT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT now() + interval '15 minutes',
  used            BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.discord_link_codes IS
  'Discord /link 綁定碼。由 generate_discord_link_code() 產生，15 分鐘有效，一次性。';

-- ── 3. RPC：登入者產生綁定碼 ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_discord_link_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_employee_id INT;
  v_org_id      INT;
  v_code        TEXT;
BEGIN
  v_employee_id := public.current_employee_id();
  v_org_id      := public.current_user_org_id();

  IF v_employee_id IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND: 目前登入帳號沒有對應員工資料';
  END IF;

  -- 舊碼一律作廢（同一員工同時只有一組有效碼）
  UPDATE public.discord_link_codes
     SET used = true
   WHERE employee_id = v_employee_id AND used = false;

  -- 8 碼大寫，來源 md5(random)（不強制依賴 pgcrypto）
  v_code := upper(substring(md5(random()::text || clock_timestamp()::text) FROM 1 FOR 8));

  INSERT INTO public.discord_link_codes (code, employee_id, organization_id)
  VALUES (v_code, v_employee_id, v_org_id);

  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_discord_link_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_discord_link_code() FROM anon;
GRANT EXECUTE ON FUNCTION public.generate_discord_link_code() TO authenticated;

COMMENT ON FUNCTION public.generate_discord_link_code() IS
  '產生 Discord /link 綁定碼（15 分鐘有效）。SECURITY DEFINER，僅 authenticated 可呼叫。';

-- ── 4. RLS ────────────────────────────────────────────────────────
ALTER TABLE public.discord_account_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_link_codes    ENABLE ROW LEVEL SECURITY;

-- service_role bypass（edge function 寫入路徑）
DROP POLICY IF EXISTS "discord_links_service_role" ON public.discord_account_links;
CREATE POLICY "discord_links_service_role" ON public.discord_account_links
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "discord_link_codes_service_role" ON public.discord_link_codes;
CREATE POLICY "discord_link_codes_service_role" ON public.discord_link_codes
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- discord_account_links：本人或同組織 admin 可 SELECT / DELETE。
-- 不給 authenticated INSERT/UPDATE — 綁定只能經由 edge function（service_role）。
DROP POLICY IF EXISTS "discord_links_select_own_or_admin" ON public.discord_account_links;
CREATE POLICY "discord_links_select_own_or_admin" ON public.discord_account_links
  FOR SELECT TO authenticated
  USING (
    (SELECT public.current_employee_id()) = employee_id
    OR (
      (SELECT public.is_admin())
      AND organization_id = (SELECT public.current_user_org_id())
    )
  );

DROP POLICY IF EXISTS "discord_links_delete_own_or_admin" ON public.discord_account_links;
CREATE POLICY "discord_links_delete_own_or_admin" ON public.discord_account_links
  FOR DELETE TO authenticated
  USING (
    (SELECT public.current_employee_id()) = employee_id
    OR (
      (SELECT public.is_admin())
      AND organization_id = (SELECT public.current_user_org_id())
    )
  );

-- discord_link_codes：authenticated 完全不開 policy
-- （RPC 是 SECURITY DEFINER 會繞過 RLS；查驗/核銷由 service_role 執行）

NOTIFY pgrst, 'reload schema';
