-- RLS 稽核 第二段:DEFINER 函式 org guard + 收回 anon grant — 2026-07-22
-- ════════════════════════════════════════════════════════════════════════════
-- security_health_check 🟡「DEFINER+anon+收 p_org_id」19 支逐支查(_dump_function_defs):
--  ✅ 11 支 fn_*_analytics 已有 `IF p_org_id <> current_employee_org() THEN RAISE FORBIDDEN`(安全,不動)
--  🔴 3 支用戶可呼叫但無 caller-org 驗證 → 補 guard(body 逐字重現 live,只插 guard):
--     - fn_pos_store_monthly_report / score_rfm_all:傳別組織 id 可撈/改他組織資料
--       (前端都傳自己 org:MonthlyReport=profile.organization_id、Segments=orgId → guard 不擋自己;
--        score_rfm_all 另有 cron 走 service_role → guard 放行 service_role)
--     - manage_position_permission:只檢查 role=admin 沒檢查 org → 他組織 admin 可改本組織職位權限
--  🟡 5 支批次/內部函式前端都沒呼叫,卻開放 anon/authenticated execute → REVOKE
--     (cron 走 service_role、內部呼叫走函式 owner 權限,皆不受影響)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 🔴 score_rfm_all:加 org guard(其餘 body 與 live 逐字一致) ──
CREATE OR REPLACE FUNCTION public.score_rfm_all(p_org_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count INT := 0;
  v_now   TIMESTAMPTZ := now();
  v_12m   TIMESTAMPTZ := v_now - INTERVAL '12 months';
BEGIN
  -- org guard(2026-07-22 RLS稽核):僅 cron(service_role)/super_admin/本組織可存取
  IF NOT (auth.role() = 'service_role' OR public.is_super_admin()
          OR p_org_id = public.current_employee_org()) THEN
    RAISE EXCEPTION 'FORBIDDEN: 不可存取其他組織資料' USING ERRCODE = '42501';
  END IF;

  WITH raw AS (
    SELECT
      m.id                                         AS member_id,
      COALESCE(MAX(mp.purchased_at), m.created_at) AS last_purchase,
      COUNT(mp.id)                                  AS freq,
      COALESCE(SUM(mp.total_amount), 0)             AS monetary
    FROM public.members m
    LEFT JOIN public.member_purchases mp
      ON mp.member_id = m.id
      AND mp.purchased_at >= v_12m
      AND mp.organization_id = p_org_id
    WHERE m.organization_id = p_org_id
    GROUP BY m.id, m.created_at
  ),
  scored AS (
    SELECT
      member_id,
      NTILE(5) OVER (ORDER BY last_purchase DESC) AS r_score,
      NTILE(5) OVER (ORDER BY freq ASC)           AS f_score,
      NTILE(5) OVER (ORDER BY monetary ASC)       AS m_score
    FROM raw
  ),
  labeled AS (
    SELECT
      member_id,
      r_score, f_score, m_score,
      (r_score + f_score + m_score) AS total_score,
      CASE
        WHEN r_score >= 4 AND f_score >= 4 AND m_score >= 4 THEN 'Champions'
        WHEN f_score >= 3 AND m_score >= 3                  THEN 'Loyal'
        WHEN r_score >= 3 AND f_score <= 2                  THEN 'New'
        WHEN r_score <= 2 AND f_score >= 3                  THEN 'At Risk'
        WHEN r_score <= 2 AND f_score <= 2                  THEN 'Lapsed'
        ELSE 'Other'
      END AS segment
    FROM scored
  )
  UPDATE public.members m
  SET
    rfm_r         = l.r_score,
    rfm_f         = l.f_score,
    rfm_m         = l.m_score,
    rfm_score     = l.total_score,
    rfm_segment   = l.segment,
    rfm_scored_at = v_now
  FROM labeled l
  WHERE m.id = l.member_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- ── 🔴 fn_pos_store_monthly_report:加 org guard(其餘 body 與 live 逐字一致) ──
CREATE OR REPLACE FUNCTION public.fn_pos_store_monthly_report(p_org_id bigint, p_year_month date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_month     DATE := date_trunc('month', COALESCE(p_year_month, CURRENT_DATE));
  v_month_end DATE := v_month + INTERVAL '1 month';
  v_stores    jsonb;
  v_top_items jsonb;
  v_total_rev NUMERIC;
  v_total_ord BIGINT;
BEGIN
  -- org guard(2026-07-22 RLS稽核):僅 service_role/super_admin/本組織可存取
  IF NOT (auth.role() = 'service_role' OR public.is_super_admin()
          OR p_org_id = public.current_employee_org()) THEN
    RAISE EXCEPTION 'FORBIDDEN: 不可存取其他組織資料' USING ERRCODE = '42501';
  END IF;

  -- Per-store summary (join pos_payments so revenue = actually collected amount)
  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'revenue' DESC), '[]')
  INTO v_stores
  FROM (
    SELECT jsonb_build_object(
      'store_id',    o.store_id,
      'store_name',  s.name,
      'revenue',     COALESCE(SUM(p.amount), 0),
      'order_count', COUNT(DISTINCT o.id),
      'avg_ticket',  ROUND(COALESCE(AVG(p.amount), 0), 0)
    ) AS row
    FROM pos_orders o
    JOIN pos_payments p ON p.order_id = o.id
    JOIN stores s       ON s.id = o.store_id
    WHERE o.organization_id = p_org_id
      AND o.status = 'paid'
      AND o.paid_at >= v_month
      AND o.paid_at <  v_month_end
    GROUP BY o.store_id, s.name
  ) sub;

  -- Top 20 items sold across all stores this month
  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'revenue' DESC), '[]')
  INTO v_top_items
  FROM (
    SELECT jsonb_build_object(
      'name',    oi.name,
      'qty',     SUM(oi.quantity),
      'revenue', ROUND(SUM(oi.unit_price * oi.quantity), 0)
    ) AS row
    FROM pos_order_items oi
    JOIN pos_orders o ON o.id = oi.order_id
    WHERE o.organization_id = p_org_id
      AND o.status = 'paid'
      AND o.paid_at >= v_month
      AND o.paid_at <  v_month_end
    GROUP BY oi.name
    ORDER BY SUM(oi.unit_price * oi.quantity) DESC
    LIMIT 20
  ) sub;

  -- Org-level totals
  SELECT
    COALESCE(SUM(p.amount), 0),
    COUNT(DISTINCT o.id)
  INTO v_total_rev, v_total_ord
  FROM pos_orders o
  JOIN pos_payments p ON p.order_id = o.id
  WHERE o.organization_id = p_org_id
    AND o.status = 'paid'
    AND o.paid_at >= v_month
    AND o.paid_at <  v_month_end;

  RETURN jsonb_build_object(
    'year_month',   to_char(v_month, 'YYYY-MM'),
    'total_revenue', v_total_rev,
    'total_orders',  v_total_ord,
    'stores',        v_stores,
    'top_items',     v_top_items
  );
