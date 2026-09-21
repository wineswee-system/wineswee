-- 診斷：列出 dashboard 會 query 的表的 distinct status / stage 與 count
-- 用來找「dashboard 寫死的 status 字串撈不到資料」的問題
BEGIN;

CREATE OR REPLACE FUNCTION public._debug_dashboard_status()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v json;
  v_result json := '{}'::json;
BEGIN
  -- 通用：拼一張表的 status distinct + count
  -- 用 dynamic SQL 跑，表不存在就 skip
  WITH src AS (
    SELECT t.tbl, t.col FROM (VALUES
      ('tasks', 'status'),
      ('employees', 'status'),
      ('leave_requests', 'status'),
      ('overtime_requests', 'status'),
      ('business_trips', 'status'),
      ('clock_corrections', 'status'),
      ('resignation_requests', 'status'),
      ('leave_of_absence_requests', 'status'),
      ('personnel_transfer_requests', 'status'),
      ('expense_requests', 'status'),
      ('attendance_records', 'status'),
      ('workflow_instances', 'status'),
      ('workflows', 'status'),
      ('task_confirmations', 'status'),
      ('opportunities', 'stage'),
      ('approval_forms', 'status')
    ) t(tbl, col)
  )
  SELECT json_object_agg(tbl, status_breakdown ORDER BY tbl)
    INTO v_result
    FROM (
      SELECT
        src.tbl,
        (
          SELECT to_json(stats)
          FROM (
            SELECT
              (SELECT EXISTS (SELECT 1 FROM information_schema.tables
                              WHERE table_schema='public' AND table_name=src.tbl)) AS table_exists,
              (SELECT row_to_json(b) FROM (
                 SELECT (
                   SELECT json_agg(json_build_object('value', val, 'count', cnt) ORDER BY cnt DESC)
                     FROM (
                       SELECT * FROM dblink(
                         'dbname=' || current_database(),
                         format('SELECT COALESCE(%I::text, ''<NULL>'') AS val, COUNT(*) AS cnt FROM public.%I GROUP BY 1 ORDER BY 2 DESC LIMIT 20',
                                src.col, src.tbl)
                       ) AS x(val text, cnt bigint)
                     ) sub
                 ) AS values
              ) b)::json AS breakdown
          ) stats
        ) AS status_breakdown
        FROM src
    ) outer_q;

  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('error', SQLERRM, 'detail', 'dblink may not be available — fallback below');
END $$;

-- 上面用 dblink 比較花俏，可能 supabase 沒裝。換更穩的做法：用 EXECUTE INTO 動態 dynamic SQL
DROP FUNCTION IF EXISTS public._debug_dashboard_status();

CREATE OR REPLACE FUNCTION public._debug_dashboard_status()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_one json;
  v_result jsonb := '{}'::jsonb;
  t_list text[] := ARRAY[
    'tasks|status',
    'employees|status',
    'leave_requests|status',
    'overtime_requests|status',
    'business_trips|status',
    'clock_corrections|status',
    'resignation_requests|status',
    'leave_of_absence_requests|status',
    'personnel_transfer_requests|status',
    'expense_requests|status',
    'attendance_records|status',
    'workflow_instances|status',
    'workflows|status',
    'task_confirmations|status',
    'opportunities|stage',
    'approval_forms|status'
  ];
  pair text;
  tbl  text;
  col  text;
  sql_text text;
BEGIN
  FOREACH pair IN ARRAY t_list LOOP
    tbl := split_part(pair, '|', 1);
    col := split_part(pair, '|', 2);

    -- 表存在嗎
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                    WHERE table_schema='public' AND table_name=tbl) THEN
      v_result := v_result || jsonb_build_object(tbl, jsonb_build_object('exists', false));
      CONTINUE;
    END IF;

    -- 跑 GROUP BY
    sql_text := format(
      'SELECT json_agg(json_build_object(''value'', val, ''count'', cnt) ORDER BY cnt DESC)
         FROM (
           SELECT COALESCE(%I::text, ''<NULL>'') AS val, COUNT(*) AS cnt
             FROM public.%I
            GROUP BY 1
            ORDER BY 2 DESC
            LIMIT 20
         ) sub',
      col, tbl
    );
    EXECUTE sql_text INTO v_one;

    v_result := v_result || jsonb_build_object(tbl,
      jsonb_build_object('exists', true, 'column', col, 'values', COALESCE(v_one, '[]'::json)));
  END LOOP;

  RETURN v_result::json;
END $$;

GRANT EXECUTE ON FUNCTION public._debug_dashboard_status() TO authenticated, anon, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
