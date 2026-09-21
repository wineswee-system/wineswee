-- 請假核准同步班表:跨午夜夜班的「收尾日」不寫(靠換日線判斷) — 2026-07-17
-- 情境:夜班(如 18:00~00:00)收在午夜,屬前一天(start)的班。員工整天假填 7/15~7/16
--   (她填的沒錯,夜班做到 7/16 凌晨),系統該解讀成「7/15 一個班」,不是真兩天。
-- 做法(讀換日線判斷,不改任何請假資料,舊單自動對):核准寫班表前先算 v_end——
--   讀 organizations.settings.day_boundary_hour(換天時間,此 org=7,預設6);
--   若 end_date 本身沒排「上班班次」、而前一天(end_date-1)的班「跨午夜且收在換日線前」
--   (actual_end<=actual_start 且 actual_end<=換日線時) → end_date 只是收尾日 →
--   v_end 收回一天、不寫該日。班收在換日線後(如做到早上8點>7點)才算真的跨到 end_date。
-- ★ 逐字保留原 trigger,只加 v_boundary/v_end 宣告 + 迴圈前判斷 + WHILE 條件改 v_end。
--   判斷在寫入迴圈「之前」跑,讀原始班表(此時 start 那天還是夜班、未被覆蓋)。
--   無跨午夜班/無班表時 v_end=end_date,行為完全不變。idempotent。

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

    -- 換日線(換天時間):凌晨幾點前算前一天的班（同打卡；此 org=7，預設 6）
    SELECT COALESCE(NULLIF(o.settings->>'day_boundary_hour', '')::int, 6) INTO v_boundary
    FROM public.organizations o WHERE o.id = NEW.organization_id;
    v_boundary := COALESCE(v_boundary, 6);

    -- ★ 跨午夜收尾日修正:end_date 沒排上班班次、前一天是「跨午夜且收在換日線前」的班 → 收尾日不寫
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
            AND s.actual_end <= s.actual_start                        -- 跨午夜
            AND s.actual_end <= make_time(v_boundary, 0, 0)           -- 收在換日線前 → 屬前一天
       )
    THEN
      v_end := NEW.end_date - 1;
    END IF;

    v_cur_date := NEW.start_date;
    WHILE v_cur_date <= v_end LOOP
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

NOTIFY pgrst, 'reload schema';
