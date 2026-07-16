-- 新增會計科目 038 進貨(費用類、所有人可用) — 2026-07-16
-- pick_scope='all' → 一般人申請單也選得到(非限財務/人資)。idempotent。

INSERT INTO public.accounts (code, name, type, pick_scope, balance, organization_id)
SELECT '038', '進貨', '費用', 'all', 0, 1
WHERE NOT EXISTS (
  SELECT 1 FROM public.accounts WHERE code = '038' AND organization_id = 1
);

NOTIFY pgrst, 'reload schema';
