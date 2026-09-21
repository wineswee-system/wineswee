-- 2026-08-19 修:費用單附件寫入被 RLS 擋(驗收人≠申請人 + org 未帶)
--   前端插 expense_request_attachments 沒帶 organization_id → org_scope INSERT policy 失敗。
--   加 BEFORE INSERT 觸發器,從該費用單自動補 org → 同組織的驗收人/簽核人皆可上傳附件。
CREATE OR REPLACE FUNCTION public._ero_att_inherit_org()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.request_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id
      FROM public.expense_requests WHERE id = NEW.request_id;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_ero_att_inherit_org ON public.expense_request_attachments;
CREATE TRIGGER trg_ero_att_inherit_org
  BEFORE INSERT ON public.expense_request_attachments
  FOR EACH ROW EXECUTE FUNCTION public._ero_att_inherit_org();
