-- ================================================
-- LIFF RPC — anon-callable employee lookup
-- Bypasses RLS via SECURITY DEFINER so the LIFF app
-- (running with anon key) can resolve a LINE userId
-- to its bound employee without exposing the
-- employees / employee_line_accounts tables directly.
-- ================================================

CREATE OR REPLACE FUNCTION public.liff_get_employee_by_line_user(p_line_user_id text)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT row_to_json(e.*)
  FROM employees e
  JOIN employee_line_accounts ela ON ela.employee_id = e.id
  WHERE ela.line_user_id = p_line_user_id
    AND e.status = '在職'
  ORDER BY ela.is_primary DESC, ela.id ASC
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.liff_get_employee_by_line_user(text) TO anon, authenticated;
