-- 重新開放羅紹輝(emp 210)的排班權 — 2026-07-07
-- 背景：2026-07-06 那批「職能部門主管不參與門市排班」把羅紹輝的 schedule.edit / schedule.algo
--       revoke 掉了。現決定重新開放他(督導、所屬威耀總部)參與排班。
-- 作法：移除他這兩個 permission 的 revoke override → 恢復 manager 角色預設(本帶 edit/algo)。
--       只動 employee_id=210 一人，不影響同批其他 5 人。idempotent(刪過再跑刪 0 筆)。
-- 生效：羅紹輝需重新登入(前端會重抓 effective permissions)。開放後他能排「所屬門市=威耀總部」的班。

DELETE FROM public.employee_permissions
 WHERE employee_id = 210
   AND permission_id IN (13, 14)   -- 13=schedule.edit, 14=schedule.algo
   AND mode = 'revoke';
