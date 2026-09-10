-- 庫存抽查:每格切成 {品名, 庫存數量, 實際數量},報表展開成「一商品一列」— 2026-09-10
-- remark_list 由「字串陣列」改「物件陣列」[{name, book, actual}];欄位仍 jsonb(功能剛上無舊資料)。
-- 報表(get_monthly_audit_key_checks)改回:門市/抽盤日期/商品名稱/庫存數量/現場數量,
--   抽盤結果由前端算(現場-庫存 → 少N/多N/正確)。book/actual 非數字則回 null。
CREATE OR REPLACE FUNCTION public.get_monthly_audit_key_checks(p_org int, p_year int, p_month int)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_start date := make_date(p_year, p_month, 1);
  v_end   date := (make_date(p_year, p_month, 1) + INTERVAL '1 month - 1 day')::date;
  v_rows  json;
BEGIN
  IF p_org IS NULL OR NOT public._same_org_or_super(p_org) THEN RETURN '[]'::json; END IF;

  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.audit_date, t.store_name), '[]'::json) INTO v_rows
  FROM (
    SELECT a.store_name,
           a.audit_date,
           btrim(e->>'name')                                                        AS name,
           CASE WHEN btrim(COALESCE(e->>'book',''))   ~ '^-?[0-9]+(\.[0-9]+)?$'
                THEN (btrim(e->>'book'))::numeric   ELSE NULL END                    AS book,
           CASE WHEN btrim(COALESCE(e->>'actual','')) ~ '^-?[0-9]+(\.[0-9]+)?$'
                THEN (btrim(e->>'actual'))::numeric ELSE NULL END                    AS actual
    FROM public.store_audit_items i
    JOIN public.store_audits a ON a.id = i.audit_id
    CROSS JOIN LATERAL jsonb_array_elements(i.remark_list) e
    WHERE a.organization_id = p_org AND a.status = '已核准'
      AND a.audit_date BETWEEN v_start AND v_end
      AND i.input_type = 'multi'
      AND jsonb_typeof(i.remark_list) = 'array'
      AND COALESCE(btrim(e->>'name'), '') <> ''
  ) t;

  RETURN v_rows;
END $fn$;

REVOKE ALL ON FUNCTION public.get_monthly_audit_key_checks(int,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_monthly_audit_key_checks(int,int,int) TO authenticated;

NOTIFY pgrst, 'reload schema';
