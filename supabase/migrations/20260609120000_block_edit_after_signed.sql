-- ════════════════════════════════════════════════════════════════════════════
-- 已有人簽過的請求 → 擋使用者編輯欄位（PG 層最後一道防線）
--
-- 之前只在 UI 鎖（編輯按鈕隱藏），但繞過 UI 直接打 API 還是能 update。
-- 現在加 BEFORE UPDATE trigger，偵測：
--   1. approval_step_history 有 exited_at IS NOT NULL（= 完成某關）
--   2. 使用者編輯欄位（date/hours/ot_type/reason/store/start_time/end_time）有變
--   → RAISE EXCEPTION
--
-- 系統欄位（status / approver / approved_at / approved_by / reject_reason /
-- ot_category / employee_id / employee）不擋 — 給 chain workflow 推進 / admin
-- 系統流程用。
--
-- 套兩個表：overtime_requests + leave_requests
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── helper：判斷該 request 是否「至少有一關已核准通過」───────────────────
-- 駁回紀錄不算（員工可以重送）
CREATE OR REPLACE FUNCTION public._request_has_approved_step(
  p_request_type TEXT,
  p_request_id   INT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM approval_step_history
     WHERE request_type = p_request_type
       AND request_id   = p_request_id
       AND action       = 'approved'
       AND exited_at   IS NOT NULL
  )
$$;


-- ─── OT trigger ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_block_edit_after_signed_ot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed BOOLEAN := false;
BEGIN
  -- 駁回狀態 → 員工可修改（修錯重送用）
  IF NEW.status IN ('已拒絕','已駁回','已退回') THEN
    RETURN NEW;
  END IF;
  -- 重送（駁回 → 待審核）→ chain 會重啟，舊簽核失效，允許修改
  IF OLD.status IN ('已拒絕','已駁回','已退回')
     AND NEW.status IN ('待審核','申請中') THEN
    RETURN NEW;
  END IF;
  -- 沒人簽過（沒有 approved 紀錄）→ 放行
  IF NOT public._request_has_approved_step('overtime', NEW.id) THEN
    RETURN NEW;
  END IF;

  -- 只擋使用者編輯欄位的變動
  v_changed := (
    NEW.date IS DISTINCT FROM OLD.date
    OR NEW.start_time IS DISTINCT FROM OLD.start_time
    OR NEW.end_time IS DISTINCT FROM OLD.end_time
    OR NEW.hours IS DISTINCT FROM OLD.hours
    OR COALESCE(NEW.ot_hours, NEW.hours) IS DISTINCT FROM COALESCE(OLD.ot_hours, OLD.hours)
    OR NEW.reason IS DISTINCT FROM OLD.reason
    OR NEW.store IS DISTINCT FROM OLD.store
    OR COALESCE(NEW.ot_type, 'pay') IS DISTINCT FROM COALESCE(OLD.ot_type, 'pay')
  );

  IF v_changed THEN
    RAISE EXCEPTION '加班申請已有簽核紀錄，無法修改內容（如需更改請先撤回）';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_overtime_block_edit_after_signed ON public.overtime_requests;
CREATE TRIGGER trg_overtime_block_edit_after_signed
  BEFORE UPDATE ON public.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_edit_after_signed_ot();


-- ─── Leave trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_block_edit_after_signed_leave()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed BOOLEAN := false;
BEGIN
  IF NEW.status IN ('已拒絕','已駁回','已退回') THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('已拒絕','已駁回','已退回')
     AND NEW.status IN ('待審核','申請中') THEN
    RETURN NEW;
  END IF;
  IF NOT public._request_has_approved_step('leave', NEW.id) THEN
    RETURN NEW;
  END IF;

  v_changed := (
    NEW.type IS DISTINCT FROM OLD.type
    OR NEW.start_date IS DISTINCT FROM OLD.start_date
    OR NEW.end_date IS DISTINCT FROM OLD.end_date
    OR NEW.start_time IS DISTINCT FROM OLD.start_time
    OR NEW.end_time IS DISTINCT FROM OLD.end_time
    OR NEW.days IS DISTINCT FROM OLD.days
    OR NEW.hours IS DISTINCT FROM OLD.hours
    OR NEW.reason IS DISTINCT FROM OLD.reason
    OR COALESCE(NEW.unit, 'day') IS DISTINCT FROM COALESCE(OLD.unit, 'day')
  );

  IF v_changed THEN
    RAISE EXCEPTION '請假申請已有簽核紀錄，無法修改內容（如需更改請先撤回）';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_leave_block_edit_after_signed ON public.leave_requests;
CREATE TRIGGER trg_leave_block_edit_after_signed
  BEFORE UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_edit_after_signed_leave();

COMMIT;

NOTIFY pgrst, 'reload schema';
