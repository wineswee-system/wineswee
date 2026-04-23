-- ================================================
-- LIFF RPC — 任務中心 + 主管儀表板
--
-- 搬進 aska911023/sme-ops-liff 之前先把 DB 面準備好：
-- 把老闆 LiffTask.jsx / LiffManagerDashboard.jsx 那批直連 .from()
-- 統一換成 SECURITY DEFINER RPC，讓 anon key 客戶端跑得動 RLS。
--
-- 涵蓋：
--   1. liff_get_task_detail          — 單一任務 + checklist + comments
--   2. liff_complete_task            — 標為已完成
--   3. liff_toggle_checklist_item    — 勾 checklists.items（共用 template）
--   4. liff_create_task_comment      — 加留言
--   5. liff_create_task              — 新增任務（假設指派給自己或同組同事）
--   6. liff_list_dashboard           — 儀表板資料集合（僅 manager+）
--
-- 所有 RPC：SECURITY DEFINER + GRANT anon, authenticated
-- ================================================

-- ── 1. 任務詳情（只能看自己被指派的）──────────────────────
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
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO task_row FROM public.tasks
   WHERE id = p_task_id AND assignee_id = emp.id;
  IF task_row.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_NOT_ASSIGNED');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'task', row_to_json(task_row),
    -- 連結的 checklists（reusable template，每條再抓 items）
    'checklists', COALESCE((
      SELECT json_agg(json_build_object(
        'id',    cl.id,
        'name',  cl.name,
        'items', COALESCE((
          SELECT json_agg(json_build_object(
            'id',      ci.id,
            'title',   ci.title,
            'checked', ci.checked,
            'sort_order', ci.sort_order
          ) ORDER BY ci.sort_order, ci.id)
          FROM public.checklist_items ci
          WHERE ci.checklist_id = cl.id
        ), '[]'::json)
      ) ORDER BY tc.id)
      FROM public.task_checklists tc
      JOIN public.checklists cl ON cl.id = tc.checklist_id
      WHERE tc.task_id = p_task_id
    ), '[]'::json),
    -- 任務自身的 inline checklist items
    'inline_items', COALESCE((
      SELECT json_agg(json_build_object(
        'id',      tci.id,
        'title',   tci.title,
        'checked', tci.checked,
        'sort_order', tci.sort_order
      ) ORDER BY tci.sort_order, tci.id)
      FROM public.task_checklist_items tci
      WHERE tci.task_id = p_task_id
    ), '[]'::json),
    -- 留言
    'comments', COALESCE((
      SELECT json_agg(json_build_object(
        'id',         tc.id,
        'author',     tc.author,
        'content',    tc.content,
        'source',     tc.source,
        'created_at', tc.created_at
      ) ORDER BY tc.created_at)
      FROM public.task_comments tc
      WHERE tc.task_id = p_task_id
    ), '[]'::json)
  );
END $$;

