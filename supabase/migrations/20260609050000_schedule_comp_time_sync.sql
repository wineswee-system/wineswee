-- ════════════════════════════════════════════════════════════════════════════
-- 排班 ↔ 補休 ledger 雙向同步
--
-- 原本流程不一致：
--   方向 A：員工/HR 開「補休」假單 → 核准 → 寫 schedules（_trg_leave_approval_sync_schedule）
--           但 _leave_code_to_shift 沒有 '補休' 對應 → 寫不到班表，斷掉。
--   方向 B：HR/Manager 直接在排班介面點某天為「補休」shift → 沒有任何 ledger 扣帳。
--           等於白給員工放假，補休系統失效。
--
-- 修：
--   1. _leave_code_to_shift 加 '補休' / 'comp_time' 對應，補方向 A 斷鏈
--   2. 新 trigger _trg_schedule_comp_time_sync（BEFORE INSERT/UPDATE/DELETE）處理方向 B：
--      - shift 變成 '補休' 且 leave_request_id IS NULL → 檢查餘額、自動建 leave_request
--        ('已核准'、type='補休'、8 小時)、呼叫 deduct_comp_time
--      - shift 從 '補休' 變掉 / DELETE → 找到對應 leave_request 自動 soft delete
--        （由 20260609040000 的 trg_leave_refund_comp_time 觸發退還 ledger）
--      - 餘額不足 → RAISE EXCEPTION 擋住排班
--
-- 注意：
--   - 不 backfill 既有的 schedule '補休' 列（避免回溯扣帳老資料）
--   - 不處理小時級補休（schedule 是日級）
--   - 一天 = 8 小時硬定（PT 之後可加 weekly_hours 動態算）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 修補方向 A：_leave_code_to_shift 加 '補休' ────────────────────────
CREATE OR REPLACE FUNCTION public._leave_code_to_shift(p_code TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_code
    WHEN 'annual'        THEN '特休'
    WHEN '特休'          THEN '特休'
    WHEN 'sick'          THEN '病'
    WHEN '病假'          THEN '病'
    WHEN 'personal'      THEN '事'
    WHEN '事假'          THEN '事'
    WHEN 'official'      THEN '公'
    WHEN '公假'          THEN '公'
    WHEN 'maternity'     THEN '產'
    WHEN '產假'          THEN '產'
    WHEN 'paternity'     THEN '陪產'
    WHEN '陪產假'        THEN '陪產'
    WHEN 'menstrual'     THEN '生'
    WHEN '生理假'        THEN '生'
    WHEN 'marriage'      THEN '婚'
    WHEN '婚假'          THEN '婚'
    WHEN 'bereavement'   THEN '喪'
    WHEN '喪假'          THEN '喪'
    WHEN 'occupational'  THEN '工傷'
    WHEN '公傷病假'      THEN '工傷'
    WHEN 'family_care'   THEN '家'
    WHEN '家庭照顧假'    THEN '家'
    WHEN 'mental_health' THEN '心'
    WHEN '心理假'        THEN '心'
    WHEN 'prenatal'      THEN '產檢'
    WHEN '產檢假'        THEN '產檢'
    WHEN 'parental'      THEN '育嬰'
    WHEN '育嬰假'        THEN '育嬰'
    WHEN 'comp_time'     THEN '補休'
    WHEN '補休'          THEN '補休'
    -- nursing 按小時請，不寫班表
    ELSE NULL
  END
$$;


-- ─── 2. 方向 B trigger：排班 shift = '補休' → 自動建補休假單 + 扣 ledger ─
CREATE OR REPLACE FUNCTION public._trg_schedule_comp_time_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp_id    INT;
  v_emp_name  TEXT;
  v_org_id    INT;
  v_available NUMERIC;
  v_new_leave_id INT;
  v_old_leave_type TEXT;
  v_deduct    JSON;
  v_target_date DATE;
BEGIN
  -- ────────── DELETE 或 shift 移開 '補休' ──────────
  IF (TG_OP = 'DELETE' AND OLD.shift = '補休')
     OR (TG_OP = 'UPDATE' AND OLD.shift = '補休' AND NEW.shift IS DISTINCT FROM '補休') THEN

    -- 找到對應 leave_request（必須 type='補休' 才退）
    IF OLD.leave_request_id IS NOT NULL THEN
      SELECT type INTO v_old_leave_type
        FROM leave_requests WHERE id = OLD.leave_request_id;

      IF v_old_leave_type IN ('補休', 'comp_time') THEN
        -- soft delete → trg_leave_refund_comp_time 會自動退 ledger
        UPDATE leave_requests
           SET deleted_at = NOW()
         WHERE id = OLD.leave_request_id
           AND deleted_at IS NULL;
      END IF;
    END IF;

    -- UPDATE case：清掉 leave_request_id pointer
    IF TG_OP = 'UPDATE' THEN
      NEW.leave_request_id := NULL;
    END IF;
  END IF;

  -- ────────── INSERT 或 shift 改成 '補休' ──────────
  IF (TG_OP IN ('INSERT', 'UPDATE')) AND NEW.shift = '補休' THEN
    -- 已經有 leave_request_id（從假單 sync 過來的）→ 跳過
    IF NEW.leave_request_id IS NOT NULL THEN
      RETURN NEW;
    END IF;

    -- Resolve employee
    v_emp_id := NEW.employee_id;
    IF v_emp_id IS NULL THEN
      SELECT id, name, organization_id INTO v_emp_id, v_emp_name, v_org_id
        FROM employees WHERE name = NEW.employee LIMIT 1;
    ELSE
      SELECT name, organization_id INTO v_emp_name, v_org_id
        FROM employees WHERE id = v_emp_id;
    END IF;

    IF v_emp_id IS NULL THEN
      RAISE EXCEPTION '排班補休失敗：找不到員工 %（id %）', NEW.employee, NEW.employee_id;
    END IF;

    v_target_date := NEW.date;

    -- 該員工該日是否已有未取消的補休假單？有就直接接過來
    SELECT id INTO NEW.leave_request_id
      FROM leave_requests
     WHERE employee_id = v_emp_id
       AND start_date <= v_target_date
       AND COALESCE(end_date, start_date) >= v_target_date
       AND type IN ('補休', 'comp_time')
       AND status NOT IN ('駁回', '已拒絕', '已撤回', '已取消')
       AND deleted_at IS NULL
     LIMIT 1;

    IF NEW.leave_request_id IS NOT NULL THEN
      RETURN NEW;  -- 已有假單，不重複建
    END IF;

    -- 檢查餘額
    SELECT COALESCE(SUM(hours - hours_used), 0) INTO v_available
      FROM comp_time_ledger
     WHERE employee_id = v_emp_id AND status = 'active';

    IF v_available < 8 THEN
      RAISE EXCEPTION '補休餘額不足：% 剩 % 小時，排補休需要 8 小時',
        v_emp_name, v_available;
    END IF;

    -- 建假單（status='已核准'，跳過簽核）
    INSERT INTO leave_requests (
      employee_id, employee, type,
      start_date, end_date, days, hours,
      reason, status, organization_id, approver, approved_at
    )
    VALUES (
      v_emp_id, v_emp_name, '補休',
      v_target_date, v_target_date, 1, 8,
      '排班補休（自動同步）', '已核准', v_org_id, 'system', NOW()
    )
    RETURNING id INTO v_new_leave_id;

    -- FIFO 扣 ledger
    v_deduct := deduct_comp_time(v_new_leave_id, v_emp_id, 8);
    IF NOT COALESCE((v_deduct->>'ok')::BOOLEAN, false) THEN
      RAISE EXCEPTION '補休 ledger 扣帳失敗：%', v_deduct;
    END IF;

    NEW.leave_request_id := v_new_leave_id;
  END IF;

  -- DELETE 不能改 NEW，要回 OLD
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_schedule_comp_time_sync ON public.schedules;
CREATE TRIGGER trg_schedule_comp_time_sync
  BEFORE INSERT OR UPDATE OR DELETE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public._trg_schedule_comp_time_sync();

COMMIT;

NOTIFY pgrst, 'reload schema';
