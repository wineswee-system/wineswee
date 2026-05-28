"""
排班 Solver — 純手寫 backtracking + constraint propagation。

公開介面：
    from scheduler.solver import solve_schedule
    result = solve_schedule(input_dict)

模組職責：
- models   — 資料類型 (Employee, TimeSlot, Assignment, etc.)
- constraints — Hard rule 檢查函式 (H3 / H4 / 月休 / 跨月)
- solver   — Backtracking 主迴圈 + forward checking
- data     — Supabase 查詢 (production); local fixture (test)
- cli      — Local 執行入口
"""
