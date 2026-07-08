-- 修:請假核准炸「column user_id does not exist」— 2026-07-08
-- 真兇：_trg_leave_approval_sync_schedule(請假核准後同步排班)第22行
--   SELECT user_id FROM employees —— employees 欄位是 auth_user_id，不是 user_id
--   (先前 RLS 大改把 user_id 改名成 auth_user_id，此 trigger 沒跟著改，一核准就炸)。
-- 加班/補打卡沒這個 trigger → 只有請假中；且要走到「已核准」才 fire，所以現在才爆。
-- 只改這一個 SELECT 的欄位名。idempotent。

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
BEGIN
  -- ── 核准 ─────────────────────────────────────────────────
  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准' THEN
    -- 小時假（nursing 等）不寫班表
    IF NEW.unit = 'hour' THEN RETURN NEW; END IF;

    v_shift := public._leave_code_to_shift(NEW.type);
    IF v_shift IS NULL THEN RETURN NEW; END IF;

    -- 取員工 auth user_id（通知用）
    SELECT auth_user_id INTO v_emp_user_id
    FROM public.employees WHERE id = NEW.employee_id LIMIT 1;

    v_cur_date := NEW.start_date;
    WHILE v_cur_date <= NEW.end_date LOOP
      -- 檢查當天班表是否已排 休/補休
      SELECT shift INTO v_old_shift
      FROM public.schedules
      WHERE employee_id = NEW.employee_id AND date = v_cur_date
      LIMIT 1;

      IF v_old_shift IN ('休', '補休') THEN
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

      -- 寫入班表（employee,date 有唯一約束，ON CONFLICT 覆蓋）
      INSERT INTO public.schedules (employee, employee_id, date, shift, organization_id, leave_request_id)
      VALUES (
        NEW.employee, NEW.employee_id, v_cur_date, v_shift,
        NEW.organization_id, NEW.id
      )
      ON CONFLICT (employee, date) DO UPDATE SET
        shift            = EXCLUDED.shift,
        leave_request_id = EXCLUDED.leave_request_id;

      v_cur_date := v_cur_date + INTERVAL '1 day';
    END LOOP;

  -- ── 撤回 / 駁回 / 取消 ──────────────────────────────────
  ELSIF NEW.status IN ('已駁回', '已取消', '已撤回')
    AND OLD.status NOT IN ('已駁回', '已取消', '已撤回') THEN
    DELETE FROM public.schedules
    WHERE leave_request_id = NEW.id;
  END IF;

  RETURN NEW;
END $function$;
