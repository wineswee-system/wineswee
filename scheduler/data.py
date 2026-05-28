"""Supabase 查詢 — 給 production API 用。Local CLI 用 JSON fixture 不走這。"""

import os
from datetime import datetime, timedelta
from typing import Optional

try:
    from supabase import create_client, Client
except ImportError:
    # 沒裝 supabase（local CLI 不需要）
    Client = None


def get_supabase() -> "Client":
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("VITE_SUPABASE_ANON_KEY")
    if not url or not key:
        raise RuntimeError("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars")
    if Client is None:
        raise RuntimeError("supabase-py not installed. pip install supabase")
    return create_client(url, key)


# Counted-as-rest shifts（跟主系統 scheduleUtils.js 對齊）
COMPANY_REST_SHIFTS = {"休", "補休"}


def gather_input(
    store_id: int,
    organization_id: int,
    cycle_dates: list[str],
) -> dict:
    """從 Supabase 查所有 solver 需要的資料，組成 input_dict (給 solve_schedule 用)。

    Args:
        store_id: 門市 ID
        organization_id: 組織 ID
        cycle_dates: e.g., ["2026-05-29", ..., "2026-06-25"]

    Returns:
        input_dict 可直接傳給 solver.solve_schedule
    """
    sb = get_supabase()
    cycle_start = cycle_dates[0]
    cycle_end = cycle_dates[-1]

    # ── 1. employees ──
    emps_res = sb.table("employees").select(
        "id, name, employment_type, can_open, can_close, store_id, organization_id, schedule_priority"
    ).eq("store_id", store_id).eq("status", "在職").execute()
    employees = []
    for e in emps_res.data:
        etype = e.get("employment_type") or "full_time"
        # 主系統用 '正職'/'兼職' 字串，轉成 enum
        if etype in ("兼職", "part_time", "PT", "pt"):
            etype = "part_time"
        else:
            etype = "full_time"
        employees.append({
            "id": e["id"],
            "name": e["name"],
            "employment_type": etype,
            "can_open": e.get("can_open"),
            "can_close": e.get("can_close"),
            "store_id": e.get("store_id"),
            "organization_id": e.get("organization_id"),
            "schedule_priority": e.get("schedule_priority") or 3,
        })

    # ── 2. time_slots (該 cycle 的月份) ──
    current_ym = cycle_start[:7]
    slots_res = sb.table("store_time_slots").select(
        "start_time, end_time, required_count, max_count, day_type, year_month"
    ).eq("store_id", store_id).eq("year_month", current_ym).execute()
    if not slots_res.data:
        # fallback 全月
        slots_res = sb.table("store_time_slots").select(
            "start_time, end_time, required_count, max_count, day_type"
        ).eq("store_id", store_id).is_("year_month", "null").execute()
    time_slots = [{
        "start_time": s["start_time"][:5] if len(s["start_time"]) >= 5 else s["start_time"],
        "end_time": s["end_time"][:5] if len(s["end_time"]) >= 5 else s["end_time"],
        "required_count": s["required_count"],
        "max_count": s.get("max_count"),
        "day_type": s.get("day_type") or "all",
    } for s in (slots_res.data or [])]

    # ── 3. store_settings ──
    settings_res = sb.table("store_settings").select("*").eq("store_id", store_id).maybeSingle().execute()
    ss = settings_res.data or {}
    store_settings = {
        "operating_hours": ss.get("operating_hours") or {},
        "ft_monthly_rest_days": ss.get("ft_monthly_rest_days") or 10,
        "pt_monthly_rest_days": ss.get("pt_monthly_rest_days") or 15,
        "work_hour_system": ss.get("work_hour_system") or "標準工時",
        "min_staff": ss.get("min_staff") or 1,
        "min_staff_weekend": ss.get("min_staff_weekend") or 1,
    }

    # ── 4. 既有 schedules in cycle (locked) ──
    sched_res = sb.table("schedules").select(
        "employee, date, shift, actual_start, actual_end, actual_hours"
    ).gte("date", cycle_start).lte("date", cycle_end).execute()
    name_to_id = {e["name"]: e["id"] for e in employees}
    locked = []
    for s in sched_res.data or []:
        eid = name_to_id.get(s["employee"])
        if eid is None:
            continue
        # 只 lock 有上班的 (休不 lock，讓 solver 重排)
        if s["shift"] in COMPANY_REST_SHIFTS:
            continue
        locked.append({
            "employee_id": eid,
            "date": s["date"],
            "window_start": s.get("actual_start"),
            "window_end": s.get("actual_end"),
            "hours": s.get("actual_hours") or 8.0,
        })

    # ── 5. previous_days (cycle 前 14 天) ──
    prev_start = (datetime.strptime(cycle_start, "%Y-%m-%d") - timedelta(days=14)).strftime("%Y-%m-%d")
    prev_end = (datetime.strptime(cycle_start, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
    prev_res = sb.table("schedules").select(
        "employee, date, shift, actual_start, actual_end"
    ).gte("date", prev_start).lte("date", prev_end).execute()
    previous_days = []
    for s in prev_res.data or []:
        eid = name_to_id.get(s["employee"])
        if eid is None:
            continue
        if s["shift"] in COMPANY_REST_SHIFTS:
            previous_days.append([eid, s["date"], None, None])
        else:
            previous_days.append([eid, s["date"], s.get("actual_start"), s.get("actual_end")])

    # ── 6. forced_rest (off_requests + leave_requests in cycle) ──
    off_res = sb.table("off_requests").select(
        "employee, date, status"
    ).gte("date", cycle_start).lte("date", cycle_end).eq("status", "已核准").execute()
    leave_res = sb.table("leave_requests").select(
        "employee, employee_id, start_date, end_date, days, status"
    ).lte("start_date", cycle_end).gte("end_date", cycle_start).eq("status", "已核准").execute()

    forced_rest_set: set[tuple[int, str]] = set()
    for o in off_res.data or []:
        eid = name_to_id.get(o["employee"])
        if eid:
            forced_rest_set.add((eid, o["date"]))
    for lv in leave_res.data or []:
        eid = lv.get("employee_id") or name_to_id.get(lv["employee"])
        if not eid:
            continue
        d = max(lv["start_date"], cycle_start)
        end = min(lv["end_date"] or lv["start_date"], cycle_end)
        d_obj = datetime.strptime(d, "%Y-%m-%d")
        end_obj = datetime.strptime(end, "%Y-%m-%d")
        while d_obj <= end_obj:
            forced_rest_set.add((eid, d_obj.strftime("%Y-%m-%d")))
            d_obj += timedelta(days=1)

    forced_rest = list(forced_rest_set)

    # ── 7. prior_rest_by_month (cycle 跨月份、cycle 外的休天累計) ──
    cycle_start_obj = datetime.strptime(cycle_start, "%Y-%m-%d")
    cycle_end_obj = datetime.strptime(cycle_end, "%Y-%m-%d")
    month_start = cycle_start_obj.replace(day=1).strftime("%Y-%m-%d")
    # 月底：下個月第一天 - 1
    next_month = cycle_end_obj.replace(day=1)
    if cycle_end_obj.month == 12:
        next_month = next_month.replace(year=cycle_end_obj.year + 1, month=1)
    else:
        next_month = next_month.replace(month=cycle_end_obj.month + 1)
    month_end = (next_month - timedelta(days=1)).strftime("%Y-%m-%d")

    month_sched_res = sb.table("schedules").select(
        "employee, date, shift"
    ).gte("date", month_start).lte("date", month_end).execute()

    prior_rest_by_month: dict[int, dict[str, int]] = {}
    cycle_set = set(cycle_dates)
    for s in month_sched_res.data or []:
        if s["date"] in cycle_set:
            continue  # 排除本 cycle
        if s["shift"] not in COMPANY_REST_SHIFTS:
            continue
        eid = name_to_id.get(s["employee"])
        if not eid:
            continue
        ym = s["date"][:7]
        prior_rest_by_month.setdefault(eid, {}).setdefault(ym, 0)
        prior_rest_by_month[eid][ym] += 1

    # ── 8. holidays ──
    hol_res = sb.table("holidays").select("date").gte("date", cycle_start).lte("date", cycle_end).execute()
    holidays = [h["date"] for h in (hol_res.data or [])]

    return {
        "employees": employees,
        "time_slots": time_slots,
        "store_settings": store_settings,
        "cycle_dates": cycle_dates,
        "holidays": holidays,
        "locked": locked,
        "forced_rest": forced_rest,
        "previous_days": previous_days,
        "prior_rest_by_month": {str(k): v for k, v in prior_rest_by_month.items()},
    }
