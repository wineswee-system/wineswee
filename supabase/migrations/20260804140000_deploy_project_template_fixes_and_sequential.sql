-- 專案範本部署修正 + 循序流程 — 2026-08-04
-- ════════════════════════════════════════════════════════════════════════════
-- 修 deploy_project_template 三個問題 + 新建「前流程完成→啟動下流程」機制:
--
--  D. 任務負責人吃不進去(assignee/assignee_id 都 null)
--     根因:tasks 有 trg_sync_task_assignee(字母序先跑,NEW.assignee := name(assignee_id))
--           部署只寫 assignee 文字、沒寫 assignee_id → 先跑的 sync 用 null id 把文字覆蓋成 null,
--           後跑的 resolve 拿到空文字 → id 也 null。
--     修法:部署解析姓名→assignee_id 寫入(sync 自然反推文字)。門市 store 同理寫 store_id。
--
--  C. 流程負責人/任務指派人沒進專案成員
--     根因:deploy_project_template 完全沒寫 project_members。
--     修法:部署把 專案負責人 + 各流程負責人 + 各任務指派人 同步進 project_members(去重)。
--
--  B. 每個流程第一個任務都進「進行中」,無視流程層「前一流程全部完成後」
--     根因:RPC 只看任務 trigger,不看流程層 trigger;且 workflow_instances 沒存流程 trigger、
--           全庫也沒有「前流程完成→啟動下流程」的機制 → 循序功能等於沒實作。
--     修法:(1) workflow_instances 加 start_trigger 欄存流程 trigger
--           (2) 部署只啟動「第一個流程」或「非 on_prev_wf_complete 的流程」;循序流程設 status='待啟動'、
--               首任務 '待處理'
--           (3) 新建 advance trigger:某流程 '已完成' → 啟動同專案排序在後、待啟動、trigger=前流程完成
--               的「下一個」流程(status→進行中 + 首任務→進行中 + 通知負責人)
--
-- 相容:無流程層 trigger 的舊範本(如酒品SOP)→ start_trigger 為空 → 每流程照舊全部啟動,
--       advance 找不到「待啟動」也不動 → 行為完全不變。
-- ════════════════════════════════════════════════════════════════════════════

-- ── (0) workflow_instances 存流程層 trigger ──
ALTER TABLE public.workflow_instances ADD COLUMN IF NOT EXISTS start_trigger text;

-- ── (0.5) 姓名→員工id 解析 helper(deploy RPC 會用到,須先定義;對齊 _task_resolve_assignee_id 的 normalization)──
CREATE OR REPLACE FUNCTION public._resolve_emp_id_by_name(p_name text, p_org_id int)
 RETURNS int
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id int;
  v_name text;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN RETURN NULL; END IF;
  v_name := regexp_replace(p_name, '[\s　]+', '', 'g');
  IF p_org_id IS NOT NULL THEN
    SELECT id INTO v_id FROM employees
     WHERE regexp_replace(name, '[\s　]+', '', 'g') = v_name AND organization_id = p_org_id
     ORDER BY (status = '在職') DESC NULLS LAST, id LIMIT 1;
  END IF;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM employees
     WHERE regexp_replace(name, '[\s　]+', '', 'g') = v_name
     ORDER BY (status = '在職') DESC NULLS LAST, id LIMIT 1;
  END IF;
  RETURN v_id;
END $function$;

