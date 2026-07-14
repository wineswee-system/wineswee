-- 職位拖曳排序 — 2026-07-14
-- 傳入排好序的 id 陣列,依序把 sort_order 設成 10,20,30...(留間隙)。admin 擋、org 限定。idempotent。

CREATE OR REPLACE FUNCTION public.reorder_positions(p_ids int[])
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org int; i int;
BEGIN
  IF NOT public.is_admin() THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  v_org := COALESCE((SELECT organization_id FROM public.employees WHERE id = public.current_employee_id()), 1);
  FOR i IN 1 .. COALESCE(array_length(p_ids, 1), 0) LOOP
    UPDATE public.positions
       SET sort_order = i * 10, updated_at = now()
     WHERE id = p_ids[i] AND organization_id = v_org;
  END LOOP;
  RETURN json_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.reorder_positions(int[]) TO authenticated;
NOTIFY pgrst, 'reload schema';
