-- Fix: form_templates 沒有 deleted_at 欄位，移除該條件

BEGIN;

CREATE OR REPLACE FUNCTION public.liff_expense_dashboard(
  p_line_user_id  TEXT,
  p_date_from     TEXT DEFAULT NULL,
  p_date_to       TEXT DEFAULT NULL,
  p_account_codes TEXT DEFAULT NULL,
  p_template_ids  TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp          employees;
  v_org_id       INT;
  v_result       JSON;
  v_date_from    DATE;
  v_date_to      DATE;
  v_acc_arr      TEXT[];
  v_tmpl_arr     INT[];
BEGIN
  SELECT * INTO v_emp FROM public._liff_resolve_employee(p_line_user_id);
  IF v_emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;
  v_org_id := v_emp.organization_id;

  IF NOT EXISTS (
    SELECT 1 FROM roles r
    WHERE r.id = v_emp.role_id
      AND r.name IN ('super_admin', 'admin', 'manager')
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  v_date_from := CASE WHEN p_date_from IS NOT NULL AND p_date_from <> '' THEN p_date_from::date ELSE NULL END;
  v_date_to   := CASE WHEN p_date_to   IS NOT NULL AND p_date_to   <> '' THEN p_date_to::date   ELSE NULL END;
  v_acc_arr   := CASE WHEN p_account_codes IS NOT NULL AND p_account_codes <> '' THEN string_to_array(p_account_codes, ',') ELSE NULL END;
  v_tmpl_arr  := CASE WHEN p_template_ids  IS NOT NULL AND p_template_ids  <> '' THEN string_to_array(p_template_ids, ',')::int[] ELSE NULL END;

  SELECT json_build_object(
    'ok', true,
    'expense_rows', (
      SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT status, COALESCE(currency, 'TWD') AS currency,
          COUNT(*)::int AS count, SUM(estimated_amount) AS estimated_sum
        FROM expense_requests
        WHERE organization_id = v_org_id AND deleted_at IS NULL
          AND status IN ('申請中', '已核准', '已駁回')
          AND (v_date_from IS NULL OR created_at::date >= v_date_from)
          AND (v_date_to   IS NULL OR created_at::date <= v_date_to)
          AND (v_acc_arr   IS NULL OR account_code = ANY(v_acc_arr))
        GROUP BY status, COALESCE(currency, 'TWD')
        ORDER BY status, COALESCE(currency, 'TWD')
      ) r
    ),
    'settle_rows', (
      SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT
          CASE status WHEN '已核准' THEN '未送核銷' WHEN '待核銷' THEN '待核銷'
                      WHEN '已核銷' THEN '已核銷'   WHEN '核銷已退回' THEN '核銷被駁回' END AS settle_label,
          COALESCE(currency, 'TWD') AS currency,
          COUNT(*)::int AS count,
          SUM(estimated_amount) AS estimated_sum,
          SUM(actual_amount)    AS actual_sum
        FROM expense_requests
        WHERE organization_id = v_org_id AND deleted_at IS NULL
          AND status IN ('已核准', '待核銷', '已核銷', '核銷已退回')
          AND (v_date_from IS NULL OR created_at::date >= v_date_from)
          AND (v_date_to   IS NULL OR created_at::date <= v_date_to)
          AND (v_acc_arr   IS NULL OR account_code = ANY(v_acc_arr))
        GROUP BY 1, COALESCE(currency, 'TWD')
        ORDER BY 1, COALESCE(currency, 'TWD')
      ) r
    ),
    'accounts', (
      SELECT COALESCE(json_agg(row_to_json(r) ORDER BY r.code), '[]'::json)
      FROM (
        SELECT DISTINCT account_code AS code, COALESCE(account_name, account_code) AS name
        FROM expense_requests
        WHERE organization_id = v_org_id AND deleted_at IS NULL AND account_code IS NOT NULL
        ORDER BY account_code
      ) r
    ),
    'non_exp_rows', (
      SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT ft.name AS template_name, fs.status, COUNT(*)::int AS count
        FROM form_submissions fs
        JOIN form_templates ft ON ft.id = fs.template_id
        WHERE ft.scope = 'business_non_expense'
          AND fs.deleted_at IS NULL          -- form_submissions 有 deleted_at
          AND (fs.organization_id = v_org_id OR ft.organization_id = v_org_id)
          AND (v_date_from IS NULL OR fs.created_at::date >= v_date_from)
          AND (v_date_to   IS NULL OR fs.created_at::date <= v_date_to)
          AND (v_tmpl_arr  IS NULL OR fs.template_id = ANY(v_tmpl_arr))
        GROUP BY ft.name, fs.status ORDER BY ft.name, fs.status
      ) r
    ),
    'non_exp_templates', (
      SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT id, name FROM form_templates
        WHERE scope = 'business_non_expense'
          AND (organization_id = v_org_id OR organization_id IS NULL)
          -- form_templates 沒有 deleted_at，不加此條件
        ORDER BY name
      ) r
    )
  ) INTO v_result;

  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_expense_dashboard(TEXT, TEXT, TEXT, TEXT, TEXT)
  TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
