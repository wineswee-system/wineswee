-- recruitment_jobs 補回缺失欄位 (schema drift) — 2026-07-15
-- 問題:程式碼(新增職缺表單 handleAddJob / 核准人力需求單 handleApproveHcRequest)會寫
--   headcount / description / headcount_request_id,但 live DB 這張表沒這三欄
--   → INSERT 撞 42703 / PGRST204 → 新增職缺、核准需求單都靜默失敗(前端只 if(data),沒報錯)。
-- 修:idempotent 補欄。headcount 預設 1、description 可空、headcount_request_id 補 FK。純加法。

ALTER TABLE public.recruitment_jobs
  ADD COLUMN IF NOT EXISTS headcount integer NOT NULL DEFAULT 1;
ALTER TABLE public.recruitment_jobs
  ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.recruitment_jobs
  ADD COLUMN IF NOT EXISTS headcount_request_id integer;

-- headcount_request_id → headcount_requests FK(若尚未建)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'recruitment_jobs_headcount_request_id_fkey'
       AND table_name = 'recruitment_jobs'
  ) THEN
    ALTER TABLE public.recruitment_jobs
      ADD CONSTRAINT recruitment_jobs_headcount_request_id_fkey
      FOREIGN KEY (headcount_request_id)
      REFERENCES public.headcount_requests(id) ON DELETE SET NULL;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
