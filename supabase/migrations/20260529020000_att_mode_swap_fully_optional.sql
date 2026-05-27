-- ════════════════════════════════════════════════════════════
-- shift_swap 打卡模式：完全選填 shift_swap_id
-- ════════════════════════════════════════════════════════════
--
-- 背景：
--   先前 shift_swap 模式要求打卡前必須有「已核准」換班單。
--   但緊急換班（臨時口頭協調）可能無法事先完成兩段確認流程。
--   決策：換班打卡僅標記模式，shift_swap_id 完全選填。
--   員工可在打卡後補送換班申請，HR 事後確認。
--
-- 變動：
--   1. 刪除 chk_att_mode_fk_in / chk_att_mode_fk_out 對 shift_swap 的強制 FK
--      （20260529010000 重新加上的 shift_swap constraint 一併拔掉）
--
--   2. _apply_correction_to_attendance：
--      shift_swap 模式補打卡時，找不到換班單不再 fallback 成 normal；
--      維持 shift_swap 標記，shift_swap_id 留 NULL。
--
--   3. generate_payroll：
--      休息日換班 OT 偵測改用 clock_in_mode = 'shift_swap'
--      （取代原本的 shift_swap_id IS NOT NULL，讓無 FK 的緊急換班也納入計算）
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. 拔掉 shift_swap FK 強制約束 ──────────────────────────

-- 上班端（完全移除 chk_att_mode_fk_in；overtime/leave/outing 已在 20260529010000 放寬）
ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS chk_att_mode_fk_in;

-- 下班端
ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS chk_att_mode_fk_out;


-- ── 2. 更新 _apply_correction_to_attendance ──────────────────
--    shift_swap 找不到換班單 → 不 fallback normal，維持 shift_swap 標記

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

  -- shift_swap：嘗試查詢已核准換班單，找不到不 fallback（緊急換班可無 FK）
  IF v_mode = 'shift_swap' THEN
    SELECT id INTO v_swap_id FROM public.shift_swaps
     WHERE swap_date = c.date AND status = '已核准'
       AND (requester_id = c.employee_id OR target_id = c.employee_id)
       AND deleted_at IS NULL
     ORDER BY id DESC LIMIT 1;
    -- 找不到換班單 → 維持 shift_swap 模式，swap_id 留 NULL
    -- （員工應事後補送換班申請）
  END IF;
  -- overtime / leave / outing：不自動建申請單，FK 留空
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


-- ── 3. 更新 generate_payroll：休息日換班 OT 用 clock_in_mode ─
--    shift_swap_id IS NOT NULL → clock_in_mode = 'shift_swap'
--    讓緊急換班（無 FK）也能納入假日加班費計算

CREATE OR REPLACE FUNCTION public._payroll_swap_hd_hours(
  p_employee_id   INT,
  p_month_start   DATE,
  p_month_end     DATE
)
RETURNS NUMERIC(5,2)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(ar.total_hours), 0)
    FROM attendance_records ar
   WHERE ar.employee_id = p_employee_id
     AND ar.date BETWEEN p_month_start AND p_month_end
     -- ★ 改用 clock_in_mode = 'shift_swap'（取代 shift_swap_id IS NOT NULL）
     --   讓無換班單 FK 的緊急換班也納入假日 OT
     AND ar.clock_in_mode = 'shift_swap'
     AND (
       EXTRACT(DOW FROM ar.date) IN (0, 6)
       OR EXISTS (
         SELECT 1 FROM holidays h
          WHERE h.date = ar.date AND h.is_workday = false
       )
     )
     -- 同日已有人工 OT 申請 → 跳過避免重複計算
     AND NOT EXISTS (
       SELECT 1 FROM overtime_requests ot
        WHERE ot.employee_id = ar.employee_id
          AND ot.request_date = ar.date
          AND ot.status = '已核准'
     );
$$;

-- 注意：generate_payroll 主體使用此 helper function（下方以 inline subquery 覆寫）。
-- 若 generate_payroll 主體仍用舊邏輯（shift_swap_id IS NOT NULL），
-- 請在下次部署薪資計算時以 20260529000000 基底再次完整 OR REPLACE，
-- 或直接在 generate_payroll 中呼叫 _payroll_swap_hd_hours(...)。

COMMIT;

NOTIFY pgrst, 'reload schema';
