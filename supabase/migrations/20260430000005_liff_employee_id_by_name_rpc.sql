-- ============================================================
-- New RPC: liff_get_employee_id_by_name
--
-- LIFF TaskConfirmations.jsx and similar flows need to find an
-- employee_id from a name string (e.g., task_assignee TEXT) so they
-- can pass it to other RPCs. Direct .from('employees').eq('name',...)
-- is blocked by RLS for anon.
--
-- Returns the employee.id for the given name, scoped to active
-- employees. Returns NULL when not found / multiple matches /
-- name is empty.
-- ============================================================

CREATE OR REPLACE FUNCTION public.liff_get_employee_id_by_name(p_name text)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.employees
  WHERE name = p_name
    AND status = '在職'
  ORDER BY id
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.liff_get_employee_id_by_name(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
