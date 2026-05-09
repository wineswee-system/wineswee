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

// 共用：把多個 row 加進結果，只保留 value 不為 "—" 或空字串的（避免空欄位佔位）
function pushIf(rows: ApprovalCardData["rows"], label: string, value: string | null | undefined, opts?: { valueColor?: string }) {
  if (value == null || value === "" || value === "—") return;
  rows.push({ label, value, ...(opts ?? {}) });
}

function fmtMoney(v: any): string | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return `$ ${n.toLocaleString("zh-TW")}`;
}

function rowsForLeave(rec: any): ApprovalCardData["rows"] {
  const rows: ApprovalCardData["rows"] = [];
  pushIf(rows, "假別", rec.type);
  // 半天/小時假：有 start_time/end_time → 顯示時段，否則顯示日期區間
  if (rec.start_time && rec.end_time) {
    pushIf(rows, "日期", fmtDate(rec.start_date));
    pushIf(rows, "時段", `${rec.start_time}–${rec.end_time}`);
  } else {
    pushIf(rows, "期間", fmtDateRange(rec.start_date, rec.end_date));
  }
  pushIf(rows, "天數", rec.days != null ? `${rec.days} 天` : null);
  pushIf(rows, "申請日", fmtDate(rec.created_at));
  pushIf(rows, "狀態", rec.status, { valueColor: statusColor(rec.status) });
  return rows;
}

function rowsForOvertime(rec: any): ApprovalCardData["rows"] {
  const rows: ApprovalCardData["rows"] = [];
  pushIf(rows, "日期", fmtDate(rec.date));
  pushIf(rows, "時數", rec.hours != null ? `${rec.hours} 小時` : null);
  pushIf(rows, "申請日", fmtDate(rec.created_at));
  pushIf(rows, "狀態", rec.status, { valueColor: statusColor(rec.status) });
  return rows;
}

function rowsForTrip(rec: any): ApprovalCardData["rows"] {
  const rows: ApprovalCardData["rows"] = [];
  pushIf(rows, "目的地", rec.destination ?? rec.location);
  pushIf(rows, "期間", fmtDateRange(rec.start_date, rec.end_date));
  pushIf(rows, "預算", fmtMoney(rec.budget));
  pushIf(rows, "申請日", fmtDate(rec.created_at));
  pushIf(rows, "狀態", rec.status, { valueColor: statusColor(rec.status) });
  // 目的(purpose) 移到 reason block 顯示，這裡不重複
  return rows;
}

function rowsForExpense(rec: any): ApprovalCardData["rows"] {
  const rows: ApprovalCardData["rows"] = [];
  pushIf(rows, "類別", rec.category);
  pushIf(rows, "金額", fmtMoney(rec.amount));
  pushIf(rows, "日期", fmtDate(rec.date));
  pushIf(rows, "收據", rec.receipt === true ? "✓ 已附" : null);
  pushIf(rows, "申請日", fmtDate(rec.created_at));
  pushIf(rows, "狀態", rec.status, { valueColor: statusColor(rec.status) });
  return rows;
}

function rowsForExpenseRequest(rec: any): ApprovalCardData["rows"] {
  const rows: ApprovalCardData["rows"] = [];
  pushIf(rows, "用途", rec.title);
  pushIf(rows, "預估金額", fmtMoney(rec.estimated_amount ?? rec.amount));
  if (rec.actual_amount != null) {
    pushIf(rows, "實際金額", fmtMoney(rec.actual_amount));
  }
  pushIf(rows, "科目", rec.account_name);
  pushIf(rows, "申請日", fmtDate(rec.created_at));
  pushIf(rows, "狀態", rec.status, { valueColor: statusColor(rec.status) });
  return rows;
}

function rowsForCorrection(rec: any): ApprovalCardData["rows"] {
  const rows: ApprovalCardData["rows"] = [];
  pushIf(rows, "日期", fmtDate(rec.date));
  pushIf(rows, "類型", rec.type);  // '上班打卡' / '下班打卡'
  pushIf(rows, "補登時間", rec.correction_time);
  pushIf(rows, "申請日", fmtDate(rec.created_at));
  pushIf(rows, "狀態", rec.status, { valueColor: statusColor(rec.status) });
  return rows;
}

