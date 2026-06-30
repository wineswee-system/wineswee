-- ════════════════════════════════════════════════════════════════════════════
-- 代簽通知：補齊 8 種表單類型（補打卡 / 出差 / 離職 / 留職停薪 / 人員調派
--   / 人力申請 / 商品調撥 / 自定義表單）
-- 2026-06-30
--
-- 共用 _notify_delegates_for() helper（已存在）。
-- 各類型加 thin trigger：INSERT + UPDATE OF status, current_step。
-- EXCEPTION guard 全套，絕不擋底層寫入。
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. 補打卡 (clock_corrections) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_notify_correction_delegates()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp_id int;
BEGIN
  IF NEW.status <> '待審核' OR NEW.approval_chain_id IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO v_emp_id FROM employees
   WHERE name = NEW.employee
     AND (organization_id = NEW.organization_id OR NEW.organization_id IS NULL) LIMIT 1;
  PERFORM public._notify_delegates_for(
    NEW.organization_id, NEW.approval_chain_id, NEW.current_step, v_emp_id,
    'correction', '補打卡', NEW.id,
    (SELECT name FROM employees WHERE id = v_emp_id),
    COALESCE(NEW.type, '') ||
      CASE WHEN NEW.correction_time IS NOT NULL
           THEN ' ' || to_char(NEW.correction_time, 'HH24:MI') ELSE '' END,
    NULL, NULL, NEW.store, NULL
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[correction_delegates] %', SQLERRM; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notify_correction_delegates ON public.clock_corrections;
CREATE TRIGGER trg_notify_correction_delegates
  AFTER INSERT OR UPDATE OF status, current_step ON public.clock_corrections
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_correction_delegates();

-- ── 2. 出差 (business_trips) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_notify_trip_delegates()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp_id int;
BEGIN
  IF NEW.status <> '待審核' OR NEW.approval_chain_id IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO v_emp_id FROM employees
   WHERE name = NEW.employee
     AND (organization_id = NEW.organization_id OR NEW.organization_id IS NULL) LIMIT 1;
  PERFORM public._notify_delegates_for(
    NEW.organization_id, NEW.approval_chain_id, NEW.current_step, v_emp_id,
    'trip', '出差申請', NEW.id,
    (SELECT name FROM employees WHERE id = v_emp_id),
    COALESCE(NEW.destination, '') ||
      CASE WHEN NEW.start_date IS NOT NULL
           THEN ' ' || to_char(NEW.start_date, 'MM/DD') ||
                CASE WHEN NEW.end_date IS NOT NULL AND NEW.end_date <> NEW.start_date
                     THEN '–' || to_char(NEW.end_date, 'MM/DD') ELSE '' END
           ELSE '' END,
    NEW.budget, 'TWD', NULL, NULL
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[trip_delegates] %', SQLERRM; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notify_trip_delegates ON public.business_trips;
CREATE TRIGGER trg_notify_trip_delegates
  AFTER INSERT OR UPDATE OF status, current_step ON public.business_trips
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_trip_delegates();

-- ── 3. 離職申請 (resignation_requests) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_notify_resignation_delegates()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status <> '申請中' OR NEW.approval_chain_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public._notify_delegates_for(
    NEW.organization_id, NEW.approval_chain_id, NEW.current_step, NEW.employee_id,
    'resignation', '離職申請', NEW.id,
    (SELECT name FROM employees WHERE id = NEW.employee_id),
    CASE WHEN NEW.planned_resign_date IS NOT NULL THEN '預定離職 ' || to_char(NEW.planned_resign_date, 'MM/DD') ELSE NULL END,
    NULL, NULL, NULL, NULL
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[resignation_delegates] %', SQLERRM; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notify_resignation_delegates ON public.resignation_requests;
CREATE TRIGGER trg_notify_resignation_delegates
  AFTER INSERT OR UPDATE OF status, current_step ON public.resignation_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_resignation_delegates();

-- ── 4. 留職停薪 (leave_of_absence_requests) ───────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_notify_loa_delegates()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status <> '申請中' OR NEW.approval_chain_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public._notify_delegates_for(
    NEW.organization_id, NEW.approval_chain_id, NEW.current_step, NEW.employee_id,
    'leave_of_absence', '留職停薪', NEW.id,
    (SELECT name FROM employees WHERE id = NEW.employee_id),
    COALESCE(NEW.reason_type, '') ||
      CASE WHEN NEW.start_date IS NOT NULL
           THEN ' ' || to_char(NEW.start_date, 'MM/DD') ||
                CASE WHEN NEW.planned_end_date IS NOT NULL
                     THEN '–' || to_char(NEW.planned_end_date, 'MM/DD') ELSE '' END
           ELSE '' END,
    NULL, NULL, NULL, NULL
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[loa_delegates] %', SQLERRM; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notify_loa_delegates ON public.leave_of_absence_requests;
CREATE TRIGGER trg_notify_loa_delegates
  AFTER INSERT OR UPDATE OF status, current_step ON public.leave_of_absence_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_loa_delegates();

-- ── 5. 人員調派 (personnel_transfer_requests) ─────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_notify_personnel_transfer_delegates()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status <> '申請中' OR NEW.approval_chain_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public._notify_delegates_for(
    NEW.organization_id, NEW.approval_chain_id, NEW.current_step, NEW.employee_id,
    'personnel_transfer', '人員調派', NEW.id,
    (SELECT name FROM employees WHERE id = NEW.employee_id),
    COALESCE(CASE WHEN NEW.effective_date IS NOT NULL THEN '生效 ' || to_char(NEW.effective_date, 'MM/DD') ELSE '' END, '') ||
    COALESCE(CASE WHEN NEW.new_position IS NOT NULL THEN ' → ' || NEW.new_position ELSE '' END, ''),
    NULL, NULL, NULL, NULL
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[personnel_transfer_delegates] %', SQLERRM; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notify_personnel_transfer_delegates ON public.personnel_transfer_requests;
CREATE TRIGGER trg_notify_personnel_transfer_delegates
  AFTER INSERT OR UPDATE OF status, current_step ON public.personnel_transfer_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_personnel_transfer_delegates();

-- ── 6. 人力申請 (headcount_requests) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_notify_headcount_delegates()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status <> '申請中' OR NEW.approval_chain_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public._notify_delegates_for(
    NEW.organization_id, NEW.approval_chain_id, NEW.current_step, NEW.employee_id,
    'headcount', '人力申請', NEW.id,
    (SELECT name FROM employees WHERE id = NEW.employee_id),
    COALESCE(NEW.job_title, '') ||
      CASE WHEN NEW.headcount > 1 THEN ' × ' || NEW.headcount ELSE '' END ||
      CASE WHEN NEW.job_type IS NOT NULL THEN '（' || NEW.job_type || '）' ELSE '' END,
    NULL, NULL, NULL, NULL
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[headcount_delegates] %', SQLERRM; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notify_headcount_delegates ON public.headcount_requests;
CREATE TRIGGER trg_notify_headcount_delegates
  AFTER INSERT OR UPDATE OF status, current_step ON public.headcount_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_headcount_delegates();

-- ── 7. 商品調撥 (goods_transfer_requests) — 申請 + 驗收兩段 ───────────────
CREATE OR REPLACE FUNCTION public._trg_notify_goods_transfer_delegates()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_chain int; v_label text;
BEGIN
  IF NEW.status = '申請審核中' THEN
    v_chain := NEW.apply_chain_id; v_label := '調撥申請';
  ELSIF NEW.status = '驗收審核中' THEN
    v_chain := NEW.receipt_chain_id; v_label := '調撥驗收';
  ELSE
    RETURN NEW;
  END IF;
  IF v_chain IS NULL THEN RETURN NEW; END IF;
  PERFORM public._notify_delegates_for(
    NEW.organization_id, v_chain, NEW.current_step, NEW.applicant_id,
    'goods_transfer', v_label, NEW.id,
    NEW.applicant_name,
    COALESCE(NEW.from_label, '—') || ' → ' || COALESCE(NEW.to_label, '—'),
    NULL, NULL, NEW.applicant_store, NULL
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[goods_transfer_delegates] %', SQLERRM; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notify_goods_transfer_delegates ON public.goods_transfer_requests;
CREATE TRIGGER trg_notify_goods_transfer_delegates
  AFTER INSERT OR UPDATE OF status, current_step ON public.goods_transfer_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_goods_transfer_delegates();

-- ── 8. 自定義表單 (form_submissions) — chain 在 form_templates ─────────────
CREATE OR REPLACE FUNCTION public._trg_notify_form_submission_delegates()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_chain int; v_tpl_name text;
BEGIN
  IF NEW.status <> '申請中' THEN RETURN NEW; END IF;
  SELECT ft.approval_chain_id, ft.name
    INTO v_chain, v_tpl_name
    FROM form_templates ft WHERE ft.id = NEW.template_id;
  IF v_chain IS NULL THEN RETURN NEW; END IF;
  PERFORM public._notify_delegates_for(
    NEW.organization_id, v_chain, NEW.current_step, NEW.applicant_id,
    'form_submission', COALESCE(v_tpl_name, '自定義表單'), NEW.id,
    (SELECT name FROM employees WHERE id = NEW.applicant_id),
    NULL, NULL, NULL, NULL, NULL
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[form_submission_delegates] %', SQLERRM; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notify_form_submission_delegates ON public.form_submissions;
CREATE TRIGGER trg_notify_form_submission_delegates
  AFTER INSERT OR UPDATE OF status, current_step ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_form_submission_delegates();

NOTIFY pgrst, 'reload schema';
