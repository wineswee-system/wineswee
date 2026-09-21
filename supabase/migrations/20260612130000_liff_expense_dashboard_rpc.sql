-- ════════════════════════════════════════════════════════════════════════════
-- liff_expense_dashboard：LIFF 儀表板 費用 / 非費用 tab 資料 RPC
--
-- 回傳：
--   expense_rows   — expense_requests 按 status+currency 彙總（申請區塊）
--   settle_rows    — expense_requests 按 settle status+currency 彙總（核銷區塊）
--   accounts       — 科目清單（供 multi-select 篩選器）
--   non_exp_rows   — form_submissions scope=business_non_expense 按 status+template 彙總
--   non_exp_templates — 非費用模板清單（供篩選器）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.liff_expense_dashboard(
  p_line_user_id  TEXT,
  p_date_from     DATE    DEFAULT NULL,
  p_date_to       DATE    DEFAULT NULL,
  p_account_codes TEXT[]  DEFAULT NULL,
  p_template_ids  INT[]   DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp     employees;
  v_org_id  INT;
  v_result  JSON;
BEGIN
  SELECT * INTO v_emp FROM public._liff_resolve_employee(p_line_user_id);
  IF v_emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;
  v_org_id := v_emp.organization_id;

  -- 只有 manager / admin / super_admin 可查
  IF NOT EXISTS (
    SELECT 1 FROM roles r
    WHERE r.id = v_emp.role_id
      AND r.name IN ('super_admin', 'admin', 'manager')
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  SELECT json_build_object(
    'ok', true,

    -- ── 費用：申請區塊（申請中/已核准/已駁回）──────────────────────────
    'expense_rows', (
      SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT
          status,
          COALESCE(currency, 'TWD') AS currency,
          COUNT(*)::int             AS count,
          SUM(estimated_amount)     AS estimated_sum
        FROM expense_requests
        WHERE organization_id = v_org_id
          AND deleted_at IS NULL
          AND status IN ('申請中', '已核准', '已駁回')
          AND (p_date_from IS NULL OR created_at::date >= p_date_from)
          AND (p_date_to   IS NULL OR created_at::date <= p_date_to)
          AND (p_account_codes IS NULL
               OR array_length(p_account_codes, 1) IS NULL
               OR account_code = ANY(p_account_codes))
        GROUP BY status, COALESCE(currency, 'TWD')
        ORDER BY status, currency
      ) r
    ),

    -- ── 費用：核銷區塊（未送核銷/待核銷/已核銷/核銷被駁回）────────────
    'settle_rows', (
      SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT
          CASE status
            WHEN '已核准'    THEN '未送核銷'
            WHEN '待核銷'    THEN '待核銷'
            WHEN '已核銷'    THEN '已核銷'
            WHEN '核銷已退回' THEN '核銷被駁回'
          END                      AS settle_label,
          COALESCE(currency, 'TWD') AS currency,
          COUNT(*)::int             AS count,
          SUM(estimated_amount)     AS estimated_sum,
          SUM(actual_amount)        AS actual_sum
        FROM expense_requests
        WHERE organization_id = v_org_id
          AND deleted_at IS NULL
          AND status IN ('已核准', '待核銷', '已核銷', '核銷已退回')
          AND (p_date_from IS NULL OR created_at::date >= p_date_from)
          AND (p_date_to   IS NULL OR created_at::date <= p_date_to)
          AND (p_account_codes IS NULL
               OR array_length(p_account_codes, 1) IS NULL
               OR account_code = ANY(p_account_codes))
        GROUP BY 1, COALESCE(currency, 'TWD')
        ORDER BY 1, currency
      ) r
    ),

    -- ── 科目清單 ──────────────────────────────────────────────────────
    'accounts', (
      SELECT COALESCE(
        json_agg(DISTINCT jsonb_build_object(
          'code', account_code,
          'name', COALESCE(account_name, account_code)
        ) ORDER BY jsonb_build_object(
          'code', account_code,
          'name', COALESCE(account_name, account_code)
        )),
        '[]'::json
      )
      FROM expense_requests
      WHERE organization_id = v_org_id
        AND deleted_at IS NULL
        AND account_code IS NOT NULL
    ),

    -- ── 非費用：申請狀態（按 template + status 彙總）─────────────────
    'non_exp_rows', (
      SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT
          ft.name AS template_name,
          fs.status,
          COUNT(*)::int AS count
        FROM form_submissions fs
        JOIN form_templates ft ON ft.id = fs.template_id
        WHERE ft.scope = 'business_non_expense'
          AND fs.deleted_at IS NULL
          AND (fs.organization_id = v_org_id OR ft.organization_id = v_org_id)
          AND (p_date_from IS NULL OR fs.created_at::date >= p_date_from)
          AND (p_date_to   IS NULL OR fs.created_at::date <= p_date_to)
          AND (p_template_ids IS NULL
               OR array_length(p_template_ids, 1) IS NULL
               OR fs.template_id = ANY(p_template_ids))
        GROUP BY ft.name, fs.status
        ORDER BY ft.name, fs.status
      ) r
    ),

    -- ── 非費用：模板清單（供篩選器）──────────────────────────────────
    'non_exp_templates', (
      SELECT COALESCE(json_agg(row_to_json(r) ORDER BY r.name), '[]'::json)
      FROM (
        SELECT id, name
        FROM form_templates
        WHERE scope = 'business_non_expense'
          AND (organization_id = v_org_id OR organization_id IS NULL)
          AND deleted_at IS NULL
        ORDER BY name
      ) r
    )
  ) INTO v_result;

  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_expense_dashboard(TEXT, DATE, DATE, TEXT[], INT[])
  TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
