-- 2026-08-17 deletion_drain 回收桶備份改走 SECURITY DEFINER RPC。
--   原本 RLS 限 admin 寫,非 admin 刪除時前端直插 deletion_drain 被擋(42501,雖best-effort不擋刪除但一直噴log)。
--   改用 DEFINER RPC:任何 authenticated 刪除者都能備份(回收桶本就該涵蓋非admin誤刪),消除 42501。

CREATE OR REPLACE FUNCTION public.drain_deletion(
  p_entity_type text, p_entity_id bigint, p_entity_name text,
  p_payload jsonb, p_related_data jsonb, p_deleted_by text, p_organization_id int
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  INSERT INTO public.deletion_drain (
    entity_type, entity_id, entity_name, payload, related_data, deleted_by, organization_id
  ) VALUES (
    p_entity_type, p_entity_id, NULLIF(btrim(p_entity_name),''),
    COALESCE(p_payload, '{}'::jsonb), p_related_data,
    COALESCE(NULLIF(btrim(p_deleted_by),''), '系統'), p_organization_id
  );
$fn$;

REVOKE ALL ON FUNCTION public.drain_deletion(text,bigint,text,jsonb,jsonb,text,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.drain_deletion(text,bigint,text,jsonb,jsonb,text,int) TO authenticated;
