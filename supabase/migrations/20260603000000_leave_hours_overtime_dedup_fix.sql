-- ============================================================
-- Fix 1: leave_requests 補 hours 欄位
--   migration 20260602220000 的 bulk_import_leave RPC 在 INSERT/UPDATE 用到
--   hours 欄位，但從來沒有 ALTER TABLE 建過這欄 → RPC 執行會噴
--   "column hours does not exist"
--
-- Fix 2: bulk_import_overtime dedup 改為 (employee_id, date, start_time)
--   104 系統允許同一員工同一 加班歸屬日 有多筆（不同時段），
--   原本只用 (employee_id, date) 去重 → 第二筆直接 skip，資料遺失。
--   改用三欄去重（IS NOT DISTINCT FROM 支援 NULL start_time）。
-- ============================================================

-- ─── Fix 1 ───────────────────────────────────────────────────
ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS hours NUMERIC;

-- ─── Fix 2 ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bulk_import_overtime(
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
  v_exist_id bigint;
  v_start    time;
BEGIN
  FOR v_rec IN SELECT * FROM jsonb_array_elements(p_records) LOOP
    v_emp_id := (v_rec->>'employee_id')::int;
    v_start  := NULLIF(v_rec->>'start_time','')::time;

    -- 以 (employee_id, date, start_time) 三欄去重；IS NOT DISTINCT FROM 支援 NULL
    SELECT id INTO v_exist_id
      FROM public.overtime_requests
     WHERE employee_id = v_emp_id
       AND date        = (v_rec->>'date')::date
       AND start_time  IS NOT DISTINCT FROM v_start
     LIMIT 1;

    IF v_exist_id IS NOT NULL THEN
      IF p_overwrite THEN
        UPDATE public.overtime_requests SET
          hours      = NULLIF(v_rec->>'hours','')::numeric,
          category   = NULLIF(v_rec->>'category',''),
          start_time = v_start,
          end_time   = NULLIF(v_rec->>'end_time','')::time,
          reason     = COALESCE(v_rec->>'reason', ''),
          status     = COALESCE(NULLIF(v_rec->>'status',''), '已核准'),
          source     = COALESCE(NULLIF(v_rec->>'source',''), 'import')
        WHERE id = v_exist_id;
        v_inserted := v_inserted + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
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
      v_start,
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

GRANT EXECUTE ON FUNCTION public.bulk_import_overtime(jsonb, boolean) TO authenticated;
