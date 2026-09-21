-- ════════════════════════════════════════════════════════════════════════════
-- 資安：移除「未登入 anon 可存取」的孤兒 policy（drift 漏回來的）
--
-- 背景：20260424200000 曾大批鎖掉 anon RLS，但後續 migration（4/26、5/19…）
--   又把部分 anon policy 加回來，且新建的表沒被涵蓋 → live DB 仍有 anon 全開。
--
-- 本檔只 DROP「LIFF 完全沒在直接查、主系統走 authenticated」的 4 張表的
-- anon policy（已驗證 LIFF src/ 0 處查詢）→ 零風險。
--
-- 仍保留待處理（LIFF 有直接查，要先改走 SECURITY DEFINER RPC 再 DROP）：
--   expense_request_attachments.anon_expense_req_att
--   approval_extra_steps.approval_extra_steps_anon_read
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS anon_projects         ON public.projects;
DROP POLICY IF EXISTS anon_project_members  ON public.project_members;
DROP POLICY IF EXISTS anon_project_sections ON public.project_sections;
DROP POLICY IF EXISTS anon_task_attachments ON public.task_attachments;

-- 同步撤掉 anon 對這些表的直接 grant（policy 沒了，grant 也該收）
REVOKE ALL ON public.projects         FROM anon;
REVOKE ALL ON public.project_members  FROM anon;
REVOKE ALL ON public.project_sections FROM anon;
REVOKE ALL ON public.task_attachments FROM anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
