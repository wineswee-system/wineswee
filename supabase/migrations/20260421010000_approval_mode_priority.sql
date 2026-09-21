-- ============================================================
-- Approval form: add priority + execution mode (sequential / parallel)
-- And task_confirmations: add priority for acknowledgement requests
-- ============================================================

BEGIN;

ALTER TABLE public.approval_forms
  ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT '中'
    CHECK (priority IN ('低', '中', '高')),
  ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'sequential'
    CHECK (mode IN ('sequential', 'parallel'));

COMMENT ON COLUMN public.approval_forms.priority IS
  'Approval urgency: 低/中/高 (default 中).';
COMMENT ON COLUMN public.approval_forms.mode IS
  'sequential = steps activate one by one; parallel = all steps activate at once.';

ALTER TABLE public.task_confirmations
  ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT '中'
    CHECK (priority IN ('低', '中', '高'));

COMMIT;
