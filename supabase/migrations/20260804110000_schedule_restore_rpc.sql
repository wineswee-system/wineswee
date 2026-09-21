-- 班表還原:從 schedule_deletions 一鍵救回誤刪/誤改的班表 — 2026-08-04
-- ════════════════════════════════════════════════════════════════════════════
-- 承 180000(刪除歸檔)/190000(編輯歸檔)。這支加「還原」能力 + 還原留痕:
--   op='delete' → 用整列快照 row_json re-insert 回 schedules(該員工該日已有班則不覆蓋,回報衝突)。
--   op='update' → 把現有那筆(original_id)改回舊值(row_json 快照)。
--   還原後在 schedule_deletions 記 restored_at/by(避免重複還原、留痕)。
-- 權限:排班編輯或鎖定權限(schedule.edit / schedule.lock;admin 角色本就有)。繞過鎖定 guard。
-- idempotent。
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.schedule_deletions ADD COLUMN IF NOT EXISTS restored_at      timestamptz;
ALTER TABLE public.schedule_deletions ADD COLUMN IF NOT EXISTS restored_by_uid  uuid;
ALTER TABLE public.schedule_deletions ADD COLUMN IF NOT EXISTS restored_by_name text;

CREATE OR REPLACE FUNCTION public.restore_schedule_deletion(p_archive_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_rec    public.schedule_deletions;
  v_uid    uuid := auth.uid();
  v_name   text;
  v_new_id int;
BEGIN
  -- 權限:能編輯/鎖定班表者才能還原(admin 角色本就有)
  IF NOT ( public.current_employee_has_permission('schedule.edit')
        OR public.current_employee_has_permission('schedule.lock') ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_PERMISSION');
  END IF;

  SELECT * INTO v_rec FROM public.schedule_deletions WHERE id = p_archive_id;
  IF v_rec.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_rec.restored_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_RESTORED', 'restored_at', v_rec.restored_at);
  END IF;

  SELECT name INTO v_name FROM public.employees WHERE auth_user_id = v_uid LIMIT 1;

  PERFORM set_config('schedules.bypass_lock', 'on', true);  -- 還原是管理動作,繞過鎖定 guard

  IF v_rec.op = 'delete' THEN
    -- 該員工該日現在若已有班表 → 不覆蓋,回報衝突(避免蓋掉新排的班)
    IF EXISTS (SELECT 1 FROM public.schedules
                WHERE employee = v_rec.employee AND date = v_rec.date) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'CONFLICT_EXISTS',
                                'note', v_rec.employee || ' ' || v_rec.date || ' 現已有班表,未覆蓋');
    END IF;
    -- 用整列快照 re-insert(沿用原 id;它已被刪除、序號空著)
    INSERT INTO public.schedules
    SELECT (jsonb_populate_record(NULL::public.schedules, v_rec.row_json)).*
    RETURNING id INTO v_new_id;
  ELSE
    -- op='update':把現有那筆改回舊值快照
    UPDATE public.schedules t SET
      employee       = s.employee,
      employee_id    = s.employee_id,
      date           = s.date,
      shift          = s.shift,
      shift_2        = s.shift_2,
      actual_start   = s.actual_start,
      actual_end     = s.actual_end,
      actual_start_2 = s.actual_start_2,
      actual_end_2   = s.actual_end_2,
      rest_minutes   = s.rest_minutes,
      source_store   = s.source_store
    FROM (SELECT (jsonb_populate_record(NULL::public.schedules, v_rec.row_json)).*) s
    WHERE t.id = v_rec.original_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ORIGINAL_MISSING',
                                'note', '原班表列已不存在(可能之後又被刪),無法回改');
    END IF;
    v_new_id := v_rec.original_id;
  END IF;

  UPDATE public.schedule_deletions
     SET restored_at = now(), restored_by_uid = v_uid, restored_by_name = v_name
   WHERE id = p_archive_id;

  RETURN jsonb_build_object('ok', true, 'schedule_id', v_new_id, 'op', v_rec.op);
END $function$;

GRANT EXECUTE ON FUNCTION public.restore_schedule_deletion(bigint) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
