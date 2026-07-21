# SME Ops Mobile — App Design & Build Scope

**App:** `sme_ops_mobile` · Flutter 3.x / Dart ^3.11.4
**Companion to:** `sme-ops` React web ERP (shared Supabase backend)
**Last updated:** 2026-07-21 (design pivot)
**Status:** Design agreed; infrastructure built; feature screens not yet implemented.

> **Replaces the earlier draft of this plan (2026-05-22)**, which targeted a **5-tab, 8-module** app (Dashboard · Approvals · POS · HR · Analytics + CRM/WMS/LMS) on a **dark** theme. The current direction is **3 sections on the web light theme**, below. The prior infra/architecture choices (Riverpod, go_router, Drift, Phase-1 completion) remain valid and are summarised in §11 and §14.

---

## 1. TL;DR — current direction

1. **Scope narrowed to 3 sections:** **Dashboard · 人資 (HRM) · 專案 (Projects)**. POS, CRM, WMS, LMS, Analytics are **dropped from mobile scope**.
2. **Theme switched to the web app's LIGHT palette.** Mobile no longer uses its own dark theme — it mirrors `src/index.css` `[data-theme="light"]` tokens exactly. *(Code change already applied — see §4.)*
3. **Dashboard is role-aware via two sub-tabs: 個人 / 主管.** Not a separate nav tab. The 主管 sub-tab scales by role (store manager → own team; owner/CEO → whole company).
4. **主管 dashboard priorities (in order):** ① Exception alerts → ② Executive approvals → ③ Project portfolio. Store ranking de-prioritized.
5. **No new backend/API needed.** Reuse Supabase's auto REST API + existing RPCs. The only prep work is pushing **3 pieces of client-side HR logic into RPCs** (§8).
6. **Offline: already built.** **Notifications: in-app works via DB table; background push is new infra.** (§9–10)
7. **Design mockup (4 phone screens):** https://claude.ai/code/artifact/9488b8f2-686e-4c9f-a54f-467541e3460f

---

## 2. Product principle & scope

The web app is for **desk work** (HR admins configuring payroll, building schedules). The phone is for the **20% that happens away from a desk**: checking your day, approving things, updating task status, clocking in. Every screen answers *"what do I need to do or know right now?"* — not *"manage the whole system."*

**In scope (mobile):**
- Personal self-service: clock in/out, my schedule, leave/overtime/punch-correction/business-trip requests, my request status, leave balances.
- Manager/exec oversight: approvals inbox, team view, exception alerts, executive approvals, project portfolio, company KPIs.
- Project work: my tasks, status updates, task confirmation, comments + photo attach, template deploy (browse + one-tap).

**Out of scope (stays on web / LIFF):** POS, CRM, WMS, LMS, full Analytics, payroll/NHI/insurance configuration, schedule building, template editing.

---

## 3. Navigation

Replaces the old 5-tab bar with **3 tabs**:

```
┌─────────────────────────────────────┐
│  [Store name ▾]           🔔  👤      │  app bar: tenant switch + notifications
├─────────────────────────────────────┤
│            (section content)          │
├─────────────────────────────────────┤
│   🏠 儀表板    👥 人資    📋 專案      │  3 tabs
└─────────────────────────────────────┘
```

Everything is **role-aware** via existing RBAC + `manager_scope` RLS. Employees see self-service; managers/owners get extra sections unlocked.

---

## 4. Design system & theme

**Change applied this session** — the mobile theme now mirrors the web design tokens exactly, LIGHT as default.

| File | Change |
|------|--------|
| [`lib/core/theme/app_theme.dart`](lib/core/theme/app_theme.dart) | Rewrote `AppColors` to match [`../src/index.css`](../src/index.css) 1:1 (old values were wrong, e.g. cyan was Material `#00BCD4`). Added `AppColorsDark` + `AppTheme.dark()` for parity; `AppTheme.light()` is the default. |
| [`lib/main.dart`](lib/main.dart) | `theme: AppTheme.dark()` → `AppTheme.light()`. |

### Palette (web light `[data-theme="light"]`)

