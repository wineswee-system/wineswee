-- 修:部分假核准同步班表時,無現成格子插 shift=NULL → 撞 NOT NULL(LIFF 審核噴系統錯誤)— 2026-08-03
-- ════════════════════════════════════════════════════════════════════════════
-- 病灶:_trg_leave_approval_sync_schedule 部分假分支(20260729120000)用
--   INSERT ... VALUES(..., shift=NULL, ...) ON CONFLICT DO UPDATE leave_request_id。
--   有現成班表 → ON CONFLICT 更新 OK;但「那天沒排班」→ 走 INSERT 新列、shift=NULL
--   → null value in column "shift" violates not-null constraint → 核准整批失敗。
-- 修:部分假改「只 UPDATE 既有格子掛 leave_request_id(留班)」;沒班就不建格
--   (部分假=留班+疊標記,沒班就沒東西可留;不需建空班別列)。整天假分支不動。
-- 只換部分假那段,其餘與 20260729120000 逐字一致。incremental,idempotent。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._trg_leave_approval_sync_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_shift       TEXT;
  v_cur_date    DATE;
  v_old_shift   TEXT;
  v_emp_user_id TEXT;
  v_end         DATE;
  v_boundary    INT;
  v_partial     boolean;
BEGIN
  -- ── 核准 ─────────────────────────────────────────────────
  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准' THEN
    IF NEW.unit = 'hour' THEN RETURN NEW; END IF;

    v_shift := public._leave_code_to_shift(NEW.type);
    IF v_shift IS NULL THEN RETURN NEW; END IF;

    v_partial := (NEW.days IS NOT NULL AND NEW.days < 1);

    SELECT auth_user_id INTO v_emp_user_id
    FROM public.employees WHERE id = NEW.employee_id LIMIT 1;

    SELECT COALESCE(NULLIF(o.settings->>'day_boundary_hour', '')::int, 6) INTO v_boundary
    FROM public.organizations o WHERE o.id = NEW.organization_id;
    v_boundary := COALESCE(v_boundary, 6);

    v_end := NEW.end_date;
    IF NEW.end_date > NEW.start_date
       AND NOT EXISTS (
         SELECT 1 FROM public.schedules s
          WHERE s.employee_id = NEW.employee_id AND s.date = NEW.end_date
            AND s.leave_request_id IS NULL
            AND s.shift IS NOT NULL AND s.shift NOT IN ('例假', '休息', '休')
       )
       AND EXISTS (
         SELECT 1 FROM public.schedules s
          WHERE s.employee_id = NEW.employee_id AND s.date = NEW.end_date - 1
            AND s.actual_start IS NOT NULL AND s.actual_end IS NOT NULL
            AND s.actual_end <= s.actual_start
            AND s.actual_end <= make_time(v_boundary, 0, 0)
       )
    THEN
      v_end := NEW.end_date - 1;
    END IF;

    v_cur_date := NEW.start_date;
    WHILE v_cur_date <= v_end LOOP
      SELECT shift INTO v_old_shift
      FROM public.schedules
      WHERE employee_id = NEW.employee_id AND date = v_cur_date
      LIMIT 1;

      IF NOT v_partial AND v_old_shift IN ('休', '補休') THEN
        INSERT INTO public.notifications (type, title, user_id)
        VALUES (
          'leave_rest_conflict',
          format(
            '班表異動：%s %s 原排 %s，因請假單 #%s（%s）自動改為 %s',
            NEW.employee,
            to_char(v_cur_date, 'MM/DD（Dy）'),
            v_old_shift, NEW.id, v_shift, v_shift
          ),
          v_emp_user_id
        );
      END IF;

      IF v_partial THEN
        -- ★ 部分假:只在已有班的格子掛 leave_request_id(留班);沒排班就不建格
        --   (shift NOT NULL,不能插空班別;部分假=留班+疊標記,沒班就沒東西可留)
        UPDATE public.schedules
           SET leave_request_id = NEW.id
         WHERE employee_id = NEW.employee_id AND date = v_cur_date;
      ELSE
        -- 整天假:維持原行為(整格蓋成假別)
        INSERT INTO public.schedules (employee, employee_id, date, shift, organization_id, leave_request_id)
        VALUES (NEW.employee, NEW.employee_id, v_cur_date, v_shift, NEW.organization_id, NEW.id)
        ON CONFLICT (employee, date) DO UPDATE SET
          shift            = EXCLUDED.shift,
          leave_request_id = EXCLUDED.leave_request_id;
      END IF;

      v_cur_date := v_cur_date + INTERVAL '1 day';
    END LOOP;

  -- ── 撤回 / 駁回 / 取消 ──────────────────────────────────
  ELSIF NEW.status IN ('已駁回', '已取消', '已撤回')
    AND OLD.status NOT IN ('已駁回', '已取消', '已撤回') THEN
    UPDATE public.schedules
       SET leave_request_id = NULL
     WHERE leave_request_id = NEW.id
       AND shift IS NOT NULL
       AND shift IS DISTINCT FROM public._leave_code_to_shift(NEW.type);
    DELETE FROM public.schedules
     WHERE leave_request_id = NEW.id
       AND (shift IS NULL OR shift = public._leave_code_to_shift(NEW.type));
  END IF;

  RETURN NEW;
END $function$;

NOTIFY pgrst, 'reload schema';
