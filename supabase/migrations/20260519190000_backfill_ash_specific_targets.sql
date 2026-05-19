-- ════════════════════════════════════════════════════════════════════════════
-- approval_step_history backfill 第二輪：動態解出「唯一人」的 chain step
-- ────────────────────────────────────────────────────────────────────────────
-- 接續 20260519170000 (fixed_emp backfill)，再補三種「specific_*」target_type：
--   - specific_dept_manager   → 該部主管（1 人）
--   - specific_store_manager  → 該店店長（1 人）
--   - specific_section_supervisor → 該組主管（1 人）
--
-- 這三種解出來唯一不重，補回 history 不會 over-insert。
--
-- 不 cover:
--   - fixed_role / fixed_dept (多人解出，補了會 false positive)
--   - applicant_dept_manager / applicant_store_manager (依申請人不同解不同人)
--   → 這幾種歷史簽核資料丟失，要的話用「resolver 解 + 全記」我寫第三輪
--     (有 false positive caveat)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── expense_requests 主鏈 ─────────────────────────────────────────────────
INSERT INTO approval_step_history (
  request_type, request_id, organization_id, chain_id,
  step_order, step_label, target_type, entered_at, exited_at,
  action, approver_id, approver_name
)
SELECT
  'expense_request',
  er.id,
  er.organization_id,
  er.approval_chain_id,
  cs.step_order,
  cs.label,
  cs.target_type,
  er.created_at,
  COALESCE(er.approved_at, er.updated_at, NOW()),
  CASE
    WHEN er.status IN ('已駁回','已退回') AND cs.step_order = er.current_step THEN 'rejected'
    ELSE 'approved'
  END,
  CASE cs.target_type
    WHEN 'specific_dept_manager'      THEN (SELECT manager_id FROM departments WHERE id = cs.target_dept_id)
    WHEN 'specific_store_manager'     THEN (SELECT manager_id FROM stores WHERE id = cs.target_store_id)
    WHEN 'specific_section_supervisor' THEN (SELECT supervisor_id FROM department_sections WHERE id = cs.target_section_id)
  END AS approver_id_resolved,
  CASE cs.target_type
    WHEN 'specific_dept_manager'      THEN (SELECT e.name FROM employees e JOIN departments d ON d.manager_id = e.id WHERE d.id = cs.target_dept_id)
    WHEN 'specific_store_manager'     THEN (SELECT e.name FROM employees e JOIN stores s ON s.manager_id = e.id WHERE s.id = cs.target_store_id)
    WHEN 'specific_section_supervisor' THEN (SELECT e.name FROM employees e JOIN department_sections ds ON ds.supervisor_id = e.id WHERE ds.id = cs.target_section_id)
  END AS approver_name_resolved
FROM expense_requests er
JOIN approval_chain_steps cs ON cs.chain_id = er.approval_chain_id
WHERE cs.target_type IN ('specific_dept_manager','specific_store_manager','specific_section_supervisor')
  AND (
    er.status IN ('已核准','已核銷')
    OR (er.status IN ('申請中','待核銷') AND cs.step_order < er.current_step)
    OR (er.status IN ('已駁回','已退回') AND cs.step_order = er.current_step)
  )
  AND NOT EXISTS (
    SELECT 1 FROM approval_step_history h
    WHERE h.request_type = 'expense_request'
      AND h.request_id = er.id
      AND h.step_order = cs.step_order
  );


-- ─── HR B 三表 + headcount 也一起補 ─────────────────────────────────────────
-- resignation_requests / leave_of_absence_requests / personnel_transfer_requests / headcount_requests
-- 用 generic UNION ALL 處理：

INSERT INTO approval_step_history (
  request_type, request_id, organization_id, chain_id,
  step_order, step_label, target_type, entered_at, exited_at,
  action, approver_id, approver_name
)
SELECT
  rt,
  src.id,
  src.organization_id,
  src.approval_chain_id,
  cs.step_order,
  cs.label,
  cs.target_type,
  src.created_at,
  COALESCE(src.approved_at, src.updated_at, NOW()),
  CASE
    WHEN src.status IN ('已駁回','已退回') AND cs.step_order = src.current_step THEN 'rejected'
    ELSE 'approved'
  END,
  CASE cs.target_type
    WHEN 'specific_dept_manager'      THEN (SELECT manager_id FROM departments WHERE id = cs.target_dept_id)
    WHEN 'specific_store_manager'     THEN (SELECT manager_id FROM stores WHERE id = cs.target_store_id)
    WHEN 'specific_section_supervisor' THEN (SELECT supervisor_id FROM department_sections WHERE id = cs.target_section_id)
  END,
  CASE cs.target_type
    WHEN 'specific_dept_manager'      THEN (SELECT e.name FROM employees e JOIN departments d ON d.manager_id = e.id WHERE d.id = cs.target_dept_id)
    WHEN 'specific_store_manager'     THEN (SELECT e.name FROM employees e JOIN stores s ON s.manager_id = e.id WHERE s.id = cs.target_store_id)
    WHEN 'specific_section_supervisor' THEN (SELECT e.name FROM employees e JOIN department_sections ds ON ds.supervisor_id = e.id WHERE ds.id = cs.target_section_id)
  END
FROM (
  SELECT 'resignation' AS rt, id, organization_id, approval_chain_id, current_step, status,
         approved_at, created_at, updated_at
    FROM resignation_requests
  UNION ALL
  SELECT 'loa', id, organization_id, approval_chain_id, current_step, status,
         approved_at, created_at, updated_at
    FROM leave_of_absence_requests
  UNION ALL
  SELECT 'transfer', id, organization_id, approval_chain_id, current_step, status,
         approved_at, created_at, updated_at
    FROM personnel_transfer_requests
  UNION ALL
  SELECT 'headcount', id, organization_id, approval_chain_id, current_step, status,
         approved_at, created_at, updated_at
    FROM headcount_requests
) src
JOIN approval_chain_steps cs ON cs.chain_id = src.approval_chain_id
WHERE cs.target_type IN ('specific_dept_manager','specific_store_manager','specific_section_supervisor')
  AND (
    src.status IN ('已核准','已核銷')
    OR (src.status IN ('申請中','待核銷','待審') AND cs.step_order < src.current_step)
    OR (src.status IN ('已駁回','已退回') AND cs.step_order = src.current_step)
  )
  AND NOT EXISTS (
    SELECT 1 FROM approval_step_history h
    WHERE h.request_type = src.rt
      AND h.request_id = src.id
      AND h.step_order = cs.step_order
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
