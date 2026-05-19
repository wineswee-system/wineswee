-- ════════════════════════════════════════════════════════════════════════════
-- approval_step_history backfill 第三輪：動態 target (applicant_* / specific_*)
-- ────────────────────────────────────────────────────────────────────────────
-- 前 2 輪只 cover fixed_emp，但 chain step 也常用：
--   - applicant_dept_manager (申請人部門主管) — 依申請人解，唯一
--   - applicant_store_manager (申請人門市店長) — 依申請人解，唯一
--   - applicant_section_supervisor (申請人組別主管) — 依申請人解，唯一
--   - specific_dept_manager (指定部門主管) — 唯一
--   - specific_store_manager (指定門市店長) — 唯一
--   - specific_section_supervisor (指定組主管) — 唯一
--
-- 用 resolve_chain_step_approvers(step_id, applicant_emp_id) 解出實際人，
-- 對該關已過的單 INSERT history。
--
-- 不 cover fixed_role / fixed_dept（多人解出，會 false positive）。
-- 不重複（NOT EXISTS 防 dup）。
--
-- 影響：Danny 在 chain 上是「主管初核 = applicant_dept_manager」對 Max 的單，
-- 跑完應該會看到他 5+ 筆。
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
  r.emp_id,
  r.emp_name
FROM expense_requests er
JOIN approval_chain_steps cs ON cs.chain_id = er.approval_chain_id
CROSS JOIN LATERAL public.resolve_chain_step_approvers(cs.id, er.employee_id) r
WHERE cs.target_type IN (
  'applicant_dept_manager',
  'applicant_store_manager',
  'applicant_section_supervisor',
  'specific_dept_manager',
  'specific_store_manager',
  'specific_section_supervisor'
)
  AND (
    er.status IN ('已核准','已核銷')
    OR (er.status IN ('申請中','待核銷') AND cs.step_order < er.current_step)
    OR (er.status IN ('已駁回','已退回') AND cs.step_order = er.current_step)
  )
  AND r.emp_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM approval_step_history h
    WHERE h.request_type = 'expense_request'
      AND h.request_id = er.id
      AND h.step_order = cs.step_order
      AND h.approver_id = r.emp_id
  );


-- ─── HR B 三表 + headcount 一併補 ─────────────────────────────────────────
INSERT INTO approval_step_history (
  request_type, request_id, organization_id, chain_id,
  step_order, step_label, target_type, entered_at, exited_at,
  action, approver_id, approver_name
)
SELECT
  src.rt,
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
  r.emp_id,
  r.emp_name
FROM (
  SELECT 'resignation' AS rt, id, employee_id, organization_id, approval_chain_id, current_step, status,
         approved_at, created_at, updated_at
    FROM resignation_requests
  UNION ALL
  SELECT 'loa', id, employee_id, organization_id, approval_chain_id, current_step, status,
         approved_at, created_at, updated_at
    FROM leave_of_absence_requests
  UNION ALL
  SELECT 'transfer', id, employee_id, organization_id, approval_chain_id, current_step, status,
         approved_at, created_at, updated_at
    FROM personnel_transfer_requests
  UNION ALL
  SELECT 'headcount', id, employee_id, organization_id, approval_chain_id, current_step, status,
         approved_at, created_at, updated_at
    FROM headcount_requests
) src
JOIN approval_chain_steps cs ON cs.chain_id = src.approval_chain_id
CROSS JOIN LATERAL public.resolve_chain_step_approvers(cs.id, src.employee_id) r
WHERE cs.target_type IN (
  'applicant_dept_manager',
  'applicant_store_manager',
  'applicant_section_supervisor',
  'specific_dept_manager',
  'specific_store_manager',
  'specific_section_supervisor'
)
  AND (
    src.status IN ('已核准','已核銷')
    OR (src.status IN ('申請中','待核銷','待審') AND cs.step_order < src.current_step)
    OR (src.status IN ('已駁回','已退回') AND cs.step_order = src.current_step)
  )
  AND r.emp_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM approval_step_history h
    WHERE h.request_type = src.rt
      AND h.request_id = src.id
      AND h.step_order = cs.step_order
      AND h.approver_id = r.emp_id
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
