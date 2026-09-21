-- 跨部門工單 ↔ 任務節點 (Phase 2) — 2026-07-14
-- 專案/流程裡的一個任務可以「指派給其他部門」= 建一張跨部門工單,雙向綁定。
-- 任務完成由工單完成決定(手動關任務被擋,防作弊);工單承辦回報完成 → 任務自動完成 + 工單自動結案。
-- 走現有 _wo_create 核心建工單(通知/RLS/流程全沿用)。

-- ① 雙向綁定欄位
ALTER TABLE public.tasks       ADD COLUMN IF NOT EXISTS work_order_id  int REFERENCES public.work_orders(id) ON DELETE SET NULL;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS source_task_id int REFERENCES public.tasks(id)       ON DELETE SET NULL;

-- ② 建工單:把某任務指派給其他部門(核心 actor 版)
CREATE OR REPLACE FUNCTION public._wo_from_task(
  p_task_id int, p_actor int, p_target_department_id int,
  p_priority text, p_expected_due_date date, p_assignee_id int
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_task public.tasks; v_res json; v_wo_id int; v_prio text; v_due date;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
  IF v_task.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_task.work_order_id IS NOT NULL THEN RETURN json_build_object('ok', false, 'error', 'ALREADY_LINKED'); END IF;
  IF v_task.status = '已完成' THEN RETURN json_build_object('ok', false, 'error', 'TASK_DONE'); END IF;

  -- 任務優先級(中文)→工單(low/medium/high);期望日用參數或任務 due_date
  v_prio := COALESCE(NULLIF(p_priority,''), CASE v_task.priority WHEN '高' THEN 'high' WHEN '低' THEN 'low' ELSE 'medium' END);
  v_due  := COALESCE(p_expected_due_date, v_task.due_date::date);

  v_res := public._wo_create(p_actor, p_target_department_id, v_task.title,
             COALESCE(NULLIF(v_task.description,''), v_task.notes, ''), v_prio, v_due, NULL, p_assignee_id, '[]'::jsonb);
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN RETURN v_res; END IF;
  v_wo_id := (v_res->>'id')::int;

  UPDATE public.work_orders SET source_task_id = p_task_id WHERE id = v_wo_id;
  UPDATE public.tasks SET work_order_id = v_wo_id WHERE id = p_task_id;
  RETURN json_build_object('ok', true, 'work_order_id', v_wo_id);
END $$;

CREATE OR REPLACE FUNCTION public.create_work_order_for_task(p_task_id int, p_target_department_id int, p_priority text DEFAULT NULL, p_expected_due_date date DEFAULT NULL, p_assignee_id int DEFAULT NULL)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._wo_from_task(p_task_id, public.current_employee_id(), p_target_department_id, p_priority, p_expected_due_date, p_assignee_id);
$$;
GRANT EXECUTE ON FUNCTION public.create_work_order_for_task(int, int, text, date, int) TO authenticated;

-- ③ 擋手動完成:任務綁了工單、但工單還沒完成 → 不能手動關任務(比照 pending bindings 擋法)
CREATE OR REPLACE FUNCTION public._trg_task_block_complete_with_open_wo()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = '已完成' AND OLD.status IS DISTINCT FROM '已完成' AND NEW.work_order_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.work_orders WHERE id = NEW.work_order_id AND status IN ('已完成','已結案')) THEN
      RAISE EXCEPTION '此任務由跨部門工單完成，請等承辦部門完成工單後自動關閉'
        USING HINT = '對應的跨部門工單尚未完成';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_task_block_complete_open_wo ON public.tasks;
CREATE TRIGGER trg_task_block_complete_open_wo
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._trg_task_block_complete_with_open_wo();

-- ④ 連動:工單(任務節點)承辦回報完成(已完成) → 任務自動完成 + 工單自動結案
CREATE OR REPLACE FUNCTION public._trg_wo_sync_source_task()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.source_task_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status = '已完成' AND COALESCE(OLD.status,'') <> '已完成' THEN
    -- 此時工單已是「已完成」→ 擋完成 trigger 會放行任務
    UPDATE public.tasks SET status = '已完成', completed_at = now(), updated_at = now()
     WHERE id = NEW.source_task_id AND status <> '已完成';
    -- 任務節點不需申請人再確認 → 自動結案(再觸發本 trigger 時 NEW.status='已結案' 不進 IF,安全)
    UPDATE public.work_orders SET status = '已結案', confirmed_at = now(), updated_at = now() WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_wo_sync_source_task ON public.work_orders;
CREATE TRIGGER trg_wo_sync_source_task
  AFTER UPDATE OF status ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public._trg_wo_sync_source_task();

NOTIFY pgrst, 'reload schema';
