-- headcount_requests 補回缺失欄位 (schema drift) — 2026-07-15
-- 問題:live DB 的 headcount_requests 只有
--   id / headcount / organization_id / status / created_at / updated_at / approved_at,
--   但程式碼(handleAddHcRequest 建單 + handleApproveHcRequest 核准 + 列表 req.creator 顯示)需要
--   dept / position_title / expected_start_date / reason / created_by / reviewed_by / reviewed_at / job_id。
-- 建表 migration 20260520160000 有定義這些欄,但 live 表跟它不符(疑似 Studio 另建精簡版,org 還被寫成 uuid)。
-- 修:idempotent 補回 8 欄 + FK(created_by/reviewed_by→employees, job_id→recruitment_jobs)。純加法。
-- 註:req.creator 的 PostgREST 內嵌關聯需要 created_by FK 才解得出,所以 FK 一定要補。

ALTER TABLE public.headcount_requests
  ADD COLUMN IF NOT EXISTS dept                text,
  ADD COLUMN IF NOT EXISTS position_title      text,
  ADD COLUMN IF NOT EXISTS expected_start_date date,
  ADD COLUMN IF NOT EXISTS reason              text,
  ADD COLUMN IF NOT EXISTS created_by          integer,
  ADD COLUMN IF NOT EXISTS reviewed_by         integer,
  ADD COLUMN IF NOT EXISTS reviewed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS job_id              integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name='headcount_requests_created_by_fkey' AND table_name='headcount_requests') THEN
    ALTER TABLE public.headcount_requests ADD CONSTRAINT headcount_requests_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES public.employees(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name='headcount_requests_reviewed_by_fkey' AND table_name='headcount_requests') THEN
    ALTER TABLE public.headcount_requests ADD CONSTRAINT headcount_requests_reviewed_by_fkey
      FOREIGN KEY (reviewed_by) REFERENCES public.employees(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name='headcount_requests_job_id_fkey' AND table_name='headcount_requests') THEN
    ALTER TABLE public.headcount_requests ADD CONSTRAINT headcount_requests_job_id_fkey
      FOREIGN KEY (job_id) REFERENCES public.recruitment_jobs(id) ON DELETE SET NULL;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