END $function$;

-- ── 🔴 manage_position_permission:加 org guard(其餘 body 與 live 逐字一致) ──
CREATE OR REPLACE FUNCTION public.manage_position_permission(p_org_id integer, p_position text, p_perm_id integer, p_action text, p_note text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller      employees;
  v_caller_role TEXT;
BEGIN
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT name INTO v_caller_role FROM roles WHERE id = v_caller.role_id;
  IF v_caller_role NOT IN ('super_admin', 'admin') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  -- org guard(2026-07-22 RLS稽核):非 super_admin 只能管自己組織的職位權限
  IF v_caller_role <> 'super_admin' AND p_org_id IS DISTINCT FROM v_caller.organization_id THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN_ORG');
  END IF;

  IF p_action NOT IN ('grant', 'revoke') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;

  IF p_action = 'revoke' THEN
    DELETE FROM position_permissions
     WHERE organization_id = p_org_id
       AND position = p_position
       AND permission_id = p_perm_id;
    RETURN json_build_object('ok', true, 'action', 'revoked');
  END IF;

  INSERT INTO position_permissions (organization_id, position, permission_id, granted_by, note)
  VALUES (p_org_id, p_position, p_perm_id, v_caller.id, p_note)
  ON CONFLICT (organization_id, position, permission_id) DO UPDATE SET
    granted_by = EXCLUDED.granted_by,
    note       = EXCLUDED.note;

  RETURN json_build_object('ok', true, 'action', 'granted');
END $function$;

-- ── 🟡 批次/內部函式:收回 anon/authenticated execute(cron 走 service_role、內部走 owner 權限) ──
REVOKE EXECUTE ON FUNCTION public.issue_birthday_rewards_monthly(bigint) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.upgrade_member_levels_all(bigint) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._create_task_confirmations_for_step(integer, integer, integer, integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._employee_is_eligible_approver(integer, integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._notify_delegates_for(integer, integer, integer, integer, text, text, integer, text, text, numeric, text, text, text) FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