-- ── 2. 標記任務完成 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_complete_task(
  p_line_user_id text,
  p_task_id      int
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  n int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  UPDATE public.tasks
     SET status = '已完成',
         completed_at = now()
   WHERE id = p_task_id
     AND assignee_id = emp.id
     AND status <> '已完成';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_DONE');
  END IF;
  RETURN json_build_object('ok', true);
END $$;

-- ── 3. 切換 checklist_items（共用 template）──────────────
-- 勾選/取消 checklist_items.checked
-- 僅允許：此 item 所屬 checklist 被任何「指派給本員工」的任務連結到
CREATE OR REPLACE FUNCTION public.liff_toggle_checklist_item(
  p_line_user_id text,
  p_item_id      int,
  p_checked      boolean
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  cl_id int;
  owns boolean;
  v_total int;
  v_done int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT checklist_id INTO cl_id FROM public.checklist_items WHERE id = p_item_id;
  IF cl_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'ITEM_NOT_FOUND');
  END IF;

  -- 授權檢查：這個 checklist 有連結到我被指派的任務
  SELECT EXISTS (
    SELECT 1 FROM public.task_checklists tc
    JOIN public.tasks t ON t.id = tc.task_id
    WHERE tc.checklist_id = cl_id AND t.assignee_id = emp.id
  ) INTO owns;
  IF NOT owns THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  UPDATE public.checklist_items SET checked = p_checked WHERE id = p_item_id;

  -- 順手把 checklists.completed 計數更新
  SELECT count(*), count(*) FILTER (WHERE checked)
    INTO v_total, v_done
    FROM public.checklist_items WHERE checklist_id = cl_id;
  UPDATE public.checklists SET items = v_total, completed = v_done WHERE id = cl_id;

  RETURN json_build_object('ok', true, 'checked', p_checked);
END $$;

-- ── 4. 任務自身 inline checklist item 切換 ─────────────────
CREATE OR REPLACE FUNCTION public.liff_toggle_task_checklist_item(
  p_line_user_id text,
  p_item_id      int,
  p_checked      boolean
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  owns boolean;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.task_checklist_items tci
    JOIN public.tasks t ON t.id = tci.task_id
    WHERE tci.id = p_item_id AND t.assignee_id = emp.id
  ) INTO owns;
  IF NOT owns THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  UPDATE public.task_checklist_items SET checked = p_checked WHERE id = p_item_id;
  RETURN json_build_object('ok', true, 'checked', p_checked);
END $$;

-- ── 5. 新增留言 ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_create_task_comment(
  p_line_user_id text,
  p_task_id      int,
  p_content      text
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  task_row tasks;
  new_id int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;
  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RETURN json_build_object('ok', false, 'error', 'EMPTY_CONTENT');
  END IF;

  -- 授權：任務指派給我 或 任務在我 org 內
  SELECT * INTO task_row FROM public.tasks WHERE id = p_task_id;
  IF task_row.id IS NULL
     OR (task_row.assignee_id IS DISTINCT FROM emp.id
         AND task_row.organization_id IS DISTINCT FROM emp.organization_id) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_FORBIDDEN');
  END IF;

  INSERT INTO public.task_comments (task_id, author, content, source)
  VALUES (p_task_id, emp.name, btrim(p_content), 'line')
  RETURNING id INTO new_id;

  RETURN json_build_object('ok', true, 'id', new_id);
END $$;

-- ── 6. 新增任務 ────────────────────────────────────────────
-- 限制：
--   - assignee_id 必填；若不是自己，assignee 必須在同 organization
--   - 新任務的 organization_id 一律 = 建立者的 org
--   - 不綁 workflow_instance（LIFF 只做獨立任務）
CREATE OR REPLACE FUNCTION public.liff_create_task(
  p_line_user_id text,
  p_payload      json
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  assignee_id_in int;
  assignee_emp employees;
  store_id_in int;
  new_id int;
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

  INSERT INTO public.tasks (
    title, description, status, priority, due_date,
    assignee, assignee_id, store, store_id, workflow,
    organization_id, category, bucket
  )
  VALUES (
    btrim(p_payload->>'title'),
    NULLIF(p_payload->>'description',''),
    COALESCE(p_payload->>'status', '未開始'),
    COALESCE(p_payload->>'priority', '中'),
    NULLIF(p_payload->>'due_date','')::date,
    assignee_emp.name,
    assignee_emp.id,
    -- 若有 store，稍後由 trigger 從 store_id 同步 TEXT；這邊先放 null 讓 trigger 接手
    NULL,
    store_id_in,
    NULLIF(p_payload->>'workflow',''),
    emp.organization_id,
    COALESCE(p_payload->>'category', 'General'),
    COALESCE(p_payload->>'bucket', 'General')
  )
  RETURNING id INTO new_id;

  RETURN json_build_object('ok', true, 'id', new_id);
END $$;

-- ── 7. 主管儀表板資料集合 ─────────────────────────────────
-- 回傳當前 org 範圍內的 workflow_instances / tasks / stores
-- 依 permission 'leave.approve' 或 super_admin/admin/manager 放行（儀表板是只讀）
CREATE OR REPLACE FUNCTION public.liff_list_dashboard(
  p_line_user_id text,
  p_days         int DEFAULT 30
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  can_view boolean;
  cutoff timestamptz;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 閘門：接主系統 RBAC，任何 role 拿到 leave.approve 就能看（super_admin 保底）
  can_view := public.liff_employee_has_permission(emp.id, 'leave.approve');
  IF NOT can_view THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  cutoff := now() - (GREATEST(p_days, 1) || ' days')::interval;

  RETURN json_build_object(
    'ok', true,
    'employee_name', emp.name,
    'instances', COALESCE((
      SELECT json_agg(json_build_object(
        'id',             wi.id,
        'template_name',  wi.template_name,
        'status',         wi.status,
        'started_at',     wi.started_at,
        'completed_at',   wi.completed_at,
        'due_date',       wi.due_date,
        'store',          wi.store,
        'assignee',       wi.assignee
      ) ORDER BY wi.started_at DESC)
      FROM public.workflow_instances wi
      WHERE wi.organization_id = emp.organization_id
        AND wi.started_at >= cutoff
    ), '[]'::json),
    'instance_tasks', COALESCE((
      SELECT json_agg(json_build_object(
        'id',                   t.id,
        'workflow_instance_id', t.workflow_instance_id,
        'title',                t.title,
        'status',               t.status,
        'due_date',             t.due_date,
        'assignee',             t.assignee,
        'store',                t.store,
        'completed_at',         t.completed_at,
        'created_at',           t.created_at,
        'step_order',           t.step_order
      ) ORDER BY t.step_order NULLS LAST, t.id)
      FROM public.tasks t
      WHERE t.organization_id = emp.organization_id
        AND t.workflow_instance_id IS NOT NULL
        AND t.created_at >= cutoff
    ), '[]'::json),
    'standalone_tasks', COALESCE((
      SELECT json_agg(json_build_object(
        'id',         t.id,
        'title',      t.title,
        'status',     t.status,
        'priority',   t.priority,
        'due_date',   t.due_date,
        'assignee',   t.assignee,
        'workflow',   t.workflow,
        'store',      t.store,
        'created_at', t.created_at
      ) ORDER BY t.created_at DESC)
      FROM public.tasks t
      WHERE t.organization_id = emp.organization_id
        AND t.workflow_instance_id IS NULL
        AND t.created_at >= cutoff
    ), '[]'::json),
    'stores', COALESCE((
      SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
      FROM public.stores s
      WHERE s.organization_id = emp.organization_id
        AND s.status = '營運中'
    ), '[]'::json)
  );
END $$;

-- ── 8. 同 org 員工清單（新增任務時指派用）─────────────────
CREATE OR REPLACE FUNCTION public.liff_list_employees_in_org(p_line_user_id text)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(json_build_object(
    'id',    e.id,
    'name',  e.name,
    'dept',  e.dept,
    'store', e.store
  ) ORDER BY e.name), '[]'::json)
  FROM public.employees e
  WHERE e.status = '在職'
    AND e.organization_id = (
      SELECT organization_id FROM public._liff_resolve_employee(p_line_user_id)
    )
$$;

-- ── GRANTs ──────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.liff_get_task_detail(text, int)                    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_complete_task(text, int)                       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_toggle_checklist_item(text, int, boolean)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_toggle_task_checklist_item(text, int, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_create_task_comment(text, int, text)           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_create_task(text, json)                        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_list_dashboard(text, int)                      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_list_employees_in_org(text)                    TO anon, authenticated;
