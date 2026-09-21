-- ════════════════════════════════════════════════════════════════════════════
-- LIFF 留職停薪申請 RPC（讓員工從 LIFF 提報 LOA）
--
-- 之前 LOA 在 Web 跟 LIFF 都沒有 create UI。Web 已有（LeaveOfAbsence.jsx），
-- 補上 LIFF 端的 3 個 RPC + 頁面。
--
-- 對齊 liff_list/upsert/delete_business_trip 的 pattern。
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. liff_list_loa：列出我的留停申請 ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_loa(p_line_user_id text)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(r.*) ORDER BY r.created_at DESC), '[]'::json)
  FROM public.leave_of_absence_requests r
  WHERE r.employee_id = (SELECT id FROM public._liff_resolve_employee(p_line_user_id))
$$;

GRANT EXECUTE ON FUNCTION public.liff_list_loa(text) TO authenticated, anon;

-- ─── 2. liff_upsert_loa：建立或更新（編輯重送）留停申請 ──────────────────────
CREATE OR REPLACE FUNCTION public.liff_upsert_loa(
  p_line_user_id text,
  p_id           int,
  p_payload      json
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp     employees;
  v_chain int;
  new_id  int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RAISE EXCEPTION 'employee not found' USING ERRCODE = '22023';
  END IF;

  -- 找這個 org 的 留停 簽核鏈
  SELECT id INTO v_chain FROM public.approval_chains
   WHERE category = '留停'
     AND organization_id = emp.organization_id
     AND COALESCE(is_active, true) = true
   ORDER BY id DESC LIMIT 1;

  IF p_id IS NULL THEN
    INSERT INTO public.leave_of_absence_requests (
      employee_id, organization_id,
      start_date, planned_end_date,
      reason_type, reason_detail,
      status, approval_chain_id, current_step
    )
    VALUES (
      emp.id, emp.organization_id,
      (p_payload->>'start_date')::date,
      (p_payload->>'planned_end_date')::date,
      p_payload->>'reason_type',
      NULLIF(p_payload->>'reason_detail', ''),
      '申請中', v_chain, 0
    )
    RETURNING id INTO new_id;
  ELSE
    UPDATE public.leave_of_absence_requests SET
      start_date       = (p_payload->>'start_date')::date,
      planned_end_date = (p_payload->>'planned_end_date')::date,
      reason_type      = p_payload->>'reason_type',
      reason_detail    = NULLIF(p_payload->>'reason_detail', ''),
      -- 編輯重送時清掉駁回原因 + 重設 chain 起點
      reject_reason    = NULL,
      status           = '申請中',
      current_step     = 0
    WHERE id = p_id AND employee_id = emp.id
    RETURNING id INTO new_id;
  END IF;

  RETURN json_build_object('id', new_id);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_upsert_loa(text, int, json) TO authenticated, anon;

-- ─── 3. liff_delete_loa：撤回未審核的申請 ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_delete_loa(
  p_line_user_id text,
  p_id           int
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RAISE EXCEPTION 'employee not found' USING ERRCODE = '22023';
  END IF;

  -- 只允許「申請中」的撤回（已核准/已駁回的不能撤）
  UPDATE public.leave_of_absence_requests
     SET status = '已取消'
   WHERE id = p_id
     AND employee_id = emp.id
     AND status = '申請中';

  RETURN json_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_delete_loa(text, int) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
