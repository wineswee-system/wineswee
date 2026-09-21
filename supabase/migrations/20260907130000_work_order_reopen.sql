-- 跨部門工單:申請人在「已完成」關可「駁回(打回重做)」→ 退回「處理中」交回原承辦人
--   - reopen_work_order(p_id, p_reason):守門=申請人或 admin;狀態須「已完成」
--   - 狀態 已完成 → 處理中,記 reject_reason、清 completed_at
--   - 通知:把「已完成→處理中」這個轉換判成新事件 'reopened'(而非誤發「已受理」),通知承辦人重做
-- 增量:CREATE OR REPLACE 既有兩支(逐字對照 live,只加最小分支)+ 新增兩支

-- 1) 通知事件:加 'reopened' 目標=承辦人(+目標部門主管當備援)
CREATE OR REPLACE FUNCTION public._notify_work_order_event(p_id integer, p_event text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url  CONSTANT text := 'https://uoernfpfieurtjqwbnii.supabase.co/functions/v1/hr-notify';
  v_anon CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvZXJuZnBmaWV1cnRqcXdibmlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3Nzg0NDUsImV4cCI6MjEwMDM1NDQ0NX0.jubKj63U9L4GiosFbu0p530zepbcdVTG86XSua1SnsU';
  v_wo      public.work_orders;
  v_mgr     int;
  v_targets int[];
  r_target  RECORD;
  v_payload jsonb;
  v_count   int := 0;
BEGIN
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_id;
  IF v_wo.id IS NULL THEN RETURN 0; END IF;
  SELECT manager_id INTO v_mgr FROM public.departments WHERE id = v_wo.target_department_id;

  v_targets := CASE p_event
    WHEN 'created'   THEN ARRAY[v_mgr, v_wo.assignee_id]
    WHEN 'accepted'  THEN ARRAY[v_wo.requester_id, v_wo.assignee_id]
    WHEN 'completed' THEN ARRAY[v_wo.requester_id]
    WHEN 'rejected'  THEN ARRAY[v_wo.requester_id]
    WHEN 'confirmed' THEN ARRAY[v_wo.assignee_id]
    WHEN 'reopened'  THEN ARRAY[v_wo.assignee_id, v_mgr]   -- ★ 駁回打回重做 → 通知承辦人
    ELSE ARRAY[]::int[] END;

  FOR r_target IN
    SELECT DISTINCT v.employee_id
      FROM public.v_employee_line_resolved v
     WHERE v.employee_id = ANY(v_targets) AND v.employee_id IS NOT NULL AND v.line_user_id IS NOT NULL
  LOOP
    v_payload := jsonb_build_object(
      'employee_id', r_target.employee_id,
      'type', 'work_order_' || p_event,
      'details', jsonb_build_object(
        'id', v_wo.id,
        'title', v_wo.title,
        'requester_name', v_wo.requester_name,
        'requester_department', v_wo.requester_department_name,
        'target_department', v_wo.target_department_name,
        'assignee_name', v_wo.assignee_name,
        'priority', v_wo.priority,
        'expected_due_date',  to_char(v_wo.expected_due_date, 'YYYY-MM-DD'),
        'scheduled_due_date', to_char(v_wo.scheduled_due_date, 'YYYY-MM-DD'),
        'reject_reason', v_wo.reject_reason
      )
    );
    PERFORM net.http_post(url := v_url, body := v_payload,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_anon),
      timeout_milliseconds := 5000);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $function$;

-- 2) 通知 trigger:已完成 → 處理中 這條路判成 'reopened'(其餘不變)
CREATE OR REPLACE FUNCTION public._trg_work_order_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_event text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event := 'created';
  ELSE
    -- 撤單不通知
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN RETURN NEW; END IF;
    IF NEW.status = OLD.status THEN RETURN NEW; END IF;
    IF OLD.status = '已完成' AND NEW.status = '處理中' THEN
      v_event := 'reopened';   -- ★ 申請人駁回,打回承辦人重做
    ELSE
      v_event := CASE NEW.status
        WHEN '處理中' THEN 'accepted'
        WHEN '已完成' THEN 'completed'
        WHEN '已結案' THEN 'confirmed'
        WHEN '已退回' THEN 'rejected'
        ELSE NULL END;
    END IF;
  END IF;
  IF v_event IS NOT NULL THEN
    PERFORM public._notify_work_order_event(NEW.id, v_event);
  END IF;
  RETURN NEW;
END $function$;

-- 3) 駁回 helper:申請人/admin,已完成 → 處理中
CREATE OR REPLACE FUNCTION public._wo_reopen(p_id integer, p_actor integer, p_reason text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_wo public.work_orders;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_id;
  IF v_wo.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT (_wo_actor_is_admin(p_actor) OR v_wo.requester_id = p_actor) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF v_wo.status <> '已完成' THEN RETURN json_build_object('ok', false, 'error', 'NOT_COMPLETED'); END IF;
  UPDATE public.work_orders
     SET status = '處理中',
         reject_reason = COALESCE(NULLIF(btrim(p_reason), ''), '(未填原因)'),
         completed_at = NULL,
         updated_at = now()
   WHERE id = p_id;
  RETURN json_build_object('ok', true, 'status', '處理中');
END $function$;

-- 4) 對外 wrapper
CREATE OR REPLACE FUNCTION public.reopen_work_order(p_id integer, p_reason text)
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._wo_reopen(p_id, public.current_employee_id(), p_reason);
$function$;

REVOKE ALL ON FUNCTION public.reopen_work_order(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reopen_work_order(integer, text) TO authenticated;
