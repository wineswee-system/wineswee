
-- ════════════════════════════════════════════════════════════
-- 請假 ↔ 班表同步
-- ════════════════════════════════════════════════════════════
--
-- 1. schedules.leave_request_id  — 追蹤哪列是由請假單建立的
-- 2. _leave_code_to_shift()      — 假別 code → 班表 shift label
-- 3. _trg_leave_approval_sync_schedule() — 核准時寫班表；撤/駁時刪
-- 4. trg_leave_approval_sync_schedule    — AFTER UPDATE trigger
-- 5. Backfill 現有已核准請假
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. 欄位：leave_request_id ────────────────────────────────

ALTER TABLE public.schedules
  ADD COLUMN IF NOT EXISTS leave_request_id INT
    REFERENCES public.leave_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_schedules_leave_request_id
  ON public.schedules(leave_request_id);


-- ── 2. 假別代碼 → 班表 shift label ──────────────────────────

CREATE OR REPLACE FUNCTION public._leave_code_to_shift(p_code TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_code
    WHEN 'annual'        THEN '特休'
    WHEN 'sick'          THEN '病'
    WHEN 'personal'      THEN '事'
    WHEN 'official'      THEN '公'
    WHEN 'maternity'     THEN '產'
    WHEN 'paternity'     THEN '陪產'
    WHEN 'menstrual'     THEN '生'
    WHEN 'marriage'      THEN '婚'
    WHEN 'bereavement'   THEN '喪'
    WHEN 'occupational'  THEN '工傷'
    WHEN 'family_care'   THEN '家'
    WHEN 'mental_health' THEN '心'
    WHEN 'prenatal'      THEN '產檢'
    WHEN 'parental'      THEN '育嬰'
    -- nursing 按小時請，不寫班表
    ELSE NULL
  END
$$;


-- ── 3. Trigger function ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public._trg_leave_approval_sync_schedule()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    SELECT user_id INTO v_emp_user_id
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
END $$;


-- ── 4. Trigger ───────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_leave_approval_sync_schedule ON public.leave_requests;
CREATE TRIGGER trg_leave_approval_sync_schedule
  AFTER UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_leave_approval_sync_schedule();


-- ── 5. Backfill：補寫現有已核准、按日單 ────────────────────

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id, employee, employee_id, type, start_date, end_date, organization_id
    FROM public.leave_requests
    WHERE status = '已核准'
      AND unit = 'day'
      AND start_date IS NOT NULL
      AND end_date IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.schedules
        WHERE leave_request_id = leave_requests.id
      )
  LOOP
    DECLARE
      v_shift    TEXT := public._leave_code_to_shift(r.type);
      v_cur_date DATE := r.start_date;
    BEGIN
      IF v_shift IS NULL THEN CONTINUE; END IF;
      WHILE v_cur_date <= r.end_date LOOP
        INSERT INTO public.schedules (employee, employee_id, date, shift, organization_id, leave_request_id)
        VALUES (r.employee, r.employee_id, v_cur_date, v_shift, r.organization_id, r.id)
        ON CONFLICT (employee, date) DO NOTHING;
        v_cur_date := v_cur_date + INTERVAL '1 day';
      END LOOP;
    END;
  END LOOP;
END $$;


COMMIT;

NOTIFY pgrst, 'reload schema';
