# SME Ops Mobile — Build Plan

**App:** `sme_ops_mobile` · Flutter 3.x / Dart ^3.11.4  
**Last updated:** 2026-05-22  
**Companion to:** `sme-ops` React web app (Supabase backend shared)

---

## Current State

### Infrastructure — Done
- `main.dart` — Supabase init, ProviderScope, dark theme
- `core/auth/auth_provider.dart` — Supabase auth stream, `isAuthenticatedProvider`
- `core/tenant/tenant_provider.dart` — tenant ID + store name persisted via SharedPreferences
- `core/theme/app_theme.dart` — dark theme, `AppColors` token class
- `app/router.dart` — go_router with auth redirect guard, ShellRoute
- `app/shell_page.dart` — bottom nav (5 tabs: Dashboard, HR, Approvals, POS, Analytics)
- `app/login_page.dart` — login screen scaffold

### Module Pages — All stubs
| Route | File | Status |
|-------|------|--------|
| `/` | `dashboard_page.dart` | stub |
| `/hr` | `hr_page.dart` | stub |
| `/approvals` | `approvals_page.dart` | stub |
| `/pos` | `pos_page.dart` | stub |
| `/crm` | `crm_page.dart` | stub |
| `/wms` | `wms_page.dart` | stub |
| `/lms` | `lms_page.dart` | stub |
| `/analytics` | `analytics_page.dart` | stub |

> CRM, WMS, LMS are routed but not in the bottom nav yet.

---

## Architecture Decisions

| Concern | Choice | Reason |
|---------|--------|--------|
| State | Riverpod 2 + riverpod_generator | mirrors web app's unidirectional data flow |
| Navigation | go_router 14 | deep links, auth redirect, shell routes |
| Backend | supabase_flutter 2 | shared DB/auth with web |
| Offline cache | Drift (SQLite) | typed queries, migrations, works offline |
| Charts | fl_chart | no JS bridge, native rendering |
| Scanning | mobile_scanner | barcode/QR for POS and WMS |
| Push | flutter_local_notifications | approval request alerts |

---

## Phase 1 — Core Infrastructure ✅ COMPLETE (2026-05-22)

### 1.1 Login Page ✅
- [x] Email + password form with validation
- [x] Supabase `signInWithPassword` call
- [x] Error display (wrong credentials, network error)
- [x] Loading state

### 1.2 Offline-First Data Layer (`core/data/`) ✅
- [x] Drift `AppDatabase` with 4 tables: `CachedApprovals`, `KpiSnapshots`, `PosProducts`, `PendingLocalActions`
- [x] `SyncService` — pulls from Supabase, writes to Drift; flushes offline action queue on reconnect
- [x] `connectivity_provider.dart` — `isOnlineProvider` stream via `connectivity_plus`
- [x] Optimistic offline queue in `PendingLocalActions` (approve/reject synced on next online)

### 1.3 Profile & Role Provider (`core/auth/`) ✅
- [x] `profileProvider` — fetches `employees` row by email, joins `roles(name)`
- [x] `roleProvider` — convenience provider exposing role string
- [x] Available for router role-gating in Phase 2

### 1.4 Tenant Selector ✅
- [x] `TenantSelectorPage` — lists active stores from Supabase, tap to select
- [x] Router redirect: unauthenticated → `/login`, no tenant → `/tenant-select`
- [x] `clearTenant()` on notifier — store-switch button in AppBar
- [x] Store name shown in shell AppBar; logout button wired

---

## Phase 2 — High-Value Mobile Modules (Priority: High)

These are the primary reason to have a mobile companion app.

### 2.1 Approvals (`/approvals`) — Killer Feature
Mobile approval is the #1 driver of adoption.

- [ ] List pending approvals from `pending_approvals` table (filtered by tenant + approver role)
- [ ] Card per request: type badge (Leave / PO / Expense), requester name, amount/duration, date
- [ ] Swipe-to-approve / swipe-to-reject gesture
- [ ] Approve/Reject detail sheet with optional comment
- [ ] Push notification on new approval request (Supabase Realtime)
- [ ] Approval history tab (past 30 days)
- [ ] Offline queue: action stored in Drift, synced when back online

### 2.2 Dashboard (`/`)
- [ ] KPI summary cards: Today's Revenue, Pending Approvals count, Active Staff, Inventory Alerts
- [ ] Revenue sparkline chart (fl_chart `LineChart`, last 7 days)
- [ ] Quick-action buttons: Approvals, POS, New Attendance
- [ ] Pull-to-refresh
- [ ] Greeting with user name from `profileProvider`
- [ ] Offline mode: show cached `kpi_snapshots` with last-sync timestamp

### 2.3 POS (`/pos`)
Mobile POS for counter staff.

- [ ] Product search (text) + barcode scan via `mobile_scanner`
- [ ] Cart: add/remove items, quantity stepper, line total
- [ ] Discount input (% or fixed)
- [ ] Payment methods: Cash / QR / Card (record type only, no gateway)
- [ ] Receipt summary screen post-sale
- [ ] Write completed sale to `sales` table in Supabase
- [ ] Offline: queue sale in Drift, sync on reconnect with conflict check

---

## Phase 3 — Secondary Modules (Priority: Medium)

