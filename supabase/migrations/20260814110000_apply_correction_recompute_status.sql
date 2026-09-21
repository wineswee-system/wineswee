-- 補卡核准套用時,除了重算工時,也重算 status(原本只算工時、狀態停在舊值)。
-- 讓「0工時爛紀錄標異常→補卡補齊後自動變回正常」這條流程成立。單點append自live dump。

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
  v_mode        text;
  v_mode_in     text := 'normal';
  v_mode_out    text := 'normal';
  v_store_id    int;
  v_att_date    date;
  v_boundary    int := 6;
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

  -- 「早上6點才換天」:凌晨6點前的打卡歸前一天的班(申請人照填實際日曆日,系統自動判斷)
  SELECT COALESCE(NULLIF(settings->>'day_boundary_hour','')::int, 6) INTO v_boundary
    FROM public.organizations WHERE id = c.organization_id;
  v_att_date := CASE WHEN c.correction_time < make_time(COALESCE(v_boundary,6),0,0) THEN (c.date - 1) ELSE c.date END;

  -- ★ 模式夾到 attendance 允許值：只有 normal / outing，其餘（overtime/leave/shift_swap）退成 normal
  v_mode := CASE WHEN COALESCE(c.clock_mode, 'normal') IN ('normal', 'outing')
                 THEN COALESCE(c.clock_mode, 'normal')
                 ELSE 'normal'
            END;

  -- 哪一端
  new_in  := CASE WHEN v_type = 'clock_in'  THEN c.correction_time END;
  new_out := CASE WHEN v_type = 'clock_out' THEN c.correction_time END;
  IF v_type = 'clock_in'  THEN v_mode_in  := v_mode; END IF;
  IF v_type = 'clock_out' THEN v_mode_out := v_mode; END IF;

  -- 不再自動生加班/請假/外出/換班單（mode↔FK CHECK 已於 2026-05-29 移除）

  -- 既有 attendance row？（用換天後的 v_att_date）
  SELECT * INTO existing_att FROM public.attendance_records
   WHERE employee_id = c.employee_id AND date = v_att_date LIMIT 1;

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
      c.employee, c.employee_id, c.organization_id, v_store_id, v_att_date,
      new_in, new_out, '補登',
      v_mode_in, v_mode_out
    );
  END IF;

  -- 兩端補齊後自動重算工時（扣休息：<5h=0、5~9h=30分、≥9h=60分）
  UPDATE public.attendance_records a
     SET total_hours = ROUND((gh.gross - public._attendance_rest_minutes(c.employee_id, gh.gross) / 60.0)::numeric, 2)
    FROM (
      SELECT id,
             CASE WHEN EXTRACT(EPOCH FROM (clock_out - clock_in)) < 0
                  THEN EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600.0 + 24
                  ELSE EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600.0 END AS gross
        FROM public.attendance_records
       WHERE employee_id = c.employee_id AND date = v_att_date
         AND clock_in IS NOT NULL AND clock_out IS NOT NULL
    ) gh
   WHERE a.id = gh.id;

  -- ★ 補卡後重算狀態(對齊打卡當下的異常判定):
  --   兩端齊+有效工時 → 若原本標異常改回正常、否則不動(不亂改正常/補登);
  --   兩端齊但0工時或上下班同時 → 異常;只有一端(還沒補齊)→ 維持;外出不動。
  UPDATE public.attendance_records
     SET status = CASE
       WHEN clock_in IS NOT NULL AND clock_out IS NOT NULL AND clock_in <> clock_out AND COALESCE(total_hours,0) > 0
         THEN (CASE WHEN status = '異常' THEN '正常' ELSE status END)
       WHEN clock_in IS NOT NULL AND clock_out IS NOT NULL
         THEN '異常'
       ELSE status
     END
   WHERE employee_id = c.employee_id AND date = v_att_date
     AND COALESCE(status,'') <> '外出';

END $function$;
