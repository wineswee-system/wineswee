-- ════════════════════════════════════════════════════════════════════════════
-- get_hr_dashboard：HR 戰情室聚合 RPC（Phase 1 — 到期風險群）
-- 2026-06-16
--
-- 給 TeamDashboard「人·HR」視角用。一支聚合回各區數字（不 over-fetch、不前端撈大表）。
-- Phase 1 區塊：
--   leave_expiry      特休到期風險（leave_type='annual'，剩餘>0，warn 天內到期）
--   permit_expiry     外籍工作證到期（work_permit_expiry，目前多無資料、ready 等填）
--   probation_ending  試用期到期（probation_end）
-- 門檻用參數（預設 30/14、60/30、7），日後可改設定表。
-- org guard：p_org 必須 = current_employee_org()（比照 fn_hr_analytics wrapper）。
--
-- 後續 Phase 會 incremental 加 key（假務其他/簽核效率/薪資成本/流動率…），禁止整支重寫。
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
  v_org    INT  := current_employee_org();
  v_today  date := current_date;
  v_leave  jsonb;
  v_permit jsonb;
  v_prob   jsonb;
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

  RETURN jsonb_build_object(
    'leave_expiry',     v_leave,
    'permit_expiry',    v_permit,
    'probation_ending', v_prob,
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
