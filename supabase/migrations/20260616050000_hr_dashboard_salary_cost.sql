-- ════════════════════════════════════════════════════════════════════════════
-- get_hr_dashboard：加 salary_cost（Phase 2 — 薪資成本區，role 鎖）
-- 2026-06-16
--
-- 在既有 get_hr_dashboard 加一個 key：salary_cost
--   只有「admin/super_admin 或有 salary.view_all 權限」者才回（其餘人這 key 為 null → 前端不顯示）
--   內容：最近有資料月份的人事成本(net 合計)、vs 上月、加班費合計、各部門成本 top
-- 其餘 body（到期風險群）與 20260616040000 逐字相同，只新增 salary 段 + RETURN 加 key。
-- idempotent。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_hr_dashboard(
  p_org            INT,
  p_leave_warn     INT DEFAULT 30,
  p_leave_crit     INT DEFAULT 14,
  p_permit_warn    INT DEFAULT 60,
  p_permit_crit    INT DEFAULT 30,
  p_probation_warn INT DEFAULT 7
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org       INT  := current_employee_org();
  v_today     date := current_date;
  v_leave     jsonb;
  v_permit    jsonb;
  v_prob      jsonb;
  v_salary    jsonb := NULL;
  v_cur_month text;
  v_prev_month text;
BEGIN
  IF p_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'FORBIDDEN: 不可存取其他組織資料';
  END IF;

  -- 特休到期風險（annual；剩餘 = total + carry_over - used > 0；未來 warn 天內到期）
  WITH lb AS (
    SELECT b.employee_id, e.name,
           (COALESCE(b.total_days,0) + COALESCE(b.carry_over_days,0) - COALESCE(b.used_days,0)) AS rem,
           b.expires_at
    FROM leave_balances b
    JOIN employees e ON e.id = b.employee_id AND e.status = '在職'
    WHERE b.organization_id = p_org
      AND b.leave_type = 'annual'
      AND b.expires_at IS NOT NULL
      AND b.expires_at >= v_today
      AND b.expires_at <= v_today + p_leave_warn
      AND (COALESCE(b.total_days,0) + COALESCE(b.carry_over_days,0) - COALESCE(b.used_days,0)) > 0
  )
  SELECT jsonb_build_object(
    'people',     COUNT(DISTINCT employee_id),
    'crit',       COUNT(DISTINCT employee_id) FILTER (WHERE expires_at <= v_today + p_leave_crit),
    'total_days', COALESCE(ROUND(SUM(rem), 1), 0),
    'list',       COALESCE(jsonb_agg(jsonb_build_object(
                    'name', name, 'days', ROUND(rem, 1), 'expires_at', expires_at
                  ) ORDER BY expires_at), '[]'::jsonb)
  ) INTO v_leave FROM lb;

  -- 外籍工作證到期（warn 天內）
  WITH wp AS (
    SELECT name, work_permit_expiry AS exp
    FROM employees
    WHERE organization_id = p_org AND status = '在職'
      AND work_permit_expiry IS NOT NULL
      AND work_permit_expiry >= v_today
      AND work_permit_expiry <= v_today + p_permit_warn
  )
  SELECT jsonb_build_object(
    'people', COUNT(*),
    'crit',   COUNT(*) FILTER (WHERE exp <= v_today + p_permit_crit),
    'list',   COALESCE(jsonb_agg(jsonb_build_object('name', name, 'expires_at', exp) ORDER BY exp), '[]'::jsonb)
  ) INTO v_permit FROM wp;

  -- 試用期到期（warn 天內）
  WITH pb AS (
    SELECT name, probation_end AS pend
    FROM employees
    WHERE organization_id = p_org AND status = '在職'
      AND probation_end IS NOT NULL
      AND probation_end >= v_today
      AND probation_end <= v_today + p_probation_warn
  )
  SELECT jsonb_build_object(
    'people', COUNT(*),
    'list',   COALESCE(jsonb_agg(jsonb_build_object('name', name, 'end', pend) ORDER BY pend), '[]'::jsonb)
  ) INTO v_prob FROM pb;

  -- ── 薪資成本（只給 admin/super_admin 或有 salary.view_all 權限者）──
  IF current_employee_role() IN ('admin','super_admin') OR public.current_user_can('salary.view_all') THEN
    SELECT max(month) INTO v_cur_month FROM salary_records WHERE organization_id = p_org;
    IF v_cur_month IS NOT NULL THEN
      v_prev_month := to_char(to_date(v_cur_month || '-01','YYYY-MM-DD') - interval '1 month', 'YYYY-MM');
      SELECT jsonb_build_object(
        'month',      v_cur_month,
        'this_total', COALESCE(SUM(net_salary)   FILTER (WHERE month = v_cur_month), 0),
        'last_total', COALESCE(SUM(net_salary)   FILTER (WHERE month = v_prev_month), 0),
        'ot_total',   COALESCE(SUM(overtime_pay) FILTER (WHERE month = v_cur_month), 0)
      ) INTO v_salary
      FROM salary_records
      WHERE organization_id = p_org AND month IN (v_cur_month, v_prev_month);

      SELECT v_salary || jsonb_build_object('by_dept',
        COALESCE(jsonb_agg(d ORDER BY (d->>'total')::numeric DESC), '[]'::jsonb))
      INTO v_salary
      FROM (
        SELECT jsonb_build_object(
                 'dept',  COALESCE(NULLIF(e.dept,''), '(未分部門)'),
                 'total', SUM(sr.net_salary)
               ) AS d
        FROM salary_records sr
        JOIN employees e ON e.id = sr.employee_id
        WHERE sr.organization_id = p_org AND sr.month = v_cur_month
        GROUP BY COALESCE(NULLIF(e.dept,''), '(未分部門)')
      ) x;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'leave_expiry',     v_leave,
    'permit_expiry',    v_permit,
    'probation_ending', v_prob,
    'salary_cost',      v_salary,
    'thresholds', jsonb_build_object(
      'leave_warn', p_leave_warn, 'leave_crit', p_leave_crit,
      'permit_warn', p_permit_warn, 'permit_crit', p_permit_crit,
      'probation_warn', p_probation_warn
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.get_hr_dashboard(INT,INT,INT,INT,INT,INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hr_dashboard(INT,INT,INT,INT,INT,INT) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
