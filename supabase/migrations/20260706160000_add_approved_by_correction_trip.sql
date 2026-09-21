-- 修：補打卡/出差 審核到「最後一關核准」或「駁回」時跳錯（column approved_by does not exist）
-- 2026-07-06
-- 根因：liff_approve_request / web_advance_chain_request 的核准/駁回 UPDATE 寫死 approved_by，
--   但 clock_corrections 只有 approver 欄、business_trips 兩者皆無（schema drift）。
--   中間關卡推進用 SET current_step（不碰 approved_by）→ 簽得動；
--   最後一關 SET ...,approved_by / 駁回 SET ...,approved_by → 42703 跳錯。
--   請假/加班有 approved_by 故正常 → 「有些可以簽有些不行」。
-- 修法：讓各 HR 表一致 —— 補上 approved_by TEXT（放審核人姓名，對齊 leave/overtime）。
--   純加法，既有 approver 欄保留（legacy，不動）。idempotent。

-- 全 HR 簽核表逐欄掃描後補齊：clock_corrections / expenses 缺 approved_by
-- （business_trips 一併加以防萬一，IF NOT EXISTS 已有則 no-op）
ALTER TABLE public.clock_corrections ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE public.expenses          ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE public.business_trips    ADD COLUMN IF NOT EXISTS approved_by TEXT;
