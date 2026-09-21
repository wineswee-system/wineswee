-- ════════════════════════════════════════════════════════════════════════════
-- 忘刷補登(correction)簽核鏈「切開」— 複製一套專屬分流鏈，不再跟請假/加班共用
-- 2026-07-02
--
-- 現況：correction 依 applicant_type 分流綁 4 條「通用」chain（跟 leave/overtime/
--   resignation/transfer/trip 共用同一套 #16/#31/#32/#45）→ 改任一條，所有表單一起變。
--
-- 做法：對 correction 目前綁的每條 chain 複製一份專屬新 chain（名稱加「忘刷補登-」
--   前綴）+ 複製其 steps，再把 correction 那筆 form_chain_configs 改綁到新 chain。
--   applicant_type 分流不變；新 chain steps = 舊的複製 → 切開當下簽核行為不變。
--   之後改「忘刷補登-」開頭的 chain 不會動到請假/加班。在飛的舊單走 snapshot 不受影響。
--
-- 冪等：LOOP 只處理「correction 還綁著非『忘刷補登-』前綴 chain」的 config；
--   重跑時已切開（綁的是專屬鏈）→ 不再複製。
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r          RECORD;
  v_new_chain INT;
BEGIN
  FOR r IN
    SELECT fcc.id AS cfg_id, fcc.chain_id AS old_chain, ac.name AS old_name
    FROM public.form_chain_configs fcc
    JOIN public.approval_chains ac ON ac.id = fcc.chain_id
    WHERE fcc.form_type = 'correction'
      AND fcc.organization_id = 1
      AND fcc.is_active = TRUE
      AND ac.name NOT LIKE '忘刷補登-%'     -- 冪等：已切開的跳過
  LOOP
    -- 1. 複製 chain 本體（加前綴）
    INSERT INTO public.approval_chains
      (name, description, category, steps_legacy_jsonb, is_active, min_amount, max_amount, organization_id)
    SELECT '忘刷補登-' || name, description, category, steps_legacy_jsonb, is_active, min_amount, max_amount, organization_id
    FROM public.approval_chains WHERE id = r.old_chain
    RETURNING id INTO v_new_chain;

    -- 2. 複製 steps 到新 chain
    INSERT INTO public.approval_chain_steps
      (chain_id, step_order, role_name, role_id, label, organization_id,
       target_type, target_role_id, target_dept_id, target_emp_id, target_store_id, target_section_id, skip_if_no_approver)
    SELECT v_new_chain, step_order, role_name, role_id, label, organization_id,
           target_type, target_role_id, target_dept_id, target_emp_id, target_store_id, target_section_id, skip_if_no_approver
    FROM public.approval_chain_steps WHERE chain_id = r.old_chain
    ORDER BY step_order;

    -- 3. 改綁 correction 這筆 config 到新專屬 chain（applicant_type 不動）
    UPDATE public.form_chain_configs
    SET chain_id = v_new_chain, updated_at = NOW()
    WHERE id = r.cfg_id;

    RAISE NOTICE '忘刷補登切開：% (chain#%) → 忘刷補登-% (chain#%)',
      r.old_name, r.old_chain, r.old_name, v_new_chain;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
