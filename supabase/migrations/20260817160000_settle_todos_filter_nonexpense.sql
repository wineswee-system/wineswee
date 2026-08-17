-- 修:非費用單(is_expense=false,如業績表/合約/意向書/用印)核准即完成、不進核銷驗收,
-- 但 web_list_my_settle_todos 只看 status+settle_assignee/employee,沒濾 is_expense →
-- 這些單被撈進申請人「待驗收」卡住。加 is_expense 濾掉(null 視為費用,保守)。

CREATE OR REPLACE FUNCTION public.web_list_my_settle_todos()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me int := current_employee_id();
BEGIN
  IF v_me IS NULL THEN RETURN '[]'::json; END IF;
  RETURN COALESCE((
    SELECT json_agg(json_build_object(
      'id',               er.id,
      'doc_type',         COALESCE(er.doc_type, 'expense'),
      'title',            er.title,
      'estimated_amount', er.estimated_amount,
      'employee',         er.employee,
      'status',           er.status,
      'settle_unit', CASE
        WHEN er.settle_store_id IS NOT NULL
          THEN (SELECT name FROM stores WHERE id = er.settle_store_id)
        WHEN er.settle_department_id IS NOT NULL
          THEN (SELECT name FROM departments WHERE id = er.settle_department_id)
        ELSE NULL END
    ) ORDER BY er.id DESC)
    FROM expense_requests er
    WHERE er.status IN ('已核准', '核銷已退回')
      AND er.deleted_at IS NULL
      AND COALESCE(er.is_expense, true) = true      -- ★非費用單不進核銷驗收
      AND (
        er.settle_assignee_id = v_me
        OR (er.settle_assignee_id IS NULL AND er.employee_id = v_me)
      )
  ), '[]'::json);
END $function$;
