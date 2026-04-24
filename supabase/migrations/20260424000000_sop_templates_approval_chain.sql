-- ============================================================
-- sop_templates 加 approval_chain_id 欄位
--
-- 背景：CreateTemplateModal.jsx 的 UI 有「流程完成後的簽核鏈」
-- 下拉選單，Workflows.jsx 的 handleCreateTpl insert 也帶了
-- approval_chain_id 欄位，但表根本沒這個欄位 → 400 error。
-- ============================================================

ALTER TABLE public.sop_templates
  ADD COLUMN IF NOT EXISTS approval_chain_id INT
  REFERENCES public.approval_chains(id) ON DELETE SET NULL;
