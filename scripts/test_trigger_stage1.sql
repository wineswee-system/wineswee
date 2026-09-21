-- Stage 1: 建測試 chain + steps + 起手 expense_request
-- 跑完應收 1 張 LINE 卡（第 1 關 測試）
DO $$
DECLARE
  v_org_id   INT;
  v_chain_id INT;
  v_req_id   INT;
  v_emp_id   INT := 10;
BEGIN
  SELECT id INTO v_org_id FROM organizations ORDER BY id LIMIT 1;

  INSERT INTO approval_chains (name, description, category, organization_id, is_active, steps_legacy_jsonb)
  VALUES ('__TEST__鏈路驗證_洪伯嘉自核', '測試 trigger 鏈路推進，跑完即刪', '測試', v_org_id, true, '[]'::jsonb)
  RETURNING id INTO v_chain_id;

  INSERT INTO approval_chain_steps (chain_id, step_order, label, target_type, target_emp_id) VALUES
    (v_chain_id, 0, '第 1 關 測試', 'fixed_emp', v_emp_id),
    (v_chain_id, 1, '第 2 關 測試', 'fixed_emp', v_emp_id),
    (v_chain_id, 2, '第 3 關 測試', 'fixed_emp', v_emp_id);

  INSERT INTO expense_requests (
    employee_id, employee, organization_id, title, description,
    estimated_amount, status, approval_chain_id, current_step
  ) VALUES (
    v_emp_id, '洪伯嘉', v_org_id, '__TEST__鏈路驗證請忽略', '測試 trigger 用，跑完會刪',
    100, '申請中', v_chain_id, 0
  ) RETURNING id INTO v_req_id;

  RAISE NOTICE '✅ Stage 1: chain_id=%, request_id=%, 應收 LINE 第 1 關', v_chain_id, v_req_id;
END $$;

-- 取剛建的 id 給後續 stage 用
SELECT
  (SELECT id FROM approval_chains   WHERE name  = '__TEST__鏈路驗證_洪伯嘉自核' ORDER BY id DESC LIMIT 1) AS chain_id,
  (SELECT id FROM expense_requests  WHERE title = '__TEST__鏈路驗證請忽略'      ORDER BY id DESC LIMIT 1) AS request_id;
