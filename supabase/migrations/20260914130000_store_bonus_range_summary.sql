-- 營運獎金辦法 Phase 2a:季別(Q1~Q4)累積結算,且各季對應月份可自訂
--   ① store_bonus_quarter_def:每 org 四季各對應哪些月(預設辦法 Q1=1-3…,可改)
--   ② store_bonus_quarter_summary(店,年,季):把該季各月每人獎金加總(純讀,不寫入)
--   ※ 取代先前的 store_bonus_range_summary(自選區間)。

DROP FUNCTION IF EXISTS public.store_bonus_range_summary(int, text, text);

-- ① 季別月份定義
CREATE TABLE IF NOT EXISTS public.store_bonus_quarter_def (
  id              serial PRIMARY KEY,
  organization_id int NOT NULL,
  quarter         text NOT NULL CHECK (quarter IN ('Q1','Q2','Q3','Q4')),
  months          int[] NOT NULL DEFAULT '{}',
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, quarter)
);
ALTER TABLE public.store_bonus_quarter_def ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sbqd_org_all ON public.store_bonus_quarter_def;
CREATE POLICY sbqd_org_all ON public.store_bonus_quarter_def FOR ALL
  USING (org_visible(organization_id) AND is_staff())
  WITH CHECK (org_visible(organization_id) AND is_staff());

-- 種子:辦法標準季(Q1=1-3 / Q2=4-6 / Q3=7-9 / Q4=10-12);給既有 org + 未來新 org
CREATE OR REPLACE FUNCTION public._ensure_store_bonus_quarter_def(p_org int)
 RETURNS void LANGUAGE plpgsql AS $function$
BEGIN
  INSERT INTO public.store_bonus_quarter_def (organization_id, quarter, months) VALUES
    (p_org, 'Q1', '{1,2,3}'), (p_org, 'Q2', '{4,5,6}'),
    (p_org, 'Q3', '{7,8,9}'), (p_org, 'Q4', '{10,11,12}')
  ON CONFLICT (organization_id, quarter) DO NOTHING;
END $function$;

INSERT INTO public.store_bonus_quarter_def (organization_id, quarter, months)
SELECT o.id, q.quarter, q.months
FROM public.organizations o
CROSS JOIN (VALUES ('Q1','{1,2,3}'::int[]),('Q2','{4,5,6}'),('Q3','{7,8,9}'),('Q4','{10,11,12}')) q(quarter, months)
ON CONFLICT (organization_id, quarter) DO NOTHING;

-- ② 季彙總
CREATE OR REPLACE FUNCTION public.store_bonus_quarter_summary(p_store_id int, p_year int, p_quarter text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_org int; v_months int[]; v_yms text[]; v_rows json; v_mstatus json;
BEGIN
  SELECT organization_id INTO v_org FROM public.stores WHERE id = p_store_id;
  IF v_org IS NULL OR NOT public._same_org_or_super(v_org) THEN RETURN NULL; END IF;

  SELECT months INTO v_months FROM public.store_bonus_quarter_def WHERE organization_id = v_org AND quarter = p_quarter;
  IF v_months IS NULL THEN
    v_months := CASE p_quarter WHEN 'Q1' THEN '{1,2,3}' WHEN 'Q2' THEN '{4,5,6}'
                               WHEN 'Q3' THEN '{7,8,9}' ELSE '{10,11,12}' END;
  END IF;
  -- 組出該季的 YYYY-MM 清單
  SELECT array_agg(p_year::text || '-' || lpad(m::text, 2, '0')) INTO v_yms FROM unnest(v_months) AS m;

  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.total_net DESC), '[]'::json) INTO v_rows
  FROM (
    SELECT e.employee_id, e.employee_name, max(e.role) AS role, count(*)::int AS months,
           COALESCE(SUM(e.mgmt_bonus),0)   AS total_mgmt,
           COALESCE(SUM(e.target_bonus),0) AS total_target,
           COALESCE(SUM(e.merit_bonus),0)  AS total_merit,
           COALESCE(SUM(e.audit_deduction),0) AS total_audit,
           COALESCE(SUM(e.punch_deduction),0) AS total_punch,
           COALESCE(SUM(e.prev_month_supplement),0) AS total_suppl,
           COALESCE(SUM(e.custom_adjust),0) AS total_custom,
           COALESCE(SUM(e.net_bonus),0)    AS total_net
    FROM public.store_bonus_monthly m
    JOIN public.store_bonus_employee e ON e.monthly_id = m.id
    WHERE m.store_id = p_store_id AND m.year_month = ANY(v_yms)
    GROUP BY e.employee_id, e.employee_name
  ) t;

  SELECT COALESCE(json_agg(json_build_object('year_month', year_month, 'status', status, 'mgmt_pool', mgmt_bonus_pool) ORDER BY year_month), '[]'::json) INTO v_mstatus
  FROM public.store_bonus_monthly WHERE store_id = p_store_id AND year_month = ANY(v_yms);

  RETURN json_build_object('ok', true, 'quarter', p_quarter, 'year', p_year, 'months', v_months, 'rows', v_rows, 'month_status', v_mstatus);
END $fn$;

REVOKE ALL ON FUNCTION public.store_bonus_quarter_summary(int,int,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_bonus_quarter_summary(int,int,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
