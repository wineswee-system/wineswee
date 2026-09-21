-- Rename task status '待處理' → '待簽核' to reflect approval-pending semantics
UPDATE tasks SET status = '待簽核' WHERE status = '待處理';