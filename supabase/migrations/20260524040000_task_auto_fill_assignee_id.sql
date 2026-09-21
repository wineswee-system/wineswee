-- ════════════════════════════════════════════════════════════════════════════
-- task: 自動補 assignee_id（從 assignee 名字反查）
-- ----------------------------------------------------------------------------
-- 問題：很多前端 path 建 task 時只寫 assignee text，沒寫 assignee_id
--   （employees 沒載完 / race condition / 舊資料 / 模板生成）
--   導致 cascade trigger 的 IF v_next.assignee_id IS NOT NULL 跳過，
--   完成 task → 下一關沒推通知。
--
-- 修法：BEFORE INSERT / BEFORE UPDATE 時，如果 assignee 有值但 assignee_id
--   是 NULL → 用 organization_id + 名字找到 employee.id 補上
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._task_resolve_assignee_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp_id INT;
  v_org_id INT;
BEGIN
  -- 已經有 assignee_id 或 assignee 是空 → 不動
  IF NEW.assignee_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.assignee IS NULL OR btrim(NEW.assignee) = '' THEN RETURN NEW; END IF;

  -- 找 org_id：優先用任務自己的，否則用建任務者的 employee.organization_id
  v_org_id := NEW.organization_id;

  -- 找在職員工，同名優先 organization_id 對得上
  IF v_org_id IS NOT NULL THEN
    SELECT id INTO v_emp_id FROM employees
     WHERE name = btrim(NEW.assignee)
       AND organization_id = v_org_id
       AND status = '在職'
     ORDER BY id LIMIT 1;
  END IF;

  -- 找不到再放寬到所有在職員工
  IF v_emp_id IS NULL THEN
    SELECT id INTO v_emp_id FROM employees
     WHERE name = btrim(NEW.assignee)
       AND status = '在職'
     ORDER BY id LIMIT 1;
  END IF;

  IF v_emp_id IS NOT NULL THEN
    NEW.assignee_id := v_emp_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_resolve_assignee_id ON public.tasks;
CREATE TRIGGER trg_task_resolve_assignee_id
  BEFORE INSERT OR UPDATE OF assignee ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._task_resolve_assignee_id();


-- ─── 一次性：把現有 assignee 有但 assignee_id 是 NULL 的 task 補起來 ────
-- 只補在職員工同名能找到的
UPDATE public.tasks t
   SET assignee_id = e.id
  FROM public.employees e
 WHERE t.assignee_id IS NULL
   AND t.assignee IS NOT NULL
   AND btrim(t.assignee) <> ''
   AND e.name = btrim(t.assignee)
   AND e.status = '在職'
   AND (
     t.organization_id IS NULL
     OR e.organization_id = t.organization_id
   );

COMMIT;

NOTIFY pgrst, 'reload schema';
