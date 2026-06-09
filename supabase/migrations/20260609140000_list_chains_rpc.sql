-- ════════════════════════════════════════════════════════════════════════════
-- list_all_chains_with_steps — SECURITY DEFINER RPC 給 admin/super_admin
-- 用，避免撞 approval_chains RLS 在某些 auth session 下 503。
--
-- Chains 設定頁直接走這個 RPC，不再 supabase.from('approval_chains') 直查。
-- 內部自己 check role，只回 admin/super_admin/manager 看得到的：
--   - admin/super_admin → 看全部
--   - 其他 → 看自己 org
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.list_all_chains_with_steps()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_org  INT;
  v_chains JSONB;
  v_steps  JSONB;
BEGIN
  v_role := public.current_employee_role();
  v_org  := public.current_employee_org();

  -- 撈 chains
  IF v_role IN ('admin', 'super_admin') THEN
    SELECT COALESCE(jsonb_agg(row_to_json(c)::jsonb ORDER BY c.category NULLS LAST, c.name), '[]'::jsonb)
      INTO v_chains
      FROM (
        SELECT id, name, description, category, is_active, organization_id, min_amount, max_amount
          FROM public.approval_chains
         ORDER BY category NULLS LAST, name
      ) c;
  ELSE
    SELECT COALESCE(jsonb_agg(row_to_json(c)::jsonb ORDER BY c.category NULLS LAST, c.name), '[]'::jsonb)
      INTO v_chains
      FROM (
        SELECT id, name, description, category, is_active, organization_id, min_amount, max_amount
          FROM public.approval_chains
         WHERE organization_id = v_org
         ORDER BY category NULLS LAST, name
      ) c;
  END IF;

  -- 撈所有 steps（用上面的 chain ids 過濾）
  SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb ORDER BY s.chain_id, s.step_order), '[]'::jsonb)
    INTO v_steps
    FROM (
      SELECT chain_id, step_order, label,
             target_type, target_emp_id, target_role_id, target_dept_id, target_store_id
        FROM public.approval_chain_steps
       WHERE chain_id IN (SELECT (e->>'id')::int FROM jsonb_array_elements(v_chains) e)
       ORDER BY chain_id, step_order
    ) s;

  RETURN jsonb_build_object(
    'role',   v_role,
    'org_id', v_org,
    'chains', v_chains,
    'steps',  v_steps
  );
END $$;

GRANT EXECUTE ON FUNCTION public.list_all_chains_with_steps() TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
