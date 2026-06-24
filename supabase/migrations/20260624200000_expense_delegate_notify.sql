-- ════════════════════════════════════════════════════════════════════════════
-- 代簽通知(費用):費用申請/核銷進到某關時,若該關簽核人有 active 代理人 → 推代簽卡給代理人
-- 2026-06-24  Phase 3(先費用,其他類型之後比照)
--
-- 隔離做法:獨立 AFTER trigger,不改既有 settle/notify 大函式。
-- 代理規則筆數少 → 掃規則、用 matcher 判斷委託人是否=本關簽核人,成立才推。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._notify_expense_delegates()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_url   CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_key   text;
  v_chain int; v_step_order int; v_rt text; v_label text;
  v_cs    approval_chain_steps;
  v_dr    record;
  v_deleg employees;
BEGIN
  -- 決定目前待簽的關卡
  IF NEW.status = '申請中' THEN
    v_chain := NEW.approval_chain_id; v_step_order := NEW.current_step; v_rt := 'expense_request'; v_label := '費用申請';
  ELSIF NEW.status = '待核銷' THEN
    v_chain := NEW.settle_chain_id; v_step_order := NEW.settle_current_step; v_rt := 'expense_settle'; v_label := '費用核銷(驗收)';
  ELSE
    RETURN NEW;
  END IF;
  IF v_chain IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_cs FROM approval_chain_steps WHERE chain_id = v_chain AND step_order = v_step_order;
  IF v_cs.id IS NULL THEN RETURN NEW; END IF;

  BEGIN
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_key := NULL; END;
  IF v_key IS NULL THEN RETURN NEW; END IF;

  -- 掃 active 代理規則:委託人=本關簽核人 → 推代簽卡給代理人
  FOR v_dr IN
    SELECT dr.delegator_employee_id, dr.delegate_employee_id, dr.reason, dr.effective_from, dr.effective_to
      FROM approval_delegation_rules dr
     WHERE dr.is_active
       AND CURRENT_DATE >= dr.effective_from
       AND (dr.effective_to IS NULL OR CURRENT_DATE <= dr.effective_to)
       AND dr.org_id = NEW.organization_id
  LOOP
    -- 委託人是否為本關簽核人(用同一支 matcher,via_delegation=TRUE 避免再展開)
    IF NOT public._employee_matches_chain_step(v_dr.delegator_employee_id, v_cs.id, NEW.employee_id, TRUE) THEN
      CONTINUE;
    END IF;
    -- 代理人要有 LINE 才推
    IF NOT EXISTS (SELECT 1 FROM v_employee_line_resolved v WHERE v.employee_id = v_dr.delegate_employee_id AND v.line_user_id IS NOT NULL) THEN
      CONTINUE;
    END IF;
    SELECT * INTO v_deleg FROM employees WHERE id = v_dr.delegator_employee_id;

    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object(
        'employee_id', v_dr.delegate_employee_id,
        'type', 'approval_delegated',
        'details', jsonb_build_object(
          'delegator_name',  v_deleg.name,
          'reason',          v_dr.reason,
          'effective_from',  v_dr.effective_from,
          'effective_to',    v_dr.effective_to,
          'rt',              v_rt,
          'request_id',      NEW.id,
          'doc_label',       v_label,
          'title',           NEW.title,
          'applicant_name',  NEW.employee,
          'applicant_dept',  NEW.department,
          'amount',          COALESCE(NEW.actual_amount, NEW.estimated_amount),
          'currency',        NEW.currency,
          'store',           NEW.store,
          'step_name',       v_cs.label
        )
      )
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[_notify_expense_delegates] failed: %', SQLERRM;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_expense_delegates ON public.expense_requests;
CREATE TRIGGER trg_notify_expense_delegates
  AFTER INSERT OR UPDATE OF status, current_step, settle_current_step ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public._notify_expense_delegates();

NOTIFY pgrst, 'reload schema';
