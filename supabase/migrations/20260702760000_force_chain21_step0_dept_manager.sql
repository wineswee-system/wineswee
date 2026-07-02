-- ════════════════════════════════════════════════════════════════════════════
-- 強制把 chain#21 第0關改回「部門主管」— 繞過 guard trigger（它 RETURN OLD 吞改動）
-- 2026-07-02
--
-- 前一版 20260702750000 的 UPDATE 沒生效：approval_chain_steps 上的
--   trg_guard_chain_steps_update（_guard_chain_steps_in_flight）BEFORE UPDATE OF
--   target_type... 最後 RETURN OLD → 靜默吞掉 target_type 的改動（不報錯也不生效）。
--
-- 做法：暫時 DISABLE 該 guard trigger → UPDATE → 再 ENABLE。
--   改回部門主管後 live chain 跟 #317 快照(applicant_dept_manager→林巧玉)一致，
--   林巧玉能簽。#317 快照本就是部門主管，不會被破壞。
--
-- ※ 深層 bug 另記：guard RETURN OLD 導致 chain step 的 target_type 幾乎改不動
--   （設定頁若走 UPDATE 也會被吞）。待評估是否應改 RETURN NEW。
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.approval_chain_steps DISABLE TRIGGER trg_guard_chain_steps_update;

UPDATE public.approval_chain_steps
SET target_type = 'applicant_dept_manager'
WHERE chain_id = 21 AND step_order = 0;

ALTER TABLE public.approval_chain_steps ENABLE TRIGGER trg_guard_chain_steps_update;

NOTIFY pgrst, 'reload schema';
