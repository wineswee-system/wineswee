-- ════════════════════════════════════════════════════════════════════════════
-- 商品調撥 — Seed 3 條 default chains（每個 org）
--
--   1. 商品調撥-申請-倉↔門市  ：直屬主管 → 倉儲主管
--   2. 商品調撥-申請-門市↔門市 ：調出店長 → 調入店督導 → 調出店督導
--      （申請人=調入店長為 submission，不在 chain 內）
--   3. 商品調撥-驗收             ：直屬主管
--
-- 若 org 已有同名 chain（之前手動建過）→ 跳過，不重複建。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_org RECORD;
  v_chain_id INT;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP

    -- ─── Chain 1: 申請-倉↔門市 ───────────────────────────────────────────
    SELECT id INTO v_chain_id
      FROM approval_chains
     WHERE organization_id = v_org.id AND name = '商品調撥-申請-倉↔門市';

    IF v_chain_id IS NULL THEN
      INSERT INTO approval_chains (organization_id, name, description)
      VALUES (v_org.id, '商品調撥-申請-倉↔門市', '總倉↔門市調撥申請鏈：直屬主管 → 倉儲主管')
      RETURNING id INTO v_chain_id;

      INSERT INTO approval_chain_steps (chain_id, step_order, role_name, label, target_type, organization_id) VALUES
        (v_chain_id, 0, 'supervisor',         '直屬主管',  'applicant_supervisor', v_org.id),
        (v_chain_id, 1, 'warehouse_supervisor', '倉儲主管', 'warehouse_supervisor', v_org.id);
    END IF;

    -- ─── Chain 2: 申請-門市↔門市 ─────────────────────────────────────────
    SELECT id INTO v_chain_id
      FROM approval_chains
     WHERE organization_id = v_org.id AND name = '商品調撥-申請-門市↔門市';

    IF v_chain_id IS NULL THEN
      INSERT INTO approval_chains (organization_id, name, description)
      VALUES (v_org.id, '商品調撥-申請-門市↔門市',
              '門市↔門市調撥申請鏈：調出店長 → 調入店督導 → 調出店督導（申請人=調入店長為發起人，不在簽核鏈內）')
      RETURNING id INTO v_chain_id;

      INSERT INTO approval_chain_steps (chain_id, step_order, role_name, label, target_type, organization_id) VALUES
        (v_chain_id, 0, 'transfer_out_store_manager',    '調出店長',   'transfer_out_store_manager',    v_org.id),
        (v_chain_id, 1, 'transfer_in_store_supervisor',  '調入店督導', 'transfer_in_store_supervisor',  v_org.id),
        (v_chain_id, 2, 'transfer_out_store_supervisor', '調出店督導', 'transfer_out_store_supervisor', v_org.id);
    END IF;

    -- ─── Chain 3: 驗收 ───────────────────────────────────────────────────
    SELECT id INTO v_chain_id
      FROM approval_chains
     WHERE organization_id = v_org.id AND name = '商品調撥-驗收';

    IF v_chain_id IS NULL THEN
      INSERT INTO approval_chains (organization_id, name, description)
      VALUES (v_org.id, '商品調撥-驗收', '商品調撥驗收鏈：申請人填實收 → 直屬主管確認')
      RETURNING id INTO v_chain_id;

      INSERT INTO approval_chain_steps (chain_id, step_order, role_name, label, target_type, organization_id) VALUES
        (v_chain_id, 0, 'supervisor', '直屬主管', 'applicant_supervisor', v_org.id);
    END IF;

  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
