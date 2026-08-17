-- 2026-08-17 門市稽核草稿編輯守門加 org 比對(admin/稽核室限同租戶,super_admin跨租戶)
CREATE OR REPLACE FUNCTION public.liff_update_store_audit_item(p_line_user_id text, p_item_id integer, p_deduct_score integer DEFAULT NULL::integer, p_group_note text DEFAULT NULL::text, p_remark text DEFAULT NULL::text, p_item_text text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp employees; v_item store_audit_items; v_audit store_audits;
  v_other int; v_ded int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  SELECT * INTO v_item FROM store_audit_items WHERE id = p_item_id;
  IF v_item.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'ITEM_NOT_FOUND'); END IF;
  SELECT * INTO v_audit FROM store_audits WHERE id = v_item.audit_id;
  IF v_audit.status <> '草稿' THEN RETURN json_build_object('ok', false, 'error', 'NOT_DRAFT', 'status', v_audit.status); END IF;
  -- 草稿編輯:稽核員本人 或 admin/super_admin 或 稽核室部門(老闆授權督導/稽核室訂正草稿)
  -- 草稿編輯:稽核員本人 / super_admin(跨租戶) / 同租戶的 admin 或 稽核室部門
  IF NOT (
       v_audit.auditor_id = emp.id
    OR EXISTS (SELECT 1 FROM public.roles r WHERE r.id = emp.role_id AND r.name = 'super_admin')
    OR (v_audit.organization_id = emp.organization_id AND (
          EXISTS (SELECT 1 FROM public.roles r WHERE r.id = emp.role_id AND r.name = 'admin')
       OR EXISTS (SELECT 1 FROM public.departments d WHERE d.id = emp.department_id AND d.name = '稽核室')
       ))
  ) THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;

  IF p_deduct_score IS NOT NULL THEN
    v_ded := GREATEST(0, p_deduct_score);
    IF v_item.input_type IN ('bonus','other') THEN
      -- 加分/其他:不受群組配分限制(類別層 100 上限由 calc 控),直接存
      UPDATE store_audit_items SET deduct_score = v_ded, passed = TRUE WHERE id = p_item_id;
    ELSE
      SELECT COALESCE(SUM(deduct_score), 0) INTO v_other FROM store_audit_items
        WHERE audit_id = v_item.audit_id
          AND relation_group IS NOT DISTINCT FROM v_item.relation_group
          AND id <> p_item_id AND input_type NOT IN ('bonus','other');
      IF v_ded > COALESCE(v_item.group_allot, 0) - v_other THEN
        v_ded := GREATEST(0, COALESCE(v_item.group_allot, 0) - v_other);
      END IF;
      UPDATE store_audit_items SET deduct_score = v_ded, passed = (v_ded = 0) WHERE id = p_item_id;
    END IF;
  END IF;

  IF p_group_note IS NOT NULL THEN UPDATE store_audit_items SET group_note = p_group_note WHERE id = p_item_id; END IF;
  IF p_remark    IS NOT NULL THEN UPDATE store_audit_items SET remark    = p_remark    WHERE id = p_item_id; END IF;
  IF p_item_text IS NOT NULL THEN UPDATE store_audit_items SET item_text = p_item_text WHERE id = p_item_id; END IF;

  PERFORM public.calc_store_audit_score(v_item.audit_id);
  RETURN json_build_object('ok', true);
END $function$

