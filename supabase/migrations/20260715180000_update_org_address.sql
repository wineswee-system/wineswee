-- 更新公司地址 — 2026-07-15
-- 威耀時代(org 1)地址改為:104 台北市中山區松江路54號7樓之1
-- 影響:在職/離職證明、簽呈 PDF 等所有讀 organizations.address 的地方。idempotent。

UPDATE public.organizations
   SET address = '104 台北市中山區松江路54號7樓之1'
 WHERE id = 1;

NOTIFY pgrst, 'reload schema';
