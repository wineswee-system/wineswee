-- ================================================
-- LIFF RPC — anon-callable store lookup for clock-in
--
-- Problem: LIFF runs with anon key, but stores RLS only lets
-- `authenticated` read rows. Result: LIFF Clock page sees store=null,
-- falls back to hardcoded 150m radius and "門市未設定座標".
--
-- Solution: SECURITY DEFINER RPC that returns ONLY the store tied to
-- a given employee, with just the fields LIFF needs for clock-in
-- validation. No sensitive data exposed.
-- ================================================

CREATE OR REPLACE FUNCTION public.liff_get_store_for_employee(p_employee_id int)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'id',                     s.id,
    'name',                   s.name,
    'lat',                    s.lat,
    'lng',                    s.lng,
    'clock_radius',           s.clock_radius,
    'allowed_wifi',           s.allowed_wifi,
    'late_tolerance_minutes', s.late_tolerance_minutes,
    'early_clock_minutes',    s.early_clock_minutes,
    'clock_in_method',        s.clock_in_method
  )
  FROM public.stores s
  JOIN public.employees e ON e.store_id = s.id
  WHERE e.id = p_employee_id
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.liff_get_store_for_employee(int) TO anon, authenticated;

COMMENT ON FUNCTION public.liff_get_store_for_employee(int) IS
  'LIFF-only accessor: returns the employee''s assigned store (GPS/WiFi config) '
  'bypassing stores RLS. Whitelisted fields only.';

-- ================================================
-- LIFF RPC — list active stores (for dropdowns in LIFF CRM pages)
-- Scoped to the caller's organization by looking up via line_user_id
-- so different orgs don't see each other's stores.
-- ================================================

CREATE OR REPLACE FUNCTION public.liff_list_stores_for_line_user(p_line_user_id text)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(
    json_build_object(
      'id',   s.id,
      'name', s.name,
      'code', s.store_code,
      'city', s.city
    ) ORDER BY s.name
  ), '[]'::json)
  FROM public.stores s
  WHERE s.status = '營運中'
    AND s.organization_id = (
      SELECT e.organization_id
      FROM public.employees e
      JOIN public.employee_line_accounts ela ON ela.employee_id = e.id
      WHERE ela.line_user_id = p_line_user_id
      LIMIT 1
    )
$$;

GRANT EXECUTE ON FUNCTION public.liff_list_stores_for_line_user(text) TO anon, authenticated;

COMMENT ON FUNCTION public.liff_list_stores_for_line_user(text) IS
  'LIFF-only: returns active stores in the caller''s org. For dropdowns.';
