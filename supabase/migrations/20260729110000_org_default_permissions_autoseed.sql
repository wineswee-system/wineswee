-- 新租戶預設權限自動 seed:開 org 就自動帶「儲備幹部可排班」等預設 — 2026-07-29
-- ════════════════════════════════════════════════════════════════════════════
-- 背景:權限骨架中,唯一綁 organization_id 的是 position_permissions(其餘 role_permissions /
--   permission_nav_cascade / department_permissions / employee_permissions 皆全域,自動共用)。
--   前一支(20260729100000)已把「儲備幹部→schedule.edit(13)/algo(14)/nav.schedule.basic(53)」
--   補給現有所有 org(含 org2)。但那是一次性 backfill,未來新開的 org(3,4,5…)不會自動有。
-- 需求:每個租戶(現在 + 以後)都要有這組預設權限。
-- 做法:organizations AFTER INSERT trigger → 自動 seed 預設 position_permissions。
--   集中一支 seeder,以後要加別的「開租戶預設權限」只改這裡即可。idempotent(NOT EXISTS)。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._seed_org_default_permissions(p_org_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- 預設:儲備幹部可排自己門市的班(schedule.edit=13 / schedule.algo=14 / nav.schedule.basic=53)
  INSERT INTO public.position_permissions (organization_id, position, permission_id, note)
  SELECT p_org_id, '儲備幹部', p.pid, '儲備幹部可排自己門市的班 (新租戶預設)'
    FROM (VALUES (13), (14), (53)) AS p(pid)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.position_permissions pp
      WHERE pp.organization_id = p_org_id
        AND pp.position = '儲備幹部'
        AND pp.permission_id = p.pid
   );
  -- 之後若有其他「開租戶預設權限」,往下加即可(集中此處)。
END $function$;

GRANT EXECUTE ON FUNCTION public._seed_org_default_permissions(integer) TO service_role;

CREATE OR REPLACE FUNCTION public._trg_seed_org_default_permissions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._seed_org_default_permissions(NEW.id);
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_seed_org_default_permissions ON public.organizations;
CREATE TRIGGER trg_seed_org_default_permissions
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public._trg_seed_org_default_permissions();

-- 保險:對現有所有 org 再跑一次 seeder(idempotent;涵蓋 org1/2 及任何已存在的)
DO $do$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.organizations LOOP
    PERFORM public._seed_org_default_permissions(r.id);
  END LOOP;
END $do$;

NOTIFY pgrst, 'reload schema';
