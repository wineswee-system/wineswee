-- ════════════════════════════════════════════════════════════════════════════
-- fn_attrition_impact — 離職員工資產追蹤
-- ----------------------------------------------------------------------------
-- 找近 12 月離職的員工，列出他們名下還沒重新分配的：
--   · 進行中商機（assignee = 他名字）
--   · 待跟進客戶
--   · 沒簽核完的表單 / 任務
-- 用途：HR / 主管交接檢核
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_attrition_impact(
  p_org_id INT,
  p_today  DATE DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'employee_id', emp_id,
    'name', name,
    'dept', dept,
    'terminated_at', terminated_at,
    'open_opportunities', open_opps,
    'open_opp_value', open_opp_value,
    'pending_tasks', pending_tasks
  ) ORDER BY (open_opp_value + pending_tasks * 1000) DESC), '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT
        e.id AS emp_id,
        e.name,
        e.dept,
        COALESCE(e.updated_at, e.created_at)::DATE AS terminated_at,
        COALESCE((
          SELECT COUNT(*) FROM opportunities o
           WHERE o.assignee = e.name
             AND o.stage NOT IN ('贏單', '輸單')
        ), 0) AS open_opps,
        COALESCE((
          SELECT SUM(o.amount) FROM opportunities o
           WHERE o.assignee = e.name
             AND o.stage NOT IN ('贏單', '輸單')
        ), 0) AS open_opp_value,
        COALESCE((
          SELECT COUNT(*) FROM tasks t
           WHERE t.assignee_id = e.id
             AND t.status IN ('未開始', '進行中', '待審核')
        ), 0) AS pending_tasks
        FROM employees e
       WHERE e.organization_id = p_org_id
         AND e.status = '離職'
         AND COALESCE(e.updated_at, e.created_at) >= p_today - INTERVAL '12 months'
    ) s
   WHERE open_opps > 0 OR pending_tasks > 0;

  RETURN jsonb_build_object(
    'today', p_today,
    'items', v_result,
    'generated_at', NOW()
  );
EXCEPTION WHEN undefined_table OR undefined_column THEN
  RETURN jsonb_build_object(
    'today', p_today,
    'items', '[]'::jsonb,
    'error', 'partial_data',
    'generated_at', NOW()
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_attrition_impact(INT, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_attrition_impact(INT, DATE) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
