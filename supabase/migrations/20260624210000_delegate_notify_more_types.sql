-- ════════════════════════════════════════════════════════════════════════════
-- 代簽通知擴大:請假 / 加班 / 經常性費用 也推代簽卡給代理人
-- 2026-06-24  Phase 3+
--
-- 共用 helper _notify_delegates_for():掃 active 代理規則,委託人=本關簽核人 → 推代簽卡。
-- 各類型加 thin trigger 呼叫它(都用 EXCEPTION guard,絕不擋底層寫入)。
-- 其餘類型(調撥/稽核/出差/補打卡/罕見表單)代理人仍可在「簽核中心」看到並簽,只是不主動推 LINE,可日後比照加。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._notify_delegates_for(
  p_org_id int, p_chain_id int, p_step_order int, p_applicant_emp_id int,
  p_rt text, p_doc_label text, p_request_id int,
  p_applicant_name text DEFAULT NULL, p_summary text DEFAULT NULL,
  p_amount numeric DEFAULT NULL, p_currency text DEFAULT NULL, p_store text DEFAULT NULL, p_liff_to text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_url   CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_key   text; v_cs approval_chain_steps; v_dr record; v_deleg employees;
BEGIN
  IF p_chain_id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_cs FROM approval_chain_steps WHERE chain_id = p_chain_id AND step_order = p_step_order;
  IF v_cs.id IS NULL THEN RETURN; END IF;
  BEGIN SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_key := NULL; END;
  IF v_key IS NULL THEN RETURN; END IF;

  FOR v_dr IN
    SELECT delegator_employee_id, delegate_employee_id, reason, effective_from, effective_to
      FROM approval_delegation_rules
     WHERE is_active AND CURRENT_DATE >= effective_from
       AND (effective_to IS NULL OR CURRENT_DATE <= effective_to) AND org_id = p_org_id
  LOOP
    IF NOT public._employee_matches_chain_step(v_dr.delegator_employee_id, v_cs.id, p_applicant_emp_id, TRUE) THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM v_employee_line_resolved v WHERE v.employee_id = v_dr.delegate_employee_id AND v.line_user_id IS NOT NULL) THEN CONTINUE; END IF;
    SELECT * INTO v_deleg FROM employees WHERE id = v_dr.delegator_employee_id;
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object('employee_id', v_dr.delegate_employee_id, 'type', 'approval_delegated',
        'details', jsonb_build_object(
          'delegator_name', v_deleg.name, 'reason', v_dr.reason,
          'effective_from', v_dr.effective_from, 'effective_to', v_dr.effective_to,
          'rt', p_rt, 'request_id', p_request_id, 'doc_label', p_doc_label,
          'applicant_name', p_applicant_name, 'summary', p_summary,
          'amount', p_amount, 'currency', p_currency, 'store', p_store,
          'step_name', v_cs.label, 'liff_to', p_liff_to)));
  END LOOP;
END $$;

-- ── 請假 ──
CREATE OR REPLACE FUNCTION public._trg_notify_leave_delegates() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = '待審核' THEN
    PERFORM public._notify_delegates_for(NEW.organization_id, NEW.approval_chain_id, NEW.current_step, NEW.employee_id,
      'leave', '請假', NEW.id, NEW.employee,
      COALESCE(NEW.type, '') || ' ' || COALESCE(to_char(NEW.start_date, 'MM/DD'), '') ||
        CASE WHEN NEW.end_date IS NOT NULL THEN '–' || to_char(NEW.end_date, 'MM/DD') ELSE '' END ||
        CASE WHEN NEW.days IS NOT NULL THEN ' (' || NEW.days || '天)' ELSE '' END,
      NULL, NULL, NULL, NULL);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[leave_delegates] %', SQLERRM; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_notify_leave_delegates ON public.leave_requests;
CREATE TRIGGER trg_notify_leave_delegates AFTER INSERT OR UPDATE OF status, current_step ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_leave_delegates();

-- ── 加班 ──
CREATE OR REPLACE FUNCTION public._trg_notify_ot_delegates() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = '待審核' THEN
    PERFORM public._notify_delegates_for(NEW.organization_id, NEW.approval_chain_id, NEW.current_step, NEW.employee_id,
      'overtime', '加班', NEW.id, NEW.employee,
      COALESCE(to_char(NEW.date, 'MM/DD'), '') || ' ' || COALESCE(NEW.hours::text, NEW.ot_hours::text, '') || ' 小時',
      NULL, NULL, NEW.store, NULL);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[ot_delegates] %', SQLERRM; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_notify_ot_delegates ON public.overtime_requests;
CREATE TRIGGER trg_notify_ot_delegates AFTER INSERT OR UPDATE OF status, current_step ON public.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_ot_delegates();

-- ── 經常性費用 ──
CREATE OR REPLACE FUNCTION public._trg_notify_expense_simple_delegates() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = '待審核' THEN
    PERFORM public._notify_delegates_for(NEW.organization_id, NEW.approval_chain_id, NEW.current_step, NEW.employee_id,
      'expense', '經常性費用', NEW.id, NEW.employee, NEW.category, NEW.amount, 'TWD', NULL, NULL);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[expense_simple_delegates] %', SQLERRM; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_notify_expense_simple_delegates ON public.expenses;
CREATE TRIGGER trg_notify_expense_simple_delegates AFTER INSERT OR UPDATE OF status, current_step ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_expense_simple_delegates();

NOTIFY pgrst, 'reload schema';
