-- 錄取動態簽核鏈 階段1:DB 骨架 — 2026-07-15
-- 需求(甲):每張錄取自己挑簽核人 + 排順序(多關),每張可不同。
-- 做法:專屬新表 offer_approval_steps 存挑的人,不動共用 chain resolver(避免動到在飛的請假/費用鏈)。
-- 純加法。offer_letters.current_step 當「目前進行到第幾關」指標。

-- ── 動態簽核步驟表 ──
CREATE TABLE IF NOT EXISTS public.offer_approval_steps (
  id              serial PRIMARY KEY,
  offer_id        integer NOT NULL REFERENCES public.offer_letters(id) ON DELETE CASCADE,
  step_order      integer NOT NULL,                 -- 1,2,3...
  approver_id     integer REFERENCES public.employees(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT '待審',      -- 待審 | 已核准 | 已駁回
  decided_at      timestamptz,
  reason          text,
  organization_id integer,
  created_at      timestamptz DEFAULT now(),
  UNIQUE (offer_id, step_order)
);
CREATE INDEX IF NOT EXISTS idx_offer_approval_steps_offer ON public.offer_approval_steps(offer_id);
CREATE INDEX IF NOT EXISTS idx_offer_approval_steps_approver ON public.offer_approval_steps(approver_id, status);

ALTER TABLE public.offer_approval_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS offer_approval_steps_staff ON public.offer_approval_steps;
CREATE POLICY offer_approval_steps_staff ON public.offer_approval_steps
  FOR ALL USING (public.is_staff()) WITH CHECK (public.is_staff());

-- ── 設定/重設某張錄取的簽核鏈(挑的人+順序)──
-- 建立錄取後呼叫:傳 approver_ids 陣列(依序),清掉舊步驟重建,current_step 歸 1、status 待審。
CREATE OR REPLACE FUNCTION public.set_offer_approval_chain(p_offer_id integer, p_approver_ids integer[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org integer;
  v_i   integer;
BEGIN
  IF p_approver_ids IS NULL OR array_length(p_approver_ids, 1) IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_APPROVERS');
  END IF;

  SELECT organization_id INTO v_org FROM offer_letters WHERE id = p_offer_id;

  DELETE FROM offer_approval_steps WHERE offer_id = p_offer_id;
  FOR v_i IN 1 .. array_length(p_approver_ids, 1) LOOP
    INSERT INTO offer_approval_steps (offer_id, step_order, approver_id, status, organization_id)
    VALUES (p_offer_id, v_i, p_approver_ids[v_i], '待審', v_org);
  END LOOP;

  UPDATE offer_letters SET status = '待審', current_step = 1 WHERE id = p_offer_id;
  RETURN json_build_object('ok', true, 'steps', array_length(p_approver_ids, 1));
END $function$;

-- ── 當關簽核人核准/駁回,推進到下一關或結案 ──
CREATE OR REPLACE FUNCTION public.advance_offer_approval(p_offer_id integer, p_action text, p_reason text DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

  -- 目前這關
  SELECT * INTO v_step FROM offer_approval_steps
   WHERE offer_id = p_offer_id AND step_order = COALESCE(v_ol.current_step, 1) AND status = '待審';
  IF v_step.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_ACTIVE_STEP'); END IF;

  -- 把關:當關簽核人 / admin / recruit.manage
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
    UPDATE candidates SET hire_status = '已駁回' WHERE id = v_ol.candidate_id;
    RETURN json_build_object('ok', true, 'status', '已駁回');

  ELSIF p_action = 'approve' THEN
    UPDATE offer_approval_steps SET status = '已核准', decided_at = now(), reason = p_reason WHERE id = v_step.id;
    -- 下一關?
    SELECT * INTO v_next FROM offer_approval_steps
     WHERE offer_id = p_offer_id AND step_order = v_step.step_order + 1;
    IF v_next.id IS NOT NULL THEN
      UPDATE offer_letters SET current_step = v_next.step_order WHERE id = p_offer_id;
      RETURN json_build_object('ok', true, 'status', '待審', 'next_step', v_next.step_order, 'next_approver_id', v_next.approver_id);
    ELSE
      -- 最後一關 → 全部通過
      UPDATE offer_letters SET status = '已核准', approved_at = now() WHERE id = p_offer_id;
      UPDATE candidates
         SET stage = '已錄取', hire_status = '已核准',
             stage_history = COALESCE(stage_history::jsonb, '[]'::jsonb)
                             || jsonb_build_object('stage', '已錄取', 'changed_at', now())
       WHERE id = v_ol.candidate_id;
      RETURN json_build_object('ok', true, 'status', '已核准', 'final', true);
    END IF;

  ELSE
    RETURN json_build_object('ok', false, 'error', 'BAD_ACTION');
  END IF;
END $function$;

GRANT EXECUTE ON FUNCTION public.set_offer_approval_chain(integer, integer[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_offer_approval(integer, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
