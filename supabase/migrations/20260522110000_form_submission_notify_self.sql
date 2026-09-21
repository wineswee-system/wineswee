-- ════════════════════════════════════════════════════════════════════════════
-- form_submission 通知：拿掉「自己審自己不推」過濾
-- ────────────────────────────────────────────────────────────────────────────
-- 問題：當 chain step 為 applicant_dept_manager 等 applicant_* 類型，
--       且申請人本人就是該角色（例：部門主管自己填表）→ resolve 出來只有自己，
--       而原本有 `AND a.emp_id IS DISTINCT FROM v_sub.applicant_id` 過濾 →
--       0 候選人 → 沒通知 → chain 卡住沒人簽。
--
-- 修法：拿掉自推過濾，讓申請人收到「請你自己審核」通知。
--       使用者直接在 LIFF/Web 對自己的單按核准即可推進。
--
-- 完整 CREATE OR REPLACE 避免 partial overwrite 災難
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

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

  -- 每個 approver 推一張卡（不過濾申請人本人，讓他自己也能收到「請自審」通知）
  FOR v_approver IN
    SELECT a.emp_id, v.line_user_id, v.liff_id
      FROM resolve_chain_step_approvers(v_step.id, v_sub.applicant_id) a
      JOIN v_employee_line_resolved v ON v.employee_id = a.emp_id
                                     AND v.line_user_id = a.line_user_id
     WHERE v.line_user_id IS NOT NULL
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
        'liff_url', v_liff_url,
        -- 提示是否自審
        'is_self_approve', v_approver.emp_id = v_sub.applicant_id
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

COMMIT;

NOTIFY pgrst, 'reload schema';
