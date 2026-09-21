-- 系統健檢工具:read-only introspection helpers — 2026-07-08
-- 目的:能從 live DB 直接列「某表全部觸發器」+「全系統函式 body 搜尋」，
--       不再靠 grep migration 檔猜(會漏掉動態建/老闆改/被 DROP 的)。
-- 都是唯讀;SECURITY DEFINER 才讀得到 pg_catalog。給 service_role/authenticated。

-- 1) 列某表的所有觸發器(live)
CREATE OR REPLACE FUNCTION public._list_table_triggers(p_table text)
RETURNS TABLE(tgname text, enabled "char", triggerdef text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
  SELECT t.tgname::text, t.tgenabled, pg_get_triggerdef(t.oid)
  FROM pg_trigger t
  WHERE t.tgrelid = ('public.' || p_table)::regclass
    AND NOT t.tgisinternal
  ORDER BY t.tgname;
$$;

-- 2) 全系統函式 body 搜尋(regex)→ 回 (函式名, 行號, 該行)
CREATE OR REPLACE FUNCTION public._grep_function_defs(p_pattern text)
RETURNS TABLE(fn_name text, ln bigint, line text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
  SELECT p.proname::text, l.ord AS ln, l.x AS line
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL
    regexp_split_to_table(pg_get_functiondef(p.oid), E'\n') WITH ORDINALITY AS l(x, ord)
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND l.x ~ p_pattern
  ORDER BY p.proname, l.ord;
$$;

GRANT EXECUTE ON FUNCTION public._list_table_triggers(text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public._grep_function_defs(text)  TO service_role, authenticated;
NOTIFY pgrst, 'reload schema';
