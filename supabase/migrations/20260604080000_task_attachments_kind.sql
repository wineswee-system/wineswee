-- ════════════════════════════════════════════════════════════════════════════
-- task_attachments 加 kind 欄（initiator / reporter）
--
-- 既有附件全部視為 'reporter'（執行回報用），既存行為不變。
-- 新發起時上傳的附件 → kind='initiator'
-- 執行回報時上傳的附件 → kind='reporter'
--
-- 同步更新：
--   - liff_insert_task_attachment：p_payload->>'kind' 讀取（向下相容 default reporter）
--   - liff_get_task_detail：attachments JSON 加 kind 欄
--
-- 主系統 createTaskAttachment 走直連 INSERT，JS 端傳 kind 即可，不需改 DB。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. 加 kind 欄 ──
ALTER TABLE public.task_attachments
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'reporter';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_task_attachments_kind') THEN
    ALTER TABLE public.task_attachments
      ADD CONSTRAINT chk_task_attachments_kind CHECK (kind IN ('initiator', 'reporter'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_task_attachments_kind
  ON public.task_attachments (task_id, kind);

COMMENT ON COLUMN public.task_attachments.kind IS
  'initiator = 發起人創建任務時上傳；reporter = 執行人/審核人回報時上傳';

-- ── 2. liff_insert_task_attachment：支援 kind ──
CREATE OR REPLACE FUNCTION public.liff_insert_task_attachment(
  p_line_user_id text,
  p_payload      jsonb
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp     employees;
  v_task  tasks;
  v_id    int;
  v_kind  text;
  v_can   boolean;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  v_id := (p_payload->>'task_id')::INT;
  SELECT * INTO v_task FROM tasks WHERE id = v_id;
  IF v_task.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'TASK_NOT_FOUND'); END IF;

  v_kind := COALESCE(NULLIF(p_payload->>'kind', ''), 'reporter');
  IF v_kind NOT IN ('initiator', 'reporter') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_KIND');
  END IF;

  -- 權限：
  --   initiator: 發起人 (created_by_emp_id) 或 reporter (assignee/approver) 都允許
  --   reporter:  原有規則 — assignee 或 approver
  IF v_kind = 'initiator' THEN
    v_can := (v_task.assignee_id = emp.id)
          OR (v_task.created_by_emp_id = emp.id)
          OR EXISTS (SELECT 1 FROM task_confirmations WHERE task_id = v_id AND approver = emp.name);
  ELSE
    v_can := (v_task.assignee_id = emp.id)
          OR EXISTS (SELECT 1 FROM task_confirmations WHERE task_id = v_id AND approver = emp.name);
  END IF;
  IF NOT v_can THEN RETURN json_build_object('ok', false, 'error', 'FORBIDDEN'); END IF;

  INSERT INTO task_attachments (
    task_id, file_name, storage_path, file_size, file_type,
    uploaded_by_emp_id, uploaded_by, organization_id, kind
  ) VALUES (
    v_id,
    p_payload->>'file_name',
    p_payload->>'storage_path',
    NULLIF(p_payload->>'file_size','')::INT,
    p_payload->>'file_type',
    emp.id, emp.name, emp.organization_id, v_kind
  ) RETURNING id INTO v_id;

  RETURN json_build_object('ok', true, 'id', v_id, 'kind', v_kind);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_insert_task_attachment(text, jsonb) TO authenticated, anon;

-- ── 3. liff_get_task_detail：attachments JSON 加 kind ──
-- 完整 CREATE OR REPLACE，避免 partial overwrite（記憶警告）
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
    'attachments', COALESCE((
      SELECT json_agg(json_build_object(
        'id', ta.id, 'file_name', ta.file_name, 'storage_path', ta.storage_path,
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
        'completed_at', tfb.completed_at
      ) ORDER BY tfb.id)
      FROM public.task_form_bindings tfb
      WHERE tfb.task_id = p_task_id
    ), '[]'::json)
  );
END $function$;

COMMIT;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_existing INT;
BEGIN
  SELECT COUNT(*) INTO v_existing FROM public.task_attachments;
  RAISE NOTICE 'task_attachments.kind 已加，既有 % 筆均為 reporter；liff_insert_task_attachment / liff_get_task_detail 已更新', v_existing;
END $$;
