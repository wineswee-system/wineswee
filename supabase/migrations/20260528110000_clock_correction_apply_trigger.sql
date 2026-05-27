-- ── clock_corrections 核准後自動寫入 attendance_records（trigger 版）─────────
-- 修 2026-05-09 normalize migration 後的隱性 bug：liff_approve_request 內仍寫死
-- correction.type = '上班打卡' / '下班打卡'，跟 normalize 後的 'clock_in' /
-- 'clock_out' 永遠對不上 → 核准後 attendance_records 不會被更新。
--
-- 用 trigger 而非 patch 既有函式：
--   1. liff_approve_request 已被 12+ 個 migration 改寫，再 partial rewrite 容易
--      洗掉別人的邏輯（[[feedback_migration_partial_overwrite_disaster]]）
--   2. 簽核傳遞 must use DB trigger 是專案鐵律（[[feedback_signoff_must_use_db_trigger]]）
--   3. trigger 跑完後既有 buggy 程式碼會變成 no-op（new_in/new_out 兩個都 NULL，
--      COALESCE 後等於沒動）
--
-- 同時把 clock_mode 反映進 attendance_records 對應端的 clock_in_mode/clock_out_mode，
-- 並為非 normal 模式自動建/找對應的 request row 滿足 FK CHECK constraint。

BEGIN;

-- ── 1. helper：把單筆 correction 套用到 attendance_records ────────────────────

CREATE OR REPLACE FUNCTION public._apply_correction_to_attendance(c clock_corrections)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  new_in        time;
  new_out       time;
  existing_att  attendance_records;
  v_overtime_id int;
  v_leave_id    int;
  v_swap_id     int;
  v_trip_id     int;
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

  -- 非 normal 模式：find-or-create 對應 request（滿足 attendance_records mode↔FK CHECK）
  IF v_mode = 'overtime' THEN
    SELECT id INTO v_overtime_id FROM public.overtime_requests
     WHERE employee_id = c.employee_id AND date = c.date AND deleted_at IS NULL
     ORDER BY id DESC LIMIT 1;
    IF v_overtime_id IS NULL THEN
      INSERT INTO public.overtime_requests
        (employee_id, employee, date, hours, reason, status, organization_id, source)
      VALUES
        (c.employee_id, c.employee, c.date, 0,
         '補打卡核准自動建立的加班申請（時數請 HR 補確認）',
         '待審核', c.organization_id, 'manual')
      RETURNING id INTO v_overtime_id;
    END IF;

  ELSIF v_mode = 'leave' THEN
    SELECT id INTO v_leave_id FROM public.leave_requests
     WHERE employee_id = c.employee_id
       AND start_date <= c.date AND end_date >= c.date
       AND deleted_at IS NULL
     ORDER BY id DESC LIMIT 1;
    IF v_leave_id IS NULL THEN
      INSERT INTO public.leave_requests
        (employee_id, employee, type, start_date, end_date, days, reason, status, organization_id)
      VALUES
        (c.employee_id, c.employee, '事假', c.date, c.date, 1,
         '補打卡核准自動建立的請假單（請至 HR 補件）',
         '待審核', c.organization_id)
      RETURNING id INTO v_leave_id;
    END IF;

  ELSIF v_mode = 'outing' THEN
    SELECT id INTO v_trip_id FROM public.business_trips
     WHERE employee = c.employee
       AND start_date <= c.date AND end_date >= c.date
       AND deleted_at IS NULL
     ORDER BY id DESC LIMIT 1;
    IF v_trip_id IS NULL THEN
      INSERT INTO public.business_trips
        (employee, destination, start_date, end_date, purpose, status, organization_id)
      VALUES
        (c.employee, NULL, c.date, c.date,
         '補打卡核准自動建立的外出單', '待審核', c.organization_id)
      RETURNING id INTO v_trip_id;
    END IF;

  ELSIF v_mode = 'shift_swap' THEN
    -- 換班不能臨建（兩段確認流程），找不到就退回 normal 避免 CHECK 噴錯
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

  -- 既有 attendance row？
  SELECT * INTO existing_att FROM public.attendance_records
   WHERE employee_id = c.employee_id AND date = c.date LIMIT 1;

  IF FOUND THEN
    UPDATE public.attendance_records SET
      clock_in            = COALESCE(new_in,  clock_in),
      clock_out           = COALESCE(new_out, clock_out),
      clock_in_mode       = CASE WHEN c.type = 'clock_in'  THEN v_mode_in  ELSE clock_in_mode  END,
      clock_out_mode      = CASE WHEN c.type = 'clock_out' THEN v_mode_out ELSE clock_out_mode END,
      overtime_request_id = COALESCE(overtime_request_id, v_overtime_id),
      leave_request_id    = COALESCE(leave_request_id,    v_leave_id),
      shift_swap_id       = COALESCE(shift_swap_id,       v_swap_id),
      business_trip_id    = COALESCE(business_trip_id,    v_trip_id)
    WHERE id = existing_att.id;
  ELSE
    SELECT store_id INTO v_store_id FROM public.employees WHERE id = c.employee_id;
    INSERT INTO public.attendance_records (
      employee, employee_id, organization_id, store_id, date,
      clock_in, clock_out, status,
      clock_in_mode, clock_out_mode,
      overtime_request_id, leave_request_id, shift_swap_id, business_trip_id
    ) VALUES (
      c.employee, c.employee_id, c.organization_id, v_store_id, c.date,
      new_in, new_out, '補登',
      v_mode_in, v_mode_out,
      v_overtime_id, v_leave_id, v_swap_id, v_trip_id
    );
  END IF;
END $$;


-- ── 2. trigger function ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_apply_correction_on_approve()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- 只在 status 從非已核准 → 已核准 的轉換時觸發
  IF NEW.status = '已核准' AND COALESCE(OLD.status, '') <> '已核准' THEN
    PERFORM public._apply_correction_to_attendance(NEW);
  END IF;
  RETURN NEW;
END $$;


-- ── 3. 掛 trigger（idempotent）─────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_clock_correction_apply ON public.clock_corrections;
CREATE TRIGGER trg_clock_correction_apply
  AFTER UPDATE OF status ON public.clock_corrections
  FOR EACH ROW
  WHEN (NEW.status = '已核准')
  EXECUTE FUNCTION public.trg_apply_correction_on_approve();

COMMIT;

NOTIFY pgrst, 'reload schema';
