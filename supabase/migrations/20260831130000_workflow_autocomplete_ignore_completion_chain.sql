-- 2026-08-31 流程結案:停用「完成簽核鏈」閘門
--
-- 問題:部分流程範本在設定裡掛了一條「完成簽核鏈」(completion_chain_id),
--   任務全做完後不直接結案,而是要再走一條額外簽核鏈(例:門市稽核簽核鏈→兔兔確認)。
--   但啟動那條鏈的程式只寫在網頁「工作流」頁,門市/LIFF 完成任務不會啟動 → 流程永遠卡「進行中」;
--   就算啟動了也長期沒人簽(#443 掛兩個月)。
--
-- 決策:完成簽核鏈停用。任務全做完 → 流程直接結案(不論從哪個介面完成)。
--   _trg_workflow_autocomplete 拿掉 completion_chain_id IS NULL 條件,並涵蓋 '待簽核' 狀態,
--   讓結案邏輯統一在 DB(不再依賴前端頁面)。

CREATE OR REPLACE FUNCTION public._trg_workflow_autocomplete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- 任務被標記已完成時:若該流程已無未完成任務 → 直接結案。
  -- 「完成簽核鏈」已停用(2026-08-31):做完就結案,不再卡在「待簽核」等額外簽核。
  IF NEW.status = '已完成' AND COALESCE(OLD.status,'') <> '已完成' AND NEW.workflow_instance_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.workflow_instances wi
                WHERE wi.id = NEW.workflow_instance_id
                  AND wi.status IN ('進行中','待簽核') AND wi.archived_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.tasks t
                        WHERE t.workflow_instance_id = NEW.workflow_instance_id
                          AND t.archived_at IS NULL AND t.status <> '已完成') THEN
      UPDATE public.workflow_instances
         SET status = '已完成', completed_at = now()
       WHERE id = NEW.workflow_instance_id AND status IN ('進行中','待簽核');
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- 回填當下卡住的實例(任務全完成卻沒結案)
UPDATE public.workflow_instances
   SET status='已完成', completed_at=COALESCE(completed_at, now()),
       chain_status='未啟動', chain_current_step=0
 WHERE id IN (427,430,443,548)
   AND status IN ('進行中','待簽核');

-- 關掉 #443 掛著的完成鏈 ash(避免簽核中心殘留待簽)
UPDATE public.approval_step_history
   SET exited_at=now(), action='cancelled'
 WHERE request_type='workflow' AND request_id=443 AND exited_at IS NULL;
