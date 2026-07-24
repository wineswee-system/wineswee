-- 非費用申請簽核鏈 step0 改「直屬主管」+ 在飛單快照同步 — 2026-07-24
-- ════════════════════════════════════════════════════════════════════════════
-- chain#21「非費用申請簽核鏈」& #41「叫貨-非費用申請簽核鏈」第0關:
--   applicant_dept_manager(部門主管/上層主管) → applicant_supervisor(直屬主管)
-- 因費用/非費用簽核是「快照凍結」(expense_request_step_advance snapshot-first),
--   改鏈只影響未來新單;在飛單須同步改快照,但僅限「還沒簽過 step0」的單。
-- 在飛單:目前只有 #392(林巧玉 用印,chain#21,current_step=0)符合。
--   附:#392 舊 step0(部門主管)解到林巧玉本人(她是加盟展店事業部主管)=自簽,
--   改直屬主管解到陳虹#52,順帶修掉自簽。
--
-- ⚠️ _guard_chain_steps_in_flight() 會擋「在飛單時改鏈步驟」(防漂移)。
--   本次因「改鏈+同步改快照」一起做,drift 當下即補,故加 opt-in bypass GUC
--   (chain.bypass_guard='on' 才放行,平時照擋),做完還原。
-- 兩段 UPDATE 都加 target_type 舊值 guard → idempotent。
-- ════════════════════════════════════════════════════════════════════════════

-- 0) 給 guard 加 opt-in bypass(其餘邏輯與 live 逐字一致,只在 BEGIN 後插 bypass 判斷)
CREATE OR REPLACE FUNCTION public._guard_chain_steps_in_flight()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_count INT;
  v_tables TEXT[] := ARRAY[
    'expense_requests', 'leave_requests', 'overtime_requests',
    'business_trips', 'clock_corrections', 'resignation_requests',
    'leave_of_absence_requests', 'personnel_transfer_requests', 'headcount_requests'
  ];
  v_table TEXT;
BEGIN
  -- ★opt-in bypass:同步處理在飛單快照的維運才開(chain.bypass_guard='on');平時 NULL/off 照擋
  IF current_setting('chain.bypass_guard', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- 在飛單保護:任一 HR B 表有引用本 chain 的申請中/待審單 → 擋
  v_count := 0;
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format(
      'SELECT COUNT(*) FROM public.%I WHERE approval_chain_id = $1 AND status IN (''申請中'',''待審'',''待審核'')',
      v_table
    ) USING OLD.chain_id INTO v_count;
    IF v_count > 0 THEN
      RAISE EXCEPTION
        'Chain % 有 % 張在飛單（表：%），請先等這些單完成或手動處理後再修改簽核流程',
        OLD.chain_id, v_count, v_table
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- form_submissions 透過 form_templates.approval_chain_id
  SELECT COUNT(*) INTO v_count
    FROM public.form_submissions fs
    JOIN public.form_templates ft ON ft.id = fs.template_id
   WHERE ft.approval_chain_id = OLD.chain_id
     AND fs.status IN ('申請中','待審','待審核','pending');
  IF v_count > 0 THEN
    RAISE EXCEPTION
      'Chain % 有 % 張在飛的 form_submissions，請先等完成後再修改',
      OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  -- ★修正:DELETE 回 OLD(放行刪除);UPDATE 回 NEW(放行修改,不再靜默還原)
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END $function$;

-- 1) 開 bypass(本次同步改快照,drift 已處理)
SELECT set_config('chain.bypass_guard', 'on', false);

-- 2) 鏈設定(未來新單走這個)
UPDATE approval_chain_steps
   SET target_type = 'applicant_supervisor',
       label       = '直屬主管',
       role_name   = '直屬主管'
 WHERE chain_id IN (21, 41)
   AND step_order = 0
   AND target_type = 'applicant_dept_manager';

-- 3) 在飛單快照同步(只動:申請中 + step0 尚未簽核 current_step<=0 的 expense_request)
UPDATE request_chain_snapshots s
   SET target_type = 'applicant_supervisor',
       label       = '直屬主管',
       role_name   = '直屬主管'
 WHERE s.request_type = 'expense_request'
   AND s.step_order   = 0
   AND s.chain_id IN (21, 41)
   AND s.target_type  = 'applicant_dept_manager'
   AND EXISTS (
     SELECT 1 FROM expense_requests e
      WHERE e.id = s.request_id
        AND e.status = '申請中'
        AND e.current_step <= 0
   );

-- 4) 還原保護(bypass 關掉)
SELECT set_config('chain.bypass_guard', 'off', false);

NOTIFY pgrst, 'reload schema';
