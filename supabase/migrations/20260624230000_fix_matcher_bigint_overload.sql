-- ════════════════════════════════════════════════════════════════════════════
-- 修復：LIFF 簽核中心對所有人(含 admin/super_admin)顯示「你的角色沒有權限審核此類單據」
-- 2026-06-24
--
-- 根因：代簽 migration(20260624190000)把 _employee_matches_chain_step 重建為
--       p_emp_id INTEGER，但 employees.id 是 BIGINT。
--       liff_list_pending_approvals 用 emp.id(bigint)呼叫此函式 →
--       「function _employee_matches_chain_step(bigint, integer, integer, boolean)
--        does not exist」→ 整支 RPC throw →
--       前端 data.can 退回預設 {hr:false, finance:false} → 人事/經費全鎖。
--       （排班/任務/異動/自訂表單 groupEnabled 恆 true 所以沒鎖，只是抓不到資料。）
--
-- 修法：純加一個 p_emp_id BIGINT 的 overload，cast 後委派給既有 integer 版。
--       - 不 DROP、不改代簽那支 integer 函式 → 零依賴風險(避免撞 RLS policy 等)。
--       - integer 呼叫者(web/HR)走 exact match 仍命中原 integer 版，不受影響。
--       - bigint 呼叫者(liff emp.id)命中此 overload → 修好。
-- 冪等：CREATE OR REPLACE。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._employee_matches_chain_step(
  p_emp_id            BIGINT,
  p_step_id           INTEGER,
  p_applicant_emp_id  INTEGER DEFAULT NULL,
  p_via_delegation    BOOLEAN DEFAULT FALSE
) RETURNS BOOLEAN
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
  SELECT public._employee_matches_chain_step(
    p_emp_id::integer, p_step_id, p_applicant_emp_id, p_via_delegation
  );
$function$;

GRANT EXECUTE ON FUNCTION public._employee_matches_chain_step(BIGINT, INTEGER, INTEGER, BOOLEAN)
  TO authenticated, anon;
