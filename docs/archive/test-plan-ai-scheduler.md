# QA Test Plan: AI 排班管理 — Restrictions & Permissions

> **Date**: 2026-04-05
> **Module**: HR / AI Scheduler (`src/pages/hr/Schedule.jsx`, `src/lib/laborLaw.js`)
> **Focus**: Every restriction, permission, and access-control path
> **Total Test Cases**: 147

---

## Architecture Context

```
User ──→ AuthContext (isAdmin, profile.role_id) ──→ Schedule.jsx
  │                                                    │
  └──→ TenantContext (tenant_id via RLS) ──────────────┘
                                                       │
  Supabase tables:                                     ▼
  ┌─────────────────────────────────────────────────────────┐
  │ schedules (employee, date, shift) — tenant-isolated     │
  │ off_requests (employee, date) — tenant-isolated         │
  │ employees (role_id → roles.level) — tenant-isolated     │
  │ roles → role_permissions → permissions                  │
  └─────────────────────────────────────────────────────────┘
```

### Role Hierarchy (from schema seed)

| Role | Level | Expected Schedule Permissions |
|------|-------|-------------------------------|
| admin | 100 | Full CRUD + AI auto-schedule + approve off-requests |
| manager | 80 | Full CRUD + AI auto-schedule + approve off-requests (own dept/store) |
| team_lead | 60 | View all + edit own team + approve off-requests (own team) |
| employee | 20 | View own schedule + submit off-requests |
| viewer | 10 | View only — no mutations |

---

## 1. Authentication Gate

> Unauthenticated users must not reach the scheduler at all.

| # | Test Case | Type | Expected | Severity |
|---|-----------|------|----------|----------|
| AUTH-01 | Navigate to `/hr/schedule` without login | E2E | Redirect to `/login` | P0 |
| AUTH-02 | Call `schedules` table via Supabase anon key | Integration | RLS denies — empty result or 403 | P0 |
| AUTH-03 | Call `off_requests` table via Supabase anon key | Integration | RLS denies — empty result or 403 | P0 |
| AUTH-04 | Expired session token — attempt to load schedule | E2E | Auto-redirect to login, no stale data shown | P0 |
| AUTH-05 | Session refresh mid-use — schedule remains loaded | E2E | Seamless re-auth, no data loss | P1 |

---

## 2. Tenant Isolation (RLS)

> A user in Tenant A must never see or modify Tenant B's schedules.

| # | Test Case | Type | Expected | Severity |
|---|-----------|------|----------|----------|
| TNT-01 | Tenant A user loads schedule — only Tenant A data returned | Integration | `schedules` filtered by `tenant_id` | P0 |
| TNT-02 | Tenant A user loads off-requests — only Tenant A data | Integration | `off_requests` filtered by `tenant_id` | P0 |
| TNT-03 | Tenant A user attempts INSERT into Tenant B schedule | Integration | RLS blocks — insert fails or inserts under own tenant | P0 |
| TNT-04 | Tenant A user attempts UPDATE on Tenant B schedule row | Integration | RLS blocks — no rows affected | P0 |
| TNT-05 | Tenant A user attempts DELETE on Tenant B schedule row | Integration | RLS blocks — no rows affected | P0 |
| TNT-06 | Switch tenant via `switchTenant()` — schedule reloads with new tenant data | E2E | Previous tenant's data cleared, new data loaded | P0 |
| TNT-07 | Manipulate `localStorage.sme_tenant` to fake tenant_id | Security | RLS still enforces server-side — no cross-tenant leak | P0 |
| TNT-08 | `app.tenant_id` not set (null) — query returns nothing | Integration | Empty result, not all-tenants data | P0 |
| TNT-09 | AI auto-schedule respects tenant boundary — generated rows get correct tenant_id | Integration | All upserted rows have current tenant_id | P0 |
| TNT-10 | Copy last week (`複製上週`) — only copies within same tenant | Integration | No cross-tenant schedule copy | P1 |

