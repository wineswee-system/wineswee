-- 綁定表單「他人填」通知改成「任務進行中才發」(對齊 self 填的行為)。
-- 現況:assign_task_form_binding_filler 一指派就即時發「請你填寫表單」,不看任務狀態 → 任務還沒輪到就打擾被指派人。
-- 改法(加新東西為主,不動 self 起跑卡 _task_enqueue_started_notify):
--   1. 指派 RPC 加守門:任務已「進行中」才即時發;否則只指派、先不發(deferred)。
--   2. 新 helper _notify_task_other_fillers:補發「請你填寫表單」給該任務所有「他人填」被指派、且尚未填的人。
--   3. 新觸發器:任務一變「進行中」(cascade 輪到)就呼叫 helper 補發。
-- 冪等/防重:未進行中時 RPC 不發→由觸發器發;已進行中時 RPC 發→觸發器只在「轉入進行中」那一刻各發一次,不重疊。

-- ── 1. 指派 RPC 加狀態守門 ──
CREATE OR REPLACE FUNCTION public.assign_task_form_binding_filler(p_binding_id integer, p_employee_id integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url   CONSTANT TEXT := 'https://uoernfpfieurtjqwbnii.supabase.co/functions/v1/hr-notify';
  v_anon  CONSTANT TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvZXJuZnBmaWV1cnRqcXdibmlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3Nzg0NDUsImV4cCI6MjEwMDM1NDQ0NX0.jubKj63U9L4GiosFbu0p530zepbcdVTG86XSua1SnsU';
  v_b     task_form_bindings;
  v_task  tasks;
  v_has_line BOOLEAN;
BEGIN
  UPDATE task_form_bindings
     SET fill_mode = 'other', assignee_id = p_employee_id
   WHERE id = p_binding_id
  RETURNING * INTO v_b;
  IF v_b.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'BINDING_NOT_FOUND'); END IF;

  SELECT * INTO v_task FROM tasks WHERE id = v_b.task_id;

  -- ★ 任務還沒輪到(非進行中)→ 只指派,先不通知;等任務進行中由 trg_task_notify_other_fillers_on_start 補發
  IF v_task.status IS DISTINCT FROM '進行中' THEN
    RETURN json_build_object('ok', true, 'notified', false, 'deferred', true);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM v_employee_line_resolved v
     WHERE v.employee_id = p_employee_id AND v.line_user_id IS NOT NULL
  ) INTO v_has_line;

  IF v_has_line THEN
    PERFORM net.http_post(
      url := v_url,
      body := jsonb_build_object(
        'employee_id', p_employee_id,
        'type', 'form_binding_fill_assigned',
        'details', jsonb_build_object(
          'binding_id',  v_b.id,
          'form_label',  v_b.form_label,
          'form_type',   v_b.form_type,
          'task_id',     v_b.task_id,
          'task_title',  v_task.title,
          'due_date',    v_task.due_date,
          'due_time',    v_task.due_time,
          'store',       v_task.store
        )
      ),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon),
      timeout_milliseconds := 5000
    );
  END IF;

  RETURN json_build_object('ok', true, 'notified', v_has_line);
END $function$;

-- ── 2. helper:補發「請你填寫表單」給該任務所有「他人填」被指派、尚未填的人 ──
CREATE OR REPLACE FUNCTION public._notify_task_other_fillers(p_task_id integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url   CONSTANT TEXT := 'https://uoernfpfieurtjqwbnii.supabase.co/functions/v1/hr-notify';
  v_anon  CONSTANT TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvZXJuZnBmaWV1cnRqcXdibmlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3Nzg0NDUsImV4cCI6MjEwMDM1NDQ0NX0.jubKj63U9L4GiosFbu0p530zepbcdVTG86XSua1SnsU';
  v_task  tasks;
  v_b     task_form_bindings;
  v_sent  int := 0;
BEGIN
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF v_task.id IS NULL OR v_task.status IS DISTINCT FROM '進行中' THEN RETURN 0; END IF;

  FOR v_b IN
    SELECT * FROM task_form_bindings
     WHERE task_id = p_task_id
       AND COALESCE(fill_mode, 'self') = 'other'
       AND assignee_id IS NOT NULL
       AND COALESCE(status, '未填') NOT IN ('已完成', '簽核中')   -- 已在填/完成的不再催
  LOOP
    IF EXISTS (
      SELECT 1 FROM v_employee_line_resolved v
       WHERE v.employee_id = v_b.assignee_id AND v.line_user_id IS NOT NULL
    ) THEN
      PERFORM net.http_post(
        url := v_url,
        body := jsonb_build_object(
          'employee_id', v_b.assignee_id,
          'type', 'form_binding_fill_assigned',
          'details', jsonb_build_object(
            'binding_id',  v_b.id,
            'form_label',  v_b.form_label,
            'form_type',   v_b.form_type,
            'task_id',     v_b.task_id,
            'task_title',  v_task.title,
            'due_date',    v_task.due_date,
            'due_time',    v_task.due_time,
            'store',       v_task.store
          )
        ),
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon),
        timeout_milliseconds := 5000
      );
      v_sent := v_sent + 1;
    END IF;
  END LOOP;
  RETURN v_sent;
END $function$;

-- ── 3. 觸發器:任務轉入「進行中」時補發 ──
CREATE OR REPLACE FUNCTION public._trg_notify_other_fillers_on_start()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = '進行中' AND OLD.status IS DISTINCT FROM '進行中' THEN
    PERFORM public._notify_task_other_fillers(NEW.id);
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_task_notify_other_fillers_on_start ON public.tasks;
CREATE TRIGGER trg_task_notify_other_fillers_on_start
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_other_fillers_on_start();
