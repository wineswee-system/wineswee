-- 排班批次匯入 RPC — 2026-07-21
-- ════════════════════════════════════════════════════════════════════════════
-- ScheduleImportModal 匯入班表:for 迴圈逐列「先 select 找舊 row → update/insert」
--   → N 列 = 2N 次網路來回、非原子。改一次呼叫 RPC 內迴圈處理(200 次→1 次)。
-- 保留現有 UX:每列包 savepoint(BEGIN/EXCEPTION),一列壞不影響其他,回 success/fail/errors。
-- upsert 鍵沿用現況 (employee 姓名 + date)(schedules 為姓名制,見 feedback_schedules_no_creator_delete_by_id);
--   加 org scope 避免跨組同名誤更新。欄位皆存在(已驗)。
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.import_schedules(
  p_rows     jsonb,
  p_org      integer,
  p_actor_id integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller     employees;
  v_row        jsonb;
  v_existing   int;
  v_success    int := 0;
  v_fail       int := 0;
  v_errors     jsonb := '[]'::jsonb;
  v_name       text;
  v_date       date;
BEGIN
  -- 呼叫者(權限;org 由參數帶)
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL AND p_actor_id IS NOT NULL THEN
    SELECT * INTO v_caller FROM employees WHERE id = p_actor_id;
  END IF;
  IF v_caller.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CALLER_NOT_FOUND');
  END IF;

  IF jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ROWS');
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    BEGIN
      v_name := v_row->>'name';
      v_date := (v_row->>'date')::date;

      -- 找同員工同日舊 row(org scope)
      SELECT id INTO v_existing
        FROM schedules
       WHERE employee = v_name AND date = v_date
         AND (organization_id = p_org OR (organization_id IS NULL AND p_org IS NULL))
       LIMIT 1;

      IF v_existing IS NOT NULL THEN
        UPDATE schedules SET
          shift        = v_row->>'shift',
          actual_start = NULLIF(v_row->>'actual_start','')::time,
          actual_end   = NULLIF(v_row->>'actual_end','')::time,
          source_store = NULLIF(v_row->>'source_store',''),
          organization_id = p_org
        WHERE id = v_existing;
      ELSE
        INSERT INTO schedules (employee, date, shift, actual_start, actual_end, source_store, organization_id)
        VALUES (
          v_name, v_date, v_row->>'shift',
          NULLIF(v_row->>'actual_start','')::time, NULLIF(v_row->>'actual_end','')::time,
          NULLIF(v_row->>'source_store',''), p_org
        );
      END IF;
      v_success := v_success + 1;

    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail + 1;
      v_errors := v_errors || jsonb_build_object(
        'row', v_row->>'rowNum', 'name', v_row->>'name',
        'date', v_row->>'date', 'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'success', v_success, 'fail', v_fail, 'errors', v_errors);
END $function$;

GRANT EXECUTE ON FUNCTION public.import_schedules(jsonb, integer, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
