-- ════════════════════════════════════════════════════════════════════════════
-- 撤掉 analytics 函式的 anon EXECUTE：防公開 anon key 撈全公司分析資料
-- 2026-06-18
--
-- 慘況：fn_*_analytics / fn_dashboard_overview / fn_compute_alerts / fn_attrition_impact
--   是 SECURITY DEFINER(繞 RLS)+ 給 anon + 內部沒驗證呼叫者、也沒用 p_org_id 過濾
--   → 任何人拿公開 anon key 就能呼叫，撈到財務/HR/銷售/庫存…全公司分析(帳齡/現金流/
--   前幾大欠款/離職風險…)。security_health_check 🟡「確認內部有 org guard」= 沒有。
--
-- 修法：撤 anon EXECUTE(只留 authenticated)。主系統儀表板都是登入者呼叫(用 profile
--   session)、LIFF 沒用這些 → 撤掉零功能影響。用 DO block 動態抓簽名,涵蓋所有多載。
--
-- 註(另案)：這些函式本身忽略 p_org_id、讀全部資料 → 多租戶時即使 authenticated 也會跨組看；
--   要徹底修需重寫 11 支大函式加 org 過濾(風險高,另開)。本支先關掉最致命的「anon 公開」。
--
-- idempotent：REVOKE 可重複執行。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'fn_dashboard_overview','fn_compute_alerts','fn_attrition_impact',
         'fn_crm_analytics','fn_finance_analytics','fn_hr_analytics','fn_inventory_analytics',
         'fn_manufacturing_analytics','fn_pos_analytics','fn_process_analytics','fn_sales_analytics'
       )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon', r.proname, r.args);
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
