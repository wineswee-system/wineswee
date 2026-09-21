-- ════════════════════════════════════════════════════════════════════════════
-- 叫貨申請：複製費用簽核鏈 → 叫貨專屬獨立鏈（含每一關步驟）
-- 2026-06-25
--
-- 叫貨原本靠 trigger fallback 借用費用鏈（見 20260625110000）。
-- 使用者要叫貨有「獨立」的鏈，故把費用那三套整組複製一份成叫貨專屬 category：
--   費用申請   → 叫貨申請   （小額/中額/大額三段金額區間都複製）
--   費用核銷   → 叫貨驗收
--   非費用申請 → 叫貨-非費用申請
-- 複製後 trigger 會優先命中叫貨專屬鏈，不再 fallback 到費用鏈 → 兩者從此各自獨立。
--
-- 純加列（新 chain + 新 steps），不改任何現有鏈。idempotent：
--   以 (目標category + min_amount + max_amount + organization_id) 為簽章，
--   已存在就跳過該條，可重複執行不重複建立。
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_map RECORD;
  v_src RECORD;
  v_new_id INT;
BEGIN
  FOR v_map IN
    SELECT * FROM (VALUES
      ('費用申請',   '叫貨申請'),
      ('費用核銷',   '叫貨驗收'),
      ('非費用申請', '叫貨-非費用申請')
    ) AS m(src_cat, tgt_cat)
  LOOP
    FOR v_src IN
      SELECT * FROM public.approval_chains WHERE category = v_map.src_cat
    LOOP
      -- 已複製過就跳過（同金額區間 + 同組織）
      IF EXISTS (
        SELECT 1 FROM public.approval_chains t
         WHERE t.category = v_map.tgt_cat
           AND COALESCE(t.min_amount, -1) = COALESCE(v_src.min_amount, -1)
           AND COALESCE(t.max_amount, -1) = COALESCE(v_src.max_amount, -1)
           AND t.organization_id IS NOT DISTINCT FROM v_src.organization_id
      ) THEN
        CONTINUE;
      END IF;

      INSERT INTO public.approval_chains
        (name, description, category, steps_legacy_jsonb, is_active, min_amount, max_amount, organization_id)
      VALUES
        ('叫貨 - ' || v_src.name, v_src.description, v_map.tgt_cat,
         COALESCE(v_src.steps_legacy_jsonb, '[]'::jsonb), v_src.is_active,
         v_src.min_amount, v_src.max_amount, v_src.organization_id)
      RETURNING id INTO v_new_id;

      INSERT INTO public.approval_chain_steps
        (chain_id, step_order, role_name, role_id, label, organization_id,
         target_type, target_role_id, target_dept_id, target_emp_id, target_store_id, target_section_id)
      SELECT v_new_id, s.step_order, s.role_name, s.role_id, s.label, s.organization_id,
             s.target_type, s.target_role_id, s.target_dept_id, s.target_emp_id, s.target_store_id, s.target_section_id
        FROM public.approval_chain_steps s
       WHERE s.chain_id = v_src.id
       ORDER BY s.step_order;

      RAISE NOTICE '已複製鏈 % (id=%) → % (新 id=%)', v_src.name, v_src.id, v_map.tgt_cat, v_new_id;
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
