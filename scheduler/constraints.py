"""Hard rule 檢查 — 全部回傳 bool / list[Violation]。

設計原則：
- 每個 check 函式獨立、純函式（input → output，無 side effect）
- check_can_assign 用於 solver 嘗試 assignment 時的 forward checking
- validate_full 用於最終結果驗證

所有規則：
  H3: 連續上班 ≤6 天 (勞基法 §36)
  H4: 換班間隔 ≥11h (勞基法 §34)
  COVERAGE: 每時段最低人力滿足
  MONTHLY_REST: 每員工 cycle 內休天數達月目標 (FT 10 / PT 15 prorate)
  CROSS_MONTH_REST: prior + cycle 加總 ≤ 月目標
"""

from datetime import datetime, timedelta
from .models import Employee, TimeSlot, Assignment, SolverInput, Violation


MAX_CONSECUTIVE_WORK_DAYS = 6        # H3: 七休一
MIN_SHIFT_INTERVAL_HOURS = 11.0      # H4: 換班間隔


def _parse_hhmm(t: str) -> float:
    """'HH:MM' → 小時 float。'14:30' → 14.5"""
    h, m = t.split(":")
    return int(h) + int(m) / 60.0


def _date_str_to_obj(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%d")


def _ymd(d: datetime) -> str:
    return d.strftime("%Y-%m-%d")


# ════════════════════════════════════════════════════════════════════════
# H3：連續上班 ≤6 天
# ════════════════════════════════════════════════════════════════════════

def consecutive_work_days(
    emp_id: int,
    date: str,
    assignments: dict[tuple[int, str], Assignment],
    previous_days: list[tuple[int, str, str | None, str | None]],
) -> int:
    """假設 emp 在 date 上班，往回算連續工作天數（含 date）。

    來源：本 cycle assignments（dict[(emp_id, date_str)]）+ previous_days history
    遇到「休」或「無紀錄」即 break。
    """
    count = 1
    d = _date_str_to_obj(date)
    prev_set = {(pid, pdate): pstart for (pid, pdate, pstart, _pend) in previous_days}

    for _ in range(20):  # 最多回看 20 天
        d -= timedelta(days=1)
        ds = _ymd(d)
        # 先看本 cycle assignments
        a = assignments.get((emp_id, ds))
        if a is not None:
            if a.is_rest:
                break  # 已排休
            count += 1
            continue
        # 再看 previous_days
        if (emp_id, ds) in prev_set:
            ps = prev_set[(emp_id, ds)]
            if ps is None:
                break  # 上 cycle 該日休
            count += 1
            continue
        # 無紀錄 → break
        break
    return count


def check_h3(
    emp_id: int,
    date: str,
    assignments: dict[tuple[int, str], Assignment],
    previous_days: list[tuple[int, str, str | None, str | None]],
) -> bool:
    """True = 在 date 上班不會違反 H3"""
    return consecutive_work_days(emp_id, date, assignments, previous_days) <= MAX_CONSECUTIVE_WORK_DAYS


# ════════════════════════════════════════════════════════════════════════
# H4：換班間隔 ≥11h
# ════════════════════════════════════════════════════════════════════════

def check_h4(
    emp_id: int,
    date: str,
    new_start: str,
    new_end: str,
    assignments: dict[tuple[int, str], Assignment],
    previous_days: list[tuple[int, str, str | None, str | None]],
) -> bool:
    """True = 在 date 上 new_start~new_end 班不會違反 H4。

    H4: 前一天結束 ↔ 今天開始 ≥11h；今天結束 ↔ 明天開始 ≥11h
    """
    d = _date_str_to_obj(date)
    new_start_h = _parse_hhmm(new_start)
    new_end_h = _parse_hhmm(new_end)
    new_end_eff = new_end_h + 24 if new_end_h <= new_start_h else new_end_h

    # 找昨天
    prev_d = _ymd(d - timedelta(days=1))
    prev_shift = assignments.get((emp_id, prev_d))
    if prev_shift is None or prev_shift.is_rest:
        # 看 previous_days
        for (pid, pdate, pstart, pend) in previous_days:
            if pid == emp_id and pdate == prev_d and pstart is not None:
                pe_h = _parse_hhmm(pend)
                ps_h = _parse_hhmm(pstart)
                pe_eff = pe_h + 24 if pe_h <= ps_h else pe_h
                # 昨天結束時間 → 今天開始時間 的 gap
                gap = (new_start_h + 24) - pe_eff
                if gap < MIN_SHIFT_INTERVAL_HOURS:
                    return False
                break
    elif prev_shift.window_end is not None:
        pe_h = _parse_hhmm(prev_shift.window_end)
        ps_h = _parse_hhmm(prev_shift.window_start)
        pe_eff = pe_h + 24 if pe_h <= ps_h else pe_h
        gap = (new_start_h + 24) - pe_eff
        if gap < MIN_SHIFT_INTERVAL_HOURS:
            return False

    # 找明天
    next_d = _ymd(d + timedelta(days=1))
    next_shift = assignments.get((emp_id, next_d))
    if next_shift is not None and not next_shift.is_rest and next_shift.window_start is not None:
        ns_h = _parse_hhmm(next_shift.window_start)
        # 今天結束 → 明天開始 的 gap
        gap = (ns_h + 24) - new_end_eff
        if gap < MIN_SHIFT_INTERVAL_HOURS:
            return False

    return True


# ════════════════════════════════════════════════════════════════════════
# COVERAGE：時段最低人力
# ════════════════════════════════════════════════════════════════════════

def slot_coverage_count(
    date: str,
    slot: TimeSlot,
    assignments: dict[tuple[int, str], Assignment],
) -> int:
    """計算 date 該 slot 已有多少人 cover (任一時段重疊就算 1 人)"""
    slot_s = _parse_hhmm(slot.start_time)
    slot_e = _parse_hhmm(slot.end_time)
    slot_e_eff = slot_e + 24 if slot_e <= slot_s else slot_e

    cnt = 0
    for (eid, d), a in assignments.items():
        if d != date or a.is_rest or a.window_start is None:
            continue
        ws = _parse_hhmm(a.window_start)
        we = _parse_hhmm(a.window_end)
        we_eff = we + 24 if we <= ws else we
        # overlap check
        if max(slot_s, ws) < min(slot_e_eff, we_eff):
            cnt += 1
    return cnt


# ════════════════════════════════════════════════════════════════════════
# MONTHLY_REST: cycle 內休天數
# ════════════════════════════════════════════════════════════════════════

def count_rest_in_cycle(
    emp_id: int,
    cycle_dates: list[str],
    assignments: dict[tuple[int, str], Assignment],
) -> int:
    return sum(1 for d in cycle_dates if (emp_id, d) in assignments and assignments[(emp_id, d)].is_rest)


def prorate_monthly_target(cycle_dates: list[str], monthly_target: int) -> int:
    """月目標按 cycle 跨到的 calendar month 比例換算成 cycle 目標。
    例：cycle 5/29-6/25 (3 in May, 25 in June)
    target = (3/31)*10 + (25/30)*10 ≈ 9.3 → round 9
    """
    if not cycle_dates:
        return monthly_target
    by_month: dict[str, int] = {}
    for d in cycle_dates:
        ym = d[:7]
        by_month[ym] = by_month.get(ym, 0) + 1
    total = 0.0
    for ym, count in by_month.items():
        yr, mo = int(ym[:4]), int(ym[5:])
        # 月份最後一天 = 下個月第 0 天
        from calendar import monthrange
        days_in_month = monthrange(yr, mo)[1]
        total += (count / days_in_month) * monthly_target
    return round(total)


# ════════════════════════════════════════════════════════════════════════
# CROSS_MONTH_REST: prior + cycle 加總
# ════════════════════════════════════════════════════════════════════════

def count_cycle_rest_by_month(
    emp_id: int,
    cycle_dates: list[str],
    assignments: dict[tuple[int, str], Assignment],
) -> dict[str, int]:
    """本 cycle 內、按 calendar month 分桶的休天數"""
    out: dict[str, int] = {}
    for d in cycle_dates:
        a = assignments.get((emp_id, d))
        if a is not None and a.is_rest:
            ym = d[:7]
            out[ym] = out.get(ym, 0) + 1
    return out


def check_cross_month(
    emp_id: int,
    cycle_dates: list[str],
    assignments: dict[tuple[int, str], Assignment],
    prior_rest_by_month: dict[int, dict[str, int]],
    monthly_target_ft: int,
    monthly_target_pt: int,
    is_pt: bool,
) -> list[Violation]:
    """檢查跨月休天累計是否超標"""
    target = monthly_target_pt if is_pt else monthly_target_ft
    cycle_by_month = count_cycle_rest_by_month(emp_id, cycle_dates, assignments)
    prior_by_month = prior_rest_by_month.get(emp_id, {})

    all_months = set(cycle_by_month.keys()) | set(prior_by_month.keys())
    violations: list[Violation] = []
    for ym in all_months:
        total = cycle_by_month.get(ym, 0) + prior_by_month.get(ym, 0)
        if total > target:
            violations.append(Violation(
                constraint="CROSS_MONTH_REST",
                employee_id=emp_id,
                date=f"{ym}-01",
                message=f"{ym} 月實際休 {total} 天 (cycle {cycle_by_month.get(ym, 0)} + prior {prior_by_month.get(ym, 0)}) 超出目標 {target} 天",
                severity="warning",
            ))
    return violations
