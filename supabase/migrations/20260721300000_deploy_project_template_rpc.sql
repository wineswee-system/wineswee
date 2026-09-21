-- 部署專案範本 RPC(階段A:建函式,尚未接前端) — 2026-07-21
-- ════════════════════════════════════════════════════════════════════════════
-- 把 Projects.handleDeploy 的巢狀多表編排搬進單一原子 RPC:
--   projects + 迴圈 workflows(workflow_instances) + 巢狀 tasks + create_task_form_binding + task_checklists。
-- 現況隱患:前端巢狀迴圈寫入且★完全沒 rollback★ → 部分失敗留半殘專案+孤兒工作流/任務,無清理。
-- RPC:單一 transaction,任何失敗全回滾。忠實複刻 handleDeploy:
--   進階欄位(description/approval_chain_id/required_forms/checklist_id/trigger)取自「範本」;
--   基本欄位(owner/store/assignee/due_date)取 p_params override,無則 fallback。
-- 階段A:只建函式,前端 Projects.handleDeploy 暫不動;先用 rollback DO block parity 比對。
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.deploy_project_template(
  p_template_id integer,
  p_params      jsonb DEFAULT '{}'::jsonb,
  p_actor_id    integer DEFAULT NULL   -- auth.uid() 優先;解不到才用(service/trigger/測試),前端無法冒名
) RETURNS jsonb
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
  v_status     text;
  v_assignee   text;
  v_due        date;
  v_trigger    text;
  v_form       jsonb;
  v_wf_cnt     int := 0;
  v_task_cnt   int := 0;
  v_fb_warn    int := 0;
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
  INSERT INTO projects (
    name, description, status, priority, owner, store,
    start_date, end_date, budget, organization_id, template_id
  ) VALUES (
    p_params->>'name', v_tpl.description, '進行中',
    COALESCE(v_tpl.default_priority, '中'),
    COALESCE(NULLIF(p_params->>'owner',''), v_caller.name),
    NULLIF(p_params->>'store',''),
    v_today, v_end, v_tpl.estimated_budget,
    v_caller.organization_id, v_tpl.id
  ) RETURNING id INTO v_proj_id;

  -- ── 2) 迴圈 workflows ──
  FOR wi IN 0 .. jsonb_array_length(v_wfs) - 1 LOOP
    v_wf     := v_wfs -> wi;
    v_ovr_wf := p_params #> ARRAY['workflows', wi::text];  -- 對應 override(可能 null)

    v_wf_owner := COALESCE(NULLIF(v_ovr_wf->>'owner',''), NULLIF(p_params->>'owner',''), v_caller.name);
    v_wf_store := COALESCE(NULLIF(v_ovr_wf->>'store',''), NULLIF(p_params->>'store',''));
    v_wf_due   := COALESCE(NULLIF(v_ovr_wf->>'due_date','')::date, v_end);

    INSERT INTO workflow_instances (
      template_name, status, started_by, started_by_id, applicant_emp_id,
      store, due_date, project_id, organization_id, sort_order, started_at
    ) VALUES (
      v_wf->>'name', '進行中', v_wf_owner, v_caller.id, v_caller.id,
      v_wf_store, v_wf_due, v_proj_id, v_caller.organization_id, wi + 1, now()
    ) RETURNING id INTO v_inst_id;
    v_wf_cnt := v_wf_cnt + 1;

    -- ── 迴圈 tasks ──
    IF jsonb_typeof(v_wf->'tasks') = 'array' THEN
      FOR ti IN 0 .. jsonb_array_length(v_wf->'tasks') - 1 LOOP
        v_task     := (v_wf->'tasks') -> ti;               -- 範本任務(進階欄位來源)
        v_ovr_task := v_ovr_wf #> ARRAY['tasks', ti::text]; -- override(基本欄位)
        v_trigger  := v_task->>'trigger';
        v_status   := CASE WHEN ti = 0 AND COALESCE(v_trigger,'') <> 'manual'
                           THEN '進行中' ELSE '待處理' END;
        v_assignee := COALESCE(NULLIF(v_ovr_task->>'assignee',''), v_wf_owner);
        v_due      := COALESCE(NULLIF(v_ovr_task->>'due_date','')::date, v_wf_due);

        INSERT INTO tasks (
          title, description, approval_chain_id, workflow_instance_id, project_id,
          organization_id, status, started_at, role, step_order, priority,
          assignee, due_date, store, bucket, category, created_by_emp_id
        ) VALUES (
          v_task->>'title', NULLIF(v_task->>'description',''),
          NULLIF(v_task->>'approval_chain_id','')::int,
          v_inst_id, v_proj_id, v_caller.organization_id, v_status,
          CASE WHEN v_status = '進行中' THEN now() ELSE NULL END,
          NULLIF(v_task->>'role',''), ti + 1,
          COALESCE(NULLIF(v_task->>'priority',''), '中'),
          v_assignee, v_due, v_wf_store, 'Project', v_wf->>'name', v_caller.id
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

  RETURN jsonb_build_object(
    'ok', true, 'project_id', v_proj_id,
    'workflow_count', v_wf_cnt, 'task_count', v_task_cnt,
    'form_binding_warnings', v_fb_warn
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.deploy_project_template(integer, jsonb, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
