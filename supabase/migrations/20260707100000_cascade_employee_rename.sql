-- 員工改名連動：改 employees.name 時，自動更新所有反正規化的姓名文字欄
-- 2026-07-07（v3：連 salary_records 也同步，薪資頁顯示新名字）
-- 背景：name（姓名）在多處被當文字鍵用（打卡/請假/加班/薪資/排班/補打卡/外出/希望休/
--   任務負責人/門市店長/部門主管/下屬 supervisor + 排班偏好）。過去改名不會回填這些欄，
--   導致歷史紀錄掛舊名（例：洪虎→韓德森 後，舊打卡仍是洪虎；薪資頁靠 salary_records.employee
--   文字比對，舊名會讓員工看不到自己的薪資、部門/門市篩選對不到）。
-- 修法：
--   (0) 薪資結算閘門加「系統同步」繞道 GUC（salary.bypass_lock），比照 schedules 既有做法。
--       改名只改姓名文字、不動金額/status，不是真正結算，故可安全繞過閘門。
--   (1) 一次性 backfill：把有 employee_id 的表 text 欄對齊到目前 name（修既有漂移）。
--   (2) AFTER UPDATE OF name trigger：之後改名（含老闆直接在 Studio 改）自動連動，用
--       employee_id 精準比對（同名不誤傷），並在連動期間設兩個 bypass GUC 繞過排班/薪資鎖。
-- idempotent：CREATE OR REPLACE + DROP/CREATE trigger；backfill 用 IS DISTINCT FROM 只改有差的。不刪任何資料。

-- ── (0) 薪資結算閘門：加「系統同步」繞道（只在改名連動時繞過；正常結算不受影響）──
--     dump live 版原樣重建，僅在 BEGIN 後加一行 bypass 早退。
CREATE OR REPLACE FUNCTION public.enforce_salary_requires_locked_schedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_store_id   INT;
  v_store_name TEXT;
