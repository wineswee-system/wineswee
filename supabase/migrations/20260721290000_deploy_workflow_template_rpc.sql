-- 部署範本 RPC(階段A:建函式,尚未接前端) — 2026-07-21
-- ════════════════════════════════════════════════════════════════════════════
-- 把 DeployWizard.handleDeploy 的多表編排搬進單一原子 RPC:
--   workflow_instances + 迴圈 tasks + 巢狀 create_task_form_binding + task_dependencies。
-- 好處:原子(部分失敗自動回滾,不留孤兒)、免 RLS-SELECT hack、一次來回、可複用。
-- ★忠實複刻 handleDeploy 每個 insert payload(同欄位值→同 trigger 觸發→parity 一致),
--   不「順手修」任何行為;差異留待 parity 比對確認後再議。
-- 階段A:只建函式,前端 handleDeploy 暫不動;先用 rollback DO block 對真實範本比對產物。
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.deploy_workflow_template(
  p_template_id integer,
  p_params      jsonb DEFAULT '{}'::jsonb,
  p_actor_id    integer DEFAULT NULL   -- 僅在 auth.uid() 解不到員工時才採用(service/trigger/測試);前端無法冒名
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller      employees;
  v_tpl         sop_templates;
  v_steps       jsonb;
  v_step        jsonb;
  v_nsteps      int;
  v_loc         text;
  v_start       date;
  v_end         date;
  v_total_days  int;
  v_step_off    int;
  v_due_time    text;
  v_rem         text;
  v_batch_pri   text;
  v_inst_id     int;
  v_task_id     int;
  v_task_ids    int[] := '{}';
  v_prev_id     int;
  v_due         date;
  v_status      text;
  v_assignee    text;
  v_fb_warn     int := 0;
  v_form        jsonb;
  i             int;
BEGIN
  -- ── 呼叫者(權限 + 建立人) ── auth.uid() 優先;解不到才用 p_actor_id(前端無法冒名)
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL AND p_actor_id IS NOT NULL THEN
    SELECT * INTO v_caller FROM employees WHERE id = p_actor_id;
  END IF;
  IF v_caller.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CALLER_NOT_FOUND');
  END IF;

  SELECT * INTO v_tpl FROM sop_templates WHERE id = p_template_id;
  IF v_tpl.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TEMPLATE_NOT_FOUND');
  END IF;

  v_steps  := COALESCE(v_tpl.steps, '[]'::jsonb);
  v_nsteps := jsonb_array_length(v_steps);
  IF v_nsteps = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TEMPLATE_HAS_NO_STEPS');
  END IF;

  v_loc       := NULLIF(p_params->>'location', '');
  v_start     := NULLIF(p_params->>'planned_start_date', '')::date;
  v_end       := NULLIF(p_params->>'planned_end_date', '')::date;
  IF v_start IS NOT NULL AND v_end IS NOT NULL AND v_end < v_start THEN
    RETURN jsonb_build_object('ok', false, 'error', 'END_BEFORE_START');
  END IF;
  v_due_time  := COALESCE(NULLIF(p_params#>>'{batch_defaults,due_time}', ''), '17:00');
  v_rem       := COALESCE(NULLIF(p_params#>>'{batch_defaults,reminder_preset}', ''), '1hr');
  v_batch_pri := COALESCE(NULLIF(p_params#>>'{batch_defaults,priority}', ''), '中');

  -- 日期均攤(複刻 handleDeploy)
  v_total_days := CASE
    WHEN v_start IS NOT NULL AND v_end IS NOT NULL THEN GREATEST(1, (v_end - v_start))
    ELSE GREATEST(v_nsteps, 7) END;
  v_step_off := GREATEST(1, v_total_days / GREATEST(1, v_nsteps));

  -- ── 1) workflow_instances ──
  INSERT INTO workflow_instances (
    template_name, store, status, started_by, started_by_id, priority,
    planned_start_date, planned_end_date, notes, target_employee_id, organization_id
  ) VALUES (
    v_tpl.name, v_loc, '進行中', v_caller.name, v_caller.id,
    COALESCE(NULLIF(p_params->>'priority',''), '中'),
    v_start, v_end, NULLIF(p_params->>'notes',''),
    NULLIF(p_params->>'target_employee_id','')::int,
    v_caller.organization_id
  ) RETURNING id INTO v_inst_id;

  -- ── 2) tasks(逐步)+ 表單綁定 ──
  FOR i IN 0 .. v_nsteps - 1 LOOP
    v_step := v_steps -> i;
    -- due_date(複刻:start + (i+1)*offset,不超過 end;無 start 則今天起算)
    v_due := CASE
      WHEN v_start IS NOT NULL THEN v_start + ((i + 1) * v_step_off)
      ELSE (now()::date + ((i + 1) * v_step_off)) END;
    IF v_end IS NOT NULL AND v_due > v_end THEN v_due := v_end; END IF;
    v_status   := CASE WHEN i = 0 THEN '進行中' ELSE '待處理' END;
    v_assignee := COALESCE(p_params #>> ARRAY['assignees', i::text], '');

    -- 註:reminder_preset/notify_line/notify_timing 欄位已從 tasks 移除(Studio drift,無 migration),
    --    這正是前端 handleDeploy 傳它們→PostgREST 報錯→部署自 2026-06 中壞掉的主因;此處不再寫。
    --    checklist 改走 task_checklists 關聯表(見下)。
    INSERT INTO tasks (
      title, description, workflow, workflow_instance_id, step_order,
      step_type, task_type, role, assignee, priority, status,
      due_date, due_time,
      store, bucket, category, organization_id, created_by_emp_id,
      approval_chain_id, trigger_template_id_on_complete
    ) VALUES (
      v_step->>'title', NULLIF(v_step->>'description',''), v_tpl.name, v_inst_id, i + 1,
      'workflow_step', 'process_step', NULLIF(v_step->>'role',''), v_assignee, v_batch_pri, v_status,
      v_due, v_due_time::time,
      v_loc, '工作流程', '工作流程', v_caller.organization_id, v_caller.id,
      NULLIF(v_step->>'approval_chain_id','')::int,
      NULLIF(v_step->>'trigger_template_id','')::int
    ) RETURNING id INTO v_task_id;
    v_task_ids := v_task_ids || v_task_id;

    -- checklist:走 task_checklists 關聯表(非 tasks.checklist_id 欄)
    IF NULLIF(v_step->>'checklist_id','') IS NOT NULL THEN
      INSERT INTO task_checklists (task_id, checklist_id)
      VALUES (v_task_id, (v_step->>'checklist_id')::int);
    END IF;

    -- 表單綁定(失敗不中止,累計 warning — 比照現況)
    IF jsonb_typeof(v_step->'required_forms') = 'array' THEN
      FOR v_form IN SELECT * FROM jsonb_array_elements(v_step->'required_forms') LOOP
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
  END LOOP;

  -- ── 3) 相鄰依賴鏈(i 依賴 i-1) ──
  FOR i IN 2 .. array_length(v_task_ids, 1) LOOP
    INSERT INTO task_dependencies (task_id, depends_on_task_id)
    VALUES (v_task_ids[i], v_task_ids[i-1]);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'instance_id', v_inst_id,
    'task_ids', to_jsonb(v_task_ids),
    'form_binding_warnings', v_fb_warn
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.deploy_workflow_template(integer, jsonb, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