| Token | Hex | Role |
|-------|-----|------|
| bg-primary | `#F4F7FC` | app background |
| bg-secondary | `#EEF2F9` | app bar / nav bar |
| bg-card | `#FFFFFF` | cards |
| text-primary | `#0F172A` | headings / body |
| text-secondary | `#334155` | secondary text |
| text-muted | `#64748B` | hints / captions |
| **accent-cyan** | `#0E7490` | **primary / CTA** |
| accent-green | `#10B981` | success |
| accent-orange | `#F59E0B` | warning |
| accent-red | `#EF4444` | error |
| accent-blue | `#3B82F6` | info |
| accent-purple | `#8B5CF6` | highlight |

### Rules (inherited from web `CLAUDE.md`)
- **Fixed semantic mapping:** success=green · warning=orange · error=red · info=blue · primary=cyan · highlight=purple.
- **Status must pair color with icon + text** — no color-only meaning.
- Tinted chips use `-dim` variants (~10% alpha on light).
- `#FFFFFF` is the only allowed literal (inverse text on accent backgrounds).
- Tabular numerals for all aligned digits (times, hours, %, money).

### Shared widgets to build once (`lib/core/widgets/`)
`StatusChip` · `SectionCard` · `DateRangeField` · `ApprovalCard` · `ProgressRing` · `KpiTile` · `Sparkline` (fl_chart).

---

## 5. Section 1 — Dashboard (儀表板)

Two sub-tabs via a top segmented control: **個人 / 主管**.

### 5a. 個人 (personal) — "my today"
Card feed, pull-to-refresh triggers `syncAll()`:
- **今日班表** + one-tap clock-in (GPS / store validation)
- **待辦** badge, overdue in red
- **假勤餘額** mini bars (特休 / 補休)
- **我的申請進度** (leave / overtime / punch-correction sign-off status)

### 5b. 主管 (manager / exec) — scales by role
Store manager sees own team; owner sees 全公司. **Priority order (confirmed):**
1. **① 異常警示 (Exception alerts)** — margin anomalies, staffing gaps, attrition risk (wires into web [`AttritionPrediction`](../src/pages/hr/AttritionPrediction.jsx)). Push-notifiable.
2. **② 待我核決 (Executive approvals)** — over-limit expenses, headcount requests — one-tap sign-off, only what the role must sign.
3. **③ 專案組合 (Project portfolio)** — health of all 展店/專案: behind-schedule / over-budget / blocked.
4. Company revenue trend (sparkline) as background context; store ranking optional/secondary.

---

## 6. Section 2 — 人資 (HRM)

Segmented **我的 / 團隊**.

**Employee (self-service):**
- Clock in/out (GPS/store validation) + punch-correction
- My schedule (week/month), shift-swap request
- Leave apply + balances + calendar
- Overtime apply (net-hours) + status
- Business-trip / early-leave quick forms
- My profile (contact, emergency contact, documents)

**Manager lane (role-gated):**
- **Approvals inbox** (killer feature) — approve/reject leave, overtime, punch-corrections, expenses; **offline-capable** (queue already coded); swipe actions + signoff-chain detail.
- Team view — who's on shift / on leave, headcount.
- Read-only team schedule glance.

---

## 7. Section 3 — 專案 (Projects)

Maps to `projects` / `tasks` / `project_sections` / `project_members` / `project_comments` (see [`../fix-projects-table.sql`](../fix-projects-table.sql)).

- **Project list & detail** — progress ring, status/priority, budget vs spent, sections, members, comments, custom fields.
- **Task list** grouped by section/status (mobile uses **list, not Kanban**; Kanban optional horizontal fallback).
- **My tasks** — due today/this week, overdue highlighted.
- **Task interactions:** tap to move 待處理→進行中→完成; task confirmation (approve/reject, uses `tasks.confirmation_*` columns); comment thread + **camera photo attach** (`image_picker` already a dep); task-bound forms.
- **Templates:** browse + one-tap deploy from `project_templates` (e.g. "新品牌展店專案" = 20 flows / 132 tasks). Editing stays on web.

---

## 8. Backend & API — changes needed

**No new API server.** Supabase = Postgres + auto REST (PostgREST) + Auth + RLS; `supabase_flutter` is that client. [`lib/core/data/sync_service.dart`](lib/core/data/sync_service.dart) already queries tables directly. RLS (`manager_scope`, dept-manager policies) already scopes both web and mobile identically.

