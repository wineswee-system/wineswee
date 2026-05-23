-- ════════════════════════════════════════════════════════════════════════════
-- LIFF 自訂表單填寫：anon RPC 套件
-- ----------------------------------------------------------------------------
-- (1) liff_get_form_template   → 拿 template + 該員工 org 內的 picker 選項
-- (2) liff_create_form_submission → 寫 form_submissions（支援 linked_binding_id）
-- 全部 SECURITY DEFINER，以 p_line_user_id 反查 employee 身份。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── (1) 拿模板 + picker 資料 ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_get_form_template(
  p_line_user_id TEXT,
  p_template_id  INT
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp        employees;
  v_tpl        form_templates;
  v_field_types TEXT[];
  v_emp_list   jsonb := '[]'::jsonb;
  v_dept_list  jsonb := '[]'::jsonb;
  v_store_list jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_emp FROM public._liff_resolve_employee(p_line_user_id);
  IF v_emp.id IS NULL THEN
    RETURN jsonb_build_object('error', 'unauthorized');
  END IF;

  SELECT * INTO v_tpl
    FROM form_templates
   WHERE id = p_template_id
     AND organization_id = v_emp.organization_id
     AND is_active = TRUE
   LIMIT 1;
  IF v_tpl.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  -- 該模板用到哪些 picker？只把需要的清單抓出來
  SELECT COALESCE(array_agg(DISTINCT (f->>'type')), ARRAY[]::TEXT[])
    INTO v_field_types
    FROM jsonb_array_elements(COALESCE(v_tpl.fields, '[]'::jsonb)) f;

  IF 'employee_picker' = ANY(v_field_types) THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', e.id, 'name', e.name, 'dept', e.dept, 'position', e.position
    ) ORDER BY e.name), '[]'::jsonb)
      INTO v_emp_list
      FROM employees e
     WHERE e.organization_id = v_emp.organization_id AND e.status = '在職';
  END IF;
  IF 'department_picker' = ANY(v_field_types) THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', d.id, 'name', d.name
    ) ORDER BY d.name), '[]'::jsonb)
      INTO v_dept_list
      FROM departments d
     WHERE d.organization_id = v_emp.organization_id;
  END IF;
  IF 'store_picker' = ANY(v_field_types) THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name
    ) ORDER BY s.name), '[]'::jsonb)
      INTO v_store_list
      FROM stores s
     WHERE s.organization_id = v_emp.organization_id AND s.is_active = TRUE;
  END IF;

  RETURN jsonb_build_object(
    'template', jsonb_build_object(
      'id', v_tpl.id,
      'name', v_tpl.name,
      'description', v_tpl.description,
      'scope', v_tpl.scope,
      'fields', COALESCE(v_tpl.fields, '[]'::jsonb)
    ),
    'me', jsonb_build_object(
      'id', v_emp.id,
      'name', v_emp.name,
      'dept', v_emp.dept,
      'department_id', v_emp.department_id,
      'store', v_emp.store,
      'store_id', v_emp.store_id,
      'position', v_emp.position,
      'email', v_emp.email,
      'organization_id', v_emp.organization_id
    ),
    'pickers', jsonb_build_object(
      'employees', v_emp_list,
      'departments', v_dept_list,
      'stores', v_store_list
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.liff_get_form_template(TEXT, INT) FROM public;
GRANT EXECUTE ON FUNCTION public.liff_get_form_template(TEXT, INT) TO anon, authenticated;


-- ─── (2) 建 form_submissions（支援 binding 連動）───────────────────────────
CREATE OR REPLACE FUNCTION public.liff_create_form_submission(
  p_line_user_id TEXT,
  p_template_id  INT,
  p_data         JSONB,
  p_binding_id   INT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp        employees;
  v_tpl        form_templates;
  v_new_id     INT;
BEGIN
  SELECT * INTO v_emp FROM public._liff_resolve_employee(p_line_user_id);
  IF v_emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_tpl
    FROM form_templates
   WHERE id = p_template_id
     AND organization_id = v_emp.organization_id
     AND is_active = TRUE
   LIMIT 1;
  IF v_tpl.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'template_not_found');
  END IF;

  -- binding 一致性檢查：如果有 binding_id，它的 form_template_id 必須吻合
  IF p_binding_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM task_form_bindings
       WHERE id = p_binding_id
         AND form_template_id = p_template_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'binding_mismatch');
    END IF;
  END IF;

  INSERT INTO form_submissions (
    organization_id, template_id, applicant_id, data, status, linked_binding_id
  ) VALUES (
    v_emp.organization_id, p_template_id, v_emp.id,
    COALESCE(p_data, '{}'::jsonb), '申請中', p_binding_id
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('ok', true, 'submission_id', v_new_id);
END $$;

REVOKE ALL ON FUNCTION public.liff_create_form_submission(TEXT, INT, JSONB, INT) FROM public;
GRANT EXECUTE ON FUNCTION public.liff_create_form_submission(TEXT, INT, JSONB, INT) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
