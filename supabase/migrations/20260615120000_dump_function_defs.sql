-- ════════════════════════════════════════════════════════════════════════════
-- _dump_function_defs() — 給 migration drift 偵測腳本用（npm run db:drift）
--
-- 回傳指定函式在「live DB」當下的完整定義（pg_get_functiondef）。腳本把結果寫成
-- git-tracked 快照檔，定期跑 + git diff 就能抓到「有人在 Studio 直接改了函式卻沒
-- 回填 migration」的 drift（本專案最常實際炸 production 的根因）。
--
-- 安全：函式定義含薪資/簽核等 SECURITY DEFINER 邏輯，不可對外 → 只給 service_role。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._dump_function_defs(p_names text[])
RETURNS TABLE(fn_name text, fn_args text, fn_def text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
  SELECT p.proname::text,
         pg_get_function_identity_arguments(p.oid)::text,
         pg_get_functiondef(p.oid)::text
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = ANY(p_names)
  ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
$$;

REVOKE ALL ON FUNCTION public._dump_function_defs(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._dump_function_defs(text[]) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
