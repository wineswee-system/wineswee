-- 修:店長新增班別失敗(super admin 可) — 2026-07-17
-- 根因:shift_definitions 在 org RLS 沙盤時漏掛 set_org_default trigger →
--   前端 insert 沒帶 organization_id → 新列 org_id=null → RLS WITH CHECK org_visible(null)
--   對店長=false(擋)、對 super admin=bypass(過)。最近幾筆 org_id 都是 null 佐證。
-- 修:補掛 trigger(新列自動補 org)+回填現有 null。sibling 表 store_time_slots 一併處理。
-- idempotent。

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shift_definitions','store_time_slots'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN CONTINUE; END IF;
    -- 確保有 organization_id 欄
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='organization_id') THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN organization_id bigint', t);
    END IF;
    -- 回填 null → 最小 org id(單一 org 公司=1)
    EXECUTE format('UPDATE public.%I SET organization_id = (SELECT MIN(id) FROM public.organizations) WHERE organization_id IS NULL', t);
    -- 補掛 set_org_default(新列自動補 org),對齊其他 54 表
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_org_default ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_set_org_default BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_org_default()', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
