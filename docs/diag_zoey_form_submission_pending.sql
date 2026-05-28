-- ════════════════════════════════════════════════════════════════════════════
-- 診斷：張庭瑋 2026-05-22「門市報修」為什麼 Zoey LIFF 沒看到
-- 一段一段跑，把結果貼回來
-- ════════════════════════════════════════════════════════════════════════════


-- ─── Q1 ─────────────────────────────────────────────────────────────────────
-- 抓那張單本身
SELECT s.id, t.name AS template_name,
       s.applicant_id, e.name AS applicant_name,
       s.organization_id, s.status, s.current_step,
       t.approval_chain_id, s.created_at
FROM public.form_submissions s
JOIN public.form_templates t ON t.id = s.template_id
LEFT JOIN public.employees e ON e.id = s.applicant_id
WHERE t.name LIKE '%報修%'
  AND s.created_at::date = '2026-05-22'
ORDER BY s.created_at DESC
LIMIT 5;


-- ─── Q2 ─────────────────────────────────────────────────────────────────────
-- 那條 chain 的所有 step：每一關 target 是什麼
SELECT cs.step_order, cs.label, cs.target_type,
       cs.target_emp_id, te.name AS target_emp,
       cs.target_role_id, tr.name AS target_role,
       cs.target_dept_id, td.name AS target_dept,
       cs.target_store_id, cs.target_section_id
FROM public.approval_chain_steps cs
LEFT JOIN public.employees   te ON te.id = cs.target_emp_id
LEFT JOIN public.roles       tr ON tr.id = cs.target_role_id
LEFT JOIN public.departments td ON td.id = cs.target_dept_id
WHERE cs.chain_id = (
  SELECT t.approval_chain_id
  FROM public.form_submissions s
  JOIN public.form_templates t ON t.id = s.template_id
  WHERE t.name LIKE '%報修%' AND s.created_at::date = '2026-05-22'
  ORDER BY s.created_at DESC LIMIT 1
)
ORDER BY cs.step_order;


-- ─── Q3 ─────────────────────────────────────────────────────────────────────
-- 陳虹員工卡
SELECT e.id, e.name, e.organization_id, e.role_id, r.name AS role_name,
       e.department_id, d.name AS dept_name, e.status
FROM public.employees e
LEFT JOIN public.roles r ON r.id = e.role_id
LEFT JOIN public.departments d ON d.id = e.department_id
WHERE e.name = '陳虹';


-- ─── Q4 ─────────────────────────────────────────────────────────────────────
-- 四條件逐一比對：哪個 false 就是兇手（鎖 id=5 張庭瑋那張）
WITH target_sub AS (
  SELECT s.*, t.approval_chain_id
  FROM public.form_submissions s
  JOIN public.form_templates t ON t.id = s.template_id
  WHERE s.id = 5
),
zoey AS (
  SELECT * FROM public.employees WHERE name = '陳虹' LIMIT 1
),
cur_step AS (
  SELECT cs.*
  FROM public.approval_chain_steps cs, target_sub s
  WHERE cs.chain_id = s.approval_chain_id AND cs.step_order = s.current_step
)
SELECT
  (SELECT organization_id FROM target_sub)  AS sub_org,
  (SELECT organization_id FROM zoey)        AS zoey_org,
  (SELECT organization_id FROM target_sub) = (SELECT organization_id FROM zoey) AS org_match,
  (SELECT status FROM target_sub)            AS sub_status,
  (SELECT current_step FROM target_sub)      AS sub_cur_step,
  (SELECT step_order  FROM cur_step)         AS step_found_at,
  (SELECT label       FROM cur_step)         AS step_label,
  (SELECT target_type FROM cur_step)         AS step_target_type,
  public._employee_matches_chain_step(
    (SELECT id FROM zoey),
    (SELECT id FROM cur_step),
    (SELECT applicant_id FROM target_sub)
  ) AS zoey_matches_step;


-- ─── Q5 ─────────────────────────────────────────────────────────────────────
-- 直接用 Zoey LINE id 撈 LIFF pending，看 form_submissions 陣列有沒有那張
SELECT jsonb_array_length(
  (public.liff_list_pending_approvals('U420564e6a7cae7ceb6fe377585e5f781')::jsonb)->'form_submissions'
) AS form_sub_count,
  (public.liff_list_pending_approvals('U420564e6a7cae7ceb6fe377585e5f781')::jsonb)->'form_submissions' AS form_subs;


-- ─── Q6 ─────────────────────────────────────────────────────────────────────
-- Zoey 所有 LINE channel 綁定（看每條 line_user_id 是否能解到 Zoey）
SELECT ela.*, e.name AS emp_name
FROM public.employee_line_accounts ela
JOIN public.employees e ON e.id = ela.employee_id
WHERE e.name = '陳虹'
ORDER BY ela.is_primary DESC, ela.id;


-- ─── Q7 ─────────────────────────────────────────────────────────────────────
-- 對 Zoey 每條 line_user_id 都跑一次 _liff_resolve_employee
-- 看每條都能不能解到她
SELECT
  ela.line_user_id,
  ela.is_primary,
  re.id   AS resolved_emp_id,
  re.name AS resolved_emp_name,
  re.status AS resolved_status
FROM public.employee_line_accounts ela
JOIN public.employees e ON e.id = ela.employee_id
LEFT JOIN LATERAL (
  SELECT * FROM public._liff_resolve_employee(ela.line_user_id)
) re ON true
WHERE e.name = '陳虹';
