-- 排班權限精修 2026-07-02
-- 背景：排班畫面 gate 由「manager 角色自動給」改為吃權限碼（前端 Schedule.jsx 同步改）。
--   perm id：schedule.view_all=12(可排全部門市) / schedule.edit=13(可排班) / schedule.algo=14(AI排班)
--   manager 角色 role_permissions 預設已帶 edit+algo，故正常店長/督導不受影響；
--   要「不排班」用 employee_permissions=revoke 個別關掉（revoke 優先權最高，蓋過角色）。
--
-- 需求：
--   1) 6 位職能部門主管 → 不參與門市排班：revoke schedule.edit/algo
--        陳家瑋#424(品牌)、林巧玉#60(加盟)、侯承寯#415(餐飲)、羅紹輝#210(營運督導)、
--        詹健如#145(採購)、劉雅玲#68(稽核)
--   2) 儲備幹部 → 可排自己門市：position_permissions 對職位授權 schedule.edit/algo
--        （未來新進儲備幹部自動有；門市範圍=自己店，由前端 scope 邏輯內建）
--   3) 營運部經理 張庭瑋#62 → 可排全部門市：grant schedule.view_all
--   4) 清掉 呂柏毅#130(儲備幹部) 誤掛的 schedule.view_all
--        （現行前端沒讀 view_all 所以原本無害，但前端改版後 scope 會吃它 → 否則他會排到全部門市）
--
-- idempotent（可重跑）。

BEGIN;

-- ── 1) 6 職能主管 revoke edit(13)+algo(14) ──
DELETE FROM public.employee_permissions
 WHERE employee_id IN (424, 60, 415, 210, 145, 68)
   AND permission_id IN (13, 14);

INSERT INTO public.employee_permissions (employee_id, permission_id, mode, reason)
VALUES
  (424, 13, 'revoke', '職能部門主管，不參與門市排班（2026-07-02）'),
  (424, 14, 'revoke', '職能部門主管，不參與門市排班（2026-07-02）'),
  (60,  13, 'revoke', '職能部門主管，不參與門市排班（2026-07-02）'),
  (60,  14, 'revoke', '職能部門主管，不參與門市排班（2026-07-02）'),
  (415, 13, 'revoke', '職能部門主管，不參與門市排班（2026-07-02）'),
  (415, 14, 'revoke', '職能部門主管，不參與門市排班（2026-07-02）'),
  (210, 13, 'revoke', '職能部門主管，不參與門市排班（2026-07-02）'),
  (210, 14, 'revoke', '職能部門主管，不參與門市排班（2026-07-02）'),
  (145, 13, 'revoke', '職能部門主管，不參與門市排班（2026-07-02）'),
  (145, 14, 'revoke', '職能部門主管，不參與門市排班（2026-07-02）'),
  (68,  13, 'revoke', '職能部門主管，不參與門市排班（2026-07-02）'),
  (68,  14, 'revoke', '職能部門主管，不參與門市排班（2026-07-02）');

-- ── 2) 儲備幹部 職位授權 edit(13)+algo(14)，org=1 ──
INSERT INTO public.position_permissions (organization_id, position, permission_id, note)
VALUES
  (1, '儲備幹部', 13, '儲備幹部可排自己門市班（2026-07-02）'),
  (1, '儲備幹部', 14, '儲備幹部可排自己門市班（2026-07-02）')
ON CONFLICT (organization_id, position, permission_id) DO NOTHING;

-- ── 3) 張庭瑋#62 grant view_all(12) ──
DELETE FROM public.employee_permissions WHERE employee_id = 62 AND permission_id = 12;
INSERT INTO public.employee_permissions (employee_id, permission_id, mode, reason)
VALUES (62, 12, 'grant', '營運部經理，可排全部門市（2026-07-02）');

-- ── 4) 清掉 呂柏毅#130 誤掛的 view_all(12)（儲備幹部只排自己店，不該全店） ──
DELETE FROM public.employee_permissions WHERE employee_id = 130 AND permission_id = 12;

COMMIT;
