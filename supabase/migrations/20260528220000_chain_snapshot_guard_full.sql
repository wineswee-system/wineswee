-- ════════════════════════════════════════════════════════════════════════════
-- Chain Snapshot Guard 補強：擋住「換新 chain」的漏洞
-- 2026-05-28
--
-- 20260528200000 已擋 approval_chain_steps 的 DELETE/UPDATE。
-- 但若有人建新 chain 再改 approval_chains 指向 / form_templates.approval_chain_id，
-- 或直接改 expense_requests/leave_requests 等表的 approval_chain_id，
-- 現有 guard 不會觸發。
--
-- 補強：
--   1. BEFORE UPDATE OF approval_chain_id ON approval_chains：
--      若舊 chain 有在飛單 → 擋
--   2. BEFORE UPDATE OF approval_chain_id ON form_templates：
--      若舊 chain 有在飛 form_submissions → 擋
--   3. BEFORE DELETE ON approval_chains：
--      若該 chain 有在飛單 → 擋
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- helper：檢查一個 chain_id 是否有任何在飛單
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._chain_has_in_flight(p_chain_id INT)
RETURNS TABLE (table_name TEXT, cnt INT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT 'expense_requests'::TEXT, COUNT(*)::INT
    FROM expense_requests WHERE approval_chain_id = p_chain_id AND status IN ('申請中','待審')
  UNION ALL
  SELECT 'leave_requests', COUNT(*)::INT
    FROM leave_requests WHERE approval_chain_id = p_chain_id AND status IN ('申請中','待審','待審核')
  UNION ALL
  SELECT 'overtime_requests', COUNT(*)::INT
    FROM overtime_requests WHERE approval_chain_id = p_chain_id AND status IN ('申請中','待審','待審核')
  UNION ALL
  SELECT 'business_trips', COUNT(*)::INT
    FROM business_trips WHERE approval_chain_id = p_chain_id AND status IN ('申請中','待審','待審核')
  UNION ALL
  SELECT 'clock_corrections', COUNT(*)::INT
    FROM clock_corrections WHERE approval_chain_id = p_chain_id AND status IN ('申請中','待審','待審核')
  UNION ALL
  SELECT 'resignation_requests', COUNT(*)::INT
    FROM resignation_requests WHERE approval_chain_id = p_chain_id AND status IN ('申請中','待審')
  UNION ALL
  SELECT 'leave_of_absence_requests', COUNT(*)::INT
    FROM leave_of_absence_requests WHERE approval_chain_id = p_chain_id AND status IN ('申請中','待審')
  UNION ALL
  SELECT 'personnel_transfer_requests', COUNT(*)::INT
    FROM personnel_transfer_requests WHERE approval_chain_id = p_chain_id AND status IN ('申請中','待審')
  UNION ALL
  SELECT 'headcount_requests', COUNT(*)::INT
    FROM headcount_requests WHERE approval_chain_id = p_chain_id AND status IN ('申請中','待審')
  UNION ALL
  SELECT 'form_submissions', COUNT(*)::INT
    FROM form_submissions fs
    JOIN form_templates ft ON ft.id = fs.template_id
   WHERE ft.approval_chain_id = p_chain_id AND fs.status IN ('申請中','待審','待審核','pending');
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- 1. approval_chains：DELETE 或換 chain_id → 擋
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._guard_approval_chain_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_row  RECORD;
  v_msgs TEXT := '';
BEGIN
  FOR v_row IN SELECT * FROM public._chain_has_in_flight(OLD.id) WHERE cnt > 0 LOOP
    v_msgs := v_msgs || format('  %s: %s 張', v_row.table_name, v_row.cnt) || E'\n';
  END LOOP;

  IF v_msgs <> '' THEN
    RAISE EXCEPTION
      'Chain % (%) 有在飛單，無法%：%E\n請等這些單完成後再操作。',
      OLD.id, OLD.name,
      CASE TG_OP WHEN 'DELETE' THEN '刪除' ELSE '變更' END,
      E'\n' || v_msgs
      USING ERRCODE = 'P0001';
  END IF;

  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_guard_approval_chain_delete ON public.approval_chains;
CREATE TRIGGER trg_guard_approval_chain_delete
  BEFORE DELETE ON public.approval_chains
  FOR EACH ROW EXECUTE FUNCTION public._guard_approval_chain_change();

-- 注意：approval_chains 本身通常不會 UPDATE id，
-- 但若有人改 name 是允許的，只擋 DELETE 即可


-- ══════════════════════════════════════════════════════════════════════════
-- 2. form_templates.approval_chain_id 被換掉 → 擋舊 chain 的在飛 form_submissions
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._guard_form_template_chain_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_count INT;
BEGIN
  IF OLD.approval_chain_id IS NULL OR OLD.approval_chain_id = NEW.approval_chain_id THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM form_submissions fs
   WHERE fs.template_id = OLD.id
     AND fs.status IN ('申請中','待審','待審核','pending');

  IF v_count > 0 THEN
    RAISE EXCEPTION
      '表單範本「%」有 % 張在飛申請，無法變更簽核流程。請等申請完成後再修改。',
      OLD.name, v_count
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_form_template_chain_change ON public.form_templates;
CREATE TRIGGER trg_guard_form_template_chain_change
  BEFORE UPDATE OF approval_chain_id ON public.form_templates
  FOR EACH ROW EXECUTE FUNCTION public._guard_form_template_chain_change();


COMMIT;
NOTIFY pgrst, 'reload schema';
