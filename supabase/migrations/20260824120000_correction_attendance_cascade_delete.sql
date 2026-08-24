-- 治本:補打卡單刪除/作廢時,自動清掉它「建立」的出勤打卡(attendance_records)。
-- 原缺口:核准補打卡會建一筆 status='補登' 的 attendance_records,但該筆沒有欄位連回補打卡單,
-- 所以刪補打卡單時無法連帶清除 → 留下孤兒打卡(例:吳承祐 #373)。
-- 只處理「純由補打卡新建」的那筆(合併進既有出勤的不動,避免誤刪既有資料)。idempotent。

-- 1) 連結欄
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS clock_correction_id integer;
CREATE INDEX IF NOT EXISTS idx_attendance_records_clock_correction_id
  ON public.attendance_records(clock_correction_id) WHERE clock_correction_id IS NOT NULL;

-- 2) 補打卡套用出勤:新建那筆記下來源補打卡 id(其餘邏輯不變)
CREATE OR REPLACE FUNCTION public._apply_correction_to_attendance(c clock_corrections)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
  v_type := CASE c.type WHEN '上班打卡' THEN 'clock_in' WHEN '下班打卡' THEN 'clock_out' ELSE c.type END;
  IF c.correction_time IS NULL OR v_type NOT IN ('clock_in', 'clock_out') THEN RETURN; END IF;

  SELECT COALESCE(NULLIF(settings->>'day_boundary_hour','')::int, 6) INTO v_boundary
    FROM public.organizations WHERE id = c.organization_id;
  v_att_date := CASE WHEN c.correction_time < make_time(COALESCE(v_boundary,6),0,0) THEN (c.date - 1) ELSE c.date END;

  v_mode := CASE WHEN COALESCE(c.clock_mode, 'normal') IN ('normal', 'outing')
                 THEN COALESCE(c.clock_mode, 'normal') ELSE 'normal' END;

  new_in  := CASE WHEN v_type = 'clock_in'  THEN c.correction_time END;
  new_out := CASE WHEN v_type = 'clock_out' THEN c.correction_time END;
  IF v_type = 'clock_in'  THEN v_mode_in  := v_mode; END IF;
  IF v_type = 'clock_out' THEN v_mode_out := v_mode; END IF;

  SELECT * INTO existing_att FROM public.attendance_records
   WHERE employee_id = c.employee_id AND date = v_att_date LIMIT 1;

  IF FOUND THEN
    -- 合併進既有出勤:不標 clock_correction_id(該筆有獨立資料,刪補打卡不應整筆刪)
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
      clock_in_mode, clock_out_mode, clock_correction_id
    ) VALUES (
      c.employee, c.employee_id, c.organization_id, v_store_id, v_att_date,
      new_in, new_out, '補登',
      v_mode_in, v_mode_out, c.id
    );
  END IF;

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

-- 3) 回填:既有「純由單一補打卡新建」的補登記錄(只有一端、對得上時間/日期)
UPDATE public.attendance_records a
   SET clock_correction_id = c.id
  FROM public.clock_corrections c
 WHERE a.clock_correction_id IS NULL
   AND a.status = '補登'
   AND a.employee_id = c.employee_id
   AND a.date = CASE WHEN c.correction_time < time '06:00' THEN c.date - 1 ELSE c.date END
   AND (
     (c.type IN ('clock_in','上班打卡')  AND a.clock_in  = c.correction_time AND a.clock_out IS NULL) OR
     (c.type IN ('clock_out','下班打卡') AND a.clock_out = c.correction_time AND a.clock_in  IS NULL)
   );

-- 4) 補打卡單被作廢(deleted_at)或硬刪 → 自動移除它建立的出勤打卡
CREATE OR REPLACE FUNCTION public._cleanup_attendance_on_correction_delete()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.attendance_records WHERE clock_correction_id = OLD.id;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    DELETE FROM public.attendance_records WHERE clock_correction_id = NEW.id;
    RETURN NEW;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_cleanup_attendance_on_correction_delete ON public.clock_corrections;
CREATE TRIGGER trg_cleanup_attendance_on_correction_delete
  AFTER UPDATE OR DELETE ON public.clock_corrections
  FOR EACH ROW EXECUTE FUNCTION public._cleanup_attendance_on_correction_delete();

-- 5) 清既有孤兒:來源補打卡已作廢/刪除,但打卡還在的
DELETE FROM public.attendance_records a
 USING public.clock_corrections c
 WHERE a.clock_correction_id = c.id AND c.deleted_at IS NOT NULL;