BEGIN
  -- ★ 系統同步（改名連動）只改姓名文字、非真正結算 → 繞過閘門
  IF current_setting('salary.bypass_lock', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- 只擋正式結算；草稿（試算暫存、逐筆調整前）放行
  IF COALESCE(NEW.status, 'finalized') <> 'finalized' THEN
    RETURN NEW;
  END IF;

  SELECT e.store_id INTO v_store_id FROM employees e WHERE e.id = NEW.employee_id;

  -- 沒門市（固定行政工時，無變動班表可鎖）或查不到員工 → 放行
  IF v_store_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 有門市 → 該月班表必須已鎖定
  IF NOT EXISTS (
    SELECT 1 FROM schedule_month_locks l
    WHERE l.store_id = v_store_id
      AND l.month = NEW.month
  ) THEN
    SELECT name INTO v_store_name FROM stores WHERE id = v_store_id;
    RAISE EXCEPTION '「%」% 班表尚未鎖定，無法結算薪資',
      COALESCE(v_store_name, '門市#' || v_store_id), NEW.month
      USING HINT = '請先到排班頁鎖定此門市的該月份，再結算薪資';
  END IF;

  RETURN NEW;
END $function$;

-- ── (1) 一次性 backfill 既有漂移（系統同步，繞過排班/薪資鎖）──
SELECT set_config('schedules.bypass_lock', 'on', false);
SELECT set_config('salary.bypass_lock',    'on', false);

UPDATE public.attendance_records t SET employee = e.name FROM public.employees e
  WHERE t.employee_id = e.id AND t.employee IS DISTINCT FROM e.name;
UPDATE public.leave_requests    t SET employee = e.name FROM public.employees e
  WHERE t.employee_id = e.id AND t.employee IS DISTINCT FROM e.name;
UPDATE public.overtime_requests t SET employee = e.name FROM public.employees e
  WHERE t.employee_id = e.id AND t.employee IS DISTINCT FROM e.name;
UPDATE public.salary_records    t SET employee = e.name FROM public.employees e
  WHERE t.employee_id = e.id AND t.employee IS DISTINCT FROM e.name;
UPDATE public.schedules         t SET employee = e.name FROM public.employees e
  WHERE t.employee_id = e.id AND t.employee IS DISTINCT FROM e.name;
UPDATE public.clock_corrections t SET employee = e.name FROM public.employees e
  WHERE t.employee_id = e.id AND t.employee IS DISTINCT FROM e.name;
UPDATE public.business_trips     t SET employee = e.name FROM public.employees e
  WHERE t.employee_id = e.id AND t.employee IS DISTINCT FROM e.name;
UPDATE public.off_requests      t SET employee = e.name FROM public.employees e
  WHERE t.employee_id = e.id AND t.employee IS DISTINCT FROM e.name;
UPDATE public.tasks             t SET assignee = e.name FROM public.employees e
  WHERE t.assignee_id = e.id AND t.assignee IS DISTINCT FROM e.name;
UPDATE public.stores            t SET manager  = e.name FROM public.employees e
  WHERE t.manager_id  = e.id AND t.manager  IS DISTINCT FROM e.name;
UPDATE public.departments       t SET head     = e.name FROM public.employees e
  WHERE t.manager_id  = e.id AND t.head     IS DISTINCT FROM e.name;
UPDATE public.employees         t SET supervisor = e.name FROM public.employees e
  WHERE t.supervisor_id = e.id AND t.supervisor IS DISTINCT FROM e.name;

SELECT set_config('schedules.bypass_lock', 'off', false);
SELECT set_config('salary.bypass_lock',    'off', false);

-- ── (2) 改名連動 trigger ──
CREATE OR REPLACE FUNCTION public.tg_cascade_employee_rename()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    -- 系統同步：繞過排班已鎖 / 薪資結算閘門（只同步姓名文字，非改班表/結算）
    PERFORM set_config('schedules.bypass_lock', 'on', true);
    PERFORM set_config('salary.bypass_lock',    'on', true);

    UPDATE public.attendance_records  SET employee = NEW.name WHERE employee_id = NEW.id AND employee IS DISTINCT FROM NEW.name;
    UPDATE public.leave_requests      SET employee = NEW.name WHERE employee_id = NEW.id AND employee IS DISTINCT FROM NEW.name;
    UPDATE public.overtime_requests   SET employee = NEW.name WHERE employee_id = NEW.id AND employee IS DISTINCT FROM NEW.name;
    UPDATE public.salary_records      SET employee = NEW.name WHERE employee_id = NEW.id AND employee IS DISTINCT FROM NEW.name;
    UPDATE public.schedules           SET employee = NEW.name WHERE employee_id = NEW.id AND employee IS DISTINCT FROM NEW.name;
    UPDATE public.clock_corrections   SET employee = NEW.name WHERE employee_id = NEW.id AND employee IS DISTINCT FROM NEW.name;
    UPDATE public.business_trips      SET employee = NEW.name WHERE employee_id = NEW.id AND employee IS DISTINCT FROM NEW.name;
    UPDATE public.off_requests        SET employee = NEW.name WHERE employee_id = NEW.id AND employee IS DISTINCT FROM NEW.name;
    -- employee_availability 無 employee_id，只能用舊名比對（同名罕見）
    UPDATE public.employee_availability SET employee = NEW.name WHERE employee = OLD.name;
    -- 其他 FK 命名欄
    UPDATE public.tasks       SET assignee   = NEW.name WHERE assignee_id   = NEW.id AND assignee   IS DISTINCT FROM NEW.name;
    UPDATE public.stores      SET manager    = NEW.name WHERE manager_id    = NEW.id AND manager    IS DISTINCT FROM NEW.name;
    UPDATE public.departments SET head       = NEW.name WHERE manager_id    = NEW.id AND head       IS DISTINCT FROM NEW.name;
    UPDATE public.employees   SET supervisor = NEW.name WHERE supervisor_id = NEW.id AND supervisor IS DISTINCT FROM NEW.name;

    PERFORM set_config('schedules.bypass_lock', 'off', true);
    PERFORM set_config('salary.bypass_lock',    'off', true);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cascade_employee_rename ON public.employees;
CREATE TRIGGER trg_cascade_employee_rename
  AFTER UPDATE OF name ON public.employees FOR EACH ROW
  EXECUTE FUNCTION public.tg_cascade_employee_rename();
