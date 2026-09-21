-- 部分假(半天特休等)不覆蓋班別:班表保留上班班 + 掛請假標記 — 2026-07-29
-- ════════════════════════════════════════════════════════════════════════════
-- 病灶:_trg_leave_approval_sync_schedule 核准假同步到班表時,ON CONFLICT 一律
--   SET shift='特休'(整格蓋掉),不分整天/部分。→ 只請半天(days=0.8,下午 13:00~19:30)
--   的特休,整格被顯示成「特休」,看不出上午還要上班;出勤也被當整天休。
--   (高承揚 7/22 #231 = days 0.8;7/8 #178? days 0.3 皆如此)
-- 修(產品決定 B:班表 + 請假都要看得到):
--   * 部分假(days < 1)→ **不蓋班別**,只掛 leave_request_id(有班保留班,前端疊「特休」角標;
--     出勤因班別仍是上班班,自動算上班)。整天假(days >= 1 或 NULL)維持原本整格蓋。
--   * 撤回/駁回:部分假只清 leave_request_id(留班);整天假才刪格(避免把保留的班一起刪掉)。
--   * 回填現有被蓋的部分假格:還原班別(從 actual_start/end 時間字串)、保留 leave_request_id。
-- 前端另補:抓已核准部分假 → 格子加「特休」角標(班表+請假都顯示)。
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
    -- 小時假（nursing 等）不寫班表
    IF NEW.unit = 'hour' THEN RETURN NEW; END IF;

    v_shift := public._leave_code_to_shift(NEW.type);
    IF v_shift IS NULL THEN RETURN NEW; END IF;

    -- ★ 部分假(不足一天,如半天特休 days=0.8)→ 不覆蓋班別,只掛標記
    v_partial := (NEW.days IS NOT NULL AND NEW.days < 1);

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

      -- 整天假蓋掉 休/補休 才提醒(部分假不蓋,不需提醒)
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
        -- ★ 部分假:保留原班別,只掛 leave_request_id(有班留班;無班則空格掛標記)
        INSERT INTO public.schedules (employee, employee_id, date, shift, organization_id, leave_request_id)
        VALUES (NEW.employee, NEW.employee_id, v_cur_date, NULL, NEW.organization_id, NEW.id)
        ON CONFLICT (employee, date) DO UPDATE SET
          leave_request_id = EXCLUDED.leave_request_id;   -- 不動 shift → 留班
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
    -- 部分假(格子仍是上班班,shift <> 假別碼)→ 只清標記,留班
    UPDATE public.schedules
       SET leave_request_id = NULL
     WHERE leave_request_id = NEW.id
       AND shift IS NOT NULL
       AND shift IS DISTINCT FROM public._leave_code_to_shift(NEW.type);
    -- 整天假(格子是假別碼或空)→ 刪整格
    DELETE FROM public.schedules
     WHERE leave_request_id = NEW.id
       AND (shift IS NULL OR shift = public._leave_code_to_shift(NEW.type));
  END IF;

  RETURN NEW;
END $function$;

-- ── 回填:現有「部分假被整格蓋成假別」的格子 → 還原班別(從 actual 時間)、保留標記 ──
UPDATE public.schedules s
   SET shift = to_char(s.actual_start, 'HH24:MI') || '~' || to_char(s.actual_end, 'HH24:MI')
  FROM public.leave_requests lr
 WHERE s.leave_request_id = lr.id
   AND lr.deleted_at IS NULL
   AND lr.unit = 'day'
   AND lr.days IS NOT NULL AND lr.days < 1
   AND s.shift = public._leave_code_to_shift(lr.type)      -- 目前仍被蓋成假別碼
   AND s.actual_start IS NOT NULL AND s.actual_end IS NOT NULL;

NOTIFY pgrst, 'reload schema';