**Existing RPC layer is strong (~90 functions)** — mobile reuses these as-is:
- Approvals/chain: `web_advance_chain_request`, `expense_step_advance`, `form_submission_chain_approve`, `secure_update_leave_status`, `secure_update_overtime_status`
- Tasks: `web_complete_task`, `web_approve_task_step`, `web_create_task_comment_with_mentions`
- Misc: `get_comp_time_balance`, `classify_ot_category_safe`, `web_respond_shift_swap_peer`, `soft_delete_request`, all `web_list_my_*` readers.

### ⚠️ The real prep work — 3 RPCs to add before mobile

These compute a business value **in the browser** then write it, so mobile would have to duplicate the math in Dart (drift risk). Push each into Postgres:

| # | Logic | Lives now in | Blocks mobile | Add RPC |
|---|-------|--------------|---------------|---------|
| 1 | **Overtime net-hours / rest deduction** (淨工時階梯) | [`../src/lib/scheduleUtils.js`](../src/lib/scheduleUtils.js) → direct insert in [`../src/pages/hr/Overtime.jsx`](../src/pages/hr/Overtime.jsx) (L298) | 加班申請 | `create_overtime_request` (compute net hours server-side) |
| 2 | **Leave days/hours + weekend/holiday deduction + entitlement + validation** | [`../src/lib/leavePolicy.js`](../src/lib/leavePolicy.js) (L300–408) + inline calc in [`../src/pages/hr/Leave.jsx`](../src/pages/hr/Leave.jsx) (L205–216) | 請假申請 | `create_leave_request` / `calc_leave_hours` + `validate_leave` |
| 3 | **Clock-in/out validation + attendance net-hours** | direct writes in [`../src/pages/hr/Attendance.jsx`](../src/pages/hr/Attendance.jsx) (L305); rules + net-hours client-side | 打卡 | `clock_in` / `clock_out` (store/GPS check + net-hours) |

> **Bonus payoff:** [`Leave.jsx`](../src/pages/hr/Leave.jsx) literally comments *"跟 LIFF 對齊：日 mode 扣週末+國假"* — this leave logic is **already duplicated** between the web app and the LINE **LIFF** mini-app (`VITE_LIFF_ID`). Adding mobile makes a **third copy**. Centralizing into an RPC removes an existing web↔LIFF maintenance hazard, not just an unblock for mobile.

### 🟢 Low risk — thin CRUD (no migration)
`business_trips`, `expenses`, `headcount_requests` inserts ([`../src/lib/db/hr.js`](../src/lib/db/hr.js) L106–246) and most project/task field updates are plain "data-in + status update" writes. RLS guards them; mobile calls the same tables or wraps trivially.

### ⛔ Out of scope — leave as-is
Payroll / NHI / insurance / depreciation client calcs ([`../src/lib/payrollCalc.js`](../src/lib/payrollCalc.js), [`../src/lib/nhiSupplement.js`](../src/lib/nhiSupplement.js)) — not a mobile feature.

---

## 9. Notifications

- **In-app: works today.** Web writes to a `notifications` table (`notify_project_members` RPC, fired by EventBus handlers). Mobile can **read + cache** it now → 🔔 badge and list with zero new backend.
- **Background push: NEW infra.** `flutter_local_notifications` is in `pubspec.yaml` but **completely unwired** (no code in `mobile/lib`). No FCM/APNs, no push server. Real push (app closed) needs: **FCM + a trigger** (Supabase Edge Function or DB webhook on `notifications` insert) + deep-link to the relevant screen. Deferred to a later phase.

---

## 10. Offline — already built

- [`lib/core/data/sync_service.dart`](lib/core/data/sync_service.dart) — pulls approvals/KPI/products into Drift, flushes `pendingLocalActions` on reconnect.
- Drift SQLite local DB (`app_database.dart`), `connectivity_provider.dart` (`isOnlineProvider`).
- **Offline approval queue works** — approve/reject while disconnected, auto-sync on reconnect.
- **Extend the same pattern** to leave/schedule/tasks sync + write-back.

---

## 11. Current infrastructure state (from Phase 1 — complete)