### 3.1 HR (`/hr`)
- [ ] Attendance clock-in / clock-out (GPS timestamp to `attendance` table)
- [ ] Leave request form (type, dates, reason) — creates pending approval
- [ ] My leave balance card
- [ ] Staff directory list with search

### 3.2 CRM (`/crm`)
- [ ] Customer list with search
- [ ] Customer detail: contact info, purchase history summary
- [ ] Log a call/visit note
- [ ] Follow-up reminder (local notification)

### 3.3 WMS (`/wms`)
- [ ] Inventory lookup by barcode scan or text search
- [ ] Stock level badge (OK / Low / Out)
- [ ] Stock adjustment form (quantity delta + reason)
- [ ] Receive goods: scan item, enter quantity, confirm

### 3.4 Analytics (`/analytics`)
- [ ] Period selector (Today / Week / Month)
- [ ] Revenue bar chart (fl_chart `BarChart`)
- [ ] Top 5 products table
- [ ] Staff performance table (sales per staff)

---

## Phase 4 — Extended Features (Priority: Low)

### 4.1 LMS (`/lms`)
- [ ] Course list with progress indicator
- [ ] Video/article content viewer
- [ ] Quiz with pass/fail result
- [ ] Certificate download via `url_launcher`

### 4.2 Remote Push Notifications
- [ ] Integrate FCM for server-triggered background pushes
- [ ] Supabase Edge Function triggers FCM on new approval row insert
- [ ] Deep link: tapping notification opens `/approvals`

### 4.3 Biometric Auth
- [ ] `local_auth` — FaceID / fingerprint re-auth after backgrounding
- [ ] Toggle in Settings

### 4.4 Settings Screen
- [ ] Theme toggle (dark/light)
- [ ] Language switcher (zh-TW / en) — `intl` already a dep, add ARB files
- [ ] Sign out
- [ ] App version (`package_info_plus`)
- [ ] Clear offline cache

### 4.5 Navigation — More Tab
- [ ] Move CRM, WMS, LMS, Settings into a "More" drawer or 5th tab
- [ ] Bottom nav stays at 5 items: Dashboard · Approvals · POS · HR · More

---

## Target File Structure

```
lib/
├── main.dart
├── app/
│   ├── router.dart                   done
│   ├── shell_page.dart               done
│   └── login_page.dart               needs UI
├── core/
│   ├── auth/
│   │   ├── auth_provider.dart        ✅ done
│   │   └── profile_provider.dart     ✅ phase 1
│   ├── data/
│   │   ├── app_database.dart         ✅ phase 1 (Drift — run build_runner)
│   │   ├── app_database.g.dart       ⚠️  generated — run: dart run build_runner build
│   │   ├── sync_service.dart         ✅ phase 1
│   │   └── connectivity_provider.dart ✅ phase 1
│   ├── tenant/
│   │   ├── tenant_provider.dart      ✅ done (+ clearTenant added)
│   │   └── tenant_selector_page.dart ✅ phase 1
│   └── theme/
│       └── app_theme.dart            ✅ done
└── modules/
    ├── dashboard/
    │   ├── dashboard_page.dart       phase 2
    │   └── dashboard_provider.dart   phase 2
    ├── approvals/
    │   ├── approvals_page.dart       phase 2
    │   ├── approvals_provider.dart   phase 2
    │   └── approval_card.dart        phase 2
    ├── pos/
    │   ├── pos_page.dart             phase 2
    │   ├── pos_provider.dart         phase 2
    │   └── scanner_widget.dart       phase 2
    ├── hr/hr_page.dart               phase 3
    ├── crm/crm_page.dart             phase 3
    ├── wms/wms_page.dart             phase 3
    ├── analytics/analytics_page.dart phase 3
    └── lms/lms_page.dart             phase 4
```

---

## Recommended Build Order

```
1. Login UI (1.1)
2. Drift DB + SyncService (1.2)
3. Profile / Role providers (1.3)
4. Tenant selector UI (1.4)
-- Phase 1 complete --
5. Approvals list + swipe actions + offline queue (2.1)
6. Dashboard KPIs + chart + offline (2.2)
7. POS cart + scanner + offline sale (2.3)
-- Phase 2 complete --
8. HR attendance + leave (3.1)
9. Analytics charts (3.4)
10. CRM (3.2)
11. WMS (3.3)
-- Phase 3 complete --
12. LMS, FCM, biometrics, settings (4.x)
```

---

## Shared Supabase Tables

| Table | Module |
|-------|--------|
| `profiles` | Auth, HR, Shell AppBar |
| `stores` | Tenant selector |
| `pending_approvals` | Approvals |
| `attendance` | HR |
| `leave_requests` | HR → Approvals |
| `purchase_orders` | Approvals |
| `products` / `inventory` | POS, WMS |
| `sales` | POS, Analytics |
| `customers` | CRM |
| `kpi_daily_snapshots` | Dashboard |

---

## Open Questions

1. **FCM vs Supabase Realtime for push** — Realtime works in-app; FCM needed for background pushes. Use both?
2. **CRM / WMS in bottom nav?** — Currently 5 tabs. Add a "More" tab or use a drawer?
3. **iOS only, Android only, or both?** — `mobile_scanner` and `flutter_local_notifications` require platform config on both.
4. **Multi-language (i18n)?** — `intl` is already a dep. Add `flutter_localizations` + ARB files?
5. **Offline conflict resolution for POS sales** — Last-write-wins or server-authoritative?
