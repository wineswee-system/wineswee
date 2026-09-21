-- LIFF 薪資查詢明細 RPC:員工在 LIFF 看到跟 web 一致的完整薪資明細 — 2026-08-06
-- ════════════════════════════════════════════════════════════════════════════
-- 背景:LIFF 薪資查詢原本吃 payroll_records(缺早退/微調)+ salary_records 簡版兩源打架,
--   完整度落後 web。改為單一來源=web 同一套引擎 _compute_payroll_for_employee,
--   員工手機看到的明細=HR 看到的(底薪/加班逐筆/津貼/資遣/微調 … 勞健保/早退/曠職/遲到/請假逐筆)。
-- 設計:
--   - 只回「已發布」月份(salary_records.published_at 非空)——薪資袋是定版,不外洩草稿。
--   - detail = 引擎現算(正常情況=發布版);實領以 published_net(salary_records.net_salary)為準,
--     前端明細若跟發布額有零頭差,用「其他」殘差吸收(對齊 web 做法)。
--   - adjustments = 該筆逐筆微調(補發/加項/扣款),前端疊進加項/扣款欄。
--   - 身分安全:_liff_resolve_employee 由 line_user_id 綁定,只回本人;PIN 是前端 UX 鎖非安全邊界(同既有)。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.liff_get_my_salary_detail(p_line_user_id text, p_period text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  emp      public.employees;
  v_rec    public.salary_records;
  v_detail json;
  v_adjs   json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 只給已發布月份(薪資袋=定版;salary_records 為員工可見來源,靠 published_at 閘門)
  SELECT * INTO v_rec FROM public.salary_records
   WHERE (employee_id = emp.id OR employee = emp.name)
     AND month = p_period
     AND published_at IS NOT NULL
   ORDER BY id DESC LIMIT 1;
  IF v_rec.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_PUBLISHED');
  END IF;

  -- 引擎完整明細(與 web SalaryTable 同源)
  v_detail := public._compute_payroll_for_employee(emp.id, p_period);

  -- 該月逐筆微調(補發/加項/扣款)
  SELECT COALESCE(json_agg(json_build_object(
           'source_type', source_type,
           'amount',      (new_value->>'amount')::numeric,
           'label',       new_value->>'label')), '[]'::json)
    INTO v_adjs
    FROM public.salary_adjustments
   WHERE salary_record_id = v_rec.id
     AND source_type IN ('manual_bonus','manual_backpay','manual_deduction')
     AND superseded_at IS NULL;

  RETURN json_build_object(
    'ok',            true,
    'period',        p_period,
    'detail',        v_detail,       -- 引擎現算完整明細
    'adjustments',   v_adjs,         -- 逐筆微調
    'published_net', v_rec.net_salary,  -- ★ 實領以發布版為準(定額不浮動)
    'published_at',  v_rec.published_at
  );
END $function$;

REVOKE ALL ON FUNCTION public.liff_get_my_salary_detail(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.liff_get_my_salary_detail(text, text) TO anon, authenticated;
