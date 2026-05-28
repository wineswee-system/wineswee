"""資料類型 — 純 dataclass，給 solver 用的乾淨 input/output schema。"""

from dataclasses import dataclass, field
from typing import Optional, Literal


@dataclass(frozen=True)
class Employee:
    id: int
    name: str
    employment_type: Literal["full_time", "part_time"]  # "正職" / "兼職"
    can_open: Optional[bool] = None   # None = 未設 / True = 可 / False = 不可
    can_close: Optional[bool] = None
    store_id: Optional[int] = None
    organization_id: Optional[int] = None
    schedule_priority: int = 3  # 1-5；1 最優先

    @property
    def is_pt(self) -> bool:
        return self.employment_type == "part_time"


@dataclass(frozen=True)
class TimeSlot:
    """時段需求 — 例：10:30~15:00 需要 2 人"""
    start_time: str   # "HH:MM"
    end_time: str
    required_count: int
    max_count: Optional[int] = None  # None = required + 2 (預設留 buffer)
    day_type: str = "all"  # "all" / "weekday" / "weekend"

    @property
    def effective_max(self) -> int:
        return self.max_count if self.max_count is not None else self.required_count + 2


@dataclass(frozen=True)
class StoreSettings:
    """店設定"""
    operating_hours: dict  # { "mon": {"open": "10:30", "close": "00:00"}, ... }
    ft_monthly_rest_days: int = 10
    pt_monthly_rest_days: int = 15
    work_hour_system: str = "標準工時"
    min_staff: int = 1
    min_staff_weekend: int = 1


@dataclass
class Assignment:
    """單一員工某日的排班結果 — None = 休"""
    employee_id: int
    date: str  # "YYYY-MM-DD"
    window_start: Optional[str] = None  # None = 休
    window_end: Optional[str] = None
    hours: float = 0.0

    @property
    def is_rest(self) -> bool:
        return self.window_start is None


@dataclass
class SolverInput:
    """Solver 完整輸入"""
    employees: list[Employee]
    cycle_dates: list[str]   # ["2026-05-29", "2026-05-30", ..., "2026-06-25"]
    time_slots: list[TimeSlot]
    store_settings: StoreSettings
    holidays: list[str] = field(default_factory=list)

    # 已鎖定的既有排班 (cycle 範圍內) — solver 不會動這些
    locked: list[Assignment] = field(default_factory=list)

    # 強制休 (已核准的 off_requests / leave_requests)
    forced_rest: list[tuple[int, str]] = field(default_factory=list)  # (emp_id, date)

    # 跨 cycle history — H3/H4 用
    # 格式：[(emp_id, "YYYY-MM-DD", "HH:MM"/None start, "HH:MM"/None end), ...]
    previous_days: list[tuple[int, str, Optional[str], Optional[str]]] = field(default_factory=list)

    # 跨月休天累計 (本 cycle 以外、同 calendar month 內的休天數)
    # { emp_id: { "YYYY-MM": count } }
    prior_rest_by_month: dict[int, dict[str, int]] = field(default_factory=dict)


@dataclass
class Violation:
    """違規記錄 — H3/H4/coverage/月休 等"""
    constraint: str  # "H3" / "H4" / "COVERAGE" / "MONTHLY_REST" / "CROSS_MONTH_REST"
    employee_id: Optional[int]
    date: Optional[str]
    message: str
    severity: str = "warning"  # "warning" / "error"


@dataclass
class SolverResult:
    """Solver 完整輸出"""
    assignments: list[Assignment]
    violations: list[Violation]
    stats: dict           # 統計：每員工總工時、休天數、cycle 達標度
    success: bool         # True = 找到合法解 (可能有 soft violations)，False = hard 違規
    elapsed_ms: int       # 求解耗時
