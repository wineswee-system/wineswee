-- ════════════════════════════════════════════════════════════════════════════
-- LIFF 新增任務全面對齊主系統：
--   1. tasks 加 created_by_emp_id (INT FK) — 給 initiator 附件權限判斷用
--   2. 升級 liff_create_task：接受 planned_start / role / store_id / bucket /
--      approval_mode / approval_chain_id / confirmation_approvers /
--      confirmation_mode / required_forms + 自動建 task_confirmations 跟
--      task_form_bindings
--   3. 新增 lookup RPC：
--      - liff_list_approval_chains
--      - liff_list_workflow_defs
--      - liff_list_task_categories
--      - liff_list_form_templates
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. tasks 加 created_by_emp_id ─────────────────────────────────
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS created_by_emp_id INT REFERENCES public.employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_created_by_emp_id ON public.tasks (created_by_emp_id);

-- 既有 row 從 TEXT created_by 反推（精確 match name）
UPDATE public.tasks t
   SET created_by_emp_id = e.id
  FROM public.employees e
 WHERE t.created_by IS NOT NULL
   AND t.created_by_emp_id IS NULL
   AND e.name = t.created_by
   AND (t.organization_id IS NULL OR e.organization_id = t.organization_id);

COMMENT ON COLUMN public.tasks.created_by_emp_id IS
  '任務發起人（員工 id）— 給 initiator 附件權限 / 通知 / 稽核用';

-- ─── 2. 升級 liff_create_task ──────────────────────────────────────
DROP FUNCTION IF EXISTS public.liff_create_task(text, json);
DROP FUNCTION IF EXISTS public.liff_create_task(text, jsonb);

CREATE OR REPLACE FUNCTION public.liff_create_task(
  p_line_user_id text,
  p_payload      jsonb
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp              employees;
  assignee_id_in   int;
  assignee_emp     employees;
  store_id_in      int;
  v_approval_mode  text;
  v_chain_id       int;
  v_confirm_mode   text;
  v_confirm_apps   text[];
  v_required_forms jsonb;
  v_form           jsonb;
  v_approver       text;
  v_step           int;
  new_id           int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  IF COALESCE(btrim(p_payload->>'title'), '') = '' THEN
    RETURN json_build_object('ok', false, 'error', 'TITLE_REQUIRED');
  END IF;

  -- 解指派對象（預設自己）
  assignee_id_in := COALESCE(NULLIF(p_payload->>'assignee_id', '')::int, emp.id);
  IF assignee_id_in = emp.id THEN
    assignee_emp := emp;
  ELSE
    SELECT * INTO assignee_emp FROM public.employees WHERE id = assignee_id_in;
    IF assignee_emp.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'ASSIGNEE_NOT_FOUND');
    END IF;
    IF assignee_emp.organization_id IS DISTINCT FROM emp.organization_id THEN
      RETURN json_build_object('ok', false, 'error', 'ASSIGNEE_CROSS_ORG');
    END IF;
  END IF;

  -- 解門市（預設接建立者的 store）
  store_id_in := COALESCE(NULLIF(p_payload->>'store_id','')::int, emp.store_id);

  -- 簽核設定
  v_approval_mode := COALESCE(NULLIF(p_payload->>'approval_mode',''), 'none');
  IF v_approval_mode NOT IN ('none', 'people', 'chain') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_APPROVAL_MODE');
  END IF;

  v_chain_id     := NULLIF(p_payload->>'approval_chain_id','')::int;
  v_confirm_mode := CASE WHEN v_approval_mode = 'people'
                         THEN COALESCE(NULLIF(p_payload->>'confirmation_mode',''), 'parallel')
                         ELSE NULL END;

  -- ── INSERT 主任務 ──
  INSERT INTO public.tasks (
    title, description, status, priority,
    planned_start, due_date,
    assignee, assignee_id, store, store_id,
    role, workflow, bucket, category,
    organization_id,
    created_by, created_by_emp_id,
    approval_chain_id, confirmation_mode
  )
  VALUES (
    btrim(p_payload->>'title'),
    NULLIF(p_payload->>'description',''),
    COALESCE(p_payload->>'status', '未開始'),
    COALESCE(p_payload->>'priority', '中'),
    NULLIF(p_payload->>'planned_start','')::date,
    NULLIF(p_payload->>'due_date','')::date,
    assignee_emp.name,
    assignee_emp.id,
    NULL, store_id_in,           -- trigger 會從 store_id 同步 TEXT
    NULLIF(p_payload->>'role',''),
    NULLIF(p_payload->>'workflow',''),
    COALESCE(p_payload->>'bucket', '一般工作'),
    COALESCE(p_payload->>'category', 'General'),
    emp.organization_id,
    emp.name, emp.id,
    v_chain_id, v_confirm_mode
  )
  RETURNING id INTO new_id;

  -- ── 多人簽核：建 task_confirmations ──
  IF v_approval_mode = 'people' THEN
    BEGIN
      v_confirm_apps := ARRAY(SELECT jsonb_array_elements_text(p_payload->'confirmation_approvers'));
    EXCEPTION WHEN OTHERS THEN
      v_confirm_apps := ARRAY[]::text[];
    END;

    v_step := 1;
    FOREACH v_approver IN ARRAY v_confirm_apps LOOP
      IF btrim(v_approver) <> '' THEN
        INSERT INTO public.task_confirmations (task_id, approver, status, step_order)
        VALUES (new_id, btrim(v_approver), 'pending', v_step)
        ON CONFLICT (task_id, approver) DO NOTHING;
        IF v_confirm_mode = 'sequential' THEN
          v_step := v_step + 1;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- ── 綁定表單 ──
  IF jsonb_typeof(p_payload->'required_forms') = 'array' THEN
    FOR v_form IN SELECT jsonb_array_elements(p_payload->'required_forms') LOOP
      INSERT INTO public.task_form_bindings (
        task_id, form_type, form_template_id, status, required_status, form_label
      ) VALUES (
        new_id,
        v_form->>'form_type',
        NULLIF(v_form->>'form_template_id','')::int,
        '未填',
        COALESCE(v_form->>'required_status',
                 CASE WHEN v_form->>'form_type' = 'expense' THEN '已核銷' ELSE '已核准' END),
        v_form->>'form_label'
      );
    END LOOP;
  END IF;

  RETURN json_build_object('ok', true, 'id', new_id);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_create_task(text, jsonb) TO authenticated, anon;

