-- ════════════════════════════════════════════════════════════════════════════
-- 診斷：表單申請類「list 顯示 status」vs「chain 實際推進」不一致
-- 起因：#96 list 顯示「申請中」，modal 內 chain 卻顯示「簽核完成」（4 關都打勾）
--
-- 不一致型態 A：chain 推完了但 status 還停在「申請中/待審」
--   → 列表錯誤顯示為「待簽核」，但實際上沒人能再簽（current_step 已超出 chain）
-- 不一致型態 B：status 已核准/已駁回 但 chain 還沒推完
--   → 列表正確顯示終態，但 modal 時間軸還有「等待簽核」的關
--
-- 跑法：一段一段執行；A 跟 B 都要看
-- ════════════════════════════════════════════════════════════════════════════


-- ─── Q1：先看 #96 本身（用戶提到的單） ─────────────────────────────────────
SELECT
  er.id, er.employee, er.status,
  er.current_step,
  er.approval_chain_id,
  ac.name AS chain_name,
  (SELECT COUNT(*) FROM public.approval_chain_steps cs
    WHERE cs.chain_id = er.approval_chain_id) AS total_steps,
  er.approved_by, er.approved_at,
  er.created_at
FROM public.expense_requests er
LEFT JOIN public.approval_chains ac ON ac.id = er.approval_chain_id
WHERE er.id = 96;


-- ─── Q2：看 #96 的 approval_step_history（誰在哪關進出） ────────────────────
SELECT step_order, step_label, action,
       approver_name, approver_id,
       entered_at, exited_at,
       EXTRACT(EPOCH FROM (exited_at - entered_at))/60 AS minutes_held
FROM public.approval_step_history
WHERE request_type = 'expense_request' AND request_id = 96
ORDER BY entered_at, step_order;


-- ─── Q3：看 #96 的 chain step 結構（每關 target） ──────────────────────────
SELECT cs.step_order, cs.label, cs.target_type,
       cs.target_emp_id, te.name AS target_emp,
       cs.target_role_id, tr.name AS target_role,
       cs.target_dept_id, td.name AS target_dept
FROM public.approval_chain_steps cs
LEFT JOIN public.employees   te ON te.id = cs.target_emp_id
LEFT JOIN public.roles       tr ON tr.id = cs.target_role_id
LEFT JOIN public.departments td ON td.id = cs.target_dept_id
WHERE cs.chain_id = (SELECT approval_chain_id FROM public.expense_requests WHERE id = 96)
ORDER BY cs.step_order;


-- ════════════════════════════════════════════════════════════════════════════
-- A. chain 推完了但 status 還停在 pending（type-A 不一致）— 各表
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Q4-a：expense_requests（費用申請） ────────────────────────────────────
WITH chain_size AS (
  SELECT chain_id, COUNT(*) AS total_steps
  FROM public.approval_chain_steps GROUP BY chain_id
)
SELECT er.id, er.employee, er.status, er.current_step,
       cs.total_steps,
       er.approval_chain_id, er.approved_by, er.approved_at, er.created_at
FROM public.expense_requests er
JOIN chain_size cs ON cs.chain_id = er.approval_chain_id
WHERE er.status IN ('申請中', '待審')
  AND er.current_step >= cs.total_steps
ORDER BY er.id DESC;


-- ─── Q4-b：leave_requests（請假） ──────────────────────────────────────────
WITH chain_size AS (
  SELECT chain_id, COUNT(*) AS total_steps
  FROM public.approval_chain_steps GROUP BY chain_id
)
SELECT lr.id, lr.employee, lr.status, lr.current_step,
       cs.total_steps,
       lr.approval_chain_id, lr.approver, lr.created_at
FROM public.leave_requests lr
JOIN chain_size cs ON cs.chain_id = lr.approval_chain_id
WHERE lr.status IN ('申請中', '待審', '待審核')
  AND lr.current_step >= cs.total_steps
ORDER BY lr.id DESC;


-- ─── Q4-c：overtime_requests（加班） ──────────────────────────────────────
WITH chain_size AS (
  SELECT chain_id, COUNT(*) AS total_steps
  FROM public.approval_chain_steps GROUP BY chain_id
)
SELECT o.id, o.employee, o.status, o.current_step,
       cs.total_steps,
       o.approval_chain_id, o.approver, o.created_at
FROM public.overtime_requests o
JOIN chain_size cs ON cs.chain_id = o.approval_chain_id
WHERE o.status IN ('申請中', '待審', '待審核')
  AND o.current_step >= cs.total_steps
ORDER BY o.id DESC;


-- ─── Q4-d：business_trips（出差） ─────────────────────────────────────────
WITH chain_size AS (
  SELECT chain_id, COUNT(*) AS total_steps
  FROM public.approval_chain_steps GROUP BY chain_id
)
SELECT t.id, t.employee, t.status, t.current_step,
       cs.total_steps,
       t.approval_chain_id, t.approver, t.created_at
FROM public.business_trips t
JOIN chain_size cs ON cs.chain_id = t.approval_chain_id
WHERE t.status IN ('申請中', '待審', '待審核')
  AND t.current_step >= cs.total_steps
ORDER BY t.id DESC;


-- ─── Q4-e：clock_corrections（補打卡） ────────────────────────────────────
WITH chain_size AS (
  SELECT chain_id, COUNT(*) AS total_steps
  FROM public.approval_chain_steps GROUP BY chain_id
)
SELECT cc.id, cc.employee, cc.status, cc.current_step,
       cs.total_steps,
       cc.approval_chain_id, cc.approver, cc.created_at
FROM public.clock_corrections cc
JOIN chain_size cs ON cs.chain_id = cc.approval_chain_id
WHERE cc.status IN ('申請中', '待審', '待審核')
  AND cc.current_step >= cs.total_steps
