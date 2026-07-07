-- 修：補打卡核准後不補登（LIFF 送的 type 是中文，補登函式只認英文）
-- 2026-07-07
-- 根因：LIFF ClockCorrection 送 type='上班打卡/下班打卡'（中文），
--   但 _apply_correction_to_attendance 判斷 type IN ('clock_in','clock_out')（英文）
--   → 中文 type 的補打卡核准時被 RETURN 跳過，attendance 沒補登。
-- 修：函式開頭把 type 正規化（中文→英文），其餘完全比照 20260706200000 不動。
--   同時把存量的中文 type 資料正規化成英文（idempotent）。
-- 手法：dump live + 只加 v_type 正規化，CREATE OR REPLACE 冪等。

BEGIN;

-- 1) 存量資料正規化：中文 type → 英文（idempotent，只動中文那幾筆）
UPDATE public.clock_corrections
   SET type = CASE type WHEN '上班打卡' THEN 'clock_in'
                        WHEN '下班打卡' THEN 'clock_out' END
 WHERE type IN ('上班打卡', '下班打卡');

-- 2) 補登函式：開頭正規化 type，後續一律用 v_type（中英都吃）
CREATE OR REPLACE FUNCTION public._apply_correction_to_attendance(c clock_corrections)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_type        text;
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
  -- ★ type 正規化：相容 LIFF 舊/中文值（上班打卡→clock_in、下班打卡→clock_out）
  v_type := CASE c.type
              WHEN '上班打卡' THEN 'clock_in'
              WHEN '下班打卡' THEN 'clock_out'
              ELSE c.type
            END;

  IF c.correction_time IS NULL OR v_type NOT IN ('clock_in', 'clock_out') THEN
    RETURN;
  END IF;

  -- 哪一端
  new_in  := CASE WHEN v_type = 'clock_in'  THEN c.correction_time END;
  new_out := CASE WHEN v_type = 'clock_out' THEN c.correction_time END;
  IF v_type = 'clock_in'  THEN v_mode_in  := v_mode; END IF;
  IF v_type = 'clock_out' THEN v_mode_out := v_mode; END IF;

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
      clock_in_mode       = CASE WHEN v_type = 'clock_in'  THEN v_mode_in  ELSE clock_in_mode  END,
      clock_out_mode      = CASE WHEN v_type = 'clock_out' THEN v_mode_out ELSE clock_out_mode END,
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

  -- ★ 補打卡把兩端補齊後，自動重算工時（扣休息，與正常下班打卡/backfill 同規則：<5h=0、5~9h=30分、≥9h=60分）
  UPDATE public.attendance_records a
     SET total_hours = ROUND((gh.gross - public.calc_shift_rest_minutes(gh.gross) / 60.0)::numeric, 2)
    FROM (
      SELECT id,
             CASE WHEN EXTRACT(EPOCH FROM (clock_out - clock_in)) < 0
                  THEN EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600.0 + 24
                  ELSE EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600.0 END AS gross
        FROM public.attendance_records
       WHERE employee_id = c.employee_id AND date = c.date
         AND clock_in IS NOT NULL AND clock_out IS NOT NULL
    ) gh
   WHERE a.id = gh.id;

END $function$;

COMMIT;
