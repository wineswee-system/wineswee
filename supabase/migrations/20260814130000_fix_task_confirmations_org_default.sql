-- 修:task_confirmations 缺 set_org_default trigger
-- 症狀:「確認審批」面板手動新增的確認單(createTaskConfirmation 不帶 organization_id)org 進 NULL。
--   task_confirmations 的 SELECT policy = (organization_id = current_employee_org() OR is_super_admin()),
--   org=NULL 時除了 super_admin 誰都 SELECT 不到該列。於是簽核人(admin 非 super)按通過:
--   UPDATE policy 允許 admin → 真的改成 approved,但 .update().select().single() 的 RETURNING
--   被 SELECT policy 擋回 0 列 → 前端 const {data} 拿到 null → if(!data) return 靜默 →
--   畫面停在「待審批」→ 再按一樣 → 一直循環。非 admin 開單者更慘:INSERT CHECK 直接擋(42501),
--   確認人根本加不進去(前端也是靜默吞掉)。
-- 修法:補回 set_org_default(BEFORE INSERT),與 approval_forms / approval_form_steps 一致,
--   讓新確認單自動帶開單者 org。並回填任何殘留 NULL org。

DROP TRIGGER IF EXISTS trg_set_org_default ON public.task_confirmations;
CREATE TRIGGER trg_set_org_default
  BEFORE INSERT ON public.task_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.set_org_default();

-- 回填殘留 NULL org(照該任務的 org),冪等
UPDATE public.task_confirmations tc
   SET organization_id = t.organization_id
  FROM public.tasks t
 WHERE t.id = tc.task_id
   AND tc.organization_id IS NULL
   AND t.organization_id IS NOT NULL;