---

## 3. Role-Based Access Control — Schedule CRUD

> Who can create, read, update, and delete schedule entries.

### 3.1 View Restrictions

| # | Test Case | Role | Expected | Severity |
|---|-----------|------|----------|----------|
| RBAC-V01 | Admin views all employees' schedules across all depts | admin | Full grid visible | P0 |
| RBAC-V02 | Manager views all schedules in own dept/store | manager | Filtered to own dept/store | P0 |
| RBAC-V03 | Manager cannot view schedules of other dept/store | manager | Rows hidden or filtered | P1 |
| RBAC-V04 | Team lead views own team's schedules | team_lead | Own team visible | P0 |
| RBAC-V05 | Employee views only own schedule row | employee | Single row: self only | P0 |
| RBAC-V06 | Viewer sees schedule grid (read-only) | viewer | Grid visible, no edit controls | P0 |
| RBAC-V07 | Employee cannot see other employees' shift details | employee | Other rows hidden | P1 |
| RBAC-V08 | Dept filter shows only depts user has access to | all roles | Dropdown filtered by permission | P1 |
| RBAC-V09 | Store filter shows only stores user has access to | all roles | Dropdown filtered by permission | P1 |

### 3.2 Create / Update Restrictions

| # | Test Case | Role | Expected | Severity |
|---|-----------|------|----------|----------|
| RBAC-C01 | Admin clicks cell → shift picker appears → assigns shift | admin | Shift saved to DB | P0 |
| RBAC-C02 | Manager clicks cell for own-dept employee → shift picker | manager | Shift saved | P0 |
| RBAC-C03 | Manager clicks cell for other-dept employee | manager | No picker / action denied | P0 |
| RBAC-C04 | Team lead edits own-team member's shift | team_lead | Shift saved | P0 |
| RBAC-C05 | Team lead edits non-team member's shift | team_lead | Action denied | P0 |
| RBAC-C06 | Employee clicks cell on own row | employee | No picker — employee cannot self-assign | P0 |
| RBAC-C07 | Employee clicks cell on other employee's row | employee | No picker | P0 |
| RBAC-C08 | Viewer clicks any cell | viewer | No picker — read-only | P0 |
| RBAC-C09 | Direct Supabase INSERT from employee-role session | Integration | RLS/policy denies write | P0 |
| RBAC-C10 | Direct Supabase UPDATE from viewer-role session | Integration | RLS/policy denies update | P0 |

### 3.3 Delete Restrictions

| # | Test Case | Role | Expected | Severity |
|---|-----------|------|----------|----------|
| RBAC-D01 | Admin deletes a schedule entry | admin | Row removed | P1 |
| RBAC-D02 | Manager deletes own-dept schedule entry | manager | Row removed | P1 |
| RBAC-D03 | Manager deletes other-dept schedule entry | manager | Action denied | P1 |
| RBAC-D04 | Employee attempts delete via API | employee | RLS denies | P0 |
| RBAC-D05 | Viewer attempts delete via API | viewer | RLS denies | P0 |

---

## 4. AI Auto-Schedule — Permission & Restriction Tests

> The AI button (`AI 自動排班`) is the most powerful action — it batch-upserts for all filtered employees.

### 4.1 Access to AI Button

| # | Test Case | Role | Expected | Severity |
|---|-----------|------|----------|----------|
| AI-P01 | Admin sees and can click `AI 自動排班` button | admin | Button visible + enabled | P0 |
| AI-P02 | Manager sees and can click AI button (own dept) | manager | Button visible + enabled | P0 |
| AI-P03 | Team lead — AI button hidden or disabled | team_lead | Button hidden/disabled | P0 |
| AI-P04 | Employee — AI button hidden | employee | Button not rendered | P0 |
| AI-P05 | Viewer — AI button hidden | viewer | Button not rendered | P0 |

### 4.2 AI Scope Restrictions

