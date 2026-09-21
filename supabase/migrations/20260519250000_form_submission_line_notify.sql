-- ════════════════════════════════════════════════════════════════════════════
-- form_submissions chain LINE 通知 — INSERT / current_step 推進 / 結案
-- ────────────────────────────────────────────────────────────────────────────
-- 全部走 hr-notify edge function（依鐵則 feedback_no_diy_flex_card：不准在 PG
-- 內 hand-roll 新 flex JSON），PG 端只負責：
--   1. 解 approver / applicant 的 line_user_id + liff_id
--   2. 從 form_submissions.data jsonb 抓 top 5 欄位當 summary
--   3. POST 給 hr-notify, type=form_submission_step_assigned / approved / rejected
--
-- pg_net 0.20.0 在 public schema（依 feedback_pg_net_signature），用 net.http_post。
-- async fire-and-forget，不會 block chain advance transaction。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. helper：把 form_submissions.data jsonb 轉成 summary fields ───────
-- 跳過 section / file 類型；picker 類型把 ID 解成人名
CREATE OR REPLACE FUNCTION public._form_submission_summary_fields(
  p_sub_id INT
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sub        form_submissions;
  v_template   form_templates;
  v_fields     jsonb;
  v_result     jsonb := '[]'::jsonb;
  v_field      jsonb;
  v_label      text;
  v_key        text;
  v_type       text;
  v_value      text;
  v_id         int;
  v_count      int := 0;
BEGIN
  SELECT * INTO v_sub FROM form_submissions WHERE id = p_sub_id;
  IF v_sub.id IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT * INTO v_template FROM form_templates WHERE id = v_sub.template_id;
  v_fields := COALESCE(v_template.fields, '[]'::jsonb);

  -- 抓前 5 個非 section / 非 file 欄位
  FOR v_field IN SELECT * FROM jsonb_array_elements(v_fields) LOOP
    v_type := v_field->>'type';
    v_key  := v_field->>'key';
    v_label := v_field->>'label';
    IF v_type IN ('section', 'file') OR v_key IS NULL THEN CONTINUE; END IF;

    v_value := v_sub.data->>v_key;
    IF v_value IS NULL OR v_value = '' THEN CONTINUE; END IF;

    -- picker 類型：把 ID 解成人名/部門名/門市名
    IF v_type = 'employee_picker' THEN
      v_id := NULLIF(v_value, '')::int;
      SELECT name INTO v_value FROM employees WHERE id = v_id;
    ELSIF v_type = 'department_picker' THEN
      v_id := NULLIF(v_value, '')::int;
      SELECT name INTO v_value FROM departments WHERE id = v_id;
    ELSIF v_type = 'store_picker' THEN
      v_id := NULLIF(v_value, '')::int;
      SELECT name INTO v_value FROM stores WHERE id = v_id;
    ELSIF v_type = 'checkbox' THEN
      v_value := CASE WHEN v_value::boolean THEN '✓ 是' ELSE '✗ 否' END;
    END IF;

    -- value 太長截斷
    IF length(v_value) > 40 THEN v_value := substr(v_value, 1, 38) || '…'; END IF;

    v_result := v_result || jsonb_build_array(
      jsonb_build_object('label', v_label, 'value', COALESCE(v_value, '—'))
    );

    v_count := v_count + 1;
    EXIT WHEN v_count >= 5;
  END LOOP;

  RETURN v_result;
END $$;


-- ─── 2. helper：對 form_submission 第 N 關推 LINE 給該關所有 approvers ──
CREATE OR REPLACE FUNCTION public._notify_form_submission_step(
  p_sub_id     int,
  p_step_order int
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_url        CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_anon       CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';

  v_sub        form_submissions;
  v_template   form_templates;
  v_chain_id   int;
  v_step       approval_chain_steps;
  v_total      int;
  v_app_name   text;
  v_summary    jsonb;
  v_step_label text;
  v_count      int := 0;
  v_approver   record;
  v_liff_url   text;
  v_payload    jsonb;
BEGIN
  SELECT * INTO v_sub FROM form_submissions WHERE id = p_sub_id;
  IF v_sub.id IS NULL THEN RETURN 0; END IF;

  SELECT * INTO v_template FROM form_templates WHERE id = v_sub.template_id;
  v_chain_id := v_template.approval_chain_id;
  IF v_chain_id IS NULL THEN RETURN 0; END IF;

  SELECT * INTO v_step
    FROM approval_chain_steps
   WHERE chain_id = v_chain_id AND step_order = p_step_order;
  IF v_step.id IS NULL THEN RETURN 0; END IF;

  SELECT COUNT(*) INTO v_total FROM approval_chain_steps WHERE chain_id = v_chain_id;
  v_step_label := COALESCE(v_step.label, v_step.role_name, '第' || (p_step_order + 1) || '關');

  SELECT name INTO v_app_name FROM employees WHERE id = v_sub.applicant_id;
  v_summary := public._form_submission_summary_fields(p_sub_id);

  -- 每個 approver 推一張卡
  FOR v_approver IN
    SELECT a.emp_id, v.line_user_id, v.liff_id
      FROM resolve_chain_step_approvers(v_step.id, v_sub.applicant_id) a
      JOIN v_employee_line_resolved v ON v.employee_id = a.emp_id
                                     AND v.line_user_id = a.line_user_id
     WHERE v.line_user_id IS NOT NULL
       AND a.emp_id IS DISTINCT FROM v_sub.applicant_id
  LOOP
    v_liff_url := CASE
      WHEN v_approver.liff_id IS NULL OR v_approver.liff_id = '' THEN NULL
      ELSE 'https://liff.line.me/' || v_approver.liff_id || '?to=' ||
           replace(replace('/Approve', '/', '%2F'), '?', '%3F')
    END;

    v_payload := jsonb_build_object(
      'employee_id', v_approver.emp_id,
      'type', 'form_submission_step_assigned',
      'details', jsonb_build_object(
        'submission_id', p_sub_id,
        'template_name', COALESCE(v_template.name, '自訂表單'),
        'applicant_name', COALESCE(v_app_name, '—'),
        'current_step_label', v_step_label,
        'current_step_index', p_step_order,
        'total_steps', v_total,
        'summary_fields', v_summary,
        'liff_url', v_liff_url
      )
    );

    PERFORM net.http_post(
      url     := v_url,
      body    := v_payload,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon
      ),
      timeout_milliseconds := 5000
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public._notify_form_submission_step(int, int) TO service_role;


-- ─── 3. helper：結案推給申請人 ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._notify_form_submission_result(
  p_sub_id  int,
  p_variant text   -- 'approved' | 'rejected'
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_url        CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_anon       CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
  v_sub        form_submissions;
  v_template   form_templates;
  v_app_name   text;
  v_app_line   text;
  v_app_liff   text;
  v_summary    jsonb;
  v_liff_url   text;
  v_payload    jsonb;
BEGIN
  IF p_variant NOT IN ('approved', 'rejected') THEN RETURN 0; END IF;

  SELECT * INTO v_sub FROM form_submissions WHERE id = p_sub_id;
  IF v_sub.id IS NULL THEN RETURN 0; END IF;
  SELECT * INTO v_template FROM form_templates WHERE id = v_sub.template_id;

  SELECT name INTO v_app_name FROM employees WHERE id = v_sub.applicant_id;
  SELECT v.line_user_id, v.liff_id INTO v_app_line, v_app_liff
    FROM v_employee_line_resolved v
   WHERE v.employee_id = v_sub.applicant_id
   ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST
   LIMIT 1;

  IF v_app_line IS NULL THEN RETURN 0; END IF;

  v_summary := public._form_submission_summary_fields(p_sub_id);
  v_liff_url := CASE
    WHEN v_app_liff IS NULL OR v_app_liff = '' THEN NULL
    ELSE 'https://liff.line.me/' || v_app_liff || '?to=%2FApprove'
  END;

  v_payload := jsonb_build_object(
    'employee_id', v_sub.applicant_id,
    'type', 'form_submission_' || p_variant,
    'details', jsonb_build_object(
      'submission_id', p_sub_id,
      'template_name', COALESCE(v_template.name, '自訂表單'),
      'applicant_name', COALESCE(v_app_name, '—'),
      'summary_fields', v_summary,
      'reject_reason', CASE WHEN p_variant = 'rejected' THEN v_sub.reject_reason ELSE NULL END,
      'liff_url', v_liff_url
    )
  );

  PERFORM net.http_post(
    url     := v_url,
    body    := v_payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon
    ),
    timeout_milliseconds := 5000
  );

  RETURN 1;
END $$;

GRANT EXECUTE ON FUNCTION public._notify_form_submission_result(int, text) TO service_role;


-- ─── 4. AFTER INSERT trigger → 推第一關 LINE ───────────────────────────
CREATE OR REPLACE FUNCTION public._trg_notify_form_submission_inserted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status <> '申請中' THEN RETURN NEW; END IF;

  PERFORM public._notify_form_submission_step(NEW.id, COALESCE(NEW.current_step, 0));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_form_submission_inserted ON public.form_submissions;
CREATE TRIGGER trg_notify_form_submission_inserted
  AFTER INSERT ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_form_submission_inserted();


-- ─── 5. AFTER UPDATE trigger → 推進下關 / 結案推申請人 ─────────────────
CREATE OR REPLACE FUNCTION public._trg_notify_form_submission_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;

  -- 結案：已核准 / 已駁回 → 推給申請人
  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准' THEN
    PERFORM public._notify_form_submission_result(NEW.id, 'approved');
    RETURN NEW;
  END IF;

  IF NEW.status IN ('已駁回', '已退回') AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public._notify_form_submission_result(NEW.id, 'rejected');
    RETURN NEW;
  END IF;

  -- current_step 推進 → 推下關 approver
  IF NEW.current_step > COALESCE(OLD.current_step, 0)
     AND NEW.status = '申請中' THEN
    PERFORM public._notify_form_submission_step(NEW.id, NEW.current_step);
    RETURN NEW;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_form_submission_updated ON public.form_submissions;
CREATE TRIGGER trg_notify_form_submission_updated
  AFTER UPDATE ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_form_submission_updated();

COMMIT;

NOTIFY pgrst, 'reload schema';
