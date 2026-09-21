-- 班表「編輯」也留痕(補齊操作紀錄)— 2026-08-03
-- ════════════════════════════════════════════════════════════════════════════
-- 20260803180000 已把「刪除」歸檔。這支補「編輯(UPDATE)」:改班前先把舊值整列存進
-- schedule_deletions(op='update'),→ 改錯班可還原成舊值、也查得到誰何時改了什麼。
-- 只在「排班內容」真的變動時記(shift/actual_*/rest/absence/source_store/date/employee_id),
-- 純 status 或無意義更新不記,避免灌爆歸檔。idempotent。需先跑過 180000。
-- ════════════════════════════════════════════════════════════════════════════

-- 區分刪除 / 編輯
ALTER TABLE public.schedule_deletions ADD COLUMN IF NOT EXISTS op text NOT NULL DEFAULT 'delete';

CREATE OR REPLACE FUNCTION public._archive_updated_schedule()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_name text;
BEGIN
  -- 排班內容沒變 → 不記(避免純 status/reorder 灌爆)
  IF  NEW.shift          IS NOT DISTINCT FROM OLD.shift
  AND NEW.actual_start   IS NOT DISTINCT FROM OLD.actual_start
  AND NEW.actual_end     IS NOT DISTINCT FROM OLD.actual_end
  AND NEW.actual_start_2 IS NOT DISTINCT FROM OLD.actual_start_2
  AND NEW.actual_end_2   IS NOT DISTINCT FROM OLD.actual_end_2
  AND NEW.rest_minutes   IS NOT DISTINCT FROM OLD.rest_minutes
  AND NEW.absence_type   IS NOT DISTINCT FROM OLD.absence_type
  AND NEW.source_store   IS NOT DISTINCT FROM OLD.source_store
  AND NEW.date           IS NOT DISTINCT FROM OLD.date
  AND NEW.employee_id    IS NOT DISTINCT FROM OLD.employee_id THEN
    RETURN NEW;
  END IF;

  IF v_uid IS NOT NULL THEN
    SELECT name INTO v_name FROM public.employees WHERE auth_user_id = v_uid LIMIT 1;
  END IF;
  INSERT INTO public.schedule_deletions (
    op, original_id, employee, employee_id, date, shift, source_store, organization_id,
    row_json, deleted_by_uid, deleted_by_name
  ) VALUES (
    'update', OLD.id, OLD.employee, OLD.employee_id, OLD.date, OLD.shift, OLD.source_store, OLD.organization_id,
    to_jsonb(OLD), v_uid, v_name
  );
  RETURN NEW;
END $$;

-- a_ 前綴確保先於鎖定檢查(trg_enforce_schedule_lock)執行
DROP TRIGGER IF EXISTS a_trg_archive_updated_schedule ON public.schedules;
CREATE TRIGGER a_trg_archive_updated_schedule
  BEFORE UPDATE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public._archive_updated_schedule();

NOTIFY pgrst, 'reload schema';
