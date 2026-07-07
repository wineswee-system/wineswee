-- 員工改名連動：改 employees.name 時，自動更新所有反正規化的姓名文字欄
-- 2026-07-07（v2：避開業務閘門）
-- 背景：name（姓名）在多處被當文字鍵用（打卡/請假/加班/排班/補打卡/外出/希望休/
--   任務負責人/門市店長/部門主管/下屬 supervisor + 排班偏好）。過去改名不會回填這些欄，
--   導致歷史紀錄掛舊名（例：洪虎→韓德森 後，舊打卡仍是洪虎）。
-- 修法：
--   (1) 一次性 backfill：把有 employee_id 的表 text 欄對齊到目前 name（修既有漂移）。
--   (2) AFTER UPDATE OF name trigger：之後改名（含老闆直接在 Studio 改）自動連動，用
--       employee_id 精準比對（同名不誤傷）。
-- ★ 避開業務閘門（v2 修正）：
--   - salary_records：有「班表未鎖不能結算」閘門，且薪資單應顯示「結算當時的名字」（歷史正確）
--     → 不納入連動，維持原樣。
--   - schedules：有「已發布鎖定不准改」閘門，但它內建 GUC 繞道 schedules.bypass_lock='on'
--     → 改名屬系統同步，設此 GUC 讓連動能改到已鎖排班（不影響鎖定本身的意義）。
-- idempotent：backfill 用 IS DISTINCT FROM 只改有差的；trigger DROP+CREATE。不刪任何資料。

-- 這次 backfill 允許繞過排班鎖（系統同步歷史姓名，非修改班表內容）
SELECT set_config('schedules.bypass_lock', 'on', false);

-- ── (1) 一次性 backfill 既有漂移（有 employee_id 的表；不含 salary_records）──
UPDATE public.attendance_records t SET employee = e.name FROM public.employees e
  WHERE t.employee_id = e.id AND t.employee IS DISTINCT FROM e.name;
UPDATE public.leave_requests    t SET employee = e.name FROM public.employees e
  WHERE t.employee_id = e.id AND t.employee IS DISTINCT FROM e.name;
UPDATE public.overtime_requests t SET employee = e.name FROM public.employees e
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

-- ── (2) 改名連動 trigger ──
CREATE OR REPLACE FUNCTION public.tg_cascade_employee_rename()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    -- 排班已鎖定的列也要同步姓名（系統同步，非改班表內容）→ 用內建 GUC 繞過鎖
    PERFORM set_config('schedules.bypass_lock', 'on', true);

    UPDATE public.attendance_records  SET employee = NEW.name WHERE employee_id = NEW.id AND employee IS DISTINCT FROM NEW.name;
    UPDATE public.leave_requests      SET employee = NEW.name WHERE employee_id = NEW.id AND employee IS DISTINCT FROM NEW.name;
    UPDATE public.overtime_requests   SET employee = NEW.name WHERE employee_id = NEW.id AND employee IS DISTINCT FROM NEW.name;
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
    -- 註：salary_records 刻意不連動（薪資單顯示結算當時姓名 + 避開薪資結算閘門）
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cascade_employee_rename ON public.employees;
CREATE TRIGGER trg_cascade_employee_rename
  AFTER UPDATE OF name ON public.employees FOR EACH ROW
  EXECUTE FUNCTION public.tg_cascade_employee_rename();
