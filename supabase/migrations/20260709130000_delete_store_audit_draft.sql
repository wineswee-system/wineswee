-- 門市稽核草稿刪除 RPC — 2026-07-09
-- 需求:門市稽核列表的「草稿」單要能刪除。
-- 做法:SECURITY DEFINER RPC，雙重防護 —— 只能刪 status='草稿' 且同租戶;
--   連同子表 store_audit_items(FK audit_id)一起刪。草稿無簽核鏈、無下游 → 硬刪安全。
--   (store_audits 無 deleted_at,不走軟刪;非草稿一律擋)。idempotent。

CREATE OR REPLACE FUNCTION public.delete_store_audit_draft(p_id integer)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_audit public.store_audits;
BEGIN
  SELECT * INTO v_audit FROM public.store_audits WHERE id = p_id;
  IF v_audit.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_audit.status <> '草稿' THEN
    RETURN json_build_object('ok', false, 'error', 'ONLY_DRAFT');  -- 只能刪草稿
  END IF;
  IF v_audit.organization_id IS DISTINCT FROM public.current_employee_org() THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');   -- 跨租戶擋
  END IF;

  DELETE FROM public.store_audit_items WHERE audit_id = p_id;
  DELETE FROM public.store_audits WHERE id = p_id AND status = '草稿';

  RETURN json_build_object('ok', true, 'id', p_id);
END $$;

GRANT EXECUTE ON FUNCTION public.delete_store_audit_draft(integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