ORDER BY cc.id DESC;


-- ─── Q4-f：resignation_requests（離職） ───────────────────────────────────
WITH chain_size AS (
  SELECT chain_id, COUNT(*) AS total_steps
  FROM public.approval_chain_steps GROUP BY chain_id
)
SELECT r.id, r.employee, r.status, r.current_step,
       cs.total_steps,
       r.approval_chain_id, r.approved_by, r.approved_at, r.created_at
FROM public.resignation_requests r
JOIN chain_size cs ON cs.chain_id = r.approval_chain_id
WHERE r.status IN ('申請中', '待審')
  AND r.current_step >= cs.total_steps
ORDER BY r.id DESC;


-- ─── Q4-g：leave_of_absence_requests（留職停薪） ──────────────────────────
WITH chain_size AS (
  SELECT chain_id, COUNT(*) AS total_steps
  FROM public.approval_chain_steps GROUP BY chain_id
)
SELECT l.id, l.employee, l.status, l.current_step,
       cs.total_steps,
       l.approval_chain_id, l.approved_by, l.approved_at, l.created_at
FROM public.leave_of_absence_requests l
JOIN chain_size cs ON cs.chain_id = l.approval_chain_id
WHERE l.status IN ('申請中', '待審')
  AND l.current_step >= cs.total_steps
ORDER BY l.id DESC;


-- ─── Q4-h：personnel_transfer_requests（人事異動） ────────────────────────
WITH chain_size AS (
  SELECT chain_id, COUNT(*) AS total_steps
  FROM public.approval_chain_steps GROUP BY chain_id
)
SELECT p.id, p.employee, p.status, p.current_step,
       cs.total_steps,
       p.approval_chain_id, p.approved_by, p.approved_at, p.created_at
FROM public.personnel_transfer_requests p
JOIN chain_size cs ON cs.chain_id = p.approval_chain_id
WHERE p.status IN ('申請中', '待審')
  AND p.current_step >= cs.total_steps
ORDER BY p.id DESC;


-- ─── Q4-i：headcount_requests（用人需求） ─────────────────────────────────
WITH chain_size AS (
  SELECT chain_id, COUNT(*) AS total_steps
  FROM public.approval_chain_steps GROUP BY chain_id
)
SELECT h.id, h.requester_name AS employee, h.status, h.current_step,
       cs.total_steps,
       h.approval_chain_id, h.approved_by, h.approved_at, h.created_at
FROM public.headcount_requests h
JOIN chain_size cs ON cs.chain_id = h.approval_chain_id
WHERE h.status IN ('申請中', '待審')
  AND h.current_step >= cs.total_steps
ORDER BY h.id DESC;


-- ─── Q4-j：form_submissions（業務 / HR 動態表單） ─────────────────────────
-- 注意 form_submissions 的 chain 來自 form_templates.approval_chain_id（不在自己身上）
WITH chain_size AS (
  SELECT chain_id, COUNT(*) AS total_steps
  FROM public.approval_chain_steps GROUP BY chain_id
)
SELECT s.id, t.name AS template_name,
       s.applicant_id, e.name AS applicant_name,
       s.status, s.current_step,
       cs.total_steps,
       t.approval_chain_id, s.created_at
FROM public.form_submissions s
JOIN public.form_templates t ON t.id = s.template_id
LEFT JOIN public.employees e ON e.id = s.applicant_id
JOIN chain_size cs ON cs.chain_id = t.approval_chain_id
WHERE s.status IN ('申請中', '待審', '待審核', 'pending')
  AND s.current_step >= cs.total_steps
ORDER BY s.id DESC;


-- ════════════════════════════════════════════════════════════════════════════
-- B. status 已是終態 但 chain 沒推完（type-B 不一致；少見但也檢查）
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Q5-a：expense_requests
WITH chain_size AS (
  SELECT chain_id, COUNT(*) AS total_steps
  FROM public.approval_chain_steps GROUP BY chain_id
)
SELECT er.id, er.employee, er.status, er.current_step,
       cs.total_steps,
       er.approval_chain_id, er.approved_by, er.approved_at
FROM public.expense_requests er
JOIN chain_size cs ON cs.chain_id = er.approval_chain_id
WHERE er.status IN ('已核准', '已核銷')
  AND er.current_step < cs.total_steps
ORDER BY er.id DESC;


-- ─── Q5-b：leave_requests
WITH chain_size AS (
  SELECT chain_id, COUNT(*) AS total_steps
  FROM public.approval_chain_steps GROUP BY chain_id
)
SELECT lr.id, lr.employee, lr.status, lr.current_step, cs.total_steps,
       lr.approval_chain_id, lr.approver
FROM public.leave_requests lr
JOIN chain_size cs ON cs.chain_id = lr.approval_chain_id
WHERE lr.status = '已核准' AND lr.current_step < cs.total_steps
ORDER BY lr.id DESC;


-- ────────────────────────────────────────────────────────────────────────────
-- 期望結果：
--   Q4-* 全空 → 沒有 type-A 不一致
--   Q5-* 全空 → 沒有 type-B 不一致
--
-- 若 Q4 有筆 → 那些單會「list 顯示申請中但其實沒人能再簽」（#96 就是這種）
--   修法分兩段：
--   1. 一次性 backfill：把這些單 SET status = '已核准' + approved_at = NOW()
--      （前提是 chain 真的全 approved 而不是 rejected）
--   2. Trigger 補強：在 BEFORE UPDATE OF current_step 加 guard，
--      若 NEW.current_step >= total_steps 且 status 仍 pending → 自動翻成 '已核准'
--      （像現有 auto_skip_self_approval_expense_request 的 safety valve）
-- ════════════════════════════════════════════════════════════════════════════
