-- ════════════════════════════════════════════════════════════
-- 自簽自動跳過：expense_requests Phase 1
-- 2026-05-15
--
-- 問題：chain step target_type 是 applicant_dept_manager / store_manager /
--       section_supervisor / supervisor 時，若申請人本身就是該層主管 →
--       chain 解析回他自己 → 自己簽自己（生產 case #60 李英顥）。
--
-- 修法：加新 trigger（不動現有 function / chain 推進邏輯），
--       在 INSERT 或 current_step 變動時，自動 fast-forward 過所有
--       會解析到申請人本身的關卡。
--
-- 範圍：先只動 expense_requests 一張表（Phase 1）。
--       驗證 1-2 天沒事再 Phase 2 套到 resignation / loa / transfer /
--       leave / overtime。
--
-- 不會影響：
--   1. 歷史單（trigger 只 fire on 新 INSERT 或 step 變動）
--   2. 申請人 ≠ 該關目標的單（trigger fire 但 IF 不成立，no-op）
--   3. 既有的 expense_request_step_advance / 通知 / chain config 邏輯
--
-- Dry-run 結果（執行此 migration 前）：
--   ① 當下這關自簽：0 筆
--   ② 整條 chain 會自簽：0 筆
--   ③ applicant_dept_manager: 17 step / 13 chain / 2 條在飛
--      applicant_supervisor:  2 step  / 2 chain  / 0 條在飛
--   ④ 在飛單 0 筆會受影響 → 完全 forward-looking 修法
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. 新 trigger function：fast-forward 過 self-resolve 的關卡 ═══
-- 每跳一關都會在 approval_step_history 補一筆 'auto_skipped' 紀錄
-- 讓簽核流程圖能正確顯示「自動跳過」而不是「未進入」
CREATE OR REPLACE FUNCTION public.auto_skip_self_approval_expense_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_step          approval_chain_steps;
  v_total_steps   int;
  v_matches       boolean;
  v_safety        int := 0;  -- 防止意外無限迴圈
BEGIN
  -- ── 早 return：不適用情境直接放過 ──
  IF NEW.approval_chain_id IS NULL OR NEW.employee_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.current_step IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('申請中', '待審') THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps
   WHERE chain_id = NEW.approval_chain_id;
  IF v_total_steps = 0 THEN
    RETURN NEW;
  END IF;

  -- ── 從 current_step 開始往後找第一個「非 self-resolve」的關 ──
  WHILE NEW.current_step < v_total_steps AND v_safety < 100 LOOP
    v_safety := v_safety + 1;

    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = NEW.approval_chain_id
       AND step_order = NEW.current_step;

    IF v_step.id IS NULL THEN
      EXIT;  -- chain 結構異常，停手
    END IF;

    -- 判斷該關目標是否解析到申請人本身
    -- 直接複用既有的 _employee_matches_chain_step（read-only，不動）
    SELECT public._employee_matches_chain_step(
      NEW.employee_id, v_step.id, NEW.employee_id
    ) INTO v_matches;

    IF NOT v_matches THEN
      EXIT;  -- 找到下一個非 self 的關，停在這
    END IF;

    -- 是 self → 補一筆 history「auto_skipped」，再跳過這關
    -- BEFORE INSERT 時 NEW.id 已透過 SERIAL default 拿到值
    INSERT INTO approval_step_history (
      request_type, request_id, organization_id, chain_id,
      step_order, step_label, target_type,
      entered_at, exited_at, action,
      approver_name, notes
    ) VALUES (
      'expense_request', NEW.id, NEW.organization_id, NEW.approval_chain_id,
      NEW.current_step, v_step.label, v_step.target_type,
      NOW(), NOW(), 'auto_skipped',
      '系統自動跳過', '申請人本身為該層主管'
    );

    NEW.current_step := NEW.current_step + 1;
  END LOOP;

  -- ── 安全閥：整條 chain 都解析到申請人 → 自動標記已核准 ──
  IF NEW.current_step >= v_total_steps THEN
    NEW.status := '已核准';
    NEW.current_step := v_total_steps;
    IF NEW.approved_by IS NULL OR NEW.approved_by = '' THEN
      NEW.approved_by := '系統自動跳過';
    END IF;
    IF NEW.approved_at IS NULL THEN
      NEW.approved_at := NOW();
    END IF;
  END IF;

  RETURN NEW;
END $$;

GRANT EXECUTE ON FUNCTION public.auto_skip_self_approval_expense_request() TO authenticated, service_role;


-- ═══ 2. INSERT trigger：剛建單就先跳過 self 關 ═══
-- 觸發時機：BEFORE INSERT，且要在 trg_auto_apply_chain_expense 之後
-- 命名 trg_z_* 確保字母順序排在 chain 指派 trigger (trg_auto_apply_*) 之後
DROP TRIGGER IF EXISTS trg_z_auto_skip_self_approval_insert ON expense_requests;
CREATE TRIGGER trg_z_auto_skip_self_approval_insert
BEFORE INSERT ON expense_requests
FOR EACH ROW
EXECUTE FUNCTION public.auto_skip_self_approval_expense_request();


-- ═══ 3. UPDATE trigger：每次 current_step 變動後也跳過 self 關 ═══
-- 適用於：有人核可後 current_step += 1 但新關還是 self 的 case
DROP TRIGGER IF EXISTS trg_z_auto_skip_self_approval_update ON expense_requests;
CREATE TRIGGER trg_z_auto_skip_self_approval_update
BEFORE UPDATE OF current_step ON expense_requests
FOR EACH ROW
WHEN (
  NEW.current_step IS DISTINCT FROM OLD.current_step
  AND NEW.status IN ('申請中', '待審')
)
EXECUTE FUNCTION public.auto_skip_self_approval_expense_request();


COMMIT;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════
-- 驗證測試：
-- 1. 建立一筆 expense_request，applicant 是 dept_manager 且 chain
--    第一關是 applicant_dept_manager → 應該看到 current_step 直接跳到 1
-- 2. 一般員工建單 → current_step 應該停在 0（不受影響）
-- 3. 已核准/已駁回的單 → 不會被觸發
--
-- 查當前狀態：
--   SELECT id, employee_id, current_step, status, approval_chain_id
--     FROM expense_requests ORDER BY id DESC LIMIT 5;
--
-- 緊急 rollback：
--   DROP TRIGGER trg_z_auto_skip_self_approval_insert ON expense_requests;
--   DROP TRIGGER trg_z_auto_skip_self_approval_update ON expense_requests;
--   DROP FUNCTION public.auto_skip_self_approval_expense_request();
-- ════════════════════════════════════════════════════════════
