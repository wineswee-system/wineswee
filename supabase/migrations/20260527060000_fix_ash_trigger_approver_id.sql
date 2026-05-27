-- ============================================================================
-- 修 ash trigger 漏掛 + backfill 已壞 approver_id
-- ============================================================================
--
-- Root cause:
--   _trg_ash_record_chain_step (新版 function，有 approver_id 邏輯) 存在但
--   完全沒 attach 任何表。實際在跑的是舊版 trg_log_approval_step_history，
--   它的 UPDATE 只 SET approver_name 不寫 approver_id。
--   → 所有 ash entries.approver_id 一律 NULL
--   → 「我簽過的」(_list_my_signed_approvals) 用 ash.approver_id = p_emp_id
--      過濾 → 任何人查都查不到自己簽過的歷史
--   → 譬如 ZOEY (陳虹) 簽過 expense_request #128 step 1，但 ash approver_id
--      是 NULL，她那邊「我簽過的」看不到這單
--
-- 修法：
--   1. Drop 舊 trigger 從 9 個表
--   2. CREATE 新 trigger 把 _trg_ash_record_chain_step 掛到 10 個表
--      (含 headcount_requests，新版 function 已支援)
--   3. Backfill 最後一關 approver_id（從 expense_requests.approved_by 等反查）
--      中間關（step 0/1/2）資料已丟，無法 backfill — 訊息損失永久
-- ============================================================================


-- ── 1. Drop 舊 trigger 從 9 個表 ─────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_log_approval_step_history ON public.leave_requests;
DROP TRIGGER IF EXISTS trg_log_approval_step_history ON public.overtime_requests;
DROP TRIGGER IF EXISTS trg_log_approval_step_history ON public.business_trips;
DROP TRIGGER IF EXISTS trg_log_approval_step_history ON public.clock_corrections;
DROP TRIGGER IF EXISTS trg_log_approval_step_history ON public.expenses;
DROP TRIGGER IF EXISTS trg_log_approval_step_history ON public.expense_requests;
DROP TRIGGER IF EXISTS trg_log_approval_step_history ON public.form_submissions;
DROP TRIGGER IF EXISTS trg_log_approval_step_history ON public.leave_of_absence_requests;
DROP TRIGGER IF EXISTS trg_log_approval_step_history ON public.personnel_transfer_requests;
DROP TRIGGER IF EXISTS trg_log_approval_step_history ON public.resignation_requests;

-- ── 1b. Drop 新 trigger（若已存在）以便重建 ──────────────────────────────────
-- 老闆 2026-05-27 已在 Studio 套用相同 trigger，但沒回填 migration → 此處需先 drop
DROP TRIGGER IF EXISTS trg_ash_record_chain_step ON public.leave_requests;
DROP TRIGGER IF EXISTS trg_ash_record_chain_step ON public.overtime_requests;
DROP TRIGGER IF EXISTS trg_ash_record_chain_step ON public.business_trips;
DROP TRIGGER IF EXISTS trg_ash_record_chain_step ON public.clock_corrections;
DROP TRIGGER IF EXISTS trg_ash_record_chain_step ON public.expenses;
DROP TRIGGER IF EXISTS trg_ash_record_chain_step ON public.expense_requests;
DROP TRIGGER IF EXISTS trg_ash_record_chain_step ON public.form_submissions;
DROP TRIGGER IF EXISTS trg_ash_record_chain_step ON public.leave_of_absence_requests;
DROP TRIGGER IF EXISTS trg_ash_record_chain_step ON public.personnel_transfer_requests;
DROP TRIGGER IF EXISTS trg_ash_record_chain_step ON public.resignation_requests;
DROP TRIGGER IF EXISTS trg_ash_record_chain_step ON public.headcount_requests;


-- ── 2. CREATE 新 trigger 把 _trg_ash_record_chain_step 掛到 10 個表 ─────────
CREATE TRIGGER trg_ash_record_chain_step
  AFTER INSERT OR UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_ash_record_chain_step();

CREATE TRIGGER trg_ash_record_chain_step
  AFTER INSERT OR UPDATE ON public.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_ash_record_chain_step();

CREATE TRIGGER trg_ash_record_chain_step
  AFTER INSERT OR UPDATE ON public.business_trips
  FOR EACH ROW EXECUTE FUNCTION public._trg_ash_record_chain_step();

CREATE TRIGGER trg_ash_record_chain_step
  AFTER INSERT OR UPDATE ON public.clock_corrections
  FOR EACH ROW EXECUTE FUNCTION public._trg_ash_record_chain_step();

CREATE TRIGGER trg_ash_record_chain_step
  AFTER INSERT OR UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public._trg_ash_record_chain_step();

CREATE TRIGGER trg_ash_record_chain_step
  AFTER INSERT OR UPDATE ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_ash_record_chain_step();

