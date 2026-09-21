-- 錄取簽核 階段2a:多把關保留 + 候選人狀態機同步 + LINE 通知鉤子 — 2026-07-21
-- 保留 set_offer_approval_chain / advance_offer_approval 名稱(不破壞 web 呼叫端)。
-- 補:①候選人 stage 由 RPC 內同步(建簽呈→錄取簽核中 / 最終通過→已錄取 / 駁回→退回待錄取決定)
--    ②每個時點發 LINE(送簽給當關、推進給下一關、通過/駁回給建立者)。
-- 卡片 flex 在 hr-notify Edge Function 建(type=offer_approval_*);此 migration 只負責觸發。
-- 多把關維持:只當關簽核人/admin/recruit.manage、原子 status 檢查、防重複處理。

-- ── 通知：解析收件人 LINE → 打 hr-notify ──
CREATE OR REPLACE FUNCTION public._notify_offer_approval(p_offer_id int, p_event text, p_approver_id int DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url  CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_anon CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
  v_ol       offer_letters;
  v_cand_nm  text;
  v_target   int;
  v_line     text;
  v_total    int;
BEGIN
  SELECT * INTO v_ol FROM offer_letters WHERE id = p_offer_id;
  IF v_ol.id IS NULL THEN RETURN; END IF;
  SELECT name INTO v_cand_nm FROM candidates WHERE id = v_ol.candidate_id;
  SELECT count(*) INTO v_total FROM offer_approval_steps WHERE offer_id = p_offer_id;

  -- 收件人:送簽/推進→當關簽核人;通過/駁回→建立者
  v_target := CASE WHEN p_event = 'pending' THEN p_approver_id ELSE v_ol.created_by END;
  IF v_target IS NULL THEN RETURN; END IF;

  SELECT line_user_id INTO v_line FROM public.v_employee_line_resolved
   WHERE employee_id = v_target AND line_user_id IS NOT NULL LIMIT 1;
  IF v_line IS NULL THEN RETURN; END IF;   -- 沒綁 LINE 就跳過

  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'employee_id', v_target,
      'type', 'offer_approval_' || p_event,
      'details', jsonb_build_object(
        'offer_id',       v_ol.id,
        'candidate_id',   v_ol.candidate_id,
        'candidate_name', v_cand_nm,
        'position',       v_ol.position,
        'dept',           v_ol.dept,
        'salary',         v_ol.salary,
        'current_step',   v_ol.current_step,
        'total_steps',    v_total,
        'reject_reason',  v_ol.reject_reason
      )
    ),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_anon),
    timeout_milliseconds := 5000
  );
END $$;

-- ── 設定簽核鏈:建步驟 + 候選人→錄取簽核中 + 通知第 1 關 ──
CREATE OR REPLACE FUNCTION public.set_offer_approval_chain(p_offer_id integer, p_approver_ids integer[])
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_org integer;
  v_cand integer;
  v_i   integer;
BEGIN
  IF p_approver_ids IS NULL OR array_length(p_approver_ids, 1) IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_APPROVERS');
  END IF;

  SELECT organization_id, candidate_id INTO v_org, v_cand FROM offer_letters WHERE id = p_offer_id;

  DELETE FROM offer_approval_steps WHERE offer_id = p_offer_id;
  FOR v_i IN 1 .. array_length(p_approver_ids, 1) LOOP
    INSERT INTO offer_approval_steps (offer_id, step_order, approver_id, status, organization_id)
    VALUES (p_offer_id, v_i, p_approver_ids[v_i], '待審', v_org);
  END LOOP;

  UPDATE offer_letters SET status = '待審', current_step = 1 WHERE id = p_offer_id;

  -- 候選人狀態機:→錄取簽核中(system 轉換,RPC 內直寫)
  IF v_cand IS NOT NULL THEN
    UPDATE candidates
       SET stage = '錄取簽核中',
           stage_history = COALESCE(stage_history::jsonb,'[]'::jsonb) || jsonb_build_object('stage','錄取簽核中','changed_at',now()),
           updated_at = now()
     WHERE id = v_cand AND stage <> '錄取簽核中';
  END IF;

  -- 通知第 1 關簽核人
  PERFORM public._notify_offer_approval(p_offer_id, 'pending', p_approver_ids[1]);

  RETURN json_build_object('ok', true, 'steps', array_length(p_approver_ids, 1));