-- ─── 3. Lookup RPCs ────────────────────────────────────────────────

-- 3a. 簽核鏈列表
CREATE OR REPLACE FUNCTION public.liff_list_approval_chains(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::json; END IF;

  RETURN COALESCE((
    SELECT json_agg(json_build_object(
      'id', c.id,
      'name', c.name,
      'description', c.description,
      'steps_count', COALESCE(jsonb_array_length(c.steps::jsonb), 0)
    ) ORDER BY c.name)
    FROM public.approval_chains c
    WHERE (c.organization_id IS NULL OR c.organization_id = emp.organization_id)
  ), '[]'::json);
END $$;
GRANT EXECUTE ON FUNCTION public.liff_list_approval_chains(text) TO authenticated, anon;

-- 3b. 流程 (workflows) 列表
CREATE OR REPLACE FUNCTION public.liff_list_workflow_defs(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::json; END IF;

  RETURN COALESCE((
    SELECT json_agg(json_build_object(
      'id', w.id, 'name', w.name
    ) ORDER BY w.name)
    FROM public.workflows w
    WHERE (w.organization_id IS NULL OR w.organization_id = emp.organization_id)
  ), '[]'::json);
END $$;
GRANT EXECUTE ON FUNCTION public.liff_list_workflow_defs(text) TO authenticated, anon;

-- 3c. 任務分類列表
CREATE OR REPLACE FUNCTION public.liff_list_task_categories(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::json; END IF;

  RETURN COALESCE((
    SELECT json_agg(json_build_object(
      'id', tc.id, 'name', tc.name
    ) ORDER BY tc.name)
    FROM public.task_categories tc
    WHERE (tc.organization_id IS NULL OR tc.organization_id = emp.organization_id)
  ), '[]'::json);
END $$;
GRANT EXECUTE ON FUNCTION public.liff_list_task_categories(text) TO authenticated, anon;

-- 3d. 表單範本列表（給綁定表單用）
CREATE OR REPLACE FUNCTION public.liff_list_form_templates(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::json; END IF;

  RETURN COALESCE((
    SELECT json_agg(json_build_object(
      'id', ft.id, 'name', ft.name
    ) ORDER BY ft.name)
    FROM public.form_templates ft
    WHERE (ft.organization_id IS NULL OR ft.organization_id = emp.organization_id)
      AND COALESCE(ft.is_active, true) = true
  ), '[]'::json);
END $$;
GRANT EXECUTE ON FUNCTION public.liff_list_form_templates(text) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE v_backfilled INT;
BEGIN
  SELECT COUNT(*) INTO v_backfilled FROM public.tasks WHERE created_by_emp_id IS NOT NULL;
  RAISE NOTICE 'tasks.created_by_emp_id 已加 + backfill % 筆；liff_create_task 全面對齊；4 支 lookup RPC 已建立', v_backfilled;
END $$;
