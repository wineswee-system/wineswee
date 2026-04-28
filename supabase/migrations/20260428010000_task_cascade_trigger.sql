-- ============================================================
-- 任務 cascade trigger
-- ----------------------------------------------------------
-- 之前只有 web handleStatusChange 觸發 autoProgressDependents，
-- 走 LIFF / BOT / 簽核 RPC 等其他路徑改 status='已完成' 時不會 cascade
-- → 後續步驟卡在「待處理」永遠等不到通知。
--
-- 改成 DB trigger：
--   tasks.status 變成 '已完成' 時，自動找所有依賴它的 task，
--   若它的所有 prerequisite 也都完成 → 自動推進到 '進行中' + started_at = now()
-- ============================================================

CREATE OR REPLACE FUNCTION public._task_cascade_on_complete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  dep_task_id INT;
  all_prereqs_done BOOLEAN;
BEGIN
  -- 只在 status 由非「已完成」轉成「已完成」時 fire
  IF NEW.status = '已完成' AND (OLD.status IS DISTINCT FROM '已完成') THEN

    -- 列出所有依賴本任務的 task
    FOR dep_task_id IN
      SELECT t.id
        FROM public.tasks t
        JOIN public.task_dependencies td ON td.task_id = t.id
       WHERE td.depends_on_task_id = NEW.id
         AND td.dep_type = 'prerequisite'
         AND t.status = '待處理'
    LOOP
      -- 該 task 的所有 prerequisite 都已完成？
      SELECT NOT EXISTS (
        SELECT 1
          FROM public.task_dependencies td2
          JOIN public.tasks t2 ON t2.id = td2.depends_on_task_id
         WHERE td2.task_id = dep_task_id
           AND td2.dep_type = 'prerequisite'
           AND COALESCE(t2.status, '') <> '已完成'
      ) INTO all_prereqs_done;

      IF all_prereqs_done THEN
        UPDATE public.tasks
           SET status = '進行中',
               started_at = COALESCE(started_at, now())
         WHERE id = dep_task_id;
      END IF;
    END LOOP;

  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_cascade_on_complete ON public.tasks;
CREATE TRIGGER trg_task_cascade_on_complete
AFTER UPDATE OF status ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public._task_cascade_on_complete();


-- ── 一次性修復：把目前已經 stuck 的依賴 task 也跑一次 cascade ────
-- (對所有 instance：找 status='待處理' 但 prereqs 都已完成的 task → 推進)
UPDATE public.tasks t
   SET status = '進行中',
       started_at = COALESCE(t.started_at, now())
 WHERE t.status = '待處理'
   AND t.workflow_instance_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.task_dependencies td
     WHERE td.task_id = t.id AND td.dep_type = 'prerequisite'
   )
   AND NOT EXISTS (
     SELECT 1
       FROM public.task_dependencies td2
       JOIN public.tasks t2 ON t2.id = td2.depends_on_task_id
      WHERE td2.task_id = t.id
        AND td2.dep_type = 'prerequisite'
        AND COALESCE(t2.status, '') <> '已完成'
   );


-- 通知 PostgREST 重載 schema cache
NOTIFY pgrst, 'reload schema';