Built and valid (unchanged by this pivot):
- `main.dart` — Supabase init, ProviderScope (theme now light)
- `core/auth/` — `auth_provider` (Supabase auth stream), `profile_provider` (employees row + role), `roleProvider`
- `core/tenant/` — tenant id + store name persisted (SharedPreferences), `TenantSelectorPage`, `clearTenant()`
- `core/data/` — Drift `AppDatabase` (`CachedApprovals`, `KpiSnapshots`, `PosProducts`, `PendingLocalActions`), `SyncService`, `connectivity_provider`
- `app/router.dart` — go_router with auth redirect + ShellRoute
- `app/shell_page.dart` — bottom nav (**currently 5 tabs → change to 3**)
- `app/login_page.dart` — login scaffold

**Architecture choices:** Riverpod 2 (+generator), go_router 14, supabase_flutter 2, Drift (offline), fl_chart, mobile_scanner, image_picker.

---

## 12. Build phasing

| Phase | Ship | Notes |
|-------|------|-------|
| **0 · Foundation** | Real Dashboard (個人/主管) + shared light-themed widgets; change shell to 3 tabs; extend `sync_service` for tasks/leave/schedule | Infra already done |
| **0.5 · RPC prep** | Add the 3 RPCs (§8): `create_overtime_request`, `create_leave_request`, `clock_in/out` | Also de-dupes LIFF logic |
| **1 · HRM self-service** | Clock in/out, My Schedule, Leave apply+balance, Overtime | Highest daily-use frequency |
| **2 · Approvals** | Manager approvals inbox (offline queue already coded) | Biggest away-from-desk win |
| **3 · Projects** | My tasks, status updates, task confirmation, comments + photo | Completes 3rd section |
| **4 · Exec + polish** | 主管 dashboard (alerts/approvals/portfolio), KPI charts, in-app notifications, template deploy | |
| **5 · Push (optional)** | FCM + Edge Function trigger + deep links | New infra |

---

## 13. Decisions log & open questions

**Answered this session:**
- Scope = 3 sections (Dashboard/HRM/Projects); drop POS/CRM/WMS/LMS/Analytics.
- Theme = web light tokens (not dark). *(applied)*
- CEO/exec access = **two sub-tabs under Dashboard (個人 / 主管)**, not a 4th nav tab.
- Exec priorities = **exception alerts, executive approvals, project portfolio** (store ranking secondary).

**Open:**
1. Primary persona weighting — blended role-aware assumed; confirm if manager-first or employee-first.
2. Push: in-app only for v1, or build FCM background push?
3. iOS / Android / both (platform config for scanner + notifications).
4. i18n — zh-TW only for v1, or add `flutter_localizations` + ARB (en)?
5. Offline conflict policy for HR writes (last-write-wins vs server-authoritative).

---

## 14. Key files

**Mobile (this repo, `mobile/`):**
- [`lib/main.dart`](lib/main.dart) — entrypoint, Supabase init, theme
- [`lib/app/router.dart`](lib/app/router.dart) — go_router + auth redirect (currently routes 8 module stubs)
- [`lib/app/shell_page.dart`](lib/app/shell_page.dart) — bottom nav (currently 5 tabs → change to 3)
- [`lib/core/theme/app_theme.dart`](lib/core/theme/app_theme.dart) — light/dark web tokens
- [`lib/core/data/sync_service.dart`](lib/core/data/sync_service.dart) — offline sync + action queue
- [`lib/core/auth/`](lib/core/auth/) · [`lib/core/tenant/`](lib/core/tenant/) — auth, profile/role, tenant scoping
- [`lib/modules/`](lib/modules/) — 8 placeholder pages (only 3 needed going forward)

**Web backend references (`../`):**
- [`../src/index.css`](../src/index.css) — source of truth for color tokens
- [`../fix-projects-table.sql`](../fix-projects-table.sql) — projects/tasks schema
- [`../src/lib/scheduleUtils.js`](../src/lib/scheduleUtils.js) · [`../src/lib/leavePolicy.js`](../src/lib/leavePolicy.js) — HR logic to migrate to RPC
- [`../src/pages/hr/`](../src/pages/hr/) — ~50 HR pages (self-service subset feeds mobile)
- [`../src/pages/process/`](../src/pages/process/) — Projects/Tasks/Templates/Workflows engine

**Design mockup:** https://claude.ai/code/artifact/9488b8f2-686e-4c9f-a54f-467541e3460f
