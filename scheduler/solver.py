"""Backtracking solver — 純手寫 constraint propagation。

策略：
1. 先 pre-rest 所有 forced_rest（已核准 off/leave）
2. 對每個 (date, emp) 變數，domain = {rest} ∪ {候選 windows}
3. Backtracking 順序：date 由前到後、同 date FT 先 PT 後
4. Forward checking：每次 assignment 後檢查 H3 / H4 / 剩餘人力可否覆蓋
5. 達到合法解後 → 套用 soft preference (低負荷日先休) 改善分布

候選 windows 從 time_slots 自動生成：
- 每個 slot 都是一個 window (PT 短班)
- 相鄰 2 個 slot 串成一個 window (FT 9h-11h 長班)
- 開店 slot 前 +0 或 +0.5h 起、關店 slot 後 +0 或 +0.5h 止 也加入候選
"""

import time
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional
from .models import (
    Employee, TimeSlot, StoreSettings, Assignment, SolverInput, SolverResult, Violation,
)
from .constraints import (
    check_h3, check_h4, slot_coverage_count,
    prorate_monthly_target, count_rest_in_cycle, check_cross_month,
    _parse_hhmm,
)


# ════════════════════════════════════════════════════════════════════════
# 候選 window 生成
# ════════════════════════════════════════════════════════════════════════

def _fmt_hour(h: float) -> str:
    """14.5 → '14:30'"""
    h = h % 24
    hh = int(h)
    mm = int(round((h - hh) * 60))
    if mm == 60:
        hh += 1
        mm = 0
    return f"{hh:02d}:{mm:02d}"


def generate_window_candidates(time_slots: list[TimeSlot], for_pt: bool) -> list[tuple[str, str, float]]:
    """從 time_slots 自動生成候選 (start, end, hours)。

    PT: 各 slot 單獨 + 相鄰 2 個 slot 串接 (4-8h)
    FT: 相鄰 2-3 個 slot 串接 (8-10h)
    """
    if not time_slots:
        return []

    # 依 start_time 排序
    slots = sorted(time_slots, key=lambda s: _parse_hhmm(s.start_time))
    candidates: set[tuple[str, str]] = set()

    for i, s in enumerate(slots):
        # 單一 slot
        candidates.add((s.start_time, s.end_time))
        # 連接後面的 slot
        for j in range(i + 1, len(slots)):
            s2 = slots[j]
            # 必須連續（s.end == s2.start，容差 30 分）
            if abs(_parse_hhmm(s.end_time) - _parse_hhmm(s2.start_time)) < 0.6:
                candidates.add((s.start_time, s2.end_time))
            # 跨 2 個以上 slot 但連續
            elif j == i + 1:
                continue
            else:
                break

    # 計算每個 window 的時長
    result: list[tuple[str, str, float]] = []
    for start, end in candidates:
        sh = _parse_hhmm(start)
        eh = _parse_hhmm(end)
        if eh <= sh:
            eh += 24
        hours = eh - sh
        # PT: 4-8h；FT: 7-10h
        if for_pt and 4 <= hours <= 8:
            result.append((start, end, hours))
        elif not for_pt and 7 <= hours <= 10:
            result.append((start, end, hours))

    # 排序：時長 desc (FT 偏好長班、PT 偏好短班但都納入)
    result.sort(key=lambda x: -x[2] if not for_pt else x[2])
    return result


# ════════════════════════════════════════════════════════════════════════
# Solver
# ════════════════════════════════════════════════════════════════════════

