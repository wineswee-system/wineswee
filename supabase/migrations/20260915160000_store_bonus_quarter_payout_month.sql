-- 營運獎金:季發放月可自訂 + 季獎金掛進「發放月」薪資袋(方案a:獨立卡,不動正式薪資合計)
--   ① store_bonus_quarter_def 加 payout_month / payout_next_year(每季自訂發放月,預設 Q1→5 Q2→8 Q3→11 Q4→隔年2)
--   ② store_bonus_quarter_settlement 加 payout_year_month(結算時算出目標發放月)
--   ③ settle_store_bonus_quarter 算並寫入 payout_year_month
--   ④ liff_get_my_store_bonus 多回傳 quarters(依 payout_year_month 讓 LIFF 掛到該月薪資袋)

-- ① 季別定義:發放月
ALTER TABLE public.store_bonus_quarter_def
  ADD COLUMN IF NOT EXISTS payout_month int,
  ADD COLUMN IF NOT EXISTS payout_next_year boolean DEFAULT false;

UPDATE public.store_bonus_quarter_def SET
  payout_month = CASE quarter WHEN 'Q1' THEN 5 WHEN 'Q2' THEN 8 WHEN 'Q3' THEN 11 WHEN 'Q4' THEN 2 END,
  payout_next_year = (quarter = 'Q4')
WHERE payout_month IS NULL;

-- ② 結算快照:目標發放月
ALTER TABLE public.store_bonus_quarter_settlement
  ADD COLUMN IF NOT EXISTS payout_year_month text;

-- ③ 結算 RPC:算出發放月並寫入
CREATE OR REPLACE FUNCTION public.settle_store_bonus_quarter(p_store_id int, p_year int, p_quarter text, p_settler int)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_org int; v_months int[]; v_yms text[]; v_rows json; v_total numeric; v_draft int;
  v_pm int; v_pny boolean; v_payout_ym text;
BEGIN
  SELECT organization_id INTO v_org FROM public.stores WHERE id = p_store_id;
  IF v_org IS NULL OR NOT public._same_org_or_super(v_org) THEN
    RETURN json_build_object('ok', false, 'error', 'DENIED'); END IF;

  SELECT months, payout_month, payout_next_year INTO v_months, v_pm, v_pny
    FROM public.store_bonus_quarter_def WHERE organization_id = v_org AND quarter = p_quarter;
  IF v_months IS NULL THEN
    v_months := CASE p_quarter WHEN 'Q1' THEN '{1,2,3}' WHEN 'Q2' THEN '{4,5,6}'
                               WHEN 'Q3' THEN '{7,8,9}' ELSE '{10,11,12}' END; END IF;
  IF v_pm IS NULL THEN
    v_pm := CASE p_quarter WHEN 'Q1' THEN 5 WHEN 'Q2' THEN 8 WHEN 'Q3' THEN 11 ELSE 2 END;
    v_pny := (p_quarter = 'Q4'); END IF;
  v_payout_ym := (p_year + CASE WHEN v_pny THEN 1 ELSE 0 END)::text || '-' || lpad(v_pm::text,2,'0');

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

  INSERT INTO public.store_bonus_quarter_settlement (organization_id, store_id, year, quarter, months, total_amount, rows, payout_year_month, settled_at, settled_by)
  VALUES (v_org, p_store_id, p_year, p_quarter, v_months, v_total, v_rows, v_payout_ym, now(), p_settler)
  ON CONFLICT (store_id, year, quarter) DO UPDATE
    SET months = EXCLUDED.months, total_amount = EXCLUDED.total_amount, rows = EXCLUDED.rows,
        payout_year_month = EXCLUDED.payout_year_month, settled_at = now(), settled_by = EXCLUDED.settled_by;

  RETURN json_build_object('ok', true, 'total', v_total, 'draft_months', v_draft, 'payout_year_month', v_payout_ym, 'rows', v_rows);
END $fn$;

REVOKE ALL ON FUNCTION public.settle_store_bonus_quarter(int,int,text,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_store_bonus_quarter(int,int,text,int) TO authenticated;

-- ④ LIFF:多回傳 quarters(該員工的季結算,依 payout_year_month 掛月)
CREATE OR REPLACE FUNCTION public.liff_get_my_store_bonus(p_line_user_id text, p_limit integer DEFAULT 12)
 RETURNS json
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  RETURN json_build_object(
    'ok', true,
    'records', (
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.year_month DESC), '[]'::json)
      FROM (
        SELECT
          m.year_month            AS year_month,
          e.net_bonus             AS net_bonus,
          e.total_bonus           AS total_bonus,
          e.mgmt_bonus            AS mgmt_bonus,
          e.profit_bonus          AS profit_bonus,
          e.target_bonus          AS target_bonus,
          e.merit_bonus           AS merit_bonus,
          e.audit_deduction       AS audit_deduction,
          e.punch_deduction       AS punch_deduction,
          e.custom_adjust         AS custom_adjust,
          e.prev_month_supplement AS prev_month_supplement,
          e.notes                 AS notes
        FROM public.store_bonus_employee e
        JOIN public.store_bonus_monthly m ON m.id = e.monthly_id
        WHERE e.employee_id = emp.id AND m.status = 'finalized'
        ORDER BY m.year_month DESC
        LIMIT GREATEST(1, COALESCE(p_limit, 12))
      ) t
    ),
    'quarters', (
      SELECT COALESCE(json_agg(json_build_object(
        'year', s.year, 'quarter', s.quarter, 'months', s.months,
        'payout_year_month', s.payout_year_month,
        'months_count', (r.value->>'months')::int,
        'total_mgmt',   COALESCE((r.value->>'total_mgmt')::numeric,0),
        'total_target', COALESCE((r.value->>'total_target')::numeric,0),
        'total_merit',  COALESCE((r.value->>'total_merit')::numeric,0),
        'total_deduct', COALESCE((r.value->>'total_deduct')::numeric,0),
        'total_net',    COALESCE((r.value->>'total_net')::numeric,0)
      ) ORDER BY s.year DESC, s.quarter DESC), '[]'::json)
      FROM public.store_bonus_quarter_settlement s
      CROSS JOIN LATERAL jsonb_array_elements(s.rows) r
      WHERE s.organization_id = emp.organization_id
        AND (r.value->>'employee_id')::int = emp.id
    )
  );
END $function$;

NOTIFY pgrst, 'reload schema';