CREATE TRIGGER trg_ash_record_chain_step
  AFTER INSERT OR UPDATE ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION public._trg_ash_record_chain_step();

CREATE TRIGGER trg_ash_record_chain_step
  AFTER INSERT OR UPDATE ON public.leave_of_absence_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_ash_record_chain_step();

CREATE TRIGGER trg_ash_record_chain_step
  AFTER INSERT OR UPDATE ON public.personnel_transfer_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_ash_record_chain_step();

CREATE TRIGGER trg_ash_record_chain_step
  AFTER INSERT OR UPDATE ON public.resignation_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_ash_record_chain_step();

-- headcount_requests 新版 function 也支援，補掛上去
CREATE TRIGGER trg_ash_record_chain_step
  AFTER INSERT OR UPDATE ON public.headcount_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_ash_record_chain_step();


-- ── 3. Backfill 最後一關 approver_id ───────────────────────────────────────
-- 從各表的「最終簽核人」欄位反查 employees.id 補進 ash.approver_id
-- 只能補「終態 ash row」(action='approved'/'rejected' 且 exited_at NOT NULL)
-- 中間關（chain advance 時 approved_by 還沒 set）的 approver_id 已永久丟失

-- expense_requests: approved_by 是名字
UPDATE public.approval_step_history ash
SET approver_id = e.id,
    approver_name = COALESCE(ash.approver_name, e.name)
FROM public.expense_requests er
JOIN public.employees e ON e.name = er.approved_by
  AND (e.organization_id = er.organization_id OR er.organization_id IS NULL)
WHERE ash.request_type = 'expense_request'
  AND ash.request_id = er.id
  AND ash.approver_id IS NULL
  AND ash.action IN ('approved','rejected')
  AND er.approved_by IS NOT NULL
  -- 只補「最後一筆」(最終簽核人)，中間關 approved_by 對不上沒用
  AND ash.step_order = (
    SELECT MAX(step_order) FROM public.approval_step_history
    WHERE request_type = 'expense_request' AND request_id = er.id
  );

-- leave_requests / overtime_requests / business_trips / clock_corrections / expenses
-- 用 approver 欄位
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'leave_requests', 'overtime_requests', 'business_trips',
    'clock_corrections', 'expenses'
  ];
  v_rt_map jsonb := '{"leave_requests":"leave","overtime_requests":"overtime",
                       "business_trips":"trip","clock_corrections":"correction",
                       "expenses":"expense"}'::jsonb;
  v_table text;
  v_rt text;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    v_rt := v_rt_map->>v_table;
    EXECUTE format($f$
      UPDATE public.approval_step_history ash
      SET approver_id = e.id,
          approver_name = COALESCE(ash.approver_name, e.name)
      FROM public.%I src
      JOIN public.employees e ON e.name = src.approver
        AND (e.organization_id = src.organization_id OR src.organization_id IS NULL)
      WHERE ash.request_type = %L
        AND ash.request_id = src.id
        AND ash.approver_id IS NULL
        AND ash.action IN ('approved','rejected')
        AND src.approver IS NOT NULL
        AND ash.step_order = (
          SELECT MAX(step_order) FROM public.approval_step_history
          WHERE request_type = %L AND request_id = src.id
        )
    $f$, v_table, v_rt, v_rt);
  END LOOP;
END $$;

-- form_submissions: approver_id 已經是 int 直接補
UPDATE public.approval_step_history ash
SET approver_id = fs.approver_id,
    approver_name = COALESCE(ash.approver_name, e.name)
FROM public.form_submissions fs
LEFT JOIN public.employees e ON e.id = fs.approver_id
WHERE ash.request_type = 'form_submission'
  AND ash.request_id = fs.id
  AND ash.approver_id IS NULL
  AND ash.action IN ('approved','rejected')
  AND fs.approver_id IS NOT NULL
  AND ash.step_order = (
    SELECT MAX(step_order) FROM public.approval_step_history
    WHERE request_type = 'form_submission' AND request_id = fs.id
  );


-- ── 完成 — 統計 backfill 結果 ──────────────────────────────────────────────
DO $$
DECLARE
  v_total_null int;
  v_backfilled int;
BEGIN
  SELECT count(*) INTO v_total_null
    FROM public.approval_step_history
   WHERE approver_id IS NULL AND action IN ('approved','rejected');

  RAISE NOTICE '[ash backfill] 剩餘 approver_id=NULL 且 action=approved/rejected: % 筆', v_total_null;
  RAISE NOTICE '[ash backfill] 中間關 approver_id 因 chain advance 時 approved_by 還沒 set 已永久丟失';
  RAISE NOTICE '[ash backfill] 新版 trigger 已掛 → 之後新案件會正常寫 approver_id';
END $$;
