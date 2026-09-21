-- ════════════════════════════════════════════════════════════════════════════
-- 跨 org 寫入隔離：把 is_staff() 寫 policy 升級成 org_visible / can_see_store
-- 2026-06-18
--
-- 背景：20260618130000 把 true 寫 policy 收成 is_staff()(擋 anon、但登入者皆可寫，仍有
--   跨租戶寫的 🟠)。本支收最後一塊:
--   - 有 organization_id 的表 → 寫 = org_visible(organization_id)(同 org 才能寫)
--   - 只有 store_id 的表       → 寫 = can_see_store(store_id)
--   - 兩者都沒有(理論上不會,is_staff 寫 policy 都來自有欄位的表)→ 維持 is_staff()
--
-- INSERT 安全:先確保有 org 的表都掛 set_org_default trigger(BEFORE INSERT 先補 org，
--   再跑 WITH CHECK org_visible → 通過)。單一 org 下:現有 row org 已回填、現有使用者 org
--   相同 → org_visible 全通過，行為不變;只是擋掉「跨 org 寫」。
--
-- 只動「寫 policy 且 qual/with_check 為 is_staff()」的(精準=130000 收斂出來那批 ORG/STORE
--   寫 policy)。PERSON(can_see_request)/admin-only(is_admin)/SELECT 完全不碰。
--
-- idempotent：可重跑(再跑時這些 policy 已是 org_visible/can_see_store，不再符合 is_staff() 條件)。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  p record;
  v_has_org boolean;
  v_has_store boolean;
  v_expr text;
BEGIN
  FOR p IN
    SELECT tablename, policyname, cmd
      FROM pg_policies
     WHERE schemaname = 'public'
       AND cmd <> 'SELECT'
       AND (btrim(COALESCE(qual,'')) = 'is_staff()' OR btrim(COALESCE(with_check,'')) = 'is_staff()')
  LOOP
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=p.tablename
                      AND column_name='organization_id' AND data_type IN ('integer','bigint','smallint'))
      INTO v_has_org;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=p.tablename
                      AND column_name='store_id' AND data_type IN ('integer','bigint','smallint'))
      INTO v_has_store;

    IF v_has_org THEN
      v_expr := 'org_visible(organization_id)';
      -- 確保 INSERT 會自動補 org（BEFORE INSERT，先於 WITH CHECK）
      EXECUTE format('DROP TRIGGER IF EXISTS trg_set_org_default ON public.%I', p.tablename);
      EXECUTE format('CREATE TRIGGER trg_set_org_default BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_org_default()', p.tablename);
    ELSIF v_has_store THEN
      v_expr := 'can_see_store(store_id)';
    ELSE
      CONTINUE;  -- 沒有可 scope 的欄位 → 維持 is_staff()
    END IF;

    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
    IF p.cmd = 'INSERT' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (%s)', p.policyname, p.tablename, v_expr);
    ELSIF p.cmd = 'UPDATE' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (%s) WITH CHECK (%s)', p.policyname, p.tablename, v_expr, v_expr);
    ELSIF p.cmd = 'DELETE' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (%s)', p.policyname, p.tablename, v_expr);
    ELSE  -- 'ALL'
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (%s) WITH CHECK (%s)', p.policyname, p.tablename, v_expr, v_expr);
    END IF;
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
