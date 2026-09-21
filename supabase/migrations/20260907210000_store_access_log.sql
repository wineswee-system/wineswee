-- 門市權責變更紀錄:加人/移除/給編輯權留痕(誰、何時、對誰、動作、原因),在「管理」視窗看得到「為啥沒了」。
CREATE TABLE IF NOT EXISTS public.store_access_log (
  id             bigserial PRIMARY KEY,
  store_id       int NOT NULL,
  store_name     text,
  employee_id    int,
  employee_name  text,
  action         text NOT NULL,      -- 加入(可排) / 加入(僅看) / 移除
  can_edit       boolean,
  actor_id       int,
  actor_name     text,
  reason         text,
  organization_id int,
  created_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_store_access_log_store ON public.store_access_log(store_id, created_at DESC);
ALTER TABLE public.store_access_log ENABLE ROW LEVEL SECURITY;
-- 直查僅同 org admin(平常走 DEFINER RPC 讀取)
DROP POLICY IF EXISTS store_access_log_sel ON public.store_access_log;
CREATE POLICY store_access_log_sel ON public.store_access_log FOR SELECT
  USING (public.is_admin() AND organization_id = public.current_user_org_id());

-- set_store_extra_access 升級成 5 參數(加 p_reason)並寫 log。先 DROP 4 參數版避免 overload。
DROP FUNCTION IF EXISTS public.set_store_extra_access(integer, integer, boolean, boolean);

CREATE OR REPLACE FUNCTION public.set_store_extra_access(p_employee_id integer, p_store_id integer, p_grant boolean, p_can_edit boolean DEFAULT false, p_reason text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller employees; v_org int; v_emp_org int; v_store_org int; v_pid int;
  v_emp_name text; v_store_name text; v_action text;
BEGIN
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CALLER_NOT_FOUND'); END IF;
  IF v_caller.role NOT IN ('admin', 'super_admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_ALLOWED');
  END IF;
  v_org := v_caller.organization_id;

  SELECT organization_id, name INTO v_emp_org, v_emp_name FROM employees WHERE id = p_employee_id;
  SELECT organization_id, name INTO v_store_org, v_store_name FROM stores WHERE id = p_store_id;
  IF v_emp_org IS NULL OR v_store_org IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_emp_org <> v_org OR v_store_org <> v_org THEN RETURN jsonb_build_object('ok', false, 'error', 'CROSS_ORG'); END IF;

  IF p_grant THEN
    INSERT INTO public.user_stores (employee_id, store_id, is_primary, organization_id)
    VALUES (p_employee_id, p_store_id, false, v_org)
    ON CONFLICT (employee_id, store_id) DO NOTHING;

    IF p_can_edit AND NOT public.liff_employee_has_permission(p_employee_id, 'schedule.edit') THEN
      SELECT id INTO v_pid FROM public.permissions WHERE code = 'schedule.edit';
      INSERT INTO public.employee_permissions (employee_id, permission_id, mode, granted_by)
      VALUES (p_employee_id, v_pid, 'grant', v_caller.id)
      ON CONFLICT (employee_id, permission_id) DO UPDATE SET mode = 'grant', granted_by = v_caller.id, updated_at = now();
    END IF;
    v_action := CASE WHEN p_can_edit THEN '加入(可排)' ELSE '加入(僅看)' END;
  ELSE
    DELETE FROM public.user_stores WHERE employee_id = p_employee_id AND store_id = p_store_id;
    v_action := '移除';
  END IF;

  INSERT INTO public.store_access_log (store_id, store_name, employee_id, employee_name, action, can_edit, actor_id, actor_name, reason, organization_id)
  VALUES (p_store_id, v_store_name, p_employee_id, v_emp_name, v_action, COALESCE(p_can_edit, false), v_caller.id, v_caller.name, NULLIF(btrim(p_reason), ''), v_org);

  RETURN jsonb_build_object('ok', true, 'action', CASE WHEN p_grant THEN 'granted' ELSE 'revoked' END, 'edit', COALESCE(p_can_edit, false));
END $function$;

REVOKE ALL ON FUNCTION public.set_store_extra_access(integer, integer, boolean, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_store_extra_access(integer, integer, boolean, boolean, text) TO authenticated;

-- 讀某店的變更紀錄(admin 限定)
CREATE OR REPLACE FUNCTION public.get_store_access_log(p_store_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_caller employees;
BEGIN
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL OR v_caller.role NOT IN ('admin', 'super_admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_ALLOWED');
  END IF;
  RETURN jsonb_build_object('ok', true, 'items', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'action', l.action, 'employee_name', l.employee_name, 'actor_name', l.actor_name,
      'reason', l.reason, 'created_at', l.created_at) ORDER BY l.created_at DESC)
    FROM public.store_access_log l
    WHERE l.store_id = p_store_id AND l.organization_id = v_caller.organization_id
      AND l.created_at > now() - interval '180 days'), '[]'::jsonb));
END $function$;

REVOKE ALL ON FUNCTION public.get_store_access_log(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_store_access_log(integer) TO authenticated;
