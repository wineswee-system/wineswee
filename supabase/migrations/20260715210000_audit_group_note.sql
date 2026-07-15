-- 稽核「說明」改群組層級 — 2026-07-15
-- Excel 說明欄是每個關聯群組合併一格 → 一組一個說明，存在該群組首項的 group_note。
-- (打字題 input_type=text 的內容仍存各自 remark，兩者分開不衝突。) idempotent。

ALTER TABLE public.store_audit_items ADD COLUMN IF NOT EXISTS group_note TEXT;

NOTIFY pgrst, 'reload schema';
