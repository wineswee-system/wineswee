-- 結薪前查:本月「時數假」影響清單 — 2026-07-30
-- ════════════════════════════════════════════════════════════════════════════
-- step3(部分請假改判遲到早退)只影響「有時數假的員工-日」。這支列出該月全部這類日子
--   + 班表/打卡/淨請假時數,讓管理員入帳前一眼掃過、核對遲到早退合不合理。
-- admin only、org-scoped、純唯讀。OUT 參數用 o_ 前綴避免與表欄位撞名(RETURNS TABLE 陷阱)。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.preview_partial_leave_impact(p_period text)
RETURNS TABLE(
  o_employee_id   int,
  o_employee      text,
  o_store         text,
  o_leave_date    date,
  o_leave_start   text,
  o_leave_end     text,
  o_net_hours     numeric,   -- 扣休息後淨請假時數
  o_clock_in      text,
  o_clock_out     text,
  o_shift_start   text,
  o_shift_end     text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_org int := public.current_user_org_id();
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION '僅管理員可查';
  END IF;

  RETURN QUERY
  SELECT
    lr.employee_id,
    lr.employee,
    st.name,
    lr.start_date,
    lr.start_time::text,
    lr.end_time::text,
    public._leave_net_hours(lr.employee_id, lr.start_date, lr.start_time, lr.end_time),
    ar.clock_in::text,
    ar.clock_out::text,
    s.actual_start::text,
    s.actual_end::text
  FROM public.leave_requests lr
  LEFT JOIN public.attendance_records ar
         ON ar.employee_id = lr.employee_id AND ar.date = lr.start_date
  LEFT JOIN public.schedules s
         ON s.employee_id = lr.employee_id AND s.date = lr.start_date
  LEFT JOIN public.employees e ON e.id = lr.employee_id
  LEFT JOIN public.stores st ON st.id = e.store_id
  WHERE lr.status = '已核准'
    AND lr.deleted_at IS NULL
    AND lr.start_time IS NOT NULL                       -- 只有時數假會被 step3 影響
    AND to_char(lr.start_date, 'YYYY-MM') = p_period
    AND (v_org IS NULL OR lr.organization_id = v_org)
  ORDER BY lr.start_date, lr.employee;
END $function$;

GRANT EXECUTE ON FUNCTION public.preview_partial_leave_impact(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
