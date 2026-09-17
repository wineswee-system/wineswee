-- ② 店長競賽辦法:4個月一期,以「業績成長率(vs上一期)」排名,達門檻者取前三 → 38000/4000/3000
--    門檻:達業績目標 + 成長率>0% + 淨利率≥3%;資料源=store_bonus_monthly(各月營業額/目標/淨利)
--    P1=1-4月(6月發)、P2=5-8月(10月發)、P3=9-12月(隔年2月發);成長率基準=上一期(P1←去年P3)

-- 期別定義(月份/發放月/獎金/門檻可調)
CREATE TABLE IF NOT EXISTS public.store_bonus_competition_def (
  id serial PRIMARY KEY,
  organization_id int NOT NULL,
  period text NOT NULL CHECK (period IN ('P1','P2','P3')),
  months int[] NOT NULL DEFAULT '{}',
  payout_month int,
  payout_next_year boolean DEFAULT false,
  prize_1 numeric(12,2) DEFAULT 38000,
  prize_2 numeric(12,2) DEFAULT 4000,
  prize_3 numeric(12,2) DEFAULT 3000,
  min_net_rate numeric(6,4) DEFAULT 0.03,   -- 淨利率門檻 3%
  updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, period)
);
ALTER TABLE public.store_bonus_competition_def ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sbcd_org_all ON public.store_bonus_competition_def;
CREATE POLICY sbcd_org_all ON public.store_bonus_competition_def FOR ALL
  USING (org_visible(organization_id) AND is_staff()) WITH CHECK (org_visible(organization_id) AND is_staff());

-- 結果快照(確認發放)
CREATE TABLE IF NOT EXISTS public.store_bonus_competition_result (
  id serial PRIMARY KEY,
  organization_id int NOT NULL,
  year int NOT NULL,
  period text NOT NULL CHECK (period IN ('P1','P2','P3')),
  payout_year_month text,
  rows jsonb DEFAULT '[]'::jsonb,     -- 前三名(含店長/金額)+ 全店排名快照
  settled_at timestamptz DEFAULT now(),
  settled_by int,
  UNIQUE (organization_id, year, period)
);
ALTER TABLE public.store_bonus_competition_result ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sbcr_org_all ON public.store_bonus_competition_result;
CREATE POLICY sbcr_org_all ON public.store_bonus_competition_result FOR ALL
  USING (org_visible(organization_id) AND is_staff()) WITH CHECK (org_visible(organization_id) AND is_staff());

-- 種子:org 1 三期預設(辦法值)
INSERT INTO public.store_bonus_competition_def (organization_id, period, months, payout_month, payout_next_year)
VALUES (1,'P1','{1,2,3,4}',6,false), (1,'P2','{5,6,7,8}',10,false), (1,'P3','{9,10,11,12}',2,true)
ON CONFLICT (organization_id, period) DO NOTHING;