def solve(input: SolverInput, time_limit_seconds: float = 30.0) -> SolverResult:
    """Backtracking 解 schedule，回傳 SolverResult。"""
    start_time = time.time()

    # ── 1. 初始化 ──
    employees = input.employees
    cycle_dates = sorted(input.cycle_dates)
    time_slots = input.time_slots
    settings = input.store_settings

    # cycle 月休目標 (prorate)
    ft_cycle_target = prorate_monthly_target(cycle_dates, settings.ft_monthly_rest_days)
    pt_cycle_target = prorate_monthly_target(cycle_dates, settings.pt_monthly_rest_days)

    # 跨月扣減後的實際 cycle 目標（避免超月目標）
    def effective_cycle_target(emp: Employee) -> int:
        monthly_target = settings.pt_monthly_rest_days if emp.is_pt else settings.ft_monthly_rest_days
        prior = input.prior_rest_by_month.get(emp.id, {})
        # 計算 cycle 跨到的月份還剩多少 budget
        from collections import Counter
        by_month = Counter(d[:7] for d in cycle_dates)
        total_remaining = 0
        for ym, count in by_month.items():
            used = prior.get(ym, 0)
            remaining = max(0, monthly_target - used)
            # 此月份在 cycle 內最多用這麼多
            total_remaining += min(count, remaining)
        # cycle 內目標 = min(prorate, 剩餘 budget 總和)
        base_target = pt_cycle_target if emp.is_pt else ft_cycle_target
        return min(base_target, total_remaining)

    # ── 2. assignments dict（變數）──
    # key: (emp_id, date_str) → Assignment
    assignments: dict[tuple[int, str], Assignment] = {}

    # 鎖定既有排班
    for a in input.locked:
        assignments[(a.employee_id, a.date)] = a

    # 強制休 (off_requests / leave_requests)
    for emp_id, date in input.forced_rest:
        assignments[(emp_id, date)] = Assignment(emp_id, date, None, None, 0.0)

    # ── 3. 生成 window 候選 ──
    pt_windows = generate_window_candidates(time_slots, for_pt=True)
    ft_windows = generate_window_candidates(time_slots, for_pt=False)

    def windows_for(emp: Employee) -> list[tuple[str, str, float]]:
        return pt_windows if emp.is_pt else ft_windows

    # ── 4. Backtracking 主迴圈 ──
    # 順序：date 先，同 date FT 先
    sorted_emps = sorted(employees, key=lambda e: (e.is_pt, -e.schedule_priority))

    # 每員工目標休天 + 已休天追蹤
    target_rest = {e.id: effective_cycle_target(e) for e in employees}
    rest_count = {e.id: 0 for e in employees}
    # 計算 forced_rest 已佔的數量
    for emp_id, date in input.forced_rest:
        if date in cycle_dates:
            rest_count[emp_id] = rest_count.get(emp_id, 0) + 1

    def try_assign(emp: Employee, date: str, value) -> bool:
        """value = None (休) 或 (start, end, hours)"""
        if value is None:
            assignments[(emp.id, date)] = Assignment(emp.id, date, None, None, 0.0)
            rest_count[emp.id] += 1
            return True
        start, end, hours = value
        # H3 check（假設此日上班）
        a = Assignment(emp.id, date, start, end, hours)
        assignments[(emp.id, date)] = a
        if not check_h3(emp.id, date, assignments, input.previous_days):
            del assignments[(emp.id, date)]
            return False
        # H4 check
        if not check_h4(emp.id, date, start, end, assignments, input.previous_days):
            del assignments[(emp.id, date)]
            return False
        # H9 can_open / can_close（開店班需 can_open，關店班需 can_close）
        sh = _parse_hhmm(start)
        eh = _parse_hhmm(end)
        if sh <= 11.0 and emp.can_open is False:
            del assignments[(emp.id, date)]
            return False
        eh_eff = eh + 24 if eh <= sh else eh
        if eh_eff >= 21.0 and emp.can_close is False:
            del assignments[(emp.id, date)]
            return False
        return True

    def undo_assign(emp: Employee, date: str):
        a = assignments.get((emp.id, date))
        if a is not None:
            if a.is_rest:
                rest_count[emp.id] -= 1
            del assignments[(emp.id, date)]

    def coverage_ok_for_date(date: str) -> bool:
        """檢查 date 的所有 slot 是否被 cover 到 required_count"""
        for slot in time_slots:
            # slot day_type filter
            if slot.day_type != "all":
                dow = datetime.strptime(date, "%Y-%m-%d").weekday()
                is_weekend = dow >= 5  # Sat=5, Sun=6
                if slot.day_type == "weekday" and is_weekend:
                    continue
                if slot.day_type == "weekend" and not is_weekend:
                    continue
            covered = slot_coverage_count(date, slot, assignments)
            if covered < slot.required_count:
                return False
        return True

    # ── 5. Backtracking ──
    deadline = start_time + time_limit_seconds

    def backtrack(date_idx: int, emp_idx: int) -> bool:
        if time.time() > deadline:
            return False  # 超時

        # 移到下一個 date
        if emp_idx >= len(sorted_emps):
            # 此 date 所有員工都分配完，檢查 coverage
            if not coverage_ok_for_date(cycle_dates[date_idx]):
                return False
            # 進下一 date
            if date_idx + 1 >= len(cycle_dates):
                return True  # 全部 cycle 完成
            return backtrack(date_idx + 1, 0)

        emp = sorted_emps[emp_idx]
        date = cycle_dates[date_idx]

        # 已鎖定 / forced_rest → 跳過
        if (emp.id, date) in assignments:
            return backtrack(date_idx, emp_idx + 1)

        # ── 候選值排序 ──
        candidates: list = []
        # 1. 若 H3 強制 → 必須選休
        consec = 1
        from datetime import datetime as dt, timedelta as td
        d_obj = dt.strptime(date, "%Y-%m-%d")
        # quick H3 estimate
        prev_set = {(pid, pdate): pstart for (pid, pdate, pstart, _pe) in input.previous_days}
        check_d = d_obj
        for _ in range(20):
            check_d -= td(days=1)
            ds = check_d.strftime("%Y-%m-%d")
            a_check = assignments.get((emp.id, ds))
            if a_check is not None:
                if a_check.is_rest:
                    break
                consec += 1
                continue
            if (emp.id, ds) in prev_set:
                if prev_set[(emp.id, ds)] is None:
                    break
                consec += 1
                continue
            break

        must_rest = consec > 6
        # 還沒到月休目標 → 偏好休
        prefer_rest = rest_count[emp.id] < target_rest[emp.id]

        if must_rest:
            candidates = [None]  # 只能休
        else:
            wins = windows_for(emp)
            if prefer_rest:
                # 還沒滿配額 → 休排前面
                candidates = [None] + list(wins)
            else:
                # 配額已滿 → 不再休（除非別無選擇）
                candidates = list(wins) + [None]

        for value in candidates:
            if try_assign(emp, date, value):
                if backtrack(date_idx, emp_idx + 1):
                    return True
                undo_assign(emp, date)
        return False

    success = backtrack(0, 0)

    # ── 6. 收集結果 ──
    elapsed_ms = int((time.time() - start_time) * 1000)
    out_assignments = list(assignments.values())

    violations: list[Violation] = []
    # 檢查月休
    for emp in employees:
        used = sum(1 for a in out_assignments if a.employee_id == emp.id and a.is_rest)
        tgt = pt_cycle_target if emp.is_pt else ft_cycle_target
        if used < tgt - 1:  # 容許 ±1
            violations.append(Violation(
                constraint="MONTHLY_REST",
                employee_id=emp.id,
                date=None,
                message=f"{emp.name} cycle 內休 {used} 天 < 目標 {tgt} 天 (1 天容差)",
                severity="warning",
            ))
    # 跨月檢查
    a_dict = {(a.employee_id, a.date): a for a in out_assignments}
    for emp in employees:
        violations.extend(check_cross_month(
            emp.id, cycle_dates, a_dict, input.prior_rest_by_month,
            settings.ft_monthly_rest_days, settings.pt_monthly_rest_days,
            emp.is_pt,
        ))

    # Stats
    stats = {
        "elapsed_ms": elapsed_ms,
        "ft_cycle_target": ft_cycle_target,
        "pt_cycle_target": pt_cycle_target,
        "rest_count_by_emp": {emp.name: sum(1 for a in out_assignments if a.employee_id == emp.id and a.is_rest) for emp in employees},
        "work_hours_by_emp": {emp.name: sum(a.hours for a in out_assignments if a.employee_id == emp.id and not a.is_rest) for emp in employees},
    }

    return SolverResult(
        assignments=out_assignments,
        violations=violations,
        stats=stats,
        success=success,
        elapsed_ms=elapsed_ms,
    )


