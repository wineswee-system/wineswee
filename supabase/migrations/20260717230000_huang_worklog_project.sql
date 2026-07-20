-- 建立「黃蘊珊的工作日誌」專案 — 2026-07-17
-- 結構:1 專案 → 6 個月流程(2026-07~12) → 每天一任務(標題=日期)。
--   7月只 17~31,8~12 整月。負責人全部黃蘊珊(id=148),任務全部「未開始」。
-- 注意:插入時暫停 trg_task_auto_start(否則每月首日會被自動轉進行中+發LINE)。
--   放在 DO block 內,block 原子性→失敗會連同 DISABLE 一起 rollback,不會殘留。
--   task_code/workflow_code 由既有 trigger 自動產;tasks.assignee 由 tg_sync_task_assignee 從 assignee_id 反推。
-- idempotent:專案已存在就跳過。

DO $$
DECLARE
  v_proj int; v_wf int;
  v_emp  int := 148;   -- 黃蘊珊
  v_org  int := 1;
  v_months date[] := ARRAY['2026-07-01','2026-08-01','2026-09-01','2026-10-01','2026-11-01','2026-12-01']::date[];
  i int; v_start date; v_end date; d date; mn text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.projects WHERE name = '黃蘊珊的工作日誌' AND owner_id = v_emp) THEN
    RAISE NOTICE '專案已存在,跳過'; RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.tasks DISABLE TRIGGER trg_task_auto_start';

  -- 專案
  INSERT INTO public.projects (name, description, status, priority, owner, owner_id, department, start_date, end_date, progress, organization_id)
  VALUES ('黃蘊珊的工作日誌', '每日工作日誌：一月一流程、一天一任務', '進行中', '中', '黃蘊珊', v_emp, '營運部', DATE '2026-07-17', DATE '2026-12-31', 0, v_org)
  RETURNING id INTO v_proj;

  -- 每月一個流程 + 每天一個任務
  FOR i IN 1..array_length(v_months, 1) LOOP
    v_start := CASE WHEN i = 1 THEN DATE '2026-07-17' ELSE v_months[i] END;
    v_end   := (v_months[i] + INTERVAL '1 month' - INTERVAL '1 day')::date;
    mn      := to_char(v_months[i], 'YYYY"年"FMMM"月"');

    INSERT INTO public.workflow_instances (template_name, status, started_by, started_by_id, assignee, project_id, organization_id, department, priority, started_at, sort_order)
    VALUES (mn || ' 工作日誌', '進行中', '黃蘊珊', v_emp, '黃蘊珊', v_proj, v_org, '營運部', '中', now(), i)
    RETURNING id INTO v_wf;

    FOR d IN SELECT generate_series(v_start, v_end, INTERVAL '1 day')::date LOOP
      INSERT INTO public.tasks (title, status, assignee_id, project_id, workflow_instance_id, step_order, due_date, priority, organization_id)
      VALUES (to_char(d, 'YYYY-MM-DD'), '未開始', v_emp, v_proj, v_wf, EXTRACT(DAY FROM d)::int, d, '中', v_org);
    END LOOP;
  END LOOP;

  EXECUTE 'ALTER TABLE public.tasks ENABLE TRIGGER trg_task_auto_start';
  RAISE NOTICE '完成:project=% / 6 流程 / 7月17-31 + 8~12整月 每天一任務(全未開始,負責人黃蘊珊)', v_proj;
END $$;

NOTIFY pgrst, 'reload schema';
