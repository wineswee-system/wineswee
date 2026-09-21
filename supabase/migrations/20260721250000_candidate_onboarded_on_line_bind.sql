-- 階段4a:新進員工綁 LINE → 候選人「待報到」轉「已報到」— 2026-07-21
-- 報到當天本人綁 LINE(employee_line_accounts 產生列) → 若該員工檔連著某候選人(candidates.employee_id)
--   且該候選人 stage='待報到' → 自動轉「已報到」。idempotent(轉一次;guard stage='待報到')。
-- ⚠️ 現在休眠:要等階段4b 有候選人被建員工檔+綁 employee_id+待報到 才會觸發。

CREATE OR REPLACE FUNCTION public._trg_candidate_onboarded_on_line_bind()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.employee_id IS NOT NULL THEN
    UPDATE public.candidates
       SET stage = '已報到',
           stage_history = COALESCE(stage_history::jsonb,'[]'::jsonb)
                           || jsonb_build_object('stage','已報到','changed_at',now(),'reason','LINE 綁定完成，報到'),
           updated_at = now()
     WHERE employee_id = NEW.employee_id AND stage = '待報到';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_candidate_onboarded_on_line_bind ON public.employee_line_accounts;
CREATE TRIGGER trg_candidate_onboarded_on_line_bind
  AFTER INSERT OR UPDATE OF is_verified, employee_id ON public.employee_line_accounts
  FOR EACH ROW EXECUTE FUNCTION public._trg_candidate_onboarded_on_line_bind();

NOTIFY pgrst, 'reload schema';