-- ── (1) 部署 RPC 全改 ──
CREATE OR REPLACE FUNCTION public.deploy_project_template(p_template_id integer, p_params jsonb DEFAULT '{}'::jsonb, p_actor_id integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller     employees;
  v_tpl        project_templates;
  v_wfs        jsonb;
  v_wf         jsonb;
  v_ovr_wf     jsonb;
  v_task       jsonb;
  v_ovr_task   jsonb;
  v_today      date;
  v_end        date;
  v_proj_id    int;
  v_inst_id    int;
  v_task_id    int;
  v_wf_owner   text;
  v_wf_store   text;
  v_wf_due     date;
  v_wf_trigger text;
  v_wf_activate boolean;
  v_wf_status  text;
  v_status     text;
  v_assignee   text;
  v_assignee_id int;
  v_owner_id   int;
  v_store_id   int;
  v_due        date;
  v_trigger    text;
  v_form       jsonb;
  v_wf_cnt     int := 0;
  v_task_cnt   int := 0;
  v_fb_warn    int := 0;
  v_member_ids int[] := ARRAY[]::int[];
  v_proj_owner text;
  wi           int;
  ti           int;
BEGIN
  -- ── 呼叫者 ──
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL AND p_actor_id IS NOT NULL THEN
    SELECT * INTO v_caller FROM employees WHERE id = p_actor_id;
  END IF;
  IF v_caller.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CALLER_NOT_FOUND');
  END IF;
  IF v_caller.organization_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ORG');
  END IF;

  SELECT * INTO v_tpl FROM project_templates WHERE id = p_template_id;
  IF v_tpl.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TEMPLATE_NOT_FOUND');
  END IF;
  IF COALESCE(NULLIF(p_params->>'name',''), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NAME_REQUIRED');
  END IF;

  v_wfs   := CASE jsonb_typeof(v_tpl.workflows)
               WHEN 'array' THEN v_tpl.workflows ELSE '[]'::jsonb END;
  v_today := COALESCE(NULLIF(p_params->>'start_date','')::date, CURRENT_DATE);
  v_end   := COALESCE(
               NULLIF(p_params->>'end_date','')::date,
               CASE WHEN v_tpl.estimated_days IS NOT NULL
                    THEN v_today + v_tpl.estimated_days ELSE NULL END);

  -- ── 1) projects ──
  v_proj_owner := COALESCE(NULLIF(p_params->>'owner',''), v_caller.name);
  INSERT INTO projects (
    name, description, status, priority, owner, store,
    start_date, end_date, budget, organization_id, template_id
  ) VALUES (
    p_params->>'name', v_tpl.description, '進行中',
    COALESCE(v_tpl.default_priority, '中'),
    v_proj_owner,
    NULLIF(p_params->>'store',''),
    v_today, v_end, v_tpl.estimated_budget,
    v_caller.organization_id, v_tpl.id
  ) RETURNING id INTO v_proj_id;

  -- 專案負責人 → 成員
  v_owner_id := public._resolve_emp_id_by_name(v_proj_owner, v_caller.organization_id);
  IF v_owner_id IS NOT NULL THEN v_member_ids := v_member_ids || v_owner_id; END IF;

  -- ── 2) 迴圈 workflows ──
  FOR wi IN 0 .. jsonb_array_length(v_wfs) - 1 LOOP
    v_wf     := v_wfs -> wi;
    v_ovr_wf := p_params #> ARRAY['workflows', wi::text];  -- 對應 override(可能 null)

    v_wf_owner   := COALESCE(NULLIF(v_ovr_wf->>'owner',''), NULLIF(p_params->>'owner',''), v_caller.name);
    v_wf_store   := COALESCE(NULLIF(v_ovr_wf->>'store',''), NULLIF(p_params->>'store',''));
    v_wf_due     := COALESCE(NULLIF(v_ovr_wf->>'due_date','')::date, v_end);
    v_wf_trigger := v_wf->>'trigger';   -- 流程層 trigger(manual / on_prev_wf_complete / …)

    -- ★ B:此流程部署當下是否啟動?
    --   第一個流程 或 非「等前流程完成/manual」→ 啟動;on_prev_wf_complete/manual(非首)→ 待啟動
    v_wf_activate := (wi = 0)
                     OR COALESCE(v_wf_trigger, '') NOT IN ('on_prev_wf_complete', 'manual');
    v_wf_status   := CASE WHEN v_wf_activate THEN '進行中' ELSE '未開始' END;  -- '未開始'=既有值,避免撞 CHECK

    -- 流程負責人 → 成員
    v_owner_id := public._resolve_emp_id_by_name(v_wf_owner, v_caller.organization_id);
    IF v_owner_id IS NOT NULL THEN v_member_ids := v_member_ids || v_owner_id; END IF;

    INSERT INTO workflow_instances (
      template_name, status, started_by, started_by_id, applicant_emp_id,
      store, due_date, project_id, organization_id, sort_order, started_at, start_trigger
    ) VALUES (
      v_wf->>'name', v_wf_status, v_wf_owner, v_caller.id, v_caller.id,
      v_wf_store, v_wf_due, v_proj_id, v_caller.organization_id, wi + 1,
      CASE WHEN v_wf_activate THEN now() ELSE NULL END, v_wf_trigger
    ) RETURNING id INTO v_inst_id;
    v_wf_cnt := v_wf_cnt + 1;

    -- ── 迴圈 tasks ──
    IF jsonb_typeof(v_wf->'tasks') = 'array' THEN
      FOR ti IN 0 .. jsonb_array_length(v_wf->'tasks') - 1 LOOP
        v_task     := (v_wf->'tasks') -> ti;               -- 範本任務(進階欄位來源)
        v_ovr_task := v_ovr_wf #> ARRAY['tasks', ti::text]; -- override(基本欄位)
        v_trigger  := v_task->>'trigger';
        -- ★ B:首任務只有在「流程啟動」且任務非 manual 時才進行中
        v_status   := CASE WHEN ti = 0 AND v_wf_activate AND COALESCE(v_trigger,'') <> 'manual'
                           THEN '進行中' ELSE '待處理' END;
        v_assignee := COALESCE(NULLIF(v_ovr_task->>'assignee',''), v_wf_owner);
        v_due      := COALESCE(NULLIF(v_ovr_task->>'due_date','')::date, v_wf_due);

        -- ★ D:解析姓名→assignee_id(讓 trg_sync_task_assignee 反推文字,不再被清 null)
        v_assignee_id := public._resolve_emp_id_by_name(v_assignee, v_caller.organization_id);
        v_store_id    := (SELECT id FROM stores
                           WHERE name = v_wf_store AND organization_id = v_caller.organization_id LIMIT 1);
        IF v_assignee_id IS NOT NULL THEN v_member_ids := v_member_ids || v_assignee_id; END IF;

        INSERT INTO tasks (
          title, description, approval_chain_id, workflow_instance_id, project_id,
          organization_id, status, started_at, role, step_order, priority,
          assignee_id, store_id, due_date, bucket, category, created_by_emp_id
        ) VALUES (
          v_task->>'title', NULLIF(v_task->>'description',''),
          NULLIF(v_task->>'approval_chain_id','')::int,
          v_inst_id, v_proj_id, v_caller.organization_id, v_status,
          CASE WHEN v_status = '進行中' THEN now() ELSE NULL END,
          NULLIF(v_task->>'role',''), ti + 1,
          COALESCE(NULLIF(v_task->>'priority',''), '中'),
          v_assignee_id, v_store_id, v_due, 'Project', v_wf->>'name', v_caller.id
        ) RETURNING id INTO v_task_id;
        v_task_cnt := v_task_cnt + 1;

        -- 表單綁定(進階,取自範本;失敗不中止)
        IF jsonb_typeof(v_task->'required_forms') = 'array' THEN
          FOR v_form IN SELECT * FROM jsonb_array_elements(v_task->'required_forms') LOOP
            BEGIN
              PERFORM public.create_task_form_binding(
                p_task_id          => v_task_id,
                p_form_type        => v_form->>'form_type',
                p_form_template_id => NULLIF(v_form->>'form_template_id','')::int,
                p_fill_mode        => COALESCE(NULLIF(v_form->>'fill_mode',''), 'self'),
                p_assignee_id      => CASE WHEN v_form->>'fill_mode' = 'other'
                                           THEN NULLIF(v_form->>'assignee_id','')::int ELSE NULL END
              );
            EXCEPTION WHEN OTHERS THEN v_fb_warn := v_fb_warn + 1;
            END;
          END LOOP;
        END IF;

        -- checklist(進階,走 task_checklists 關聯表)
        IF NULLIF(v_task->>'checklist_id','') IS NOT NULL THEN
          INSERT INTO task_checklists (task_id, checklist_id)
          VALUES (v_task_id, (v_task->>'checklist_id')::int);
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- ── 3) C:同步 project_members(專案負責人 + 流程負責人 + 任務指派人,去重、不覆蓋既有)──
  INSERT INTO project_members (project_id, employee_id, employee_name, role, added_by, organization_id)
  SELECT v_proj_id, e.id, e.name, 'member', '範本部署', v_caller.organization_id
    FROM employees e
   WHERE e.id = ANY(v_member_ids)
     AND NOT EXISTS (SELECT 1 FROM project_members pm
                      WHERE pm.project_id = v_proj_id AND pm.employee_id = e.id);

  RETURN jsonb_build_object(
    'ok', true, 'project_id', v_proj_id,
    'workflow_count', v_wf_cnt, 'task_count', v_task_cnt,
    'form_binding_warnings', v_fb_warn
  );
