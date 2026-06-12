-- ════════════════════════════════════════════════════════════════════════════
-- 修正在飛門市報修單的快照（兩處資料壞掉，皆 idempotent）
--
-- 1. 督導關：20260612100000 step 7 誤把 applicant_section_supervisor 改成
--    applicant_store_supervisor。但督導/經理 position 多為「店長/經理」非「督導」，
--    applicant_store_supervisor 解不出人 → 督導關空白。改回 applicant_section_supervisor。
--
-- 2. 財務關：舊單快照凍在已失效員工（emp 151），但 live chain 已改為
--    emp 62（張庭瑋，財務會簽 Vicky 代）。把失效的 151 同步成 62。
--
-- 只動 status='申請中' 的在飛報修單，且只命中壞掉的特定值，已結案單不影響。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. 督導關修回 applicant_section_supervisor
UPDATE request_chain_snapshots rcs
SET target_type = 'applicant_section_supervisor'
FROM form_submissions fs
JOIN form_templates ft ON ft.id = fs.template_id
WHERE rcs.request_type = 'form_submission'
  AND rcs.request_id   = fs.id
  AND rcs.target_type  = 'applicant_store_supervisor'
  AND rcs.label LIKE '%督導%'
  AND ft.name LIKE '%報修%'
  AND fs.status = '申請中';

-- 2. 財務關失效的 151 同步成 62（張庭瑋）
UPDATE request_chain_snapshots rcs
SET target_emp_id = 62,
    label = '財務會簽(Vicky代)'
FROM form_submissions fs
JOIN form_templates ft ON ft.id = fs.template_id
WHERE rcs.request_type = 'form_submission'
  AND rcs.request_id   = fs.id
  AND rcs.target_type  = 'fixed_emp'
  AND rcs.target_emp_id = 151
  AND rcs.label LIKE '%財務%'
  AND ft.name LIKE '%報修%'
  AND fs.status = '申請中';

COMMIT;
