-- 簽核鏈編輯 guard 改為「只擋沒快照的在飛單」 — 2026-07-31
-- ════════════════════════════════════════════════════════════════════════════
-- _guard_chain_steps_in_flight 原本:chain 有任何在飛單(申請中/待審核)就擋編輯。
-- 但每張單送出當下已建快照(request_chain_snapshots)凍結自己的流程,改 chain 不影響
-- 它們 → 這個擋對「有快照的在飛單」是多餘的(慘案:Chain 31 只有 1 張 leave #245,
-- 已有 2 關快照、完全受保護,卻擋住改鏈)。
-- 修:只擋「沒建快照=改鏈真的會影響」的在飛單;有快照的放行。opt-in bypass GUC 保留。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._guard_chain_steps_in_flight()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_count  INT;
  v_tables TEXT[] := ARRAY[
    'expense_requests', 'leave_requests', 'overtime_requests',
    'business_trips', 'clock_corrections', 'resignation_requests',
    'leave_of_absence_requests', 'personnel_transfer_requests', 'headcount_requests'
  ];
  -- 對應 request_chain_snapshots.request_type
  v_rts    TEXT[] := ARRAY[
    'expense_request', 'leave_request', 'overtime_request',
    'trip', 'correction', 'resignation',
    'loa', 'transfer', 'headcount'
  ];
  v_table TEXT;
  v_rt    TEXT;
  i INT;
BEGIN
  -- opt-in bypass:同步處理在飛單快照的維運才開(chain.bypass_guard='on')
  IF current_setting('chain.bypass_guard', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- 只擋「沒建快照(改鏈真的會影響)」的在飛單;有快照的已凍結自己流程 → 放行
  FOR i IN 1 .. array_length(v_tables, 1) LOOP
    v_table := v_tables[i];
    v_rt    := v_rts[i];
    EXECUTE format(
      'SELECT COUNT(*) FROM public.%I t
        WHERE t.approval_chain_id = $1
          AND t.status IN (''申請中'',''待審'',''待審核'')
          AND NOT EXISTS (
            SELECT 1 FROM public.request_chain_snapshots s
             WHERE s.request_type = $2 AND s.request_id = t.id)',
      v_table
    ) USING OLD.chain_id, v_rt INTO v_count;
    IF v_count > 0 THEN
      RAISE EXCEPTION
        'Chain % 有 % 張「未建快照」的在飛單（表：%），改鏈會影響到這些單,請先讓它們完成或手動處理',
        OLD.chain_id, v_count, v_table
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- form_submissions(透過 form_templates.approval_chain_id;快照 request_type='form_submission')
  SELECT COUNT(*) INTO v_count
    FROM public.form_submissions fs
    JOIN public.form_templates ft ON ft.id = fs.template_id
   WHERE ft.approval_chain_id = OLD.chain_id
     AND fs.status IN ('申請中','待審','待審核','pending')
     AND NOT EXISTS (
       SELECT 1 FROM public.request_chain_snapshots s
        WHERE s.request_type = 'form_submission' AND s.request_id = fs.id);
  IF v_count > 0 THEN
    RAISE EXCEPTION
      'Chain % 有 % 張未建快照的在飛 form_submissions，請先處理',
      OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $function$;

NOTIFY pgrst, 'reload schema';
