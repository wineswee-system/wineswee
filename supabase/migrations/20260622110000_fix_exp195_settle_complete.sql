-- ════════════════════════════════════════════════════════════════════════════
-- 修：費用申請 #195 核銷卡死 — 補結案
-- 2026-06-22
--
-- 狀況：settle_current_step=3（核銷鏈 24 僅 0/1/2 三步，3=已過末步）但 status 仍「待核銷」、
--   settled_at=null。時間軸讀 step 顯示綠燈完成、列表讀 status 顯示待核銷 → 進度對不上；
--   且推進函式找不到 step_order=3 → STEP_NOT_FOUND → UI 永遠推不動。成因為 06-15 核銷推進
--   函式/快照改動窗口（commit d71ca561 等）的遺留，全系統僅此 1 筆受害。
--
-- 修法（= 比照其他 8 筆已核銷的單，只補 status 欄位，不建分錄）：
--   ※ 全系統 8 筆已核銷皆無會計分錄（secure_create_journal_entry 因 app.tenant_id 未設被
--     EXCEPTION 靜默吃掉）→ 不為 #195 單獨建分錄，以免與其他單不一致。
--   ※ settled_by = '韓德森'（總經理核備＝最後一步的人，對齊其他 8 筆）
--   ※ settled_at = 2026-06-15 14:21（時間軸上總經理核備的實際時刻，非今天）
--
-- 防呆：WHERE 綁定「待核銷 + step=3」破壞態，已修過 / 狀態不符 → no-op（idempotent）。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.expense_requests
   SET status              = '已核銷',
       settle_current_step = 3,
       settled_by          = '韓德森',
       settled_at          = '2026-06-15T06:21:00+00'::timestamptz,
       updated_at          = NOW()
 WHERE id = 195
   AND status = '待核銷'
   AND settle_current_step = 3;

COMMIT;
