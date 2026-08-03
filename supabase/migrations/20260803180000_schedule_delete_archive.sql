-- 班表刪除歸檔(止血:刪掉可還原 + 留痕)— 2026-08-03
-- ════════════════════════════════════════════════════════════════════════════
-- 慘案:中山國小 6 位員工八月班表被刪、無痕消失(schedules 硬刪、無 deleted_at、無稽核、
--   PITR 未開)。為避免再發生:在 schedules 加「BEFORE DELETE 歸檔」trigger —— 任何途徑
--   (手刪一格 / 發布覆蓋 / 清除本月 / Studio 手動)刪掉班表列,都先把整列快照存進
--   schedule_deletions,並記錄刪除時間 + 執行者(auth.uid → 員工姓名)。
--   救援 = 從 schedule_deletions re-insert;稽核 = 查得到誰在何時刪了哪些。
--   不改前端讀取/刪除邏輯(零風險,不影響班表顯示)。idempotent。
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.schedule_deletions (
  id              bigserial PRIMARY KEY,
  original_id     int,
  employee        text,
  employee_id     int,
  date            date,
  shift           text,
  source_store    text,
  organization_id int,
  row_json        jsonb,          -- 整列快照(還原用,含所有欄位)
  deleted_at      timestamptz NOT NULL DEFAULT now(),
  deleted_by_uid  uuid,
  deleted_by_name text
);
CREATE INDEX IF NOT EXISTS idx_sched_del_emp_date ON public.schedule_deletions (employee_id, date);
CREATE INDEX IF NOT EXISTS idx_sched_del_deleted_at ON public.schedule_deletions (deleted_at);

-- RLS:員工看自己 org 的歸檔;寫入只由 DEFINER trigger(不開任何 INSERT/UPDATE/DELETE policy)
ALTER TABLE public.schedule_deletions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sched_del_select ON public.schedule_deletions;
CREATE POLICY sched_del_select ON public.schedule_deletions
  FOR SELECT TO authenticated
  USING (public.org_visible(organization_id));

CREATE OR REPLACE FUNCTION public._archive_deleted_schedule()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_name text;
BEGIN
  IF v_uid IS NOT NULL THEN
    SELECT name INTO v_name FROM public.employees WHERE auth_user_id = v_uid LIMIT 1;
  END IF;
  INSERT INTO public.schedule_deletions (
    original_id, employee, employee_id, date, shift, source_store, organization_id,
    row_json, deleted_by_uid, deleted_by_name
  ) VALUES (
    OLD.id, OLD.employee, OLD.employee_id, OLD.date, OLD.shift, OLD.source_store, OLD.organization_id,
    to_jsonb(OLD), v_uid, v_name
  );
  RETURN OLD;
END $$;

-- BEFORE DELETE(與既有 trg_enforce_schedule_lock 並存,依名稱序執行);a_ 前綴確保先歸檔
DROP TRIGGER IF EXISTS a_trg_archive_deleted_schedule ON public.schedules;
CREATE TRIGGER a_trg_archive_deleted_schedule
  BEFORE DELETE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public._archive_deleted_schedule();

NOTIFY pgrst, 'reload schema';
