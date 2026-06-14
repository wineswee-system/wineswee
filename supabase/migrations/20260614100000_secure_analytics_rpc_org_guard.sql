-- ════════════════════════════════════════════════════════════════════════════
-- 資安修補：分析類 SECURITY DEFINER RPC 跨租戶外洩
--
-- 問題（已驗證）：11 支 fn_*_analytics / fn_dashboard_overview / fn_compute_alerts
--   / fn_attrition_impact 都：
--     - 收 p_org_id 參數
--     - 函式內 0 個 org 驗證
--     - GRANT 給 anon
--   → 任何人（含未登入 anon）傳別家公司的 org_id 就能看該公司營收/財務/HR 數據。
--   多公司客戶上線後 = 跨租戶資料外洩。
--
-- 修法（不改 267 行本體，避免改壞）：
--   1. 把實際函式 rename 成 _impl
--   2. 用原名建「薄 guard wrapper」：p_org_id 必須等於 current_employee_org()，否則拒絕
--   3. REVOKE anon（這些是 Web 登入頁在用，anon 本來就多餘）；wrapper 只給 authenticated
--   4. _impl 只由 wrapper（SECURITY DEFINER 同 owner）呼叫，撤掉 anon/authenticated
--
-- guard 安全性：正常登入用戶傳自己 org → 通過；攻擊者傳別家 org → 擋；
--   anon → current_employee_org()=NULL → 擋（且已 REVOKE anon）。
-- idempotent：重跑只會確保 _impl 存在 + wrapper 為最新；不會雙重 rename。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $do$
DECLARE
  fn  TEXT;
  fns TEXT[] := ARRAY[
    'fn_dashboard_overview', 'fn_compute_alerts', 'fn_attrition_impact',
    'fn_crm_analytics', 'fn_finance_analytics', 'fn_hr_analytics',
    'fn_inventory_analytics', 'fn_manufacturing_analytics', 'fn_pos_analytics',
    'fn_process_analytics', 'fn_sales_analytics'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    -- 只處理存在的函式（避免某支沒建就報錯）
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN (fn, fn || '_impl')
    );

    -- 1. rename 實作 → _impl（若還沒 rename 過）
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname='public' AND p.proname = fn)
       AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                       WHERE n.nspname='public' AND p.proname = fn || '_impl') THEN
      EXECUTE format('ALTER FUNCTION public.%I(int, date) RENAME TO %I', fn, fn || '_impl');
    END IF;

    -- 2. 用原名建 guard wrapper
    EXECUTE format(
      'CREATE OR REPLACE FUNCTION public.%I(p_org_id int, p_today date DEFAULT CURRENT_DATE) '
      'RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS '
      '$fn$ BEGIN '
      'IF p_org_id IS NULL OR p_org_id IS DISTINCT FROM public.current_employee_org() THEN '
      'RAISE EXCEPTION ''FORBIDDEN: 不可存取其他組織資料'' USING ERRCODE = ''42501''; END IF; '
      'RETURN public.%I(p_org_id, p_today); END $fn$',
      fn, fn || '_impl');

    -- 3. 權限：wrapper 只給 authenticated；anon 全撤
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(int, date) FROM anon', fn);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION public.%I(int, date) TO authenticated', fn);
    -- _impl 只由 wrapper 呼叫，不對外
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(int, date) FROM anon', fn || '_impl');
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(int, date) FROM authenticated', fn || '_impl');
  END LOOP;
END $do$;

COMMIT;

NOTIFY pgrst, 'reload schema';
