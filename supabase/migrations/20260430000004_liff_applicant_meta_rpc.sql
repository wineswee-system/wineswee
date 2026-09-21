-- ============================================================
-- New RPC: liff_get_applicant_meta
--
-- LIFF approvalNotify.js currently does 3 direct table queries
-- (employees / stores / departments) to build the approver-side
-- LINE card. All 3 are blocked by RLS for anon (LIFF context),
-- so the notification falls back to an anonymous applicant label.
--
-- This RPC returns {name, store_name, department_name} in one
-- SECURITY DEFINER call, bypassing RLS.
-- ============================================================

CREATE OR REPLACE FUNCTION public.liff_get_applicant_meta(p_emp_id int)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'id',              e.id,
    'name',            e.name,
    'store_name',      s.name,
    'department_name', d.name
  )
  FROM public.employees e
  LEFT JOIN public.stores      s ON s.id = e.store_id
  LEFT JOIN public.departments d ON d.id = e.department_id
  WHERE e.id = p_emp_id
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.liff_get_applicant_meta(int) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
