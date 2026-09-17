-- ③ 個人銷售酒款激勵辦法:個人開發客源成交,單筆40000→1500、100000→3000,次月20日獨立發放
--    銷售業績「列入」門市營業額(POS 本來就含,自然併入);此獎金為額外個人發放,不進門市獎金池

CREATE TABLE IF NOT EXISTS public.personal_sale_incentive (
  id serial PRIMARY KEY,
  organization_id int NOT NULL,
  employee_id int NOT NULL,
  employee_name text,
  store_id int,
  sale_date date NOT NULL,
  sale_amount numeric(12,2) NOT NULL,        -- 單筆結帳金額(折扣後淨額)
  bonus numeric(12,2) DEFAULT 0,             -- 依級距自動算:>=100000→3000、>=40000→1500、否則0
  payout_year_month text,                     -- 發放月(次月)
  reviewer_id int,                            -- 覆核者(店長/督導)
  notes text,
  status text DEFAULT '已覆核',
  created_at timestamptz DEFAULT now(),
  created_by int
);
ALTER TABLE public.personal_sale_incentive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS psi_org_all ON public.personal_sale_incentive;
CREATE POLICY psi_org_all ON public.personal_sale_incentive FOR ALL
  USING (org_visible(organization_id) AND is_staff()) WITH CHECK (org_visible(organization_id) AND is_staff());

-- 自動算級距獎金 + 次月發放月
CREATE OR REPLACE FUNCTION public.tg_personal_sale_compute() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.bonus := CASE WHEN COALESCE(NEW.sale_amount,0) >= 100000 THEN 3000
                    WHEN COALESCE(NEW.sale_amount,0) >= 40000  THEN 1500
                    ELSE 0 END;
  IF NEW.payout_year_month IS NULL AND NEW.sale_date IS NOT NULL THEN
    NEW.payout_year_month := to_char((NEW.sale_date + INTERVAL '1 month')::date, 'YYYY-MM');
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_psi_compute ON public.personal_sale_incentive;
CREATE TRIGGER trg_psi_compute BEFORE INSERT OR UPDATE ON public.personal_sale_incentive
  FOR EACH ROW EXECUTE FUNCTION public.tg_personal_sale_compute();

-- org 預設(重用既有 set_org_default)
DROP TRIGGER IF EXISTS trg_psi_org ON public.personal_sale_incentive;
CREATE TRIGGER trg_psi_org BEFORE INSERT ON public.personal_sale_incentive
  FOR EACH ROW EXECUTE FUNCTION public.set_org_default();

NOTIFY pgrst, 'reload schema';
