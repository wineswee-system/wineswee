-- ════════════════════════════════════════════════════════════
-- M3: 解 clock_corrections schema drift + 合並 punch_corrections
--
-- live DB schema：
--   id, employee, employee_id, organization_id, store, date,
--   original_clock_in TIME, original_clock_out TIME,
--   corrected_clock_in TIME, corrected_clock_out TIME,
--   reason, status, approver, reject_reason, created_at,
--   approval_chain_id, current_step
--
-- 預期 schema（migration files / LIFF RPC liff_insert_clock_correction
-- / line-webhook card-approval 都假設）：
--   ..., type TEXT ('clock_in'/'clock_out'/'上班打卡'/'下班打卡'),
--   correction_time TIME, original_time TIME, approved_at TIMESTAMPTZ
--
-- live DB 只有 2 筆資料（都是 clock_in only），punch_corrections 0 筆。
-- 修法：補欄位 → backfill → drop 舊欄位 → drop punch_corrections。
--
-- ⚠️ 部署順序：先確認 LIFF 不再走老 schema（等 LIFF 同步部署），這個 migration
-- 才安全 — 但因為 LIFF RPC 本來就用 type/correction_time，這個 migration 反而
-- 是讓 LIFF 從 silent fail 變正常。
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. 補預期的欄位 ═══
ALTER TABLE public.clock_corrections
  ADD COLUMN IF NOT EXISTS type            TEXT,
  ADD COLUMN IF NOT EXISTS correction_time TIME,
  ADD COLUMN IF NOT EXISTS original_time   TIME,
  ADD COLUMN IF NOT EXISTS approved_at     TIMESTAMPTZ;


-- ═══ 2. Backfill：把 corrected_clock_in/out 兩欄收斂進 type + correction_time ═══
-- 規則：
--   has clock_in only        → type='clock_in',  correction_time=corrected_clock_in
--   has clock_out only       → type='clock_out', correction_time=corrected_clock_out
--   has both (邊緣 case)     → 拆兩 row（保留原 row 設 in，再 INSERT 一筆 out）
--   皆無                     → type='clock_in' (預設) correction_time=NULL（保守）

-- 邊緣 case：has both 的 row 拆出第二筆 (out)
INSERT INTO public.clock_corrections (
  employee, employee_id, organization_id, store, date,
  type, correction_time, original_time,
  reason, status, approver, reject_reason, approved_at,
  approval_chain_id, current_step, created_at
)
SELECT
  employee, employee_id, organization_id, store, date,
  'clock_out',
  corrected_clock_out,
  original_clock_out,
  reason, status, approver, reject_reason, NULL,
  approval_chain_id, current_step, created_at
FROM public.clock_corrections
 WHERE corrected_clock_in IS NOT NULL
   AND corrected_clock_out IS NOT NULL
   AND type IS NULL;

-- 主 row：用第一個有值的事件
UPDATE public.clock_corrections
   SET type = CASE
                WHEN corrected_clock_in IS NOT NULL THEN 'clock_in'
                WHEN corrected_clock_out IS NOT NULL THEN 'clock_out'
                ELSE 'clock_in'
              END,
       correction_time = COALESCE(corrected_clock_in, corrected_clock_out),
       original_time = COALESCE(original_clock_in, original_clock_out)
 WHERE type IS NULL;


-- ═══ 3. type 收斂值（中文 → 英文，保 LIFF 既有資料一致） ═══
UPDATE public.clock_corrections
   SET type = CASE type
                WHEN '上班打卡' THEN 'clock_in'
                WHEN '下班打卡' THEN 'clock_out'
                ELSE type
              END
 WHERE type IN ('上班打卡', '下班打卡');


-- ═══ 4. NOT NULL constraint on type ═══
ALTER TABLE public.clock_corrections
  ALTER COLUMN type SET NOT NULL,
  ALTER COLUMN type SET DEFAULT 'clock_in';


-- ═══ 5. Drop 舊雙欄 schema ═══
ALTER TABLE public.clock_corrections
  DROP COLUMN IF EXISTS corrected_clock_in,
  DROP COLUMN IF EXISTS corrected_clock_out,
  DROP COLUMN IF EXISTS original_clock_in,
  DROP COLUMN IF EXISTS original_clock_out;


-- ═══ 6. Drop punch_corrections（0 筆資料，無 backfill 需求） ═══
DROP TABLE IF EXISTS public.punch_corrections CASCADE;


COMMIT;

NOTIFY pgrst, 'reload schema';