| # | Test Case | Expected | Severity |
|---|-----------|----------|----------|
| AI-S01 | AI only fills empty cells — existing manual assignments preserved | Pre-set shift unchanged after AI run | P0 |
| AI-S02 | AI respects off-requests — employee with 希望休 gets `休` | Off-requested dates = `休` | P0 |
| AI-S03 | AI respects minimum staff threshold (`minStaff`) | Each day has ≥ minStaff workers | P0 |
| AI-S04 | AI assigns ≥ 2 rest days per employee per week | `restDays.length >= 2` for each employee | P0 |
| AI-S05 | AI prefers weekend rest when minimum staff is met | Saturday/Sunday prioritized for rest | P1 |
| AI-S06 | AI rotates shift types evenly across employees | No single employee stuck on one shift | P2 |
| AI-S07 | AI with dept filter active — only schedules filtered employees | Unfiltered employees untouched | P0 |
| AI-S08 | AI with store filter active — only schedules filtered employees | Unfiltered employees untouched | P0 |
| AI-S09 | AI result triggers compliance check automatically | `validateSchedule()` runs, alerts shown | P0 |
| AI-S10 | AI cannot produce a schedule that violates §36 (< 2 rest days) | Validation errors = 0 for rest-day rule | P0 |

### 4.3 AI Confirmation & Safety

| # | Test Case | Expected | Severity |
|---|-----------|----------|----------|
| AI-C01 | Clicking AI button shows confirmation dialog before execution | `confirm()` dialog with employee count + date range | P0 |
| AI-C02 | Cancelling confirmation dialog — no changes made | DB unchanged | P0 |
| AI-C03 | AI button disabled during execution (`autoScheduling` state) | No double-click / duplicate batch | P0 |
| AI-C04 | AI completion shows summary alert with count | `alert()` with number of shifts filled | P1 |
| AI-C05 | AI failure (Supabase error) — no partial state, error shown | Graceful error handling | P0 |

---

## 5. Copy Last Week (`複製上週`) — Permission & Restrictions

| # | Test Case | Role | Expected | Severity |
|---|-----------|------|----------|----------|
| CPY-01 | Admin clicks 複製上週 — copies all shifts from prior week | admin | Upsert succeeds, grid updates | P0 |
| CPY-02 | Manager clicks 複製上週 — copies only own-dept shifts | manager | Scoped to dept | P1 |
| CPY-03 | Employee — 複製上週 button hidden | employee | Button not rendered | P0 |
| CPY-04 | No data last week — alert shown | all | `alert('上週無排班資料')` | P1 |
| CPY-05 | Copy does not overwrite manually-set shifts in current week | all | `upsert` with `onConflict` preserves existing | P1 |
| CPY-06 | Copy maps day-of-week correctly (Mon→Mon, Tue→Tue...) | all | Date index alignment correct | P0 |

---

## 6. Off-Request (希望休) — Permission & Restrictions

> Employees submit rest-day preferences; managers/admins approve.

### 6.1 Submit Off-Request

| # | Test Case | Role | Expected | Severity |
|---|-----------|------|----------|----------|
| OFF-S01 | Employee submits off-request for a future date | employee | Row inserted with status `待審核` | P0 |
| OFF-S02 | Employee submits off-request for past date | employee | Rejected — past dates not allowed | P1 |
| OFF-S03 | Employee submits duplicate off-request (same date) | employee | Rejected — unique constraint | P0 |
| OFF-S04 | Employee submits off-request for already-scheduled work day | employee | Allowed (pending approval) | P1 |
| OFF-S05 | Viewer submits off-request | viewer | Denied — no write permission | P0 |
| OFF-S06 | Employee can only submit for self (not for another employee) | employee | RLS enforces `employee = self` | P0 |

### 6.2 Approve/Reject Off-Request