END $function$;

-- ── (2) B-runtime:前流程「已完成」→ 啟動排序在後、待啟動、on_prev_wf_complete 的下一個流程 ──
CREATE OR REPLACE FUNCTION public._trg_activate_next_workflow()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_next_id      int;
  v_next_trigger text;
  v_task_id      int;
BEGIN
  IF NEW.status = '已完成' AND COALESCE(OLD.status,'') <> '已完成' AND NEW.project_id IS NOT NULL THEN
    -- 同專案、排序緊接在後、且尚待啟動的「下一個」流程
    SELECT id, start_trigger INTO v_next_id, v_next_trigger
      FROM public.workflow_instances
     WHERE project_id = NEW.project_id
       AND status = '未開始'
       AND sort_order > COALESCE(NEW.sort_order, 0)
     ORDER BY sort_order, id
     LIMIT 1;

    -- 只有 trigger=前流程完成 才自動啟動(manual 的留給人工啟動,不越過)
    IF v_next_id IS NOT NULL AND COALESCE(v_next_trigger,'') = 'on_prev_wf_complete' THEN
      UPDATE public.workflow_instances
         SET status = '進行中', started_at = now()
       WHERE id = v_next_id;

      -- 啟動它的第一個任務(step_order 最小、待處理)
      SELECT id INTO v_task_id
        FROM public.tasks
       WHERE workflow_instance_id = v_next_id AND archived_at IS NULL AND status = '待處理'
       ORDER BY step_order, id LIMIT 1;

      IF v_task_id IS NOT NULL THEN
        UPDATE public.tasks SET status = '進行中', started_at = now() WHERE id = v_task_id;

        -- 通知新輪到的負責人(站內)
        INSERT INTO public.notifications (type, title, user_id)
        SELECT 'task_activated',
               format('流程「%s」已啟動,任務「%s」輪到你了', wi.template_name, t.title),
               e.auth_user_id
          FROM public.tasks t
          JOIN public.workflow_instances wi ON wi.id = t.workflow_instance_id
          JOIN public.employees e ON e.id = t.assignee_id
         WHERE t.id = v_task_id AND e.auth_user_id IS NOT NULL;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_activate_next_workflow ON public.workflow_instances;
CREATE TRIGGER trg_activate_next_workflow
  AFTER UPDATE OF status ON public.workflow_instances
  FOR EACH ROW EXECUTE FUNCTION public._trg_activate_next_workflow();

NOTIFY pgrst, 'reload schema';