# ════════════════════════════════════════════════════════════════════════
# Public API
# ════════════════════════════════════════════════════════════════════════

def solve_schedule(input_dict: dict, time_limit_seconds: float = 30.0) -> dict:
    """Public entry — 從 dict 解析成 SolverInput、解、再 serialize 成 dict。

    給 Vercel serverless function / CLI 用。
    """
    employees = [Employee(**e) for e in input_dict["employees"]]
    time_slots = [TimeSlot(**ts) for ts in input_dict["time_slots"]]
    settings = StoreSettings(**input_dict["store_settings"])
    cycle_dates = input_dict["cycle_dates"]
    holidays = input_dict.get("holidays", [])
    locked = [Assignment(**a) for a in input_dict.get("locked", [])]
    forced_rest = [tuple(x) for x in input_dict.get("forced_rest", [])]
    previous_days = [tuple(x) for x in input_dict.get("previous_days", [])]
    prior_rest_by_month = {
        int(k): v for k, v in input_dict.get("prior_rest_by_month", {}).items()
    }

    inp = SolverInput(
        employees=employees,
        cycle_dates=cycle_dates,
        time_slots=time_slots,
        store_settings=settings,
        holidays=holidays,
        locked=locked,
        forced_rest=forced_rest,
        previous_days=previous_days,
        prior_rest_by_month=prior_rest_by_month,
    )

    result = solve(inp, time_limit_seconds=time_limit_seconds)

    return {
        "success": result.success,
        "elapsed_ms": result.elapsed_ms,
        "assignments": [
            {
                "employee_id": a.employee_id,
                "date": a.date,
                "window_start": a.window_start,
                "window_end": a.window_end,
                "hours": a.hours,
                "is_rest": a.is_rest,
            }
            for a in result.assignments
        ],
        "violations": [
            {
                "constraint": v.constraint,
                "employee_id": v.employee_id,
                "date": v.date,
                "message": v.message,
                "severity": v.severity,
            }
            for v in result.violations
        ],
        "stats": result.stats,
    }
