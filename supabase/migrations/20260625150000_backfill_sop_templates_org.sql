-- ════════════════════════════════════════════════════════════════════════════
-- 回填:流程範本(sop_templates)缺 organization_id → 同組其他人看不到
-- 2026-06-25
--
-- 前端新增/AI 生成範本時漏帶 organization_id,造成 org-scoped RLS 下別人看不到。
-- 前端已修(補 organization_id);這支把現有 NULL 的補成預設 org(單一組織 = org 1)。
-- idempotent:只動 organization_id IS NULL 的。
-- ════════════════════════════════════════════════════════════════════════════

UPDATE public.sop_templates
   SET organization_id = (SELECT MIN(id) FROM public.organizations)
 WHERE organization_id IS NULL;