| # | Test Case | Role | Expected | Severity |
|---|-----------|------|----------|----------|
| OFF-A01 | Manager approves off-request for own-dept employee | manager | Status → `已批准`, `decided_by` set | P0 |
| OFF-A02 | Manager rejects off-request with reason | manager | Status → `已拒絕` | P0 |
| OFF-A03 | Manager attempts to approve other-dept off-request | manager | Denied | P0 |
| OFF-A04 | Team lead approves own-team off-request | team_lead | Status → `已批准` | P0 |
| OFF-A05 | Employee attempts to approve their own off-request | employee | Denied | P0 |
| OFF-A06 | Viewer attempts to approve any off-request | viewer | Denied | P0 |
| OFF-A07 | Approved off-request appears as `希望休` icon in schedule grid | all | `CalendarOff` icon rendered | P1 |

### 6.3 Off-Request Display Restrictions

| # | Test Case | Role | Expected | Severity |
|---|-----------|------|----------|----------|
| OFF-D01 | Employee sees only own off-requests | employee | Others' requests hidden | P0 |
| OFF-D02 | Manager sees all off-requests in own dept | manager | Dept-scoped list | P0 |
| OFF-D03 | Admin sees all off-requests across all depts | admin | Full list | P0 |

---

## 7. Labor Law Compliance — Restriction Enforcement

> `validateSchedule()` enforces Taiwan labor law as hard/soft constraints.

### 7.1 Hard Constraints (Errors — must block)

| # | Test Case | Law | Input | Expected | Severity |
|---|-----------|-----|-------|----------|----------|
| LAW-E01 | 0 rest days in 7-day week | §36 | 7 work days | `errors[]` includes §36 violation | P0 |
| LAW-E02 | 1 rest day in 7-day week | §36 | 6 work + 1 rest | `errors[]` includes §36 violation | P0 |
| LAW-E03 | 2 rest days — no error | §36 | 5 work + 2 rest | `errors.length === 0` | P0 |
| LAW-E04 | 7 consecutive work days | §36 | Mon–Sun all work | `errors[]` includes "連續工作 7 天" | P0 |
| LAW-E05 | 6 consecutive work days — no error | §36 | Mon–Sat work, Sun rest | No consecutive-work error | P0 |
| LAW-E06 | Partial week (< 7 schedules) — no false positive | §36 | 4 work days only | No error (insufficient data) | P1 |
| LAW-E07 | Multiple employees — errors scoped per employee | §36 | A valid, B invalid | Only B has errors | P0 |

### 7.2 Soft Constraints (Warnings)

| # | Test Case | Law | Input | Expected | Severity |
|---|-----------|-----|-------|----------|----------|
| LAW-W01 | 48h weekly (6 × 8h) exceeds 40h | §30 | 6 work days | `warnings[]` includes §30 | P0 |
| LAW-W02 | 40h weekly — no warning | §30 | 5 work days | No §30 warning | P0 |
| LAW-W03 | Shift gap 8h (22:00→06:00 next day) < 11h | §34 | 14-22 then 6-14 | `warnings[]` includes §34 | P0 |
| LAW-W04 | Shift gap 11h — no warning | §34 | 08-17 then 08-17 | No §34 warning (15h gap) | P0 |
| LAW-W05 | Shift gap exactly 11h — borderline pass | §34 | 08-17 then 04-12 next day | No §34 warning | P1 |
| LAW-W06 | Unparseable shift format (e.g. `輪值`) | §34 | `輪值` then `08-17` | Warning about unparseable format, no crash | P1 |
| LAW-W07 | Two rest days between work shifts — gap calc skips rest | §34 | 14-22, 休, 休, 6-14 | No false §34 warning | P1 |

### 7.3 Compliance UI Display