function rowsForCover(rec: any): ApprovalCardData["rows"] {
  const rows: ApprovalCardData["rows"] = [];
  pushIf(rows, "代班日", fmtDate(rec.shift_date));
  pushIf(rows, "班別", rec.shift_label);
  if (rec.actual_start && rec.actual_end) {
    pushIf(rows, "時段", `${rec.actual_start}–${rec.actual_end}`);
  }
  pushIf(rows, "工時", rec.actual_hours != null ? `${rec.actual_hours} 小時` : null);
  pushIf(rows, "缺勤者", rec.absent_emp_name);
  pushIf(rows, "發起人", rec.requester_name);
  pushIf(rows, "申請日", fmtDate(rec.created_at));
  pushIf(rows, "狀態", rec.status, { valueColor: statusColor(rec.status) });
  return rows;
}

function rowsForOffRequest(rec: any): ApprovalCardData["rows"] {
  const rows: ApprovalCardData["rows"] = [];
  pushIf(rows, "希望休日", fmtDate(rec.date));
  pushIf(rows, "申請日", fmtDate(rec.created_at));
  pushIf(rows, "狀態", rec.status, { valueColor: statusColor(rec.status) });
  return rows;
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

// 每種類型「主說明文字」對應的欄位名（會顯示在 reason block）
const REASON_FIELD: Record<ApprovalRequestType, string> = {
  leave:           "reason",
  overtime:        "reason",
  trip:            "purpose",       // 出差目的（move 出 row）
  expense:         "description",
  expense_request: "description",   // expense_request 用 description（title 已在 row）
  correction:      "reason",
  cover:           "reason",
  off_request:     "reason",
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

  // 4. 抓附件（依類型不同存儲方式不同）
  const attachments = await fetchAttachments(db, type, id, rec);

  // 5. 組 card data
  const reasonField = REASON_FIELD[type];
  const card: ApprovalCardData = {
    type,
    id,
    applicantName,
    applicantDept,
    statusChip: rec.status === "待審核" || rec.status === "申請中" ? "待你審核" : rec.status,
    rows: ROWS_FOR[type](rec),
    reason: rec[reasonField] ?? null,
    alerts: alerts.length > 0 ? alerts : undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
    liffId,
    liffDetailPath: type === "expense_request" ? `/approve/expense-request?id=${id}` : "/approve",
  };

  return { ok: true, card };
}

// ── Attachment fetcher (per type) ────────────────────────────────────────────
// 不同類型附件儲存方式不同，這裡分支處理：
//   - expense_request: expense_request_attachments 表 + bucket 'attachments'
//   - expense (報帳): expenses.attachments 欄位（已存好的 publicUrl 陣列）
//   - leave: leave_requests.attachments 欄位（已存好的 publicUrl 陣列）
//   - 其他 5 類目前無附件功能 → 回 []

async function fetchAttachments(
  db: SupabaseClient,
  type: ApprovalRequestType,
  id: number,
  rec: any,
): Promise<NonNullable<ApprovalCardData["attachments"]>> {
  try {
    if (type === "expense_request") {
      const { data: rows } = await db
        .from("expense_request_attachments")
        .select("id, file_name, storage_path, file_type")
        .eq("request_id", id)
        .order("created_at", { ascending: true });
      if (!rows || rows.length === 0) return [];
      return rows.map((r: any) => ({
        name: r.file_name ?? "附件",
        url: storagePublicUrl(db, "attachments", r.storage_path),
        fileType: r.file_type ?? null,
      }));
    }

    if (type === "expense" || type === "leave") {
      // attachments 欄位通常是 text[] 或 jsonb，存的是 publicUrl 陣列
      const raw = rec.attachments;
      if (!raw) return [];
      const list: string[] = Array.isArray(raw) ? raw : [];
      return list
        .filter((u): u is string => typeof u === "string" && u.length > 0)
        .map((url, i) => ({
          name: deriveFileName(url, i + 1),
          url,
          fileType: deriveMimeFromUrl(url),
        }));
    }

    return [];
  } catch (err) {
    console.warn(`[card-approval] fetchAttachments(${type}, ${id}) failed:`, err);
    return [];
  }
}

function storagePublicUrl(db: SupabaseClient, bucket: string, path?: string | null): string | null {
  if (!path) return null;
  const { data } = db.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl ?? null;
}

function deriveFileName(url: string, idx: number): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch { /* not a URL */ }
  return `附件 ${idx}`;
}

function deriveMimeFromUrl(url: string): string | null {
  const lower = url.toLowerCase();
  if (/\.(jpe?g|png|gif|webp|heic)(\?|$)/.test(lower)) return "image/*";
  if (/\.pdf(\?|$)/.test(lower)) return "application/pdf";
  return null;
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
