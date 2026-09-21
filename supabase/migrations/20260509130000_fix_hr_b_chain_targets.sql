-- ════════════════════════════════════════════════════════════
-- M5: 修 HR B 類三條多關 chain 的 target_type
--
-- chains 12 (離職), 13 (留停), 14 (異動) 三步驟原本 target_type 全是
-- applicant_dept_manager → 三關都解到同一個人（申請人直屬主管），多關
-- 等於一關。修正為：
--   step 0 (直屬主管):   applicant_dept_manager           （不動，已對）
--   step 1 (HR 確認):    specific_dept_manager + dept=26 （人力資源部主管）
--   step 2 (執行長核准): fixed_emp + emp=52              （陳虹 總經理(執行長)）
--
-- 只動 organization_id=1 的 chain（live DB 目前只有這一家）。
-- 若有其他 org 加入後跑這個 migration 不會炸（用 chain id 鎖定）。
-- ════════════════════════════════════════════════════════════

BEGIN;

-- HR 確認 (step 1): specific_dept_manager → dept_id=26 (人力資源部)
UPDATE public.approval_chain_steps
   SET target_type = 'specific_dept_manager',
       target_dept_id = 26,
       target_emp_id = NULL,
       target_role_id = NULL,
       target_store_id = NULL,
       target_section_id = NULL
 WHERE chain_id IN (12, 13, 14)
   AND step_order = 1;

-- 執行長核准 (step 2): fixed_emp → emp_id=52 (陳虹)
UPDATE public.approval_chain_steps
   SET target_type = 'fixed_emp',
       target_emp_id = 52,
       target_dept_id = NULL,
       target_role_id = NULL,
       target_store_id = NULL,
       target_section_id = NULL
 WHERE chain_id IN (12, 13, 14)
   AND step_order = 2;

COMMIT;

NOTIFY pgrst, 'reload schema';