| # | Test Case | Expected | Severity |
|---|-----------|----------|----------|
| LAW-UI01 | Error violations show red alert with `AlertTriangle` icon | Red banner with law citation | P0 |
| LAW-UI02 | Warnings show orange alert with `Info` icon | Orange banner with law citation | P0 |
| LAW-UI03 | All-clear shows green shield banner | "排班符合勞基法規定" message | P0 |
| LAW-UI04 | Compliance re-validates when schedule changes | New shift triggers `useEffect` → `validateSchedule()` | P0 |
| LAW-UI05 | Empty schedule — no compliance banner shown | No banner rendered | P1 |
| LAW-UI06 | Law reference modal (`排班條件`) lists all 3 laws | 勞基法, 性平法, 職安法 sections visible | P1 |

---

## 8. Shift Assignment Restrictions

> What values can be assigned, and edge-case guards.

| # | Test Case | Expected | Severity |
|---|-----------|----------|----------|
| SHIFT-01 | Only predefined SHIFT_TYPES can be selected | Picker shows exactly: 08-17, 09-18, 10-19, 11-20, 12-21, 輪值, 休 | P0 |
| SHIFT-02 | No free-text shift entry (UI enforces picker) | No text input — buttons only | P0 |
| SHIFT-03 | Cancel button in shift picker closes without saving | `editCell` set to null, no DB call | P1 |
| SHIFT-04 | Clicking same cell toggles picker open/closed | Second click closes picker | P2 |
| SHIFT-05 | Assign shift to national holiday (§37) — visual indicator | Holiday date highlighted or warned | P1 |
| SHIFT-06 | Female employee assigned night shift (22:00–06:00) — §49 warning | Compliance warning about 勞基法 §49 | P1 |
| SHIFT-07 | Pregnant employee scheduled — 職安法 §30-1 warning | Warning about prohibited work | P1 |
| SHIFT-08 | Nursing employee — 性平法 §18 哺乳時間 factored in | Warning or 1h deduction from work hours | P2 |

---

## 9. Week Navigation & Data Boundary Restrictions

| # | Test Case | Expected | Severity |
|---|-----------|----------|----------|
| NAV-01 | Navigate to previous week — new data loaded | `weekOffset - 1`, fresh query to Supabase | P0 |
| NAV-02 | Navigate to next week — new data loaded | `weekOffset + 1`, fresh query | P0 |
| NAV-03 | Return to current week via "本週" button | `weekOffset = 0` | P0 |
| NAV-04 | Schedule data strictly bounded by `weekStart`–`weekEnd` | No data from adjacent weeks bleeds in | P0 |
| NAV-05 | Editing past-week schedule — allowed for admin | Admin can back-fill | P1 |
| NAV-06 | Editing past-week schedule — denied for employee | Employee cannot change history | P1 |
| NAV-07 | Far-future week (> 4 weeks ahead) — still functional | No arbitrary date limit | P2 |

---

## 10. Filter Restrictions

> Dept and store filters must respect the user's own scope.

| # | Test Case | Expected | Severity |
|---|-----------|----------|----------|
| FLT-01 | No filter — all permitted employees shown | `filtered` includes all accessible employees | P0 |
| FLT-02 | Dept filter applied — only that dept's employees shown | Grid rows filtered | P0 |
| FLT-03 | Store filter applied — only that store's employees shown | Grid rows filtered | P0 |
| FLT-04 | Both filters combined — intersection of dept + store | Only employees matching both | P0 |
| FLT-05 | Switching filter clears previous selection | No stale filter state | P1 |
| FLT-06 | Manager sees only own-dept options in dept dropdown | Cannot filter into other depts | P1 |
| FLT-07 | Empty filter result — "無員工" message shown | `colspan=8` centered message | P1 |
| FLT-08 | AI auto-schedule uses filtered list, not all employees | Only `filtered.length` employees processed | P0 |

---

## 11. Overtime Pay Calculation Restrictions

> `calculateOvertimePay()` must follow §32 rate tiers exactly.

