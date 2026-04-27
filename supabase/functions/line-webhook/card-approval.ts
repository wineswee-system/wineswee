// ── Approval card data fetch + builder ───────────────────────────────────────
// 七種申請類型（leave/overtime/trip/expense/expense_request/correction/cover/off_request）
// 共用一支 fetcher，回傳已 ready 給 flexApprovalRequest 用的 ApprovalCardData。

import type { SupabaseClient, ApprovalRequestType } from './types.ts';
import { flexApprovalRequest, flexResultErr, type ApprovalCardData } from './flex-builders.ts';
import { COLOR_DANGER, COLOR_NEUTRAL, COLOR_SUCCESS } from './colors.ts';

// ── Type guard / table mapping ───────────────────────────────────────────────

const TABLE_MAP: Record<ApprovalRequestType, string> = {
  leave:           "leave_requests",
  overtime:        "overtime_requests",
  trip:            "business_trips",
  expense:         "expenses",
  expense_request: "expense_requests",
  correction:      "clock_corrections",
  cover:           "shift_cover_requests",
  off_request:     "off_requests",
};

// ── Date / time helpers ──────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  // ISO date or datetime → MM/DD (週X)
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  const wd = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mm}/${dd} (${wd})`;
}

function fmtDateRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return "—";
  const s = fmtDate(start);
  if (!end || end === start) return s;
  return `${s} – ${fmtDate(end)}`;
}

function statusColor(status?: string): string {
  if (!status) return COLOR_NEUTRAL;
  if (status === "已核准" || status === "已核銷") return COLOR_SUCCESS;
  if (status === "已退回" || status === "已駁回") return COLOR_DANGER;
  return COLOR_NEUTRAL;
}

// ── Per-type field builders ──────────────────────────────────────────────────
// 每種申請類型，把 row 從 raw record 轉出來。所有 type 共用 applicant + reason
// 兩個欄位（外層處理），這裡只回 type-specific 的中段 rows。

function rowsForLeave(rec: any): ApprovalCardData["rows"] {
  return [
    { label: "假別", value: rec.type ?? "—" },
    { label: "期間", value: fmtDateRange(rec.start_date, rec.end_date) },
    { label: "天數", value: rec.days != null ? `${rec.days} 天` : "—" },
    { label: "申請日", value: fmtDate(rec.created_at) },
    { label: "狀態", value: rec.status ?? "—", valueColor: statusColor(rec.status) },
  ];
}

function rowsForOvertime(rec: any): ApprovalCardData["rows"] {
  return [
    { label: "日期", value: fmtDate(rec.date) },
    { label: "時數", value: rec.hours != null ? `${rec.hours} 小時` : "—" },
    { label: "申請日", value: fmtDate(rec.created_at) },
    { label: "狀態", value: rec.status ?? "—", valueColor: statusColor(rec.status) },
  ];
}

function rowsForTrip(rec: any): ApprovalCardData["rows"] {
  return [
    { label: "目的地", value: rec.destination ?? rec.location ?? "—" },
    { label: "期間", value: fmtDateRange(rec.start_date, rec.end_date) },
    { label: "天數", value: rec.days != null ? `${rec.days} 天` : "—" },
    { label: "申請日", value: fmtDate(rec.created_at) },
    { label: "狀態", value: rec.status ?? "—", valueColor: statusColor(rec.status) },
  ];
}

function rowsForExpense(rec: any): ApprovalCardData["rows"] {
  return [
    { label: "類別", value: rec.category ?? rec.type ?? "—" },
    { label: "金額", value: rec.amount != null ? `$ ${Number(rec.amount).toLocaleString("zh-TW")}` : "—" },
    { label: "日期", value: fmtDate(rec.date ?? rec.expense_date ?? rec.created_at) },
    { label: "狀態", value: rec.status ?? "—", valueColor: statusColor(rec.status) },
  ];
}

function rowsForExpenseRequest(rec: any): ApprovalCardData["rows"] {
  return [
    { label: "用途", value: rec.purpose ?? rec.title ?? "—" },
    { label: "金額", value: rec.amount != null ? `$ ${Number(rec.amount).toLocaleString("zh-TW")}` : "—" },
    { label: "科目", value: rec.account_name ?? rec.account ?? "—" },
    { label: "申請日", value: fmtDate(rec.created_at) },
    { label: "狀態", value: rec.status ?? "—", valueColor: statusColor(rec.status) },
  ];
}

function rowsForCorrection(rec: any): ApprovalCardData["rows"] {
  return [
    { label: "日期", value: fmtDate(rec.date) },
    { label: "類型", value: rec.type === "in" ? "上班補卡" : rec.type === "out" ? "下班補卡" : (rec.type ?? "—") },
    { label: "時間", value: rec.time ?? "—" },
    { label: "狀態", value: rec.status ?? "—", valueColor: statusColor(rec.status) },
  ];
}

function rowsForCover(rec: any): ApprovalCardData["rows"] {
  return [
    { label: "代班日", value: fmtDate(rec.shift_date) },
    { label: "班別", value: rec.shift_name ?? "—" },
    { label: "原班員工", value: rec.original_employee_name ?? "—" },
    { label: "代班費", value: rec.cover_pay != null ? `$ ${Number(rec.cover_pay).toLocaleString("zh-TW")}` : "—" },
    { label: "狀態", value: rec.status ?? "—", valueColor: statusColor(rec.status) },
  ];
}

function rowsForOffRequest(rec: any): ApprovalCardData["rows"] {
  return [
    { label: "月份", value: rec.year_month ?? "—" },
    { label: "希望休天數", value: rec.day_count != null ? `${rec.day_count} 天` : "—" },
    { label: "申請日", value: fmtDate(rec.created_at) },
    { label: "狀態", value: rec.status ?? "—", valueColor: statusColor(rec.status) },
  ];
}

const ROWS_FOR: Record<ApprovalRequestType, (rec: any) => ApprovalCardData["rows"]> = {
  leave:           rowsForLeave,
  overtime:        rowsForOvertime,
  trip:            rowsForTrip,
  expense:         rowsForExpense,
  expense_request: rowsForExpenseRequest,
  correction:      rowsForCorrection,
  cover:           rowsForCover,
  off_request:     rowsForOffRequest,
};

// ── Main fetcher ─────────────────────────────────────────────────────────────

export type FetchResult =
  | { ok: true; card: ApprovalCardData }
  | { ok: false; reason: string; record?: any };

/** 根據 type + id 抓資料、組好 ApprovalCardData。
 *  liffId 由 caller 傳進來（為了 footer 的「看詳情」按鈕）。
 */
export async function fetchApprovalCard(
  db: SupabaseClient,
  type: ApprovalRequestType,
  id: number,
  liffId?: string,
): Promise<FetchResult> {
  const table = TABLE_MAP[type];
  if (!table) return { ok: false, reason: "UNKNOWN_TYPE" };

  // 1. 抓申請單本身
  const { data: rec, error } = await db
    .from(table)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return { ok: false, reason: `DB_ERROR: ${error.message}` };
  if (!rec) return { ok: false, reason: "NOT_FOUND" };

  // 2. 抓申請人（優先 employee_id FK，否則用 employee text 對名字）
  let applicantName = rec.employee ?? "—";
  let applicantDept: string | null = null;

  let empRow: any = null;
  if (rec.employee_id) {
    const { data: e } = await db
      .from("employees")
      .select("id, name, department_id, store_id")
      .eq("id", rec.employee_id)
      .maybeSingle();
    empRow = e;
  } else if (rec.employee) {
    const { data: e } = await db
      .from("employees")
      .select("id, name, department_id, store_id")
      .eq("name", rec.employee)
      .maybeSingle();
    empRow = e;
  }

  if (empRow) {
    applicantName = empRow.name ?? applicantName;
    const parts: string[] = [];
    if (empRow.store_id) {
      const { data: s } = await db.from("stores").select("name").eq("id", empRow.store_id).maybeSingle();
      if (s?.name) parts.push(s.name);
    }
    if (empRow.department_id) {
      const { data: d } = await db.from("departments").select("name").eq("id", empRow.department_id).maybeSingle();
      if (d?.name) parts.push(d.name);
    }
    if (parts.length > 0) applicantDept = parts.join(" / ");
  }

  // 3. 駁回原因（如果先前被退過）
  const alerts: string[] = [];
  const rejectReason = rec.reject_reason || rec.rejection_reason;
  if (rejectReason && rec.status === "已退回") {
    alerts.push(`⚠️ 上次駁回原因：${rejectReason}`);
  }

  // 4. 組 card data
  const card: ApprovalCardData = {
    type,
    id,
    applicantName,
    applicantDept,
    statusChip: rec.status === "待審核" || rec.status === "申請中" ? "待你審核" : rec.status,
    rows: ROWS_FOR[type](rec),
    reason: rec.reason ?? rec.purpose ?? rec.note ?? rec.description ?? null,
    alerts: alerts.length > 0 ? alerts : undefined,
    liffId,
    liffDetailPath: "/approve",
  };

  return { ok: true, card };
}

/** Build the card flex object directly. */
export async function buildApprovalCardMessage(
  db: SupabaseClient,
  type: ApprovalRequestType,
  id: number,
  liffId?: string,
): Promise<object> {
  const r = await fetchApprovalCard(db, type, id, liffId);
  if (!r.ok) {
    const errorLines: Record<string, string> = {
      "UNKNOWN_TYPE":  "未支援的申請類型",
      "NOT_FOUND":     `找不到 #${id} 的申請單，可能已被刪除`,
    };
    return flexResultErr({
      title: "無法載入申請單",
      lines: [errorLines[r.reason] ?? r.reason],
    });
  }
  return flexApprovalRequest(r.card);
}
