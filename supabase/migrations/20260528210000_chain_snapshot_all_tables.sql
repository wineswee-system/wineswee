-- ════════════════════════════════════════════════════════════════════════════
-- Chain Snapshot 擴展：補齊所有表單類型
-- 2026-05-28
--
-- 接續 20260528200000_chain_snapshot.sql（expense_requests 已完成）
-- 補上：
--   leave_requests / overtime_requests / clock_corrections / business_trips
--   resignation_requests / leave_of_absence_requests / personnel_transfer_requests
--   headcount_requests / form_submissions（chain 來自 form_templates）
--
-- 每張表：
--   1. AFTER INSERT trigger → 自動快照
--   2. Backfill → 補齊目前所有在飛單
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- 通用 trigger function（讀 approval_chain_id 欄位的表共用）
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trg_snapshot_chain_generic()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request_type TEXT;
  v_chain_id     INT;
BEGIN
  v_request_type := TG_ARGV[0];  -- 由各表 trigger 傳入

  -- 取 chain_id（通用欄位）
  v_chain_id := CASE
    WHEN TG_TABLE_NAME = 'form_submissions' THEN
      (SELECT ft.approval_chain_id FROM public.form_templates ft WHERE ft.id = NEW.template_id)
    ELSE
      (to_jsonb(NEW)->>'approval_chain_id')::int
  END;

  IF v_chain_id IS NULL THEN RETURN NEW; END IF;

  PERFORM public._snapshot_chain_for_request(v_request_type, NEW.id, v_chain_id);
  RETURN NEW;
END $$;

GRANT EXECUTE ON FUNCTION public._trg_snapshot_chain_generic()
  TO authenticated, service_role;


-- ══════════════════════════════════════════════════════════════════════════
-- leave_requests（請假）
-- ══════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_snapshot_leave_request_chain ON public.leave_requests;
CREATE TRIGGER trg_snapshot_leave_request_chain
  AFTER INSERT ON public.leave_requests
  FOR EACH ROW
  WHEN (NEW.approval_chain_id IS NOT NULL)
  EXECUTE FUNCTION public._trg_snapshot_chain_generic('leave_request');

-- Backfill
DO $$ DECLARE v_row leave_requests; BEGIN
  FOR v_row IN
    SELECT * FROM leave_requests
     WHERE approval_chain_id IS NOT NULL
       AND status IN ('申請中','待審','待審核')
       AND NOT EXISTS (SELECT 1 FROM request_chain_snapshots
                        WHERE request_type='leave_request' AND request_id=leave_requests.id)
  LOOP
    PERFORM public._snapshot_chain_for_request('leave_request', v_row.id, v_row.approval_chain_id);
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- overtime_requests（加班）
-- ══════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_snapshot_overtime_request_chain ON public.overtime_requests;
CREATE TRIGGER trg_snapshot_overtime_request_chain
  AFTER INSERT ON public.overtime_requests
  FOR EACH ROW
  WHEN (NEW.approval_chain_id IS NOT NULL)
  EXECUTE FUNCTION public._trg_snapshot_chain_generic('overtime_request');

DO $$ DECLARE v_row overtime_requests; BEGIN
  FOR v_row IN
    SELECT * FROM overtime_requests
     WHERE approval_chain_id IS NOT NULL
       AND status IN ('申請中','待審','待審核')
       AND NOT EXISTS (SELECT 1 FROM request_chain_snapshots
                        WHERE request_type='overtime_request' AND request_id=overtime_requests.id)
  LOOP
    PERFORM public._snapshot_chain_for_request('overtime_request', v_row.id, v_row.approval_chain_id);
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- clock_corrections（忘刷補登）
-- ══════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_snapshot_clock_correction_chain ON public.clock_corrections;
CREATE TRIGGER trg_snapshot_clock_correction_chain
  AFTER INSERT ON public.clock_corrections
  FOR EACH ROW
  WHEN (NEW.approval_chain_id IS NOT NULL)
  EXECUTE FUNCTION public._trg_snapshot_chain_generic('correction');

DO $$ DECLARE v_row clock_corrections; BEGIN
  FOR v_row IN
    SELECT * FROM clock_corrections
     WHERE approval_chain_id IS NOT NULL
       AND status IN ('申請中','待審','待審核')
       AND NOT EXISTS (SELECT 1 FROM request_chain_snapshots
                        WHERE request_type='correction' AND request_id=clock_corrections.id)
  LOOP
    PERFORM public._snapshot_chain_for_request('correction', v_row.id, v_row.approval_chain_id);
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- business_trips（出差）
-- ══════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_snapshot_business_trip_chain ON public.business_trips;
CREATE TRIGGER trg_snapshot_business_trip_chain
  AFTER INSERT ON public.business_trips
  FOR EACH ROW
  WHEN (NEW.approval_chain_id IS NOT NULL)
  EXECUTE FUNCTION public._trg_snapshot_chain_generic('trip');

DO $$ DECLARE v_row business_trips; BEGIN
  FOR v_row IN
    SELECT * FROM business_trips
     WHERE approval_chain_id IS NOT NULL
       AND status IN ('申請中','待審','待審核')
       AND NOT EXISTS (SELECT 1 FROM request_chain_snapshots
                        WHERE request_type='trip' AND request_id=business_trips.id)
  LOOP
    PERFORM public._snapshot_chain_for_request('trip', v_row.id, v_row.approval_chain_id);
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- resignation_requests（離職）
-- ══════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_snapshot_resignation_request_chain ON public.resignation_requests;
CREATE TRIGGER trg_snapshot_resignation_request_chain
  AFTER INSERT ON public.resignation_requests
  FOR EACH ROW
  WHEN (NEW.approval_chain_id IS NOT NULL)
  EXECUTE FUNCTION public._trg_snapshot_chain_generic('resignation');

