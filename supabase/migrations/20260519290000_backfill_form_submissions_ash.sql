-- ════════════════════════════════════════════════════════════════════════════
-- 補回 form_submissions ash trigger 上線前的歷史簽核紀錄
-- ────────────────────────────────────────────────────────────────────────────
-- 220001 (ash trigger) 上線前送的 form_submissions：
--   - INSERT trigger 沒 fire → step 0 沒 'submitted' 紀錄
--   - 後續 approve 時 UPDATE trigger 找不到舊 step row 可 SET exited_at
--     → 只 INSERT 了下一關 'pending'
--   → ash 只有「正在跑的那關」一筆 pending；Vicky 已核但簽核時間軸/PDF 顯示不出來
--
-- 補法（精確！）：
--   entered_at(step N) = (next step entered_at) || sub.created_at fallback
--   exited_at(step N)  = (next step entered_at)         ← 因為當下一關 entered 時上一關才結束
--   action = 'approved'  ← 能跑到下一關代表上一關被核准
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

WITH subs AS (
  SELECT fs.id, fs.organization_id, fs.template_id, fs.current_step, fs.created_at,
         fs.applicant_id, fs.status, fs.approved_at, fs.approver_id,
         ft.approval_chain_id
    FROM form_submissions fs
    JOIN form_templates ft ON ft.id = fs.template_id
   WHERE ft.approval_chain_id IS NOT NULL
),
all_chain_steps AS (
  SELECT s.id AS sub_id, s.organization_id, s.approval_chain_id, s.current_step,
         s.created_at AS sub_created_at, s.status AS sub_status,
         s.approved_at AS sub_approved_at,
         cs.step_order, cs.label, cs.target_type,
         (SELECT COUNT(*) FROM approval_chain_steps WHERE chain_id = s.approval_chain_id) AS total_steps
    FROM subs s
    JOIN approval_chain_steps cs ON cs.chain_id = s.approval_chain_id
),
existing AS (
  SELECT request_id AS sub_id, step_order, entered_at
    FROM approval_step_history
   WHERE request_type = 'form_submission'
)
INSERT INTO approval_step_history (
  request_type, request_id, organization_id, chain_id,
  step_order, step_label, target_type, entered_at, exited_at, action
)
SELECT
  'form_submission',
  acs.sub_id, acs.organization_id, acs.approval_chain_id,
  acs.step_order, acs.label, acs.target_type,
  -- entered_at：用上一關的 exited_at；step 0 直接用 sub.created_at
  CASE
    WHEN acs.step_order = 0 THEN acs.sub_created_at
    ELSE COALESCE(
      (SELECT entered_at FROM existing e WHERE e.sub_id = acs.sub_id AND e.step_order = acs.step_order),
      acs.sub_created_at
    )
  END,
  -- exited_at：用下一關的 entered_at；最後一關用 sub.approved_at
  CASE
    WHEN acs.step_order = acs.total_steps - 1 THEN acs.sub_approved_at
    ELSE COALESCE(
      (SELECT entered_at FROM existing e WHERE e.sub_id = acs.sub_id AND e.step_order = acs.step_order + 1),
      acs.sub_approved_at  -- 終態 fallback
    )
  END,
  'approved'
FROM all_chain_steps acs
WHERE
  -- 該 step 已過關：step_order 小於 current_step（chain 中段）
  -- 或單據已結案（status 終態）且 step 不是被 reject 的那關
  (
    acs.step_order < acs.current_step
    OR (acs.sub_status IN ('已核准','已核銷') AND acs.step_order < acs.total_steps)
  )
  -- 還沒寫進 ash 的才補（idempotent）
  AND NOT EXISTS (
    SELECT 1 FROM approval_step_history h
    WHERE h.request_type = 'form_submission'
      AND h.request_id = acs.sub_id
      AND h.step_order = acs.step_order
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
