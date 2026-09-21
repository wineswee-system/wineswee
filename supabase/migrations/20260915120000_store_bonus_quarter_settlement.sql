-- 營運獎金辦法:季結算(確認季發放)— 記錄一季每人應領總額的快照
CREATE TABLE IF NOT EXISTS public.store_bonus_quarter_settlement (
  id              serial PRIMARY KEY,
  organization_id int NOT NULL,
  store_id        int NOT NULL,
  year            int NOT NULL,
  quarter         text NOT NULL CHECK (quarter IN ('Q1','Q2','Q3','Q4')),
  months          int[] NOT NULL DEFAULT '{}',
  total_amount    numeric(12,2) DEFAULT 0,
  rows            jsonb DEFAULT '[]'::jsonb,   -- 每人快照
  settled_at      timestamptz DEFAULT now(),
  settled_by      int,
  UNIQUE (store_id, year, quarter)
);
ALTER TABLE public.store_bonus_quarter_settlement ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sbqs_org_all ON public.store_bonus_quarter_settlement;
CREATE POLICY sbqs_org_all ON public.store_bonus_quarter_settlement FOR ALL
  USING (org_visible(organization_id) AND is_staff())
  WITH CHECK (org_visible(organization_id) AND is_staff());

-- 確認季發放:彙總該季各月每人獎金 → 存快照(可重跑覆蓋)。回傳含尚未結算月數警示。
CREATE OR REPLACE FUNCTION public.settle_store_bonus_quarter(p_store_id int, p_year int, p_quarter text, p_settler int)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_org int; v_months int[]; v_yms text[]; v_rows json; v_total numeric; v_draft int;
BEGIN
  SELECT organization_id INTO v_org FROM public.stores WHERE id = p_store_id;
  IF v_org IS NULL OR NOT public._same_org_or_super(v_org) THEN
    RETURN json_build_object('ok', false, 'error', 'DENIED'); END IF;

  SELECT months INTO v_months FROM public.store_bonus_quarter_def WHERE organization_id = v_org AND quarter = p_quarter;
  IF v_months IS NULL THEN
    v_months := CASE p_quarter WHEN 'Q1' THEN '{1,2,3}' WHEN 'Q2' THEN '{4,5,6}'
                               WHEN 'Q3' THEN '{7,8,9}' ELSE '{10,11,12}' END; END IF;
  SELECT array_agg(p_year::text || '-' || lpad(m::text,2,'0')) INTO v_yms FROM unnest(v_months) m;

  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.total_net DESC), '[]'::json),
         COALESCE(SUM(t.total_net),0)
    INTO v_rows, v_total
  FROM (
    SELECT e.employee_id, e.employee_name, max(e.role) role, count(*)::int months,
           COALESCE(SUM(e.mgmt_bonus),0) total_mgmt, COALESCE(SUM(e.target_bonus),0) total_target,
           COALESCE(SUM(e.merit_bonus),0) total_merit,
           COALESCE(SUM(e.audit_deduction),0)+COALESCE(SUM(e.punch_deduction),0) total_deduct,
           COALESCE(SUM(e.net_bonus),0) total_net
    FROM public.store_bonus_monthly m JOIN public.store_bonus_employee e ON e.monthly_id = m.id
    WHERE m.store_id = p_store_id AND m.year_month = ANY(v_yms)
    GROUP BY e.employee_id, e.employee_name
  ) t;

  SELECT count(*) INTO v_draft FROM public.store_bonus_monthly
   WHERE store_id = p_store_id AND year_month = ANY(v_yms) AND status <> 'finalized';

  INSERT INTO public.store_bonus_quarter_settlement (organization_id, store_id, year, quarter, months, total_amount, rows, settled_at, settled_by)
  VALUES (v_org, p_store_id, p_year, p_quarter, v_months, v_total, v_rows, now(), p_settler)
  ON CONFLICT (store_id, year, quarter) DO UPDATE
    SET months = EXCLUDED.months, total_amount = EXCLUDED.total_amount, rows = EXCLUDED.rows,
        settled_at = now(), settled_by = EXCLUDED.settled_by;

  RETURN json_build_object('ok', true, 'total', v_total, 'draft_months', v_draft, 'rows', v_rows);
END $fn$;

REVOKE ALL ON FUNCTION public.settle_store_bonus_quarter(int,int,text,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_store_bonus_quarter(int,int,text,int) TO authenticated;

NOTIFY pgrst, 'reload schema';
