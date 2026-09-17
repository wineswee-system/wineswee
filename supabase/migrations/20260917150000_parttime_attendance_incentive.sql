-- ④ 計時同仁激勵辦法(只做全勤激勵):當月全勤達標 → 時薪+10,乘當月核薪工時,次月發放
--    全勤達標=工時≥100h + 無遲到早退事病假曠職 + 忘卡補卡≤4(人工認定勾選,同獎金扣項作法)
--    跨店支援激勵(暫不做)

CREATE TABLE IF NOT EXISTS public.part_time_attendance_incentive (
  id serial PRIMARY KEY,
  organization_id int NOT NULL,
  employee_id int NOT NULL,
  employee_name text,
  year_month text NOT NULL,                 -- 出勤月(YYYY-MM)
  paid_hours numeric(10,2) DEFAULT 0,       -- 當月核薪工時
  is_full_attendance boolean DEFAULT false, -- 全勤達標(人工勾)
  rate_add numeric(6,2) DEFAULT 10,         -- 時薪加給(全勤+10)
  bonus numeric(12,2) DEFAULT 0,            -- = is_full ? paid_hours*rate_add : 0
  payout_year_month text,                    -- 發放月(次月)
  notes text,
  status text DEFAULT '已核',
  created_at timestamptz DEFAULT now(),
  created_by int,
  UNIQUE (organization_id, employee_id, year_month)
);
ALTER TABLE public.part_time_attendance_incentive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ptai_org_all ON public.part_time_attendance_incentive;
CREATE POLICY ptai_org_all ON public.part_time_attendance_incentive FOR ALL
  USING (org_visible(organization_id) AND is_staff()) WITH CHECK (org_visible(organization_id) AND is_staff());

-- 自動算獎金(全勤才給,+10×核薪工時)+ 次月發放月
CREATE OR REPLACE FUNCTION public.tg_parttime_incentive_compute() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.bonus := CASE WHEN NEW.is_full_attendance
                    THEN round(COALESCE(NEW.paid_hours,0) * COALESCE(NEW.rate_add,10), 2)
                    ELSE 0 END;
  IF NEW.year_month IS NOT NULL THEN
    NEW.payout_year_month := to_char(((NEW.year_month||'-01')::date + INTERVAL '1 month')::date, 'YYYY-MM');
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_ptai_compute ON public.part_time_attendance_incentive;
CREATE TRIGGER trg_ptai_compute BEFORE INSERT OR UPDATE ON public.part_time_attendance_incentive
  FOR EACH ROW EXECUTE FUNCTION public.tg_parttime_incentive_compute();

DROP TRIGGER IF EXISTS trg_ptai_org ON public.part_time_attendance_incentive;
CREATE TRIGGER trg_ptai_org BEFORE INSERT ON public.part_time_attendance_incentive
  FOR EACH ROW EXECUTE FUNCTION public.set_org_default();

NOTIFY pgrst, 'reload schema';
