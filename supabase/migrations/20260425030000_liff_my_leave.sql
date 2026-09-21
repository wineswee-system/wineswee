-- ============================================================
-- LIFF：我的假期額度 + 日曆
--
-- 員工自助場景：
--   1. liff_get_my_leave_balances：查我自己的本年度假期額度（每個假別剩多少）
--   2. liff_list_team_leaves_in_month：查同部門/同店在某月已核准的假
--      （用於請假前看「同事誰那天放假」避開撞期）
--   3. liff_list_my_leaves_in_range：查我自己某段日期內的請假紀錄
--
-- 設計重點：
--   - balances 用 employee_id (INT) 篩，是強型別，不會撞名字
--   - team_leaves 只回「已核准」+「跟我同部門 OR 同店」+ 不顯示原因（隱私）
--   - 不重複造輪子：申請假單已有 liff_create_leave_request（如未來要做就再加）
-- ============================================================

-- ═══ 1. liff_get_my_leave_balances ═══
CREATE OR REPLACE FUNCTION public.liff_get_my_leave_balances(
  p_line_user_id text,
  p_year         int DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp     employees;
  yr      int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  yr := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);

  RETURN json_build_object(
    'ok',   true,
    'year', yr,
    'balances', (
      SELECT COALESCE(json_agg(json_build_object(
        'leave_type',      leave_type,
        'total_days',      total_days,
        'used_days',       used_days,
        'carry_over_days', carry_over_days,
        'remaining',       (total_days + COALESCE(carry_over_days, 0) - used_days),
        'expires_at',      expires_at,
        'expiring_soon',   (expires_at IS NOT NULL AND expires_at <= CURRENT_DATE + INTERVAL '30 days')
      ) ORDER BY leave_type), '[]'::json)
      FROM public.leave_balances
      WHERE employee_id = emp.id AND year = yr
    ),
    'totals', (
      SELECT json_build_object(
        'total',     COALESCE(sum(total_days + COALESCE(carry_over_days, 0)), 0),
        'used',      COALESCE(sum(used_days), 0),
        'remaining', COALESCE(sum(total_days + COALESCE(carry_over_days, 0) - used_days), 0)
      )
      FROM public.leave_balances
      WHERE employee_id = emp.id AND year = yr
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_my_leave_balances(text, int) TO anon, authenticated;


-- ═══ 2. liff_list_team_leaves_in_month ═══
-- 看同事誰那個月放了假，避開撞期
-- 隱私：不回 reason / 申請時間 等敏感欄位
CREATE OR REPLACE FUNCTION public.liff_list_team_leaves_in_month(
  p_line_user_id text,
  p_year_month   text  -- '2026-04' 格式
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp        employees;
  month_start date;
  month_end   date;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 解析 '2026-04' → 2026-04-01 / 2026-04-30
  BEGIN
    month_start := (p_year_month || '-01')::date;
    month_end   := (month_start + INTERVAL '1 month - 1 day')::date;
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_MONTH_FORMAT');
  END;

  RETURN json_build_object(
    'ok',     true,
    'month',  p_year_month,
    'leaves', (
      SELECT COALESCE(json_agg(json_build_object(
        'employee',   l.employee,
        'type',       l.type,
        'start_date', l.start_date,
        'end_date',   l.end_date,
        'days',       l.days,
        'is_me',      (l.employee = emp.name)
      ) ORDER BY l.start_date, l.employee), '[]'::json)
      FROM public.leave_requests l
      WHERE l.status = '已核准'
        AND l.organization_id = emp.organization_id
        AND l.start_date <= month_end
        AND l.end_date   >= month_start
        AND EXISTS (
          SELECT 1 FROM public.employees e2
          WHERE e2.name = l.employee
            -- 同部門 OR 同店 OR 自己
            AND (
              e2.id = emp.id
              OR e2.dept = emp.dept
              OR e2.store_id = emp.store_id
            )
        )
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_team_leaves_in_month(text, text) TO anon, authenticated;


-- ═══ 3. liff_list_my_leaves_in_range ═══
-- 查自己某段日期的請假紀錄（含 pending / approved / rejected）
CREATE OR REPLACE FUNCTION public.liff_list_my_leaves_in_range(
  p_line_user_id text,
  p_from         date,
  p_to           date
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  RETURN json_build_object(
    'ok',     true,
    'leaves', (
      SELECT COALESCE(json_agg(json_build_object(
        'id',           l.id,
        'type',         l.type,
        'start_date',   l.start_date,
        'end_date',     l.end_date,
        'days',         l.days,
        'hours',        l.hours,
        'reason',       l.reason,
        'status',       l.status,
        'approver',     l.approver,
        'reject_reason', l.reject_reason,
        'created_at',   l.created_at
      ) ORDER BY l.start_date DESC), '[]'::json)
      FROM public.leave_requests l
      WHERE l.employee = emp.name
        AND l.start_date <= p_to
        AND l.end_date   >= p_from
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_my_leaves_in_range(text, date, date) TO anon, authenticated;