| # | Test Case | Input | Expected | Severity |
|---|-----------|-------|----------|----------|
| OT-01 | Weekday OT 2h — 1.34× only | base=30000, hours=2 | `Math.round(125 × 2 × 1.34) = 335` | P0 |
| OT-02 | Weekday OT 4h — first 2h @1.34 + next 2h @1.67 | base=30000, hours=4 | `335 + 418 = 753` | P0 |
| OT-03 | Rest day OT 2h — 1.34× | type=restday | Same as weekday for first 2h | P0 |
| OT-04 | Rest day OT 8h — 1.34 + 1.67 tiers | type=restday | `335 + 1253 = 1588` | P0 |
| OT-05 | Rest day OT 10h — includes 2.67× tier | type=restday | Includes `125 × 2 × 2.67` | P0 |
| OT-06 | Holiday OT — 2× flat | type=holiday | `125 × 8 × 2 = 2000` | P0 |
| OT-07 | Unknown type — returns 0 | type=xyz | `0` | P1 |
| OT-08 | 0 hours — returns 0 | hours=0 | `0` | P1 |
| OT-09 | Negative hours — handled gracefully | hours=-2 | `0` or error, no negative pay | P1 |
| OT-10 | Very high base salary — no overflow | base=200000 | Correct calculation | P2 |

---

## 12. Security — API-Level Restrictions

> Tests that bypass the UI and hit Supabase directly.

| # | Test Case | Method | Expected | Severity |
|---|-----------|--------|----------|----------|
| SEC-01 | Anon key SELECT on `schedules` | GET | RLS returns empty / 403 | P0 |
| SEC-02 | Anon key INSERT into `schedules` | POST | RLS denies | P0 |
| SEC-03 | Employee-role INSERT for another employee's schedule | POST | RLS denies (if employee != self) | P0 |
| SEC-04 | Employee-role UPDATE on existing schedule | PATCH | RLS denies | P0 |
| SEC-05 | Viewer-role INSERT | POST | RLS denies | P0 |
| SEC-06 | Cross-tenant SELECT via tampered `app.tenant_id` | GET | RLS denies — `set_config` is session-scoped | P0 |
| SEC-07 | SQL injection in employee name field | INSERT | Supabase parameterized query — safe | P0 |
| SEC-08 | XSS in shift value — rendered safely | UI render | React escapes HTML entities | P0 |
| SEC-09 | Mass INSERT (> 1000 rows) — rate limited or bounded | POST | Reasonable batch size enforced | P1 |
| SEC-10 | Concurrent edits — same cell by two users | UPSERT | Last-write-wins or conflict handled | P2 |

---

## 13. Error Handling & Edge Cases

| # | Test Case | Expected | Severity |
|---|-----------|----------|----------|
| ERR-01 | Supabase connection failure on page load | Error message shown: "資料載入失敗" + reload button | P0 |
| ERR-02 | Schedule query fails mid-week-change | Previous data cleared, error logged | P1 |
| ERR-03 | Shift assignment fails (network error) | Cell reverts, user notified | P0 |
| ERR-04 | AI auto-schedule with 0 filtered employees | No-op or informative message | P1 |
| ERR-05 | Employee with no `name` in DB | Row skipped or handled gracefully | P2 |
| ERR-06 | `locations` table query (currently bugs — should be `stores`) | Data loads from correct table | P0 (BUG) |
| ERR-07 | `minStaff` set to 0 or negative | Clamped to 1 minimum | P1 |
| ERR-08 | `minStaff` set higher than total employees | All employees scheduled to work, no infinite loop | P1 |

---

## Test Execution Matrix

### By Role (横軸 = action, 纵軸 = role)

| Action | admin | manager | team_lead | employee | viewer | anon |
|--------|-------|---------|-----------|----------|--------|------|
| View all schedules | ✅ | own dept | own team | self only | ✅ read-only | ❌ |
| Edit shift cell | ✅ | own dept | own team | ❌ | ❌ | ❌ |
| AI auto-schedule | ✅ | own dept | ❌ | ❌ | ❌ | ❌ |
| Copy last week | ✅ | own dept | ❌ | ❌ | ❌ | ❌ |
| Submit off-request | ✅ | ✅ | ✅ | self only | ❌ | ❌ |
| Approve off-request | ✅ | own dept | own team | ❌ | ❌ | ❌ |
| Delete schedule entry | ✅ | own dept | ❌ | ❌ | ❌ | ❌ |
| View compliance alerts | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| View law reference modal | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Change minStaff | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

