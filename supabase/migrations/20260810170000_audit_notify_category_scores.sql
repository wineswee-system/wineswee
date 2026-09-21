CREATE OR REPLACE FUNCTION public._notify_store_audit_event(p_audit_id integer, p_event text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url       CONSTANT TEXT := 'https://uoernfpfieurtjqwbnii.supabase.co/functions/v1/hr-notify';
  v_anon      CONSTANT TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvZXJuZnBmaWV1cnRqcXdibmlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3Nzg0NDUsImV4cCI6MjEwMDM1NDQ0NX0.jubKj63U9L4GiosFbu0p530zepbcdVTG86XSua1SnsU';
  v_audit     store_audits;
  v_step      approval_chain_steps;
  v_total     INT;
  v_count     INT := 0;
  r_target    RECORD;
  v_payload   JSONB;
  v_failed    INT;
  v_step_label TEXT;
  v_step_idx  INT;
  v_cats      JSONB;
BEGIN
  SELECT * INTO v_audit FROM store_audits WHERE id = p_audit_id;
  IF v_audit.id IS NULL THEN RETURN 0; END IF;

  SELECT COUNT(*) INTO v_failed FROM store_audit_items WHERE audit_id = p_audit_id AND passed = FALSE;

  -- 每大項分數(=100-該類扣分,封頂100/地板0);給 LINE 卡顯示
  SELECT jsonb_agg(jsonb_build_object('name', category_name, 'score', score) ORDER BY category_code)
    INTO v_cats
  FROM (
    SELECT category_code, MAX(category_name) AS category_name,
           LEAST(100, GREATEST(0, 100 - SUM(CASE WHEN input_type='bonus' THEN -COALESCE(deduct_score,0)
                                                 ELSE COALESCE(deduct_score,0) END))) AS score
      FROM store_audit_items WHERE audit_id = p_audit_id
     GROUP BY category_code
  ) c;

  IF p_event = 'chain_step' AND v_audit.approval_chain_id IS NOT NULL THEN
    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = v_audit.approval_chain_id AND step_order = v_audit.current_step;
    SELECT COUNT(*) INTO v_total FROM approval_chain_steps WHERE chain_id = v_audit.approval_chain_id;
    v_step_label := COALESCE(v_step.label, v_step.role_name, '第' || (v_audit.current_step + 1) || '關');
    v_step_idx   := v_audit.current_step;
  END IF;

  -- 當班人員（on_duty_confirm/rejected 用）
  IF p_event IN ('on_duty_confirm', 'rejected') THEN
    FOR r_target IN
      SELECT od.employee_id, v.line_user_id, v.liff_id
        FROM store_audit_on_duty od
        JOIN v_employee_line_resolved v ON v.employee_id = od.employee_id
       WHERE od.audit_id = p_audit_id AND od.employee_id IS NOT NULL
         AND v.line_user_id IS NOT NULL
         AND (p_event = 'rejected' OR od.confirmed = FALSE)
    LOOP
      v_payload := jsonb_build_object(
        'employee_id', r_target.employee_id,
        'type', CASE WHEN p_event = 'on_duty_confirm' THEN 'store_audit_on_duty_assigned' ELSE 'store_audit_rejected' END,
        'details', jsonb_build_object(
          'audit_id', p_audit_id, 'store_name', v_audit.store_name,
          'audit_date', to_char(v_audit.audit_date, 'YYYY-MM-DD'),
          'shift', v_audit.shift, 'auditor_name', v_audit.auditor_name,
          'failed_count', v_failed, 'total_deducted', v_audit.total_deducted,
          'avg_score', v_audit.avg_score, 'categories', v_cats,
          'reject_reason', v_audit.reject_reason,
          'liff_url', CASE WHEN r_target.liff_id IS NULL OR r_target.liff_id = '' THEN NULL
                           ELSE 'https://liff.line.me/' || r_target.liff_id || '?to=%2Fstore-audit%2F' || p_audit_id END
        )
      );
      PERFORM net.http_post(url := v_url, body := v_payload,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_anon),
        timeout_milliseconds := 5000);
      v_count := v_count + 1;
    END LOOP;
  END IF;

  -- ★ chain_step：不再過濾稽核員本人，自審也推
  IF p_event = 'chain_step' AND v_step.id IS NOT NULL THEN
    FOR r_target IN
      SELECT a.emp_id, v.line_user_id, v.liff_id
        FROM resolve_chain_step_approvers(v_step.id, v_audit.auditor_id) a
        JOIN v_employee_line_resolved v ON v.employee_id = a.emp_id
       WHERE v.line_user_id IS NOT NULL
    LOOP
      v_payload := jsonb_build_object(
        'employee_id', r_target.emp_id,
        'type', 'store_audit_step_assigned',
        'details', jsonb_build_object(
          'audit_id', p_audit_id, 'store_name', v_audit.store_name,
          'audit_date', to_char(v_audit.audit_date, 'YYYY-MM-DD'),
          'shift', v_audit.shift, 'auditor_name', v_audit.auditor_name,
          'failed_count', v_failed, 'total_deducted', v_audit.total_deducted,
          'avg_score', v_audit.avg_score, 'categories', v_cats,
          'current_step_label', v_step_label, 'current_step_index', v_step_idx, 'total_steps', v_total,
          'is_self_approve', r_target.emp_id = v_audit.auditor_id,
          'liff_url', CASE WHEN r_target.liff_id IS NULL OR r_target.liff_id = '' THEN NULL
                           ELSE 'https://liff.line.me/' || r_target.liff_id || '?to=%2Fstore-audit%2F' || p_audit_id END
        )
      );
      PERFORM net.http_post(url := v_url, body := v_payload,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_anon),
        timeout_milliseconds := 5000);
      v_count := v_count + 1;
    END LOOP;
  END IF;

  -- 稽核員（approved/rejected 用）
  IF p_event IN ('approved', 'rejected') AND v_audit.auditor_id IS NOT NULL THEN
    FOR r_target IN
      SELECT v.line_user_id, v.liff_id
        FROM v_employee_line_resolved v
       WHERE v.employee_id = v_audit.auditor_id AND v.line_user_id IS NOT NULL
       LIMIT 1
    LOOP
      v_payload := jsonb_build_object(
        'employee_id', v_audit.auditor_id,
        'type', CASE WHEN p_event = 'approved' THEN 'store_audit_approved' ELSE 'store_audit_rejected' END,
        'details', jsonb_build_object(
          'audit_id', p_audit_id, 'store_name', v_audit.store_name,
          'audit_date', to_char(v_audit.audit_date, 'YYYY-MM-DD'),
          'shift', v_audit.shift, 'auditor_name', v_audit.auditor_name,
          'failed_count', v_failed, 'total_deducted', v_audit.total_deducted,
          'avg_score', v_audit.avg_score, 'categories', v_cats,
          'reject_reason', v_audit.reject_reason, 'approver', v_audit.approver,
          'liff_url', CASE WHEN r_target.liff_id IS NULL OR r_target.liff_id = '' THEN NULL
                           ELSE 'https://liff.line.me/' || r_target.liff_id || '?to=%2Fstore-audit%2F' || p_audit_id END
        )
      );
      PERFORM net.http_post(url := v_url, body := v_payload,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_anon),
        timeout_milliseconds := 5000);
      v_count := v_count + 1;
    END LOOP;
  END IF;

  RETURN v_count;
END $function$

;
