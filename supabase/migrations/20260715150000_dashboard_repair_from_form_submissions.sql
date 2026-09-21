-- 儀表板門市報修改讀 form_submissions（門市報修申請單）— 2026-07-15
-- 問題:repair_rows 讀 store_repair_requests(LIFF維修工單,全庫0筆沒人用),
--   但實際報修單是自訂表單 form_templates「門市報修申請單」+ form_submissions(14筆)。
-- 修:repair_rows 改撈 form_submissions,join form_templates name ILIKE '%報修%',org+deleted_at+日期過濾。
-- 狀態變成申請單制(申請中/已核准/已駁回/已取消),前端桶同步改。純換來源,idempotent。

CREATE OR REPLACE FUNCTION public.liff_expense_dashboard(p_line_user_id text, p_date_from text DEFAULT NULL::text, p_date_to text DEFAULT NULL::text, p_account_codes text DEFAULT NULL::text, p_template_ids text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp        employees;
  v_org_id     INT;
  v_result     JSON;
  v_date_from  DATE;
  v_date_to    DATE;
  v_acc_arr    TEXT[];
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

  SELECT json_build_object(
    'ok', true,

    -- ── 費用申請（doc_type='expense', is_expense=true）──────────────────────
    'exp_rows', (
      SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT
          status,
          COALESCE(currency, 'TWD') AS currency,
          COUNT(*)::int             AS count,
          SUM(estimated_amount)     AS estimated_sum,
          SUM(actual_amount)        AS actual_sum
        FROM expense_requests
        WHERE organization_id = v_org_id AND deleted_at IS NULL
          AND doc_type = 'expense' AND is_expense = true
          AND (v_date_from IS NULL OR created_at::date >= v_date_from)
          AND (v_date_to   IS NULL OR created_at::date <= v_date_to)
          AND (v_acc_arr   IS NULL OR account_code = ANY(v_acc_arr))
        GROUP BY status, COALESCE(currency, 'TWD')
      ) r
    ),

    -- ── 非費用申請（doc_type='expense', is_expense=false）──────────────────
    'nonexp_rows', (
      SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT status, COUNT(*)::int AS count
        FROM expense_requests
        WHERE organization_id = v_org_id AND deleted_at IS NULL
          AND doc_type = 'expense' AND is_expense = false
          AND (v_date_from IS NULL OR created_at::date >= v_date_from)
          AND (v_date_to   IS NULL OR created_at::date <= v_date_to)
        GROUP BY status
      ) r
    ),

    -- ── 叫貨申請（doc_type='order'，不分 is_expense）──────────────────────
    'order_rows', (
      SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT status, COUNT(*)::int AS count
        FROM expense_requests
        WHERE organization_id = v_org_id AND deleted_at IS NULL
          AND doc_type = 'order'
          AND (v_date_from IS NULL OR created_at::date >= v_date_from)
          AND (v_date_to   IS NULL OR created_at::date <= v_date_to)
        GROUP BY status
      ) r
    ),

    -- ── 門市報修（form_submissions：門市報修申請單，走簽核鏈的自訂表單）──────────
    -- 舊的 store_repair_requests 工單表全庫 0 筆、沒人用;報修單其實是自訂表單。
    'repair_rows', (
      SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT fs.status, COUNT(*)::int AS count
        FROM form_submissions fs
        JOIN form_templates ft ON ft.id = fs.template_id
        WHERE fs.organization_id = v_org_id
          AND fs.deleted_at IS NULL
          AND ft.name ILIKE '%報修%'
          AND (v_date_from IS NULL OR fs.created_at::date >= v_date_from)
          AND (v_date_to   IS NULL OR fs.created_at::date <= v_date_to)
        GROUP BY fs.status
      ) r
    ),

    -- ── 經常性費用（expenses）────────────────────────────────────────────────
    'regular_expense_rows', (
      SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT status, COUNT(*)::int AS count, SUM(amount) AS amount_sum
        FROM expenses
        WHERE organization_id = v_org_id
          AND (v_date_from IS NULL OR created_at::date >= v_date_from)
          AND (v_date_to   IS NULL OR created_at::date <= v_date_to)
        GROUP BY status
      ) r
    ),

    -- ── 商品調撥（goods_transfer_requests）──────────────────────────────────
    'transfer_rows', (
      SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT status, COUNT(*)::int AS count
        FROM goods_transfer_requests
        WHERE organization_id = v_org_id AND deleted_at IS NULL
          AND (v_date_from IS NULL OR created_at::date >= v_date_from)
          AND (v_date_to   IS NULL OR created_at::date <= v_date_to)
        GROUP BY status
      ) r
    ),

    -- ── 門市稽核（store_audits）──────────────────────────────────────────────
    'audit_rows', (
      SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT status, COUNT(*)::int AS count
        FROM store_audits
        WHERE organization_id = v_org_id
          AND (v_date_from IS NULL OR created_at::date >= v_date_from)
          AND (v_date_to   IS NULL OR created_at::date <= v_date_to)
        GROUP BY status
      ) r
    ),

    -- ── 跨部門工單（work_orders）──────────────────────────────────────────────
    'work_order_rows', (
      SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT status, COUNT(*)::int AS count
        FROM work_orders
        WHERE organization_id = v_org_id AND deleted_at IS NULL
          AND (v_date_from IS NULL OR created_at::date >= v_date_from)
          AND (v_date_to   IS NULL OR created_at::date <= v_date_to)
        GROUP BY status
      ) r
    ),

    -- ── 科目清單（費用申請用）────────────────────────────────────────────────
    'accounts', (
      SELECT COALESCE(json_agg(row_to_json(r) ORDER BY r.code), '[]'::json)
      FROM (
        SELECT DISTINCT account_code AS code, COALESCE(account_name, account_code) AS name
        FROM expense_requests
        WHERE organization_id = v_org_id AND deleted_at IS NULL
          AND is_expense = true AND account_code IS NOT NULL
        ORDER BY account_code
      ) r
    )
  ) INTO v_result;

  RETURN v_result;
END $function$;

NOTIFY pgrst, 'reload schema';
