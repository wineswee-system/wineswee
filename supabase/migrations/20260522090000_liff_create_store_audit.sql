-- ════════════════════════════════════════════════════════════════════════════
-- LIFF 建立稽核單 RPC — 含初始化資料 (stores + bound chain)
-- ────────────────────────────────────────────────────────────────────────────
-- 1. liff_get_store_audit_init — 開新增頁時取 stores + 綁定的 chain_id
-- 2. liff_create_store_audit   — 建單（auditor_id 從 line_user_id 解出）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 新增頁初始化資料 ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_get_store_audit_init(
  p_line_user_id text
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp           employees;
  v_stores      json;
  v_chain_id    int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT json_agg(json_build_object('id', id, 'name', name) ORDER BY name) INTO v_stores
  FROM stores WHERE organization_id = emp.organization_id;

  SELECT chain_id INTO v_chain_id
  FROM form_chain_configs
  WHERE form_type = 'store_audit' AND organization_id = emp.organization_id
  LIMIT 1;

  RETURN json_build_object(
    'ok', true,
    'stores', COALESCE(v_stores, '[]'::json),
    'bound_chain_id', v_chain_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_store_audit_init(text) TO authenticated, anon;


-- ─── 2. 建單 RPC ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_create_store_audit(
  p_line_user_id text,
  p_store_id     int,
  p_audit_date   date,
  p_shift        text DEFAULT NULL,
  p_arrive_time  time DEFAULT NULL,
  p_depart_time  time DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp           employees;
  v_store_name  text;
  v_chain_id    int;
  v_new_id      int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT name INTO v_store_name FROM stores
   WHERE id = p_store_id AND organization_id = emp.organization_id;
  IF v_store_name IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'STORE_NOT_FOUND_OR_NO_ACCESS');
  END IF;

  SELECT chain_id INTO v_chain_id
  FROM form_chain_configs
  WHERE form_type = 'store_audit' AND organization_id = emp.organization_id
  LIMIT 1;

  INSERT INTO store_audits (
    organization_id, store_id, store_name,
    audit_date, shift, arrive_time, depart_time,
    auditor_id, auditor_name,
    approval_chain_id, status
  ) VALUES (
    emp.organization_id, p_store_id, v_store_name,
    p_audit_date, p_shift, p_arrive_time, p_depart_time,
    emp.id, emp.name,
    v_chain_id, '草稿'
  ) RETURNING id INTO v_new_id;

  RETURN json_build_object('ok', true, 'audit_id', v_new_id);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_create_store_audit(text, int, date, text, time, time) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
