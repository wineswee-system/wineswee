-- HR 批次匯入 RPC（繞過 trigger，避免 LINE 通知 + chain 誤觸發）
-- 使用 SET LOCAL session_replication_role = replica 讓 ENABLE trigger 不執行
-- 適用：大量歷史資料匯入（104 HR 匯出、薪資補底）

-- 確保可能由 Studio 手動加過但 migration 沒記錄的欄位存在
ALTER TABLE public.leave_requests     ADD COLUMN IF NOT EXISTS unit     TEXT;
ALTER TABLE public.overtime_requests  ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.overtime_requests  ADD COLUMN IF NOT EXISTS source   TEXT;

-- ─── 1. 打卡紀錄批次匯入 ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bulk_import_attendance(
  p_records  jsonb,
  p_overwrite boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_skipped  int := 0;
  v_rec      jsonb;
  v_emp_id   int;
  v_date     date;
  v_exist_id bigint;
BEGIN
  SET LOCAL session_replication_role = replica;

  FOR v_rec IN SELECT * FROM jsonb_array_elements(p_records) LOOP
    v_emp_id := (v_rec->>'employee_id')::int;
    v_date   := (v_rec->>'date')::date;

    SELECT id INTO v_exist_id
      FROM public.attendance_records
     WHERE employee_id = v_emp_id AND date = v_date
     LIMIT 1;

    IF v_exist_id IS NOT NULL THEN
      IF p_overwrite THEN
        UPDATE public.attendance_records SET
          clock_in       = NULLIF(v_rec->>'clock_in',  '')::time,
          clock_out      = NULLIF(v_rec->>'clock_out', '')::time,
          total_hours    = NULLIF(v_rec->>'total_hours','')::numeric,
          status         = COALESCE(NULLIF(v_rec->>'status',''), '正常'),
          clock_in_mode  = COALESCE(NULLIF(v_rec->>'clock_in_mode',''),  'normal'),
          clock_out_mode = COALESCE(NULLIF(v_rec->>'clock_out_mode',''), 'normal')
        WHERE id = v_exist_id;
        v_inserted := v_inserted + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    ELSE
      INSERT INTO public.attendance_records
        (employee_id, employee, organization_id, date,
         clock_in, clock_out, total_hours, status,
         clock_in_mode, clock_out_mode)
      VALUES (
        v_emp_id,
        v_rec->>'employee',
        NULLIF(v_rec->>'organization_id','')::int,
        v_date,
        NULLIF(v_rec->>'clock_in',  '')::time,
        NULLIF(v_rec->>'clock_out', '')::time,
        NULLIF(v_rec->>'total_hours','')::numeric,
        COALESCE(NULLIF(v_rec->>'status',''), '正常'),
        COALESCE(NULLIF(v_rec->>'clock_in_mode',''),  'normal'),
        COALESCE(NULLIF(v_rec->>'clock_out_mode',''), 'normal')
      );
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
END;
$$;

-- ─── 2. 請假紀錄批次匯入 ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bulk_import_leave(p_records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_skipped  int := 0;
  v_rec      jsonb;
  v_emp_id   int;
BEGIN
  SET LOCAL session_replication_role = replica;

  FOR v_rec IN SELECT * FROM jsonb_array_elements(p_records) LOOP
    v_emp_id := (v_rec->>'employee_id')::int;

    -- 以 (employee_id, type, start_date, end_date) 去重
    IF EXISTS (
      SELECT 1 FROM public.leave_requests
       WHERE employee_id = v_emp_id
         AND type        = v_rec->>'type'
         AND start_date  = (v_rec->>'start_date')::date
         AND end_date    = (v_rec->>'end_date')::date
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.leave_requests
      (employee_id, employee, organization_id, type,
       start_date, end_date, days, unit, reason, status, approver)
    VALUES (
      v_emp_id,
      v_rec->>'employee',
      NULLIF(v_rec->>'organization_id','')::int,
      v_rec->>'type',
      (v_rec->>'start_date')::date,
      (v_rec->>'end_date')::date,
      NULLIF(v_rec->>'days','')::numeric,
      COALESCE(NULLIF(v_rec->>'unit',''), 'day'),
      COALESCE(v_rec->>'reason', ''),
      COALESCE(NULLIF(v_rec->>'status',''), '已核准'),
      COALESCE(NULLIF(v_rec->>'approver',''), '匯入')
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
END;
$$;

-- ─── 3. 加班紀錄批次匯入 ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bulk_import_overtime(p_records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_skipped  int := 0;
  v_rec      jsonb;
  v_emp_id   int;
BEGIN
  SET LOCAL session_replication_role = replica;

  FOR v_rec IN SELECT * FROM jsonb_array_elements(p_records) LOOP
    v_emp_id := (v_rec->>'employee_id')::int;

    -- 以 (employee_id, date) 去重
    IF EXISTS (
      SELECT 1 FROM public.overtime_requests
       WHERE employee_id = v_emp_id
         AND date        = (v_rec->>'date')::date
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.overtime_requests
      (employee_id, employee, organization_id, date, hours,
       category, start_time, end_time, reason, status, source, store)
    VALUES (
      v_emp_id,
      v_rec->>'employee',
      NULLIF(v_rec->>'organization_id','')::int,
      (v_rec->>'date')::date,
      NULLIF(v_rec->>'hours','')::numeric,
      NULLIF(v_rec->>'category',''),
      NULLIF(v_rec->>'start_time','')::time,
      NULLIF(v_rec->>'end_time','')::time,
      COALESCE(v_rec->>'reason', ''),
      COALESCE(NULLIF(v_rec->>'status',''), '已核准'),
      COALESCE(NULLIF(v_rec->>'source',''), 'import'),
      NULLIF(v_rec->>'store','')
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
END;
$$;

-- 開放 authenticated 呼叫（RLS 由 SECURITY DEFINER 內部處理）
GRANT EXECUTE ON FUNCTION public.bulk_import_attendance(jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_import_leave(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_import_overtime(jsonb) TO authenticated;
