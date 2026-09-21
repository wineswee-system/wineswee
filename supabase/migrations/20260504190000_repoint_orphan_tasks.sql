-- =============================================
-- 修復重建後 22 個指向離職員工的 in-flight task
-- 全部是 workflow_instance_id=1 (新門市開店流程) 的子任務
--
-- 重新指派邏輯：
--   id=53 (學文, typo merged 入 153) → 153 楊學文 (12 個任務)
--   id=45 (Alicia, 真離職, 原財務部)  → 48  韓虎    ( 4 個財務相關)
--   id=54 (營運, 殭屍 row, 原營運部)  → 62  張庭瑋  ( 5 個營運相關)
--   id=49 (Ken, 真離職, 原門市)       → 153 楊學文  ( 1 個招牌安裝-總務)
-- =============================================

BEGIN;

-- 53 → 153
UPDATE tasks SET assignee_id = 153
WHERE assignee_id = 53 AND status IN ('待簽核','待處理');

-- 45 → 48 (財務任務改派給財務主管)
UPDATE tasks SET assignee_id = 48
WHERE assignee_id = 45 AND status IN ('待簽核','待處理');

-- 54 → 62 (營運任務改派給營運主管)
UPDATE tasks SET assignee_id = 62
WHERE assignee_id = 54 AND status IN ('待簽核','待處理');

-- 49 → 153 (招牌安裝由總務承接)
UPDATE tasks SET assignee_id = 153
WHERE assignee_id = 49 AND status IN ('待簽核','待處理');

-- 安全檢查：跑完後不該再有 task assignee 指向離職員工
DO $$
DECLARE
  bad INT;
BEGIN
  SELECT COUNT(*) INTO bad
  FROM tasks t JOIN employees e ON e.id = t.assignee_id
  WHERE t.status IN ('待簽核','待處理') AND e.status = '離職';
  IF bad > 0 THEN
    RAISE EXCEPTION '還有 % 個 task 指向離職員工', bad;
  END IF;
END $$;

COMMIT;
