-- ============================================================
-- 任務附件功能
-- 每個任務可上傳照片/檔案當完成證明
-- 執行人 + 該任務的審批人 都能看
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.task_attachments (
  id            BIGSERIAL PRIMARY KEY,
  task_id       INT NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  storage_path  TEXT NOT NULL,                -- attachments bucket path: tasks/{task_id}/{ts}.{ext}
  file_size     INT,
  file_type     TEXT,                          -- mime type
  uploaded_by_emp_id INT REFERENCES public.employees(id) ON DELETE SET NULL,
  uploaded_by   TEXT,                          -- 員工名快照
  organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_att_task ON public.task_attachments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_att_org  ON public.task_attachments(organization_id);

ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_attachments' AND policyname = 'auth_task_attachments') THEN
    CREATE POLICY auth_task_attachments ON public.task_attachments FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_attachments' AND policyname = 'anon_task_attachments') THEN
    CREATE POLICY anon_task_attachments ON public.task_attachments FOR SELECT TO anon USING (true);
  END IF;
END $$;


-- ═══ RPC: 上傳附件記錄 ═══
CREATE OR REPLACE FUNCTION public.liff_insert_task_attachment(
  p_line_user_id text,
  p_payload      jsonb
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  v_task tasks;
  v_id INT;
  v_can boolean;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  v_id := (p_payload->>'task_id')::INT;
  SELECT * INTO v_task FROM tasks WHERE id = v_id;
  IF v_task.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'TASK_NOT_FOUND'); END IF;

  -- 權限：assignee 或 approver
  v_can := (v_task.assignee_id = emp.id) OR EXISTS (
    SELECT 1 FROM task_confirmations WHERE task_id = v_id AND approver = emp.name
  );
  IF NOT v_can THEN RETURN json_build_object('ok', false, 'error', 'FORBIDDEN'); END IF;

  INSERT INTO task_attachments (
    task_id, file_name, storage_path, file_size, file_type,
    uploaded_by_emp_id, uploaded_by, organization_id
  ) VALUES (
    v_id,
    p_payload->>'file_name',
    p_payload->>'storage_path',
    NULLIF(p_payload->>'file_size','')::INT,
    p_payload->>'file_type',
    emp.id, emp.name, emp.organization_id
  ) RETURNING id INTO v_id;

  RETURN json_build_object('ok', true, 'id', v_id);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_insert_task_attachment(text, jsonb) TO authenticated, anon;


-- ═══ RPC: 刪除附件（只 uploader 自己） ═══
CREATE OR REPLACE FUNCTION public.liff_delete_task_attachment(
  p_line_user_id text,
  p_id           int
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  n int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  DELETE FROM task_attachments WHERE id = p_id AND uploaded_by_emp_id = emp.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_NOT_OWNER'); END IF;
  RETURN json_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_delete_task_attachment(text, int) TO authenticated, anon;


-- ═══ liff_get_task_detail 升級：含 attachments ═══
CREATE OR REPLACE FUNCTION public.liff_get_task_detail(
  p_line_user_id text,
  p_task_id      int
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  task_row tasks;
  is_assignee boolean;
  is_approver boolean;
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

  IF NOT (is_assignee OR is_approver) THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'task', row_to_json(task_row),
    'is_assignee', is_assignee,
    'is_approver', is_approver,
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
    -- ★ 新：附件
    'attachments', COALESCE((
      SELECT json_agg(json_build_object(
        'id', ta.id, 'file_name', ta.file_name, 'storage_path', ta.storage_path,
        'file_size', ta.file_size, 'file_type', ta.file_type,
        'uploaded_by', ta.uploaded_by, 'uploaded_by_emp_id', ta.uploaded_by_emp_id,
        'created_at', ta.created_at
      ) ORDER BY ta.created_at DESC)
      FROM public.task_attachments ta WHERE ta.task_id = p_task_id
    ), '[]'::json)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_task_detail(text, int) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
COMMIT;
