-- 錄取簽呈:指定簽核人 + 可核准/駁回 — 2026-07-15
-- 需求:錄取簽呈原本建立後卡在「待審」沒任何地方能核准(半殘)。
--   改成建立時「自己指定簽核人」,只有該員(或招募管理者)能核准/駁回。
-- 加:approver_id(指定簽核人)、reject_reason(駁回原因)。純加法、idempotent。

ALTER TABLE public.offer_letters
  ADD COLUMN IF NOT EXISTS approver_id   integer,
  ADD COLUMN IF NOT EXISTS reject_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name='offer_letters_approver_id_fkey' AND table_name='offer_letters') THEN
    ALTER TABLE public.offer_letters ADD CONSTRAINT offer_letters_approver_id_fkey
      FOREIGN KEY (approver_id) REFERENCES public.employees(id) ON DELETE SET NULL;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
