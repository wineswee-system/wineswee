-- 2026-08-19 驗收(核銷)鏈的動態「主管」改吃「驗收人」的主管(原本吃申請人)
--   老闆:東西是驗收人在驗收,應由驗收人的主管把關,不是申請人的主管。
--   改觸發器傳 settle_assignee_id(無則退回 employee_id);並重snapshot還沒開始簽的在飛驗收單。
CREATE OR REPLACE FUNCTION public._trg_snapshot_expense_settle_chain()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = '待核銷'
     AND (OLD.status IS DISTINCT FROM '待核銷' OR OLD.settle_chain_id IS DISTINCT FROM NEW.settle_chain_id)
     AND NEW.settle_chain_id IS NOT NULL THEN
    -- ★驗收鏈動態主管吃「驗收人」的;沒指定驗收人才退回申請人
    PERFORM public._snapshot_settle_chain(NEW.id, NEW.settle_chain_id, COALESCE(NEW.settle_assignee_id, NEW.employee_id));
  END IF;
  RETURN NEW;
END $function$;

-- 重snapshot:待核銷 + 尚未開始簽驗收鏈(settle_current_step=0)的單,改吃驗收人主管
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id, settle_chain_id, COALESCE(settle_assignee_id, employee_id) AS anchor
    FROM public.expense_requests
    WHERE status='待核銷' AND settle_chain_id IS NOT NULL
      AND COALESCE(settle_current_step,0)=0 AND deleted_at IS NULL
      AND settle_assignee_id IS NOT NULL AND settle_assignee_id <> employee_id
  LOOP
    PERFORM public._snapshot_settle_chain(r.id, r.settle_chain_id, r.anchor);
  END LOOP;
END $$;
