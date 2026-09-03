-- 2026-09-02 月稽核報表 RPC:一次回「門市分數排名(含趨勢)」+「常見缺失Top」
--   門市分數:每店當月已核准稽核,第一/第二複評=最早兩次 avg_score,平均=當月平均,
--             趨勢=第二 vs 第一(up/down/flat;只1次=null)。依平均排名。
--   常見缺失:store_audit_items 未通過或扣分者,依 item_text 彙總次數/總扣分/門市清單。

CREATE OR REPLACE FUNCTION public.get_monthly_audit_report(p_org int, p_year int, p_month int)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_start date := make_date(p_year, p_month, 1);
  v_end   date := (make_date(p_year, p_month, 1) + INTERVAL '1 month - 1 day')::date;
  v_scores  json;
  v_def     json;
  v_cats    json;
  v_improve json;
BEGIN
  IF p_org IS NULL OR NOT public._same_org_or_super(p_org) THEN RETURN NULL; END IF;

  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.avg DESC NULLS LAST), '[]'::json) INTO v_scores
  FROM (
    SELECT s.store_name,
           (array_agg(s.avg_score ORDER BY s.audit_date))[1]::numeric AS first_score,
           (array_agg(s.avg_score ORDER BY s.audit_date))[2]::numeric AS second_score,
           round(avg(s.avg_score), 2) AS avg,
           count(*)::int AS audit_count,
           CASE
             WHEN count(*) < 2 THEN NULL
             WHEN (array_agg(s.avg_score ORDER BY s.audit_date))[2] > (array_agg(s.avg_score ORDER BY s.audit_date))[1] THEN 'up'
             WHEN (array_agg(s.avg_score ORDER BY s.audit_date))[2] < (array_agg(s.avg_score ORDER BY s.audit_date))[1] THEN 'down'
             ELSE 'flat'
           END AS trend
    FROM public.store_audits s
    WHERE s.organization_id = p_org AND s.status = '已核准'
      AND s.audit_date BETWEEN v_start AND v_end
      AND s.avg_score IS NOT NULL
    GROUP BY s.store_name
  ) t;

  SELECT COALESCE(json_agg(row_to_json(d)), '[]'::json) INTO v_def
  FROM (
    SELECT i.item_text,
           count(*)::int AS cnt,
           COALESCE(sum(i.deduct_score), 0)::int AS total_deduct,
           array_agg(DISTINCT a.store_name) AS stores
    FROM public.store_audit_items i
    JOIN public.store_audits a ON a.id = i.audit_id
    WHERE a.organization_id = p_org AND a.status = '已核准'
      AND a.audit_date BETWEEN v_start AND v_end
      AND (i.passed = false OR i.deduct_score > 0)
      AND COALESCE(btrim(i.item_text), '') <> ''
    GROUP BY i.item_text
    ORDER BY count(*) DESC, sum(i.deduct_score) DESC
    LIMIT 15
  ) d;

  -- 缺失「分類」彙總(當月未通過/扣分項,依 category_name 聚合)
  SELECT COALESCE(json_agg(row_to_json(g) ORDER BY g.deduct DESC), '[]'::json) INTO v_cats
  FROM (
    SELECT COALESCE(NULLIF(btrim(i.category_name), ''), '(未分類)') AS name,
           count(*)::int AS cnt,
           COALESCE(sum(i.deduct_score), 0)::int AS deduct,
           count(DISTINCT a.store_name)::int AS stores
    FROM public.store_audit_items i
    JOIN public.store_audits a ON a.id = i.audit_id
    WHERE a.organization_id = p_org AND a.status = '已核准'
      AND a.audit_date BETWEEN v_start AND v_end
      AND (i.passed = false OR i.deduct_score > 0)
    GROUP BY 1
  ) g;

  -- 複評改善追蹤:第一次稽核被扣分的項目,到最後一次稽核是否修好(僅當月稽核≥2次的店)
  --   項目識別 = (category_code, item_no);improved = 第一次扣、最後一次沒扣
  SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.rate DESC, x.first_bad DESC), '[]'::json) INTO v_improve
  FROM (
    WITH ord AS (
      SELECT store_name, id,
             row_number() OVER (PARTITION BY store_name ORDER BY audit_date) rn,
             count(*)     OVER (PARTITION BY store_name) n
        FROM public.store_audits
       WHERE organization_id = p_org AND status = '已核准'
         AND audit_date BETWEEN v_start AND v_end
    ),
    a1 AS (SELECT store_name, id FROM ord WHERE rn = 1 AND n >= 2),
    a2 AS (SELECT store_name, id FROM ord WHERE rn = n AND n >= 2),
    firstbad AS (
      SELECT a1.store_name, i.category_code, i.item_no
        FROM a1 JOIN public.store_audit_items i ON i.audit_id = a1.id
       WHERE (i.passed = false OR i.deduct_score > 0)
    ),
    secondbad AS (
      SELECT a2.store_name, i.category_code, i.item_no
        FROM a2 JOIN public.store_audit_items i ON i.audit_id = a2.id
       WHERE (i.passed = false OR i.deduct_score > 0)
    )
    SELECT fb.store_name,
           count(*)::int AS first_bad,
           count(*) FILTER (WHERE sb.item_no IS NULL)::int AS improved,
           round(count(*) FILTER (WHERE sb.item_no IS NULL) * 100.0 / count(*))::int AS rate
      FROM firstbad fb
      LEFT JOIN secondbad sb
        ON sb.store_name = fb.store_name
       AND sb.category_code IS NOT DISTINCT FROM fb.category_code
       AND sb.item_no IS NOT DISTINCT FROM fb.item_no
     GROUP BY fb.store_name
  ) x;

  RETURN json_build_object('year', p_year, 'month', p_month,
    'scores', v_scores, 'deficiencies', v_def, 'categories', v_cats, 'improvement', v_improve);
END $fn$;

REVOKE ALL ON FUNCTION public.get_monthly_audit_report(int,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_monthly_audit_report(int,int,int) TO authenticated;