### By Layer

| Layer | Tool | Cases | Focus |
|-------|------|-------|-------|
| Unit | Vitest | 28 | `validateSchedule()`, `calculateOvertimePay()`, shift-gap math |
| Component | Vitest + RTL | 35 | Conditional button rendering, picker behavior, role-based UI |
| Integration | Vitest + MSW | 42 | Supabase RLS policies, cross-tenant isolation, RBAC enforcement |
| E2E | Playwright | 32 | Full user journeys per role, AI auto-schedule flow, week navigation |
| Security | Playwright + Supabase client | 10 | Direct API abuse, injection, rate limits |

---

## Priority Summary

| Priority | Count | Description |
|----------|-------|-------------|
| P0 | 82 | Must-pass — security boundaries, auth, tenant isolation, core RBAC |
| P1 | 45 | Should-pass — edge cases, scoped permissions, data integrity |
| P2 | 20 | Nice-to-have — UX polish, extreme edge cases |

---

## Known Gaps (require code changes before tests can pass)

| Gap | File | Issue | Required Fix |
|-----|------|-------|-------------|
| GAP-1 | `supabase-schema.sql` | `schedules` and `off_requests` tables not defined | Add CREATE TABLE + RLS policies |
| GAP-2 | `Schedule.jsx:57` | Queries `locations` instead of `stores` | Change to `supabase.from('stores')` |
| GAP-3 | `Schedule.jsx` | No role checks — any authenticated user can CRUD | Add `useAuth()` permission guards |
| GAP-4 | `Schedule.jsx` | No tenant_id on INSERT/UPSERT | Include `tenant_id` from `useTenant()` |
| GAP-5 | `Schedule.jsx` | No delete functionality exists | Add delete handler with RBAC |
| GAP-6 | `laborLaw.js` | No §49 female night-work validation | Add gender-aware shift validation |
| GAP-7 | `laborLaw.js` | No 職安法 §30-1 pregnancy check | Add pregnancy status validation |
| GAP-8 | Schema | No `schedule.view`, `schedule.create`, `schedule.auto` permissions | Add to `permissions` table seed |
| GAP-9 | `Schedule.jsx` | `minStaff` has no lower-bound clamp | Add `Math.max(1, value)` |
| GAP-10 | `off_requests` | No approval workflow (status/decided_by columns) | Extend table + add approval UI |

---

## Suggested SQL for Missing Schema (prerequisite to running tests)

```sql
-- schedules table
CREATE TABLE IF NOT EXISTS schedules (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee TEXT NOT NULL,
  date DATE NOT NULL,
  shift TEXT DEFAULT '休',
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, employee, date)
);

ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_schedules ON schedules
  USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

-- off_requests table
CREATE TABLE IF NOT EXISTS off_requests (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee TEXT NOT NULL,
  date DATE NOT NULL,
  reason TEXT,
  status TEXT DEFAULT '待審核',
  requested_at TIMESTAMPTZ DEFAULT now(),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  UNIQUE(tenant_id, employee, date)
);

ALTER TABLE off_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_off_requests ON off_requests
  USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

-- Schedule permissions
INSERT INTO permissions (code, name, module) VALUES
  ('schedule.view', '查看排班', '人資'),
  ('schedule.create', '建立/編輯排班', '人資'),
  ('schedule.delete', '刪除排班', '人資'),
  ('schedule.auto', 'AI自動排班', '人資'),
  ('off_request.create', '申請希望休', '人資'),
  ('off_request.approve', '批准希望休', '人資');
```
