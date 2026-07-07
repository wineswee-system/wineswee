-- 修：補打卡核准不再自動生加班/請假/外出/換班單
-- 2026-07-07
-- 根因：_apply_correction_to_attendance 對 clock_mode=overtime/leave/outing/shift_swap
--   會 find-or-create 對應申請單，用來滿足 attendance_records 的 mode↔FK CHECK。
--   但那些 CHECK 已於 2026-05-29 (20260529020000) 全數 DROP → 自動生單是多餘殘骸，
--   且加班分支 INSERT overtime_requests(hours=0) 撞 chk_ot_positive_hours(hours>0)
--   → 加班模式補打卡核准整個失敗。
-- 修：移除全部自動生單分支；補打卡核准只補打卡時間 + 標模式標籤 + 重算工時。
--   模式標籤保留（下游 OT 偵測讀 clock_in_mode 標籤，非讀自動生的單）。
-- 保留：type 中英正規化（20260707140000）。idempotent(CREATE OR REPLACE)。

BEGIN;

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
  v_mode        text := COALESCE(c.clock_mode, 'normal');
  v_mode_in     text := 'normal';
  v_mode_out    text := 'normal';
  v_store_id    int;
BEGIN
  -- type 正規化：相容 LIFF 中文值（上班打卡→clock_in、下班打卡→clock_out）
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

  -- ★ 不再自動生加班/請假/外出/換班單：
  --   mode↔FK CHECK 已於 2026-05-29 (20260529020000) 移除，模式僅為標籤，
  --   無需為滿足 FK 而臨建申請單（原本加班分支還會 hours=0 撞 chk_ot_positive_hours）。

  -- 既有 attendance row？
  SELECT * INTO existing_att FROM public.attendance_records
   WHERE employee_id = c.employee_id AND date = c.date LIMIT 1;

  IF FOUND THEN
    UPDATE public.attendance_records SET
      clock_in       = COALESCE(new_in,  clock_in),
      clock_out      = COALESCE(new_out, clock_out),
      clock_in_mode  = CASE WHEN v_type = 'clock_in'  THEN v_mode_in  ELSE clock_in_mode  END,
      clock_out_mode = CASE WHEN v_type = 'clock_out' THEN v_mode_out ELSE clock_out_mode END
    WHERE id = existing_att.id;
  ELSE
    SELECT store_id INTO v_store_id FROM public.employees WHERE id = c.employee_id;
    INSERT INTO public.attendance_records (
      employee, employee_id, organization_id, store_id, date,
      clock_in, clock_out, status,
      clock_in_mode, clock_out_mode
    ) VALUES (
      c.employee, c.employee_id, c.organization_id, v_store_id, c.date,
      new_in, new_out, '補登',
      v_mode_in, v_mode_out
    );
  END IF;

  -- ★ 兩端補齊後自動重算工時（扣休息，與正常下班打卡/backfill 同規則：<5h=0、5~9h=30分、≥9h=60分）
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
