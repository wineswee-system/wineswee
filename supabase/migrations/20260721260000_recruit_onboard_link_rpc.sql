-- 階段4b:建員工檔後回寫候選人 → 待報到 — 2026-07-21
-- 建員工檔(新增員工表單)成功後呼叫:綁 candidate.employee_id + stage='待報到'(system 轉換)。
-- SECURITY DEFINER 繞 RLS + 把關(admin/recruit.manage)。之後本人綁 LINE → 4a trigger 轉「已報到」。

CREATE OR REPLACE FUNCTION public.recruit_onboard_link(p_candidate_id int, p_employee_id int)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stage text;
BEGIN
  IF NOT (public.is_admin() OR public.current_employee_has_permission('recruit.manage')) THEN
    RETURN json_build_object('ok', false, 'error', 'NO_PERMISSION');
  END IF;
  SELECT stage INTO v_stage FROM public.candidates WHERE id = p_candidate_id;
  IF v_stage IS NULL THEN RETURN json_build_object('ok', false, 'error', 'CANDIDATE_NOT_FOUND'); END IF;

  UPDATE public.candidates
     SET employee_id = p_employee_id,
         stage = '待報到',
         stage_history = COALESCE(stage_history::jsonb,'[]'::jsonb)
                         || jsonb_build_object('stage','待報到','changed_at',now(),'reason','建員工檔'),
         updated_at = now()
   WHERE id = p_candidate_id;

  RETURN json_build_object('ok', true, 'from', v_stage);
END $$;

GRANT EXECUTE ON FUNCTION public.recruit_onboard_link(int, int) TO authenticated;

NOTIFY pgrst, 'reload schema';
