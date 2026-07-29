-- 儲備幹部可排班授權:補給所有租戶(不只 org1)— 2026-07-29
-- ════════════════════════════════════════════════════════════════════════════
-- 病灶:position_permissions 綁 organization_id,而「儲備幹部→schedule.edit(13)/algo(14)/
--   nav.schedule.basic(53)」只 seed 給 org1(2026-06-24)。org2「展示範例公司(Demo)」的
--   儲備幹部(許慧君#454)拿不到 schedule.edit → 前端不讓排、RLS 也不放行。
--   系統要多租戶販售,每個 org 的儲備幹部都該預設能排自己門市班表。
-- permissions 是全域(organization_id=null),13/14/53 各 org 通用 → 直接對每個 org 補 position 授權。
-- 做法:對「所有 organization × {13,14,53}」補 position_permissions,WHERE NOT EXISTS → idempotent。
--   套所有 org(即使該 org 目前沒儲備幹部也無妨:授權掛在職位字串上,之後聘了自動生效,
--   符合「可販售範本」的預設)。
-- ⚠️ 只補「現有」org。未來新建 org 的預設授權要靠開租戶的 provisioning seed 帶(另議)。
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO public.position_permissions (organization_id, position, permission_id, note)
SELECT o.id, '儲備幹部', p.pid,
       '儲備幹部可排自己門市的班 (多租戶補齊 2026-07-29)'
  FROM public.organizations o
  CROSS JOIN (VALUES (13), (14), (53)) AS p(pid)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.position_permissions pp
    WHERE pp.organization_id = o.id
      AND pp.position = '儲備幹部'
      AND pp.permission_id = p.pid
 );

NOTIFY pgrst, 'reload schema';
