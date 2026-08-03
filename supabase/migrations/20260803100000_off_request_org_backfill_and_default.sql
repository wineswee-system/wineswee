-- 希望休(off_requests)org_id 回填 + 補掛 set_org_default trigger — 2026-08-03
-- ════════════════════════════════════════════════════════════════════════════
-- 症狀:web「希望休」清單顯示共 0 筆、只有 super_admin 看得到在飛的希望休單。
-- 根因:off_requests 有幾筆 organization_id = NULL(#283/#284/#285…)。
--   org_visible(NULL) 除 super_admin / service_role 外一律回 false(見函式:
--   `RETURN p_org IS NOT NULL AND p_org = current_user_org()`)→ RLS 把 null-org 的單
--   對所有一般 org 使用者擋掉 → 只有 super_admin(跨 org bypass)看得到。
--   而 off_requests 當初漏掛 set_org_default trigger(對齊其他 54 表),LIFF/歷史路徑
--   進來若沒帶 org 就留 null。
-- 修:①回填現有 null(優先取申請人 employees.organization_id,取不到退最小 org)
--     ②補掛 set_org_default(新列 org 為 null 時自動補)③順手回填 store 反正規化欄。
-- idempotent。不動任何簽核/通知邏輯。
-- ════════════════════════════════════════════════════════════════════════════

-- ① 回填 organization_id：先從申請人的員工 org 帶（多租戶正確）
UPDATE public.off_requests o
   SET organization_id = e.organization_id
  FROM public.employees e
 WHERE o.employee_id = e.id
   AND o.organization_id IS NULL
   AND e.organization_id IS NOT NULL;

-- 仍為 null（無 employee_id 對應）→ 退最小 org（單一 org 公司=1）
UPDATE public.off_requests
   SET organization_id = (SELECT MIN(id) FROM public.organizations)
 WHERE organization_id IS NULL;

-- ③ 順手回填 store 反正規化欄（顯示用，不影響可見性）
UPDATE public.off_requests o
   SET store = e.store
  FROM public.employees e
 WHERE o.employee_id = e.id
   AND o.store IS NULL
   AND e.store IS NOT NULL;

-- ② 補掛 set_org_default（BEFORE INSERT，新列 org 為 null 時自動補），對齊其他表
DROP TRIGGER IF EXISTS trg_set_org_default ON public.off_requests;
CREATE TRIGGER trg_set_org_default BEFORE INSERT ON public.off_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_org_default();

NOTIFY pgrst, 'reload schema';
