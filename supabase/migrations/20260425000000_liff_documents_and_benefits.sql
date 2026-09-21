-- ============================================================
-- LIFF：員工文件查詢 + 福利政策查詢
--
-- 兩個 RPC 都是員工自助查詢用，不寫入。
--   1. liff_list_documents：列出公司公開文件（依 category 過濾）
--   2. liff_get_my_benefits：解析「對我生效」的福利政策
--      解析優先序：employee_id 命中 > store_id 命中 > 全公司（NULL/NULL）
-- ============================================================

-- ═══ 1. liff_list_documents ═══
-- 注意：documents 表本身沒有 employee/org scope，是「公司全員可查」的設計
-- 因此只要綁定的員工存在就能讀。如未來需要 org 隔離，可在這裡加 organization_id 篩選。
CREATE OR REPLACE FUNCTION public.liff_list_documents(
  p_line_user_id text,
  p_category     text DEFAULT NULL,
  p_search       text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  result json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT json_build_object(
    'ok',         true,
    'documents',  COALESCE(json_agg(json_build_object(
      'id',           d.id,
      'name',         d.name,
      'type',         d.type,
      'size',         d.size,
      'uploader',     d.uploader,
      'upload_date',  d.upload_date,
      'category',     d.category,
      'url',          d.url,
      'notes',        d.notes
    ) ORDER BY d.upload_date DESC NULLS LAST, d.id DESC), '[]'::json),
    'categories', (
      SELECT COALESCE(json_agg(DISTINCT category ORDER BY category), '[]'::json)
      FROM public.documents
      WHERE category IS NOT NULL
    )
  ) INTO result
  FROM public.documents d
  WHERE (p_category IS NULL OR d.category = p_category)
    AND (
      p_search IS NULL OR btrim(p_search) = ''
      OR d.name ILIKE '%' || p_search || '%'
      OR d.notes ILIKE '%' || p_search || '%'
    );

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_documents(text, text, text) TO anon, authenticated;


-- ═══ 2. liff_get_my_benefits ═══
-- 解析優先序：員工級客製 > 門市級客製 > 全公司預設
-- 同一個 code 同時有多筆生效時，取「最具體」那筆
CREATE OR REPLACE FUNCTION public.liff_get_my_benefits(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp     employees;
  today   date := CURRENT_DATE;
  result  json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  WITH candidates AS (
    SELECT
      bp.*,
      -- 優先級：3=員工級, 2=門市級, 1=全公司
      CASE
        WHEN bp.employee_id = emp.id THEN 3
        WHEN bp.employee_id IS NULL AND bp.store_id = emp.store_id THEN 2
        WHEN bp.employee_id IS NULL AND bp.store_id IS NULL THEN 1
        ELSE 0
      END AS priority
    FROM public.benefit_policies bp
    WHERE bp.is_active = TRUE
      AND (bp.tenant_id IS NULL OR bp.tenant_id = emp.tenant_id)
      AND (bp.effective_from IS NULL OR bp.effective_from <= today)
      AND (bp.effective_to   IS NULL OR bp.effective_to   >= today)
  ),
  ranked AS (
    SELECT *,
      ROW_NUMBER() OVER (
        PARTITION BY category, code
        ORDER BY priority DESC, id DESC
      ) AS rn
    FROM candidates
    WHERE priority > 0
  ),
  effective AS (
    SELECT * FROM ranked WHERE rn = 1
  )
  SELECT json_build_object(
    'ok',     true,
    'leave',  (
      SELECT COALESCE(json_agg(json_build_object(
        'code',     code,
        'config',   config,
        'notes',    notes,
        'scope',    CASE priority WHEN 3 THEN '個人' WHEN 2 THEN '門市' ELSE '全公司' END
      ) ORDER BY code), '[]'::json)
      FROM effective WHERE category = 'leave'
    ),
    'bonus',  (
      SELECT COALESCE(json_agg(json_build_object(
        'code',     code,
        'config',   config,
        'notes',    notes,
        'scope',    CASE priority WHEN 3 THEN '個人' WHEN 2 THEN '門市' ELSE '全公司' END
      ) ORDER BY code), '[]'::json)
      FROM effective WHERE category = 'bonus'
    )
  ) INTO result;

  RETURN COALESCE(result, json_build_object('ok', true, 'leave', '[]'::json, 'bonus', '[]'::json));
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_my_benefits(text) TO anon, authenticated;
