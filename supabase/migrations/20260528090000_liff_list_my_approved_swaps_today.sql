-- ── LIFF: list my approved shift_swaps for today ─────────────────────────────
-- shift_swaps RLS enabled + 兩個 policy 都只給 authenticated；anon 直查會空回。
-- LIFF Clock.jsx 的「換班模式」打卡要列出今日已核准 swaps，必須走
-- SECURITY DEFINER RPC 繞過 RLS。
--
-- Pattern：跟 liff_list_my_shift_swaps / liff_respond_shift_swap_peer 對齊，
-- 用 _liff_resolve_employee(p_line_user_id) 解人，避免接受任意 employee_id。

BEGIN;

DROP FUNCTION IF EXISTS public.liff_list_my_approved_swaps_today(text);

CREATE OR REPLACE FUNCTION public.liff_list_my_approved_swaps_today(
  p_line_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',              ss.id,
      'swap_date',       ss.swap_date,
      'requester_id',    ss.requester_id,
      'target_id',       ss.target_id,
      'requester_shift', ss.requester_shift,
      'target_shift',    ss.target_shift,
      'requester',       ss.requester,
      'target',          ss.target
    ) ORDER BY ss.id DESC)
    FROM public.shift_swaps ss
   WHERE ss.swap_date     = CURRENT_DATE
     AND ss.status        = '已核准'
     AND ss.organization_id = emp.organization_id
     AND (ss.requester_id = emp.id OR ss.target_id = emp.id)
     AND ss.deleted_at IS NULL
  ), '[]'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_my_approved_swaps_today(text) TO authenticated, anon;

COMMIT;
