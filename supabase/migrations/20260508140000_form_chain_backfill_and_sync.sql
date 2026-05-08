-- ════════════════════════════════════════════════════════════
-- 自訂表單 chain 整合 — backfill + 雙向同步
--
-- 背景：
--   - 舊：form_templates.approval_chain_id 直接綁一個 chain
--   - 新：form_chain_configs 用 form_type='custom:<template_id>' 綁 chain
--   - FormBuilder 已改用 ChainConfigModal mode='single'，寫 form_chain_configs
--   - 但既有資料 + 列表顯示 還靠 form_templates.approval_chain_id
--
-- 解決：
--   1. 一次性把現有 form_templates.approval_chain_id 灌進 form_chain_configs
--   2. 加 trigger AFTER INSERT/UPDATE form_chain_configs 自動 sync 回
--      form_templates.approval_chain_id (form_type='custom:<id>' 才 sync)
--   → 兩邊永遠一致，舊路徑（form_templates.approval_chain_id 讀）不會壞
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. Backfill：form_templates → form_chain_configs ═══
INSERT INTO public.form_chain_configs (form_type, organization_id, chain_id, is_active, notes)
SELECT
  'custom:' || id::text,
  organization_id,
  approval_chain_id,
  true,
  'backfilled from form_templates.approval_chain_id (20260508140000)'
FROM public.form_templates
WHERE approval_chain_id IS NOT NULL
  AND organization_id IS NOT NULL  -- UNIQUE (form_type, org_id) 對 NULL 不去重
ON CONFLICT (form_type, organization_id) DO UPDATE
  SET chain_id  = EXCLUDED.chain_id,
      updated_at = NOW();


-- ═══ 2. Trigger：form_chain_configs INSERT/UPDATE → sync form_templates ═══
CREATE OR REPLACE FUNCTION public._trg_sync_form_chain_to_template()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_template_id int;
BEGIN
  -- 只處理 'custom:<id>' 格式（其他 form_type 走別的路徑）
  IF NEW.form_type !~ '^custom:[0-9]+$' THEN
    RETURN NEW;
  END IF;

  v_template_id := substring(NEW.form_type FROM 'custom:([0-9]+)')::int;
  IF v_template_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 同步 chain_id 到 form_templates
  UPDATE public.form_templates
     SET approval_chain_id = NEW.chain_id,
         updated_at = NOW()
   WHERE id = v_template_id;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_form_chain_to_template ON public.form_chain_configs;
CREATE TRIGGER trg_sync_form_chain_to_template
  AFTER INSERT OR UPDATE OF chain_id ON public.form_chain_configs
  FOR EACH ROW EXECUTE FUNCTION public._trg_sync_form_chain_to_template();


-- ═══ 3. （DELETE 也要 sync — 拔掉 chain 設定時把 form_templates 的也清掉） ═══
CREATE OR REPLACE FUNCTION public._trg_clear_form_chain_on_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_template_id int;
BEGIN
  IF OLD.form_type !~ '^custom:[0-9]+$' THEN
    RETURN OLD;
  END IF;

  v_template_id := substring(OLD.form_type FROM 'custom:([0-9]+)')::int;
  IF v_template_id IS NULL THEN
    RETURN OLD;
  END IF;

  UPDATE public.form_templates
     SET approval_chain_id = NULL,
         updated_at = NOW()
   WHERE id = v_template_id;

  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_clear_form_chain_on_delete ON public.form_chain_configs;
CREATE TRIGGER trg_clear_form_chain_on_delete
  AFTER DELETE ON public.form_chain_configs
  FOR EACH ROW EXECUTE FUNCTION public._trg_clear_form_chain_on_delete();


COMMIT;

NOTIFY pgrst, 'reload schema';
