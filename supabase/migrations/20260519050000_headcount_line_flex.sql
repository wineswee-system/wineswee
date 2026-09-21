-- ════════════════════════════════════════════════════════════════════════════
-- 人力需求 LINE flex 推送（接 HR B chain notify 機制）
-- ────────────────────────────────────────────────────────────────────────────
-- 仿 _push_resignation_flex / _push_transfer_flex / _push_loa_flex pattern：
--   1. _push_headcount_flex(line_user_id, liff_id, id, event)
--      組 extra rows（職務 / 性質 / 人數 / 需求門市・部門 / 待遇）
--      + reason 區塊（駁回紅色 / 新增人力原因灰色）
--      最後 call 共用 _push_hr_chain_flex 推卡
--   2. _notify_hr_b_step 加 'headcount' dispatch
--   3. trg_notify_headcount_inserted / trg_notify_headcount_updated triggers
--      - INSERT 申請中 + 有 chain → 推第一關通知
--      - UPDATE status→已核准/已駁回 → 推給申請人
--      - UPDATE current_step++ → 推下一關通知
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. _push_headcount_flex ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._push_headcount_flex(
  p_line_user_id text, p_liff_id text, p_id int, p_event text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row headcount_requests;
  v_emp_name text; v_dept text;
  v_store text;
  v_need_dept text;
  v_text_label   CONSTANT text := '#9CA3AF';
  v_text_body    CONSTANT text := '#333333';
  v_color_danger CONSTANT text := '#dc2626';
  v_extra jsonb := '[]'::jsonb;
  v_reason jsonb := '[]'::jsonb;
  v_salary_str text := '';
BEGIN
  SELECT * INTO v_row FROM headcount_requests WHERE id = p_id;
  IF v_row.id IS NULL THEN RETURN; END IF;

  SELECT e.name, COALESCE(d.name, e.dept) INTO v_emp_name, v_dept
    FROM employees e LEFT JOIN departments d ON d.id = e.department_id
   WHERE e.id = v_row.employee_id;

  SELECT name INTO v_store     FROM stores      WHERE id = v_row.store_id;
  SELECT name INTO v_need_dept FROM departments WHERE id = v_row.need_dept_id;

  -- 待遇字串
  IF v_row.salary_type IS NOT NULL OR v_row.salary_range IS NOT NULL THEN
    v_salary_str := btrim(COALESCE(v_row.salary_type, '') || ' ' || COALESCE(v_row.salary_range, ''));
  END IF;

  v_extra := jsonb_build_array(
    -- 表單編號（黃色 monospace 區隔）
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','表單編號','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text', COALESCE(v_row.form_no, '#' || v_row.id::text),
          'size','sm','color',v_text_body,'flex',5)
      )
    ),
    -- 職務 (粗體強調)
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','職務','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text',
          v_row.job_title || COALESCE(' · ' || v_row.job_type, ''),
          'size','sm','color',v_text_body,'weight','bold','flex',5,'wrap',true)
      )
    ),
    -- 需求人數
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','需求人數','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text', v_row.headcount::text || ' 人',
          'size','sm','color',v_text_body,'weight','bold','flex',5)
      )
    )
  );

  -- 需求門市（有才顯示）
  IF v_store IS NOT NULL THEN
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object(
        'type','box','layout','horizontal','margin','sm',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','需求門市','size','sm','color',v_text_label,'flex',2),
          jsonb_build_object('type','text','text', v_store,
            'size','sm','color',v_text_body,'flex',5)
        )
      )
    );
  END IF;

  -- 需求部門（有才顯示）
  IF v_need_dept IS NOT NULL THEN
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object(
        'type','box','layout','horizontal','margin','sm',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','需求部門','size','sm','color',v_text_label,'flex',2),
          jsonb_build_object('type','text','text', v_need_dept,
            'size','sm','color',v_text_body,'flex',5)
        )
      )
    );
  END IF;

  -- 待遇（有才顯示）
  IF v_salary_str <> '' THEN
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object(
        'type','box','layout','horizontal','margin','sm',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','待遇','size','sm','color',v_text_label,'flex',2),
          jsonb_build_object('type','text','text', v_salary_str,
            'size','sm','color',v_text_body,'flex',5,'wrap',true)
        )
      )
    );
  END IF;

  -- 退回原因（紅色框）或 新增人力原因（灰色框）
  IF p_event = 'request_rejected' AND COALESCE(btrim(v_row.reject_reason), '') <> '' THEN
    v_reason := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#FEF2F2','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','❌ 退回原因','size','xxs','color',v_color_danger,'weight','bold'),
          jsonb_build_object('type','text','text', v_row.reject_reason,
            'size','sm','color',v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  ELSIF COALESCE(btrim(v_row.new_reason), '') <> '' THEN
    v_reason := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#F9FAFB','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','📝 新增人力原因','size','xxs','color',v_text_label,'weight','bold'),
          jsonb_build_object('type','text','text', v_row.new_reason,
            'size','sm','color',v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  END IF;

  PERFORM public._push_hr_chain_flex(
    p_line_user_id, p_liff_id, 'headcount', p_id,
    v_emp_name, v_dept, p_event, v_extra, v_reason
  );
END $$;
GRANT EXECUTE ON FUNCTION public._push_headcount_flex(text, text, int, text) TO authenticated, service_role;


-- ─── 2. _notify_hr_b_step 加 'headcount' 分支 ──────────────────────────────
-- 1:1 重寫 20260508121000，唯一變動是 CASE 加一條 + dispatch 加 ELSIF
CREATE OR REPLACE FUNCTION public._notify_hr_b_step(
  p_table       text,
  p_id          int,
  p_step_order  int
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_chain_id   int;
  v_emp_id     int;
  v_step       approval_chain_steps;
  v_count      int := 0;
  v_line       record;
BEGIN
  EXECUTE format(
    'SELECT approval_chain_id, employee_id FROM %I WHERE id = $1',
    CASE p_table
      WHEN 'resignation' THEN 'resignation_requests'
      WHEN 'transfer'    THEN 'personnel_transfer_requests'
      WHEN 'loa'         THEN 'leave_of_absence_requests'
      WHEN 'headcount'   THEN 'headcount_requests'
    END
  ) INTO v_chain_id, v_emp_id USING p_id;

  IF v_chain_id IS NULL THEN RETURN 0; END IF;

  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_chain_id AND step_order = p_step_order;
  IF v_step.id IS NULL THEN RETURN 0; END IF;

  FOR v_line IN
    SELECT DISTINCT v.line_user_id, v.liff_id
      FROM resolve_chain_step_approvers(v_step.id, v_emp_id) a
      JOIN v_employee_line_resolved v ON v.employee_id = a.emp_id
                                     AND v.line_user_id = a.line_user_id
     WHERE v.line_user_id IS NOT NULL
  LOOP
    IF p_table = 'resignation' THEN
      PERFORM public._push_resignation_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
    ELSIF p_table = 'transfer' THEN
      PERFORM public._push_transfer_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
    ELSIF p_table = 'loa' THEN
      PERFORM public._push_loa_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
    ELSIF p_table = 'headcount' THEN
      PERFORM public._push_headcount_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
    END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;
GRANT EXECUTE ON FUNCTION public._notify_hr_b_step(text, int, int) TO authenticated, service_role;


-- ─── 3. headcount_requests trigger 函式 ────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_notify_headcount_inserted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('申請中', '待審') THEN RETURN NEW; END IF;
  IF NEW.approval_chain_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public._notify_hr_b_step('headcount', NEW.id, COALESCE(NEW.current_step, 0));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._trg_notify_headcount_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_app_line text; v_app_liff text;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;

  -- 已核准 → 推給申請人
  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准' THEN
    SELECT v.line_user_id, v.liff_id INTO v_app_line, v_app_liff
      FROM v_employee_line_resolved v WHERE v.employee_id = NEW.employee_id
      ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST LIMIT 1;
    IF v_app_line IS NOT NULL THEN
      PERFORM public._push_headcount_flex(v_app_line, v_app_liff, NEW.id, 'request_approved');
    END IF;
    RETURN NEW;
  END IF;

  -- 已駁回 → 推給申請人
  IF NEW.status = '已駁回' AND OLD.status IS DISTINCT FROM '已駁回' THEN
    SELECT v.line_user_id, v.liff_id INTO v_app_line, v_app_liff
      FROM v_employee_line_resolved v WHERE v.employee_id = NEW.employee_id
      ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST LIMIT 1;
    IF v_app_line IS NOT NULL THEN
      PERFORM public._push_headcount_flex(v_app_line, v_app_liff, NEW.id, 'request_rejected');
    END IF;
    RETURN NEW;
  END IF;

  -- 推進到下一關 → 推給下一關的人
  IF NEW.current_step > COALESCE(OLD.current_step, 0)
     AND NEW.status IN ('申請中', '待審')
     AND NEW.approval_chain_id IS NOT NULL THEN
    PERFORM public._notify_hr_b_step('headcount', NEW.id, NEW.current_step);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_headcount_inserted ON public.headcount_requests;
CREATE TRIGGER trg_notify_headcount_inserted
  AFTER INSERT ON public.headcount_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_headcount_inserted();

DROP TRIGGER IF EXISTS trg_notify_headcount_updated ON public.headcount_requests;
CREATE TRIGGER trg_notify_headcount_updated
  AFTER UPDATE ON public.headcount_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_headcount_updated();

COMMIT;

NOTIFY pgrst, 'reload schema';
