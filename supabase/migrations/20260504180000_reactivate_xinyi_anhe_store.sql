-- =============================================
-- 重啟信義安和 (準備開的分店)
-- - id=18 原本叫「13台北信義安和」, is_active=false
-- - 改名「信義安和」, is_active=true, 隸屬營運部
-- - section_id / manager_id 暫不指定（之後 UI 上分配）
-- =============================================

UPDATE stores SET
  is_active = true,
  name = '信義安和',
  department_id = 23
WHERE id = 18;