-- 計算:回傳某期各店排名(不寫入)。核心邏輯(供結算共用)
CREATE OR REPLACE FUNCTION public._competition_rows(p_org int, p_year int, p_period text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_months int[]; v_pm int; v_pny boolean; v_p1 numeric; v_p2 numeric; v_p3 numeric; v_minrate numeric;
  v_prev_period text; v_prev_year int; v_prev_months int[];
  v_yms text[]; v_prev_yms text[]; v_payout_ym text; v_rows json;
BEGIN
  SELECT months, payout_month, payout_next_year, prize_1, prize_2, prize_3, min_net_rate
    INTO v_months, v_pm, v_pny, v_p1, v_p2, v_p3, v_minrate
    FROM store_bonus_competition_def WHERE organization_id=p_org AND period=p_period;
  IF v_months IS NULL THEN
    v_months := CASE p_period WHEN 'P1' THEN '{1,2,3,4}' WHEN 'P2' THEN '{5,6,7,8}' ELSE '{9,10,11,12}' END;
    v_pm := CASE p_period WHEN 'P1' THEN 6 WHEN 'P2' THEN 10 ELSE 2 END;
    v_pny := (p_period='P3'); v_p1:=38000; v_p2:=4000; v_p3:=3000; v_minrate:=0.03;
  END IF;
  v_prev_period := CASE p_period WHEN 'P1' THEN 'P3' WHEN 'P2' THEN 'P1' ELSE 'P2' END;
  v_prev_year   := CASE p_period WHEN 'P1' THEN p_year-1 ELSE p_year END;
  SELECT months INTO v_prev_months FROM store_bonus_competition_def WHERE organization_id=p_org AND period=v_prev_period;
  IF v_prev_months IS NULL THEN
    v_prev_months := CASE v_prev_period WHEN 'P1' THEN '{1,2,3,4}' WHEN 'P2' THEN '{5,6,7,8}' ELSE '{9,10,11,12}' END;
  END IF;
  SELECT array_agg(p_year::text||'-'||lpad(m::text,2,'0')) INTO v_yms FROM unnest(v_months) m;
  SELECT array_agg(v_prev_year::text||'-'||lpad(m::text,2,'0')) INTO v_prev_yms FROM unnest(v_prev_months) m;
  v_payout_ym := (p_year + CASE WHEN v_pny THEN 1 ELSE 0 END)::text||'-'||lpad(v_pm::text,2,'0');

  WITH cur AS (
    SELECT s.id store_id, s.name store_name, s.manager_id,
           COALESCE(SUM(m.actual_revenue),0) cur_rev,
           COALESCE(SUM(m.target_revenue),0) cur_target,
           COALESCE(SUM(m.net_profit),0) cur_net,
           COUNT(m.id) cur_months
    FROM stores s LEFT JOIN store_bonus_monthly m ON m.store_id=s.id AND m.year_month = ANY(v_yms)
    WHERE s.organization_id=p_org GROUP BY s.id, s.name, s.manager_id
  ), prev AS (
    SELECT s.id store_id, COALESCE(SUM(m.actual_revenue),0) prev_rev
    FROM stores s LEFT JOIN store_bonus_monthly m ON m.store_id=s.id AND m.year_month = ANY(v_prev_yms)
    WHERE s.organization_id=p_org GROUP BY s.id
  ), calc AS (
    SELECT c.*, p.prev_rev, e.name manager_name, e.join_date manager_join, e.status manager_status,
           CASE WHEN p.prev_rev>0 THEN round((c.cur_rev-p.prev_rev)/p.prev_rev,4) END growth,
           CASE WHEN c.cur_rev>0 THEN round(c.cur_net/c.cur_rev,4) ELSE 0 END net_rate,
           (c.cur_target>0 AND c.cur_rev>=c.cur_target) achieved
    FROM cur c JOIN prev p ON p.store_id=c.store_id
    LEFT JOIN employees e ON e.id=c.manager_id
  ), elig AS (
    SELECT *, (achieved AND growth IS NOT NULL AND growth>0 AND net_rate>=v_minrate
               AND cur_months>0) eligible
    FROM calc
  ), ranked AS (
    SELECT *, CASE WHEN eligible THEN row_number() OVER (PARTITION BY eligible ORDER BY growth DESC) END rnk
    FROM elig
  )
  SELECT json_build_object(
    'period', p_period, 'year', p_year, 'months', v_months, 'payout_year_month', v_payout_ym,
    'prizes', json_build_array(v_p1,v_p2,v_p3), 'min_net_rate', v_minrate,
    'prev_period', v_prev_period, 'prev_year', v_prev_year,
    'rows', COALESCE(json_agg(json_build_object(
       'store_id', store_id, 'store_name', store_name,
       'manager_id', manager_id, 'manager_name', manager_name,
       'cur_rev', cur_rev, 'prev_rev', prev_rev, 'cur_target', cur_target,
       'growth', growth, 'net_rate', net_rate, 'achieved', achieved,
       'eligible', eligible, 'rank', CASE WHEN eligible THEN rnk END,
       'prize', CASE WHEN eligible AND rnk=1 THEN v_p1 WHEN eligible AND rnk=2 THEN v_p2 WHEN eligible AND rnk=3 THEN v_p3 ELSE 0 END
     ) ORDER BY eligible DESC, growth DESC NULLS LAST), '[]'::json)
  ) INTO v_rows FROM ranked;
  RETURN v_rows;
END $fn$;

-- 對外計算(閘門)
CREATE OR REPLACE FUNCTION public.compute_store_competition(p_org int, p_year int, p_period text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public._same_org_or_super(p_org) THEN RETURN json_build_object('ok',false,'error','DENIED'); END IF;
  RETURN json_build_object('ok', true) || public._competition_rows(p_org, p_year, p_period)::jsonb;
END $fn$;

-- 確認發放:快照結果
CREATE OR REPLACE FUNCTION public.settle_store_competition(p_org int, p_year int, p_period text, p_settler int)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_data jsonb; v_ym text;
BEGIN
  IF NOT public._same_org_or_super(p_org) THEN RETURN json_build_object('ok',false,'error','DENIED'); END IF;
  v_data := public._competition_rows(p_org, p_year, p_period)::jsonb;
  v_ym := v_data->>'payout_year_month';
  INSERT INTO store_bonus_competition_result (organization_id, year, period, payout_year_month, rows, settled_at, settled_by)
  VALUES (p_org, p_year, p_period, v_ym, v_data->'rows', now(), p_settler)
  ON CONFLICT (organization_id, year, period) DO UPDATE
    SET payout_year_month=EXCLUDED.payout_year_month, rows=EXCLUDED.rows, settled_at=now(), settled_by=EXCLUDED.settled_by;
  RETURN json_build_object('ok', true, 'payout_year_month', v_ym, 'data', v_data);
END $fn$;

REVOKE ALL ON FUNCTION public.compute_store_competition(int,int,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_store_competition(int,int,text,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_store_competition(int,int,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_store_competition(int,int,text,int) TO authenticated;

NOTIFY pgrst, 'reload schema';
