-- Wineswee 官網 CMS 後臺 — 內容表 + 讀寫 RPC + 圖片 bucket
-- 公開站走 get_wineswee_content()(anon 可讀);後臺寫入走 save_wineswee_content()(限 admin)
-- 冪等:可重複執行。Studio 不包 transaction,故用 IF NOT EXISTS / OR REPLACE / ON CONFLICT。
BEGIN;

-- ── 1. 內容表(每區塊一列 JSON) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wineswee_content (
  section     text PRIMARY KEY,               -- 'site' | 'products' | 'details' | 'news' | 'stores'
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);
ALTER TABLE public.wineswee_content ENABLE ROW LEVEL SECURITY;
-- 不開 anon/authenticated 直查 policy → 一律走下方 DEFINER RPC(對齊本專案 anon RLS 慣例)

-- ── 2. 公開讀(anon + authenticated 皆可) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_wineswee_content()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_object_agg(section, data), '{}'::jsonb) FROM public.wineswee_content;
$$;
REVOKE ALL ON FUNCTION public.get_wineswee_content() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_wineswee_content() TO anon, authenticated;

-- ── 3. 後臺寫入(限 admin,DEFINER 內部驗身分) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.save_wineswee_content(_section text, _data jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION '沒有權限修改官網內容' USING ERRCODE = '42501';
  END IF;
  IF _section NOT IN ('site','products','details','news','stores') THEN
    RAISE EXCEPTION '未知的區塊: %', _section USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.wineswee_content(section, data, updated_at, updated_by)
  VALUES (_section, _data, now(), auth.uid())
  ON CONFLICT (section) DO UPDATE
    SET data = EXCLUDED.data, updated_at = now(), updated_by = auth.uid();
END; $$;
REVOKE ALL ON FUNCTION public.save_wineswee_content(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_wineswee_content(text, jsonb) TO authenticated;

-- ── 4. 圖片 storage bucket(公開讀、admin 寫) ──────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('wineswee-media', 'wineswee-media', true, 10485760,
        ARRAY['image/jpeg','image/png','image/webp','image/gif','image/svg+xml','image/avif'])
ON CONFLICT (id) DO UPDATE
  SET public = true, file_size_limit = 10485760,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS ws_media_read   ON storage.objects;
DROP POLICY IF EXISTS ws_media_insert ON storage.objects;
DROP POLICY IF EXISTS ws_media_update ON storage.objects;
DROP POLICY IF EXISTS ws_media_delete ON storage.objects;
CREATE POLICY ws_media_read   ON storage.objects FOR SELECT
  USING (bucket_id = 'wineswee-media');
CREATE POLICY ws_media_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'wineswee-media' AND public.is_admin());
CREATE POLICY ws_media_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'wineswee-media' AND public.is_admin());
CREATE POLICY ws_media_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'wineswee-media' AND public.is_admin());

COMMIT;
NOTIFY pgrst, 'reload schema';