END $function$;

-- ── 推進:多把關 + 候選人狀態同步 + 通知 ──
CREATE OR REPLACE FUNCTION public.advance_offer_approval(p_offer_id integer, p_action text, p_reason text DEFAULT NULL)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id  int;
  v_role       text;
  v_ol         offer_letters;
  v_step       offer_approval_steps;
  v_next       offer_approval_steps;
BEGIN
  SELECT e.id, r.name INTO v_caller_id, v_role
    FROM employees e LEFT JOIN roles r ON r.id = e.role_id
   WHERE e.auth_user_id = auth.uid() LIMIT 1;
  IF v_caller_id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;

  SELECT * INTO v_ol FROM offer_letters WHERE id = p_offer_id;
  IF v_ol.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_ol.status <> '待審' THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_PROCESSED', 'status', v_ol.status);
  END IF;

  -- 當前這關(原子:只認 current_step 且仍待審)
  SELECT * INTO v_step FROM offer_approval_steps
   WHERE offer_id = p_offer_id AND step_order = COALESCE(v_ol.current_step, 1) AND status = '待審';
  IF v_step.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_ACTIVE_STEP'); END IF;

  -- 多把關:當關簽核人 / admin / recruit.manage
  IF NOT (
    v_step.approver_id = v_caller_id
    OR v_role IN ('super_admin', 'admin')
    OR public.current_employee_has_permission('recruit.manage')
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  IF p_action = 'reject' THEN
    UPDATE offer_approval_steps SET status = '已駁回', decided_at = now(), reason = p_reason WHERE id = v_step.id;
    UPDATE offer_letters SET status = '已駁回', reject_reason = p_reason WHERE id = p_offer_id;
    -- 候選人退回「待錄取決定」讓 HR 改人重送或淘汰(不直接淘汰)
    UPDATE candidates
       SET stage = '待錄取決定',
           stage_history = COALESCE(stage_history::jsonb,'[]'::jsonb) || jsonb_build_object('stage','待錄取決定','changed_at',now(),'reason','錄取簽核駁回'),
           updated_at = now()
     WHERE id = v_ol.candidate_id;
    PERFORM public._notify_offer_approval(p_offer_id, 'rejected', NULL);
    RETURN json_build_object('ok', true, 'status', '已駁回');

  ELSIF p_action = 'approve' THEN
    UPDATE offer_approval_steps SET status = '已核准', decided_at = now(), reason = p_reason WHERE id = v_step.id;
    SELECT * INTO v_next FROM offer_approval_steps
     WHERE offer_id = p_offer_id AND step_order = v_step.step_order + 1;
    IF v_next.id IS NOT NULL THEN
      -- 推進到下一關 + 通知
      UPDATE offer_letters SET current_step = v_next.step_order WHERE id = p_offer_id;
      PERFORM public._notify_offer_approval(p_offer_id, 'pending', v_next.approver_id);
      RETURN json_build_object('ok', true, 'status', '待審', 'next_step', v_next.step_order, 'next_approver_id', v_next.approver_id);
    ELSE
      -- 最後一關 → 全部通過 + 候選人→已錄取 + 通知建立者
      UPDATE offer_letters SET status = '已核准', approved_at = now() WHERE id = p_offer_id;
      UPDATE candidates
         SET stage = '已錄取',
             stage_history = COALESCE(stage_history::jsonb, '[]'::jsonb) || jsonb_build_object('stage', '已錄取', 'changed_at', now())
       WHERE id = v_ol.candidate_id;
      PERFORM public._notify_offer_approval(p_offer_id, 'approved', NULL);
      RETURN json_build_object('ok', true, 'status', '已核准', 'final', true);
    END IF;

  ELSE
    RETURN json_build_object('ok', false, 'error', 'BAD_ACTION');
  END IF;
END $function$;

GRANT EXECUTE ON FUNCTION public._notify_offer_approval(int, text, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_offer_approval_chain(integer, integer[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_offer_approval(integer, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