DO $$ DECLARE v_row resignation_requests; BEGIN
  FOR v_row IN
    SELECT * FROM resignation_requests
     WHERE approval_chain_id IS NOT NULL
       AND status IN ('申請中','待審')
       AND NOT EXISTS (SELECT 1 FROM request_chain_snapshots
                        WHERE request_type='resignation' AND request_id=resignation_requests.id)
  LOOP
    PERFORM public._snapshot_chain_for_request('resignation', v_row.id, v_row.approval_chain_id);
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- leave_of_absence_requests（留職停薪）
-- ══════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_snapshot_loa_request_chain ON public.leave_of_absence_requests;
CREATE TRIGGER trg_snapshot_loa_request_chain
  AFTER INSERT ON public.leave_of_absence_requests
  FOR EACH ROW
  WHEN (NEW.approval_chain_id IS NOT NULL)
  EXECUTE FUNCTION public._trg_snapshot_chain_generic('loa');

DO $$ DECLARE v_row leave_of_absence_requests; BEGIN
  FOR v_row IN
    SELECT * FROM leave_of_absence_requests
     WHERE approval_chain_id IS NOT NULL
       AND status IN ('申請中','待審')
       AND NOT EXISTS (SELECT 1 FROM request_chain_snapshots
                        WHERE request_type='loa' AND request_id=leave_of_absence_requests.id)
  LOOP
    PERFORM public._snapshot_chain_for_request('loa', v_row.id, v_row.approval_chain_id);
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- personnel_transfer_requests（人事異動）
-- ══════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_snapshot_transfer_request_chain ON public.personnel_transfer_requests;
CREATE TRIGGER trg_snapshot_transfer_request_chain
  AFTER INSERT ON public.personnel_transfer_requests
  FOR EACH ROW
  WHEN (NEW.approval_chain_id IS NOT NULL)
  EXECUTE FUNCTION public._trg_snapshot_chain_generic('transfer');

DO $$ DECLARE v_row personnel_transfer_requests; BEGIN
  FOR v_row IN
    SELECT * FROM personnel_transfer_requests
     WHERE approval_chain_id IS NOT NULL
       AND status IN ('申請中','待審')
       AND NOT EXISTS (SELECT 1 FROM request_chain_snapshots
                        WHERE request_type='transfer' AND request_id=personnel_transfer_requests.id)
  LOOP
    PERFORM public._snapshot_chain_for_request('transfer', v_row.id, v_row.approval_chain_id);
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- headcount_requests（人力需求）
-- ══════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_snapshot_headcount_request_chain ON public.headcount_requests;
CREATE TRIGGER trg_snapshot_headcount_request_chain
  AFTER INSERT ON public.headcount_requests
  FOR EACH ROW
  WHEN (NEW.approval_chain_id IS NOT NULL)
  EXECUTE FUNCTION public._trg_snapshot_chain_generic('headcount');

DO $$ DECLARE v_row headcount_requests; BEGIN
  FOR v_row IN
    SELECT * FROM headcount_requests
     WHERE approval_chain_id IS NOT NULL
       AND status IN ('申請中','待審')
       AND NOT EXISTS (SELECT 1 FROM request_chain_snapshots
                        WHERE request_type='headcount' AND request_id=headcount_requests.id)
  LOOP
    PERFORM public._snapshot_chain_for_request('headcount', v_row.id, v_row.approval_chain_id);
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- form_submissions（所有自訂表單：門市報修、叫貨驗收、試用期評核…）
-- chain 來自 form_templates.approval_chain_id（不在 form_submissions 本身）
-- ══════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_snapshot_form_submission_chain ON public.form_submissions;
CREATE TRIGGER trg_snapshot_form_submission_chain
  AFTER INSERT ON public.form_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public._trg_snapshot_chain_generic('form_submission');
  -- 注意：不加 WHEN 條件，由 trigger function 內部判斷 chain_id

DO $$ DECLARE v_row form_submissions; v_chain_id INT; BEGIN
  FOR v_row IN
    SELECT * FROM form_submissions
     WHERE status IN ('申請中','待審','待審核','pending')
       AND NOT EXISTS (SELECT 1 FROM request_chain_snapshots
                        WHERE request_type='form_submission' AND request_id=form_submissions.id)
  LOOP
    SELECT ft.approval_chain_id INTO v_chain_id
      FROM form_templates ft WHERE ft.id = v_row.template_id;
    IF v_chain_id IS NOT NULL THEN
      PERFORM public._snapshot_chain_for_request('form_submission', v_row.id, v_chain_id);
    END IF;
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- 驗證：列出各表快照數量
-- ══════════════════════════════════════════════════════════════════════════
-- SELECT request_type, COUNT(DISTINCT request_id) AS 單數, COUNT(*) AS step_總數
-- FROM public.request_chain_snapshots
-- GROUP BY request_type
-- ORDER BY request_type;


COMMIT;
NOTIFY pgrst, 'reload schema';
