-- =============================================
-- 審計後續清理 — 2026-05-04
-- 1. 重指派 8 個非完成態 tasks 從離職員工到對應在職員工
-- 2. 刪除 5 個離職員工的 project_members（owner 之後可手動加回）
-- 3. employees 加 is_executive_board 旗標 + 標記韓虎/陳虹（取代 OrgChart 硬寫 id）
-- =============================================

BEGIN;

-- ── 1. 重指派 tasks (status NOT 已完成/取消) ──
-- 53 學文     → 153 楊學文 (typo merged)
-- 147 Vicky   → 62  張庭瑋 (twin merged)
-- 57  張啟達  → 152 張啟達 (twin merged)
-- 155 阿謙    → 72  楊家謙 (倉儲)
-- 154 花輪    → 72  楊家謙 (倉儲)

UPDATE tasks SET assignee_id = 153 WHERE assignee_id = 53
  AND status NOT IN ('已完成','已取消','cancelled','done','completed');
UPDATE tasks SET assignee_id = 62  WHERE assignee_id = 147
  AND status NOT IN ('已完成','已取消','cancelled','done','completed');
UPDATE tasks SET assignee_id = 152 WHERE assignee_id = 57
  AND status NOT IN ('已完成','已取消','cancelled','done','completed');
UPDATE tasks SET assignee_id = 72  WHERE assignee_id = 155
  AND status NOT IN ('已完成','已取消','cancelled','done','completed');
UPDATE tasks SET assignee_id = 72  WHERE assignee_id = 154
  AND status NOT IN ('已完成','已取消','cancelled','done','completed');

-- ── 2. 清離職 project_members ──
-- 重指派可能跟 unique(project_id, employee_id) 撞 → 直接刪，由 owner 重加
DELETE FROM project_members
WHERE employee_id IN (
  SELECT id FROM employees WHERE status = '離職'
);

-- ── 3. 加 is_executive_board 欄 + 標記兼任高管 ──
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS is_executive_board BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN employees.is_executive_board IS
  '兼任總經理室高管（在組織圖 apex 額外顯示）。';

UPDATE employees SET is_executive_board = true WHERE id IN (48, 52); -- 韓虎, 陳虹

-- 安全檢查
DO $$
DECLARE
  bad_tasks INT;
  bad_pm    INT;
  exec_count INT;
BEGIN
  SELECT COUNT(*) INTO bad_tasks
  FROM tasks t JOIN employees e ON e.id = t.assignee_id
  WHERE e.status = '離職'
    AND t.status NOT IN ('已完成','已取消','cancelled','done','completed');
  IF bad_tasks > 0 THEN
    RAISE EXCEPTION '還有 % 個 task 指向離職', bad_tasks;
  END IF;

  SELECT COUNT(*) INTO bad_pm
  FROM project_members pm JOIN employees e ON e.id = pm.employee_id
  WHERE e.status = '離職';
  IF bad_pm > 0 THEN
    RAISE EXCEPTION '還有 % 個 project_member 指向離職', bad_pm;
  END IF;

  SELECT COUNT(*) INTO exec_count FROM employees WHERE is_executive_board = true;
  IF exec_count <> 2 THEN
    RAISE EXCEPTION 'is_executive_board 標記數異常: %, 預期 2', exec_count;
  END IF;
END $$;

COMMIT;
