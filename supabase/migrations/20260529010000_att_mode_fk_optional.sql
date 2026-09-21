-- ════════════════════════════════════════════════════════════
-- 打卡模式 FK 約束放寬 + 拔掉自動建申請單邏輯
-- ════════════════════════════════════════════════════════════
--
-- 背景：
--   原設計讓打卡時自動建立 overtime_requests / leave_requests /
--   business_trips（mode=overtime/leave/outing）。
--   討論後決定：打卡只做記錄 + 提醒，申請單由員工自行送出。
--   系統不代為建立表單，避免產生大量不必要的草稿單。
--
-- 變動：
--   1. chk_att_mode_fk_in / chk_att_mode_fk_out：
--      只保留 shift_swap 必須有 shift_swap_id 的強制；
--      overtime / leave / outing 的 FK 改為選填（可連結但不強制）
--
--   2. _apply_correction_to_attendance：
--      移除 overtime / leave / outing 三個模式的 find-or-create 邏輯；
--      shift_swap 仍保留「只找不建」邏輯。
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. 放寬 attendance_records 模式↔FK 約束 ─────────────────

-- 上班端：只有 shift_swap 強制有 FK
ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS chk_att_mode_fk_in;
ALTER TABLE public.attendance_records
  ADD CONSTRAINT chk_att_mode_fk_in CHECK (
    clock_in_mode != 'shift_swap' OR shift_swap_id IS NOT NULL
  );

-- 下班端：同上
ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS chk_att_mode_fk_out;
ALTER TABLE public.attendance_records
  ADD CONSTRAINT chk_att_mode_fk_out CHECK (
    clock_out_mode != 'shift_swap' OR shift_swap_id IS NOT NULL
  );


-- ── 2. 更新 _apply_correction_to_attendance ──────────────────
--    拔掉 overtime / leave / outing 的 find-or-create；
--    shift_swap 仍保留「只找不建，找不到 fallback normal」。

CREATE OR REPLACE FUNCTION public._apply_correction_to_attendance(c clock_corrections)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  new_in        time;
  new_out       time;
  existing_att  attendance_records;
  v_swap_id     int;
  v_mode        text := COALESCE(c.clock_mode, 'normal');
  v_mode_in     text := 'normal';
  v_mode_out    text := 'normal';
  v_store_id    int;
BEGIN
  IF c.correction_time IS NULL OR c.type NOT IN ('clock_in', 'clock_out') THEN
    RETURN;
  END IF;

  -- 哪一端
  new_in  := CASE WHEN c.type = 'clock_in'  THEN c.correction_time END;
  new_out := CASE WHEN c.type = 'clock_out' THEN c.correction_time END;
  IF c.type = 'clock_in'  THEN v_mode_in  := v_mode; END IF;
  IF c.type = 'clock_out' THEN v_mode_out := v_mode; END IF;

  -- shift_swap：只查不建（需兩段確認流程），找不到就 fallback normal
  IF v_mode = 'shift_swap' THEN
    SELECT id INTO v_swap_id FROM public.shift_swaps
     WHERE swap_date = c.date AND status = '已核准'
       AND (requester_id = c.employee_id OR target_id = c.employee_id)
       AND deleted_at IS NULL
     ORDER BY id DESC LIMIT 1;
    IF v_swap_id IS NULL THEN
      v_mode_in  := 'normal';
      v_mode_out := 'normal';
    END IF;
  END IF;
  -- overtime / leave / outing：不自動建申請單，FK 留空即可（已放寬 constraint）
  -- 員工應自行送出對應申請單，HR 核准後薪資才計入

  -- 既有 attendance row？
  SELECT * INTO existing_att FROM public.attendance_records
   WHERE employee_id = c.employee_id AND date = c.date LIMIT 1;

  IF FOUND THEN
    UPDATE public.attendance_records SET
      clock_in      = COALESCE(new_in,  clock_in),
      clock_out     = COALESCE(new_out, clock_out),
      clock_in_mode  = CASE WHEN c.type = 'clock_in'  THEN v_mode_in  ELSE clock_in_mode  END,
      clock_out_mode = CASE WHEN c.type = 'clock_out' THEN v_mode_out ELSE clock_out_mode END,
      shift_swap_id  = COALESCE(shift_swap_id, v_swap_id)
      -- overtime_request_id / leave_request_id / business_trip_id 不由補打卡填入
      -- 員工須自行連結申請單
    WHERE id = existing_att.id;
  ELSE
    SELECT store_id INTO v_store_id FROM public.employees WHERE id = c.employee_id;
    INSERT INTO public.attendance_records (
      employee, employee_id, organization_id, store_id, date,
      clock_in, clock_out, status,
      clock_in_mode, clock_out_mode,
      shift_swap_id
    ) VALUES (
      c.employee, c.employee_id, c.organization_id, v_store_id, c.date,
      new_in, new_out, '補登',
      v_mode_in, v_mode_out,
      v_swap_id
    );
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
