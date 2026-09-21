-- ════════════════════════════════════════════════════════════════════════════
-- 新身分「儲備幹部」可排自己負責的門市
-- 2026-06-24
--
-- 排班權限原本只有 role=manager(店長/督導/資深店長)/admin 有。
-- 儲備幹部 role 維持 store_staff(跟門市人員一樣，不給滿手 manager 權限)，
-- 改用 position_permissions 對「職位=儲備幹部」單獨開排班權限：
--   nav.schedule.basic(看得到排班頁) + schedule.edit(能排/存) + schedule.algo(可用 AI 排班)
-- 能排哪些店 → 沿用 Schedule.jsx 既有邏輯(authProfile.store_id → 自己的門市)，
-- 所以儲備幹部自動只排自己的店；門市人員/兼職(職位不同)完全不受影響。
--
-- 冪等：ON CONFLICT DO NOTHING。用 permissions.code 查 id，不寫死。
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO public.position_permissions (organization_id, position, permission_id, note)
SELECT o.id, '儲備幹部', p.id, '儲備幹部可排自己門市的班 (2026-06-24)'
  FROM public.organizations o
  CROSS JOIN public.permissions p
 WHERE p.code IN ('nav.schedule.basic', 'schedule.edit', 'schedule.algo')
ON CONFLICT (organization_id, position, permission_id) DO NOTHING;
