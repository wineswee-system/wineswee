-- ════════════════════════════════════════════════════════════════════════════
-- LIFF：員工查自己的「門市業績獎金」（唯讀，只回已發布 finalized）
-- 2026-06-22
--
-- 純 SELECT、加新函式，不動 store_bonus 計算/任何現有邏輯。
-- 只回 store_bonus_monthly.status='finalized' 的月份（草稿不給員工看，會變動）。
-- 回每月：net_bonus(應發) + 損益/達標/記功/稽核扣/補卡扣/custom_adjust/前月補發 明細。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.liff_get_my_store_bonus(
  p_line_user_id text,
  p_limit        int DEFAULT 12
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
    'ok', true,
    'records', (
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.year_month DESC), '[]'::json)
      FROM (
        SELECT
          m.year_month                AS year_month,
          e.net_bonus                 AS net_bonus,
          e.total_bonus               AS total_bonus,
          e.profit_bonus              AS profit_bonus,
          e.target_bonus              AS target_bonus,
          e.merit_bonus               AS merit_bonus,
          e.audit_deduction           AS audit_deduction,
          e.punch_deduction           AS punch_deduction,
          e.custom_adjust             AS custom_adjust,
          e.prev_month_supplement     AS prev_month_supplement,
          e.notes                     AS notes
        FROM public.store_bonus_employee e
        JOIN public.store_bonus_monthly  m ON m.id = e.monthly_id
        WHERE e.employee_id = emp.id
          AND m.status = 'finalized'
        ORDER BY m.year_month DESC
        LIMIT GREATEST(1, COALESCE(p_limit, 12))
      ) t
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_my_store_bonus(text, int) TO anon, authenticated;
