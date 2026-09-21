-- ════════════════════════════════════════════════════════════════════════════
-- 復原 chain#21(非費用申請簽核鏈) 第0關 target_type 回「部門主管」
-- 2026-07-02
--
-- 背景：第0關原本 target_type=applicant_dept_manager（label「上層主管」），在飛單
--   #317 的快照也是這個 → 申請人林巧玉(加盟展店事業部主管)自己是這關的人，收到卡片。
--   今早被改成 applicant_supervisor(直屬主管) → live chain(陳虹) 跟 #317 快照(林巧玉)
--   不一致 → 簽核判斷看 live chain 擋住林巧玉，她簽不動。改回即恢復一致。
--
-- 冪等：只在目前是 applicant_supervisor 時改回。label 不動（跟快照一致）。
--
-- ※ 深層 bug 另記：有快照的在飛單不該被改 chain 影響（簽核判斷應優先讀快照），
--   目前 expense_request 簽核疑似讀 live chain → 待修，否則改 chain 會回頭弄壞在飛單。
-- ════════════════════════════════════════════════════════════════════════════

UPDATE public.approval_chain_steps
SET target_type = 'applicant_dept_manager'
WHERE chain_id = 21
  AND step_order = 0
  AND target_type = 'applicant_supervisor';

NOTIFY pgrst, 'reload schema';
