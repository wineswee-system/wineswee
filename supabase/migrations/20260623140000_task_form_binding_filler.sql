-- ════════════════════════════════════════════════════════════════════════════
-- 任務綁定表單:自己填 / 他人填(指派 + LINE 通知)
-- 2026-06-23  Phase 1
--
-- task_form_bindings 加 fill_mode('self'|'other') + assignee_id。
-- create_task_form_binding 加兩個有預設的參數(向下相容)。
-- 新 RPC assign_task_form_binding_filler:指派他人 + 推 hr-notify。
-- liff_get_task_detail 的 form_bindings json 加 fill_mode/assignee_id(本檔尾段)。
-- 純加法、idempotent。既有 binding 預設 self → 行為不變。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 欄位 ────────────────────────────────────────────────────────────────
ALTER TABLE public.task_form_bindings
  ADD COLUMN IF NOT EXISTS fill_mode TEXT NOT NULL DEFAULT 'self';
ALTER TABLE public.task_form_bindings
  DROP CONSTRAINT IF EXISTS task_form_bindings_fill_mode_check;
ALTER TABLE public.task_form_bindings
  ADD CONSTRAINT task_form_bindings_fill_mode_check CHECK (fill_mode IN ('self','other'));
ALTER TABLE public.task_form_bindings
  ADD COLUMN IF NOT EXISTS assignee_id INT REFERENCES public.employees(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tfb_assignee
  ON public.task_form_bindings(assignee_id) WHERE assignee_id IS NOT NULL;

-- ─── 2. create_task_form_binding 加 fill_mode/assignee_id(先 DROP 舊三參避免 overload 歧義)──
DROP FUNCTION IF EXISTS public.create_task_form_binding(INT, TEXT, INT);
CREATE OR REPLACE FUNCTION public.create_task_form_binding(
  p_task_id           INT,
  p_form_type         TEXT,
  p_form_template_id  INT  DEFAULT NULL,
  p_fill_mode         TEXT DEFAULT 'self',
  p_assignee_id       INT  DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_required_status TEXT;
  v_label           TEXT;
  v_id              INT;
  v_fill_mode       TEXT := CASE WHEN p_fill_mode = 'other' THEN 'other' ELSE 'self' END;
BEGIN
  IF p_form_type NOT IN (
    'expense_request', 'expense', 'form_submission', 'store_audit', 'goods_transfer',
    'expense_apply', 'expense_settle', 'goods_transfer_apply', 'goods_transfer_receipt'
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_FORM_TYPE');
  END IF;

  v_required_status := CASE p_form_type
    WHEN 'expense_request' THEN '已核銷'
    WHEN 'expense'         THEN '已核銷'
    WHEN 'form_submission' THEN '已核准'
    WHEN 'store_audit'     THEN '已核准'
    WHEN 'goods_transfer'  THEN '已完成'
    WHEN 'expense_apply'          THEN '已核准'
    WHEN 'expense_settle'         THEN '已核銷'
    WHEN 'goods_transfer_apply'   THEN '待驗收'
    WHEN 'goods_transfer_receipt' THEN '已完成'
  END;

  v_label := CASE p_form_type
    WHEN 'expense_request' THEN '申請費用'
    WHEN 'expense'         THEN '費用報銷'
    WHEN 'form_submission' THEN COALESCE(
      (SELECT name FROM form_templates WHERE id = p_form_template_id),
      '自訂表單'
    )
    WHEN 'store_audit'     THEN '門市稽核'
    WHEN 'goods_transfer'  THEN '商品調撥'
    WHEN 'expense_apply'          THEN '費用-申請'
    WHEN 'expense_settle'         THEN '費用-核銷(驗收)'
    WHEN 'goods_transfer_apply'   THEN '調撥-申請'
    WHEN 'goods_transfer_receipt' THEN '調撥-入庫驗收'
  END;

  -- 同 task 同 type+template 不重複建
  SELECT id INTO v_id FROM task_form_bindings
   WHERE task_id = p_task_id
     AND form_type = p_form_type
     AND COALESCE(form_template_id, -1) = COALESCE(p_form_template_id, -1)
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN json_build_object('ok', true, 'binding_id', v_id, 'reused', true);
  END IF;

  INSERT INTO task_form_bindings (task_id, form_type, form_template_id, required_status, form_label, fill_mode, assignee_id)
  VALUES (p_task_id, p_form_type, p_form_template_id, v_required_status, v_label, v_fill_mode,
          CASE WHEN v_fill_mode = 'other' THEN p_assignee_id ELSE NULL END)
  RETURNING id INTO v_id;

  RETURN json_build_object('ok', true, 'binding_id', v_id, 'reused', false);
END $$;

GRANT EXECUTE ON FUNCTION public.create_task_form_binding(INT, TEXT, INT, TEXT, INT) TO authenticated, anon;

-- ─── 3. 指派他人填寫 + LINE 通知 ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_task_form_binding_filler(
  p_binding_id  INT,
  p_employee_id INT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_url   CONSTANT TEXT := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_anon  CONSTANT TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
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
END $$;

GRANT EXECUTE ON FUNCTION public.assign_task_form_binding_filler(INT, INT) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ─── 4. liff_get_task_detail.form_bindings 加 fill_mode/assignee_id ───
CREATE OR REPLACE FUNCTION public.liff_get_task_detail(p_line_user_id text, p_task_id integer)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  emp employees;
  task_row tasks;
  is_assignee boolean;
  is_approver boolean;
  is_binding_filler boolean;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO task_row FROM public.tasks WHERE id = p_task_id;
  IF task_row.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;

  is_assignee := (task_row.assignee_id = emp.id);
  is_approver := EXISTS (SELECT 1 FROM task_confirmations WHERE task_id = p_task_id AND approver = emp.name);
  -- 被指派去填某張綁定表單的人（他人填）也要能進來看任務 / 填表
  is_binding_filler := EXISTS (
    SELECT 1 FROM task_form_bindings
     WHERE task_id = p_task_id AND assignee_id = emp.id
  );

  IF NOT (is_assignee OR is_approver OR is_binding_filler) THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'task', row_to_json(task_row),
    'viewer_emp_id', emp.id,
    'is_assignee', is_assignee,
    'is_approver', is_approver,
    'is_binding_filler', is_binding_filler,
    'checklists', COALESCE((
      SELECT json_agg(json_build_object(
        'id',    cl.id,
        'name',  cl.name,
        'items', COALESCE((
          SELECT json_agg(json_build_object(
            'id', ci.id, 'title', ci.title,
            'checked', COALESCE(s.checked, false), 'sort_order', ci.sort_order
          ) ORDER BY ci.sort_order, ci.id)
          FROM public.checklist_items ci
          LEFT JOIN public.task_checklist_item_state s
            ON s.checklist_item_id = ci.id AND s.task_id = p_task_id
          WHERE ci.checklist_id = cl.id
        ), '[]'::json)
      ) ORDER BY tc.id)
      FROM public.task_checklists tc
      JOIN public.checklists cl ON cl.id = tc.checklist_id
      WHERE tc.task_id = p_task_id
    ), '[]'::json),
    'inline_items', COALESCE((
      SELECT json_agg(json_build_object(
        'id', tci.id, 'title', tci.title, 'checked', tci.checked, 'sort_order', tci.sort_order
      ) ORDER BY tci.sort_order, tci.id)
      FROM public.task_checklist_items tci
      WHERE tci.task_id = p_task_id
    ), '[]'::json),
    'comments', COALESCE((
      SELECT json_agg(json_build_object(
        'id', tc.id, 'author', tc.author, 'content', tc.content, 'source', tc.source, 'created_at', tc.created_at
      ) ORDER BY tc.created_at)
      FROM public.task_comments tc WHERE tc.task_id = p_task_id
    ), '[]'::json),
    'confirmations', COALESCE((
      SELECT json_agg(json_build_object(
        'id', tcf.id, 'approver', tcf.approver, 'status', tcf.status, 'notes', tcf.notes,
        'step_order', tcf.step_order, 'responded_at', tcf.responded_at, 'created_at', tcf.created_at
      ) ORDER BY tcf.step_order, tcf.id)
      FROM public.task_confirmations tcf WHERE tcf.task_id = p_task_id
    ), '[]'::json),
    'attachments', COALESCE((
      SELECT json_agg(json_build_object(
        'id', ta.id, 'file_name', ta.file_name, 'storage_path', ta.storage_path,
        'file_url', ta.file_url,
        'file_size', ta.file_size, 'file_type', ta.file_type,
        'uploaded_by', ta.uploaded_by, 'uploaded_by_emp_id', ta.uploaded_by_emp_id,
        'kind', ta.kind,
        'created_at', ta.created_at
      ) ORDER BY ta.created_at DESC)
      FROM public.task_attachments ta WHERE ta.task_id = p_task_id
    ), '[]'::json),
    'chain_steps', COALESCE((
      SELECT json_agg(json_build_object(
        'id', cs.id,
        'step_order', cs.step_order,
        'label', cs.label,
        'role_name', cs.role_name,
        'target_type', cs.target_type
      ) ORDER BY cs.step_order)
      FROM public.approval_chain_steps cs
      WHERE cs.chain_id = task_row.approval_chain_id
    ), '[]'::json),
    'form_bindings', COALESCE((
      SELECT json_agg(json_build_object(
        'id', tfb.id,
        'form_type', tfb.form_type,
        'form_template_id', tfb.form_template_id,
        'form_id', tfb.form_id,
        'status', tfb.status,
        'required_status', tfb.required_status,
        'form_label', tfb.form_label,
        'fill_mode', tfb.fill_mode,
        'assignee_id', tfb.assignee_id,
        'completed_at', tfb.completed_at
      ) ORDER BY tfb.id)
      FROM public.task_form_bindings tfb
      WHERE tfb.task_id = p_task_id
    ), '[]'::json)
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.liff_get_task_detail(text, integer) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
