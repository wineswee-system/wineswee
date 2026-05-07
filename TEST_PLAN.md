# SME-OPS Full Automation Test Plan

> **Date**: 2026-04-05
> **Version**: v1.0
> **Application**: SME-OPS ERP (React 19 / Vite 6 / Supabase)
> **Scope**: 100+ pages, 22 lib modules, 12 functional modules

---

## 1. Test Strategy Overview

### 1.1 Test Pyramid

```
          ╱  E2E Tests  ╲          ← 15% — Critical user journeys (Playwright)
         ╱  Integration   ╲        ← 25% — Cross-module workflows, API, routing
        ╱   Component      ╲       ← 25% — Page-level rendering, user interactions
       ╱    Unit Tests      ╲      ← 35% — Lib engines, pure logic, calculations
```

### 1.2 Technology Stack

| Layer | Tool | Purpose |
|-------|------|---------|
| Unit + Component | **Vitest** + React Testing Library | Fast, Vite-native, JSX support |
| E2E | **Playwright** | Cross-browser, reliable, built-in assertions |
| Coverage | **v8** (via Vitest) | Line/branch/function coverage |
| CI | **GitHub Actions** | Automated on every PR |
| Visual Regression | **Playwright Screenshots** | Catch unintended UI changes |
| API Mocking | **MSW (Mock Service Worker)** | Intercept Supabase calls without backend |

### 1.3 Coverage Targets

| Metric | Target | Minimum |
|--------|--------|---------|
| Line coverage (lib/) | 90% | 80% |
| Branch coverage (lib/) | 85% | 75% |
| Component render coverage | 100% | 95% |
| E2E critical paths | 100% | 100% |

---

## 2. Unit Tests — Business Logic Engines (`src/lib/`)

> **Framework**: Vitest
> **Location**: `src/lib/__tests__/<module>.test.js`
> **Priority**: P0 — These are the calculation engines that must be correct.

---

### 2.1 `accounting.js` — GL Engine (P0)

| # | Test Case | Input | Expected Output |
|---|-----------|-------|-----------------|
| A-01 | Balanced JE passes validation | `{lines: [{debit:1000,credit:0},{debit:0,credit:1000}]}` | `{valid: true}` |
| A-02 | Unbalanced JE fails validation | `{lines: [{debit:1000,credit:0},{debit:0,credit:500}]}` | `{valid: false, error: "Debit ≠ Credit"}` |
| A-03 | Zero-amount JE rejected | All lines = 0 | Validation error |
| A-04 | Post JE transitions draft→posted | Draft JE | Status = "posted", GL updated |
| A-05 | Cannot post already-posted JE | Posted JE | Error / no-op |
| A-06 | Trial balance debits = credits | Set of posted JEs | `totalDebits === totalCredits` |
| A-07 | Trial balance excludes draft JEs | Mix of draft + posted | Only posted included |
| A-08 | Balance sheet: Assets = L + E | Full GL data | Equation holds |
| A-09 | P&L: Revenue − Expenses = Net Income | Revenue + expense accounts | Correct net income |
| A-10 | Chart of Accounts: correct structure | `CHART_OF_ACCOUNTS` | All accounts have code, name, type |
| A-11 | getAccountType returns correct type | Account code "1100" | "asset" |
| A-12 | Depreciation straight-line calculation | Asset cost=100K, life=5yr, salvage=10K | Annual dep = 18,000 |
| A-13 | Depreciation partial year (pro-rata) | Mid-year acquisition | Pro-rated amount |

### 2.2 `payroll.js` — Taiwan Payroll Engine (P0)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| P-01 | Labor insurance — minimum bracket | Salary ≤ 27,470 | Correct employee/employer split |
| P-02 | Labor insurance — maximum bracket | Salary ≥ 45,800 cap | Capped at max bracket |
| P-03 | Labor insurance — mid bracket | Salary = 36,000 | Correct bracket lookup |
| P-04 | Health insurance — single dependent | Salary + 0 dependents | Correct NHI amount |
| P-05 | Health insurance — with dependents | Salary + 3 dependents | Higher NHI amount |
| P-06 | Labor pension 6% employer | Salary = 40,000 | Pension = 2,400 |
| P-07 | Income tax withholding — low salary | Salary = 30,000 | Minimal or zero tax |
| P-08 | Income tax withholding — high salary | Salary = 150,000 | Correct progressive rate |
| P-09 | Net salary = Gross − all deductions | Full salary record | Net = Gross − 勞保 − 健保 − 勞退 − 所得稅 |
| P-10 | Monthly withholding matches tax table | Various salary levels | Matches 2026 tax brackets |
| P-11 | Edge: salary exactly at bracket boundary | Boundary value | Correct bracket selected |

### 2.3 `laborLaw.js` — Taiwan Labor Standards (P0)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| L-01 | Normal work hours ≤ 8h/day | 8h schedule | Valid |
| L-02 | Reject schedule > 8h without OT | 10h schedule, no OT approval | Invalid |
| L-03 | Weekly hours ≤ 40 (§30) | 5×8h schedule | Valid |
| L-04 | Reject weekly hours > 40 (§30) | 6×8h = 48h | Violation flagged |
| L-05 | OT first 2 hours at 1.34× | 2h overtime | Pay = 2 × hourly × 1.34 |
| L-06 | OT next 2 hours at 1.67× | 4h overtime | First 2h @1.34 + next 2h @1.67 |
| L-07 | Rest day OT rates (§24) | Work on rest day | Higher multiplier applied |
| L-08 | National holiday OT = 2× (§39) | Work on holiday | Double pay |
| L-09 | Monthly OT cap 46h (§32) | 47h OT requested | Violation flagged |
| L-10 | Extended OT cap 54h (with agreement) | 54h with agreement flag | Valid |

### 2.4 `leavePolicy.js` — Leave Entitlement Engine (P0)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| LP-01 | Annual leave: 6mo–1yr = 3 days | Tenure = 8 months | 3 days |
| LP-02 | Annual leave: 1–2yr = 7 days | Tenure = 18 months | 7 days |
| LP-03 | Annual leave: 3–5yr = 10 days | Tenure = 4 years | 10 days |
| LP-04 | Annual leave: 5–10yr = 14 days | Tenure = 7 years | 14 days |
| LP-05 | Annual leave: 10+yr = 15+ days | Tenure = 12 years | 15 + extra per year |
| LP-06 | Sick leave: max 30 days/year | Request 31st day | Rejected or unpaid |
| LP-07 | Menstrual leave: 1 day/month | Valid request | Approved |
| LP-08 | Family care leave: 7 days/year | 8th day request | Rejected |
| LP-09 | Maternity leave: 8 weeks | Valid request | 56 calendar days |
| LP-10 | Paternity leave: 7 days | Valid request | 7 days |
| LP-11 | Leave request overlaps existing | Overlapping dates | Validation error |
| LP-12 | Leave balance insufficient | Request > remaining | Validation error |
| LP-13 | All 16 leave types recognized | Each type code | Valid info returned |

### 2.5 `mrpEngine.js` — Material Requirements Planning (P0)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| M-01 | Single-level BOM explosion | Parent + 3 components | Correct qty per component |
| M-02 | Multi-level BOM explosion (recursive) | 3-level BOM tree | All levels exploded correctly |
| M-03 | Net requirements = Gross − On-hand | Demand=100, Stock=30 | Net = 70 |
| M-04 | Net requirements with safety stock | Demand=100, Stock=30, SS=20 | Net = 90 |
| M-05 | Lead time offset calculation | Lead time = 5 days | Order date = need date − 5 |
| M-06 | Purchase suggestions generated | Net req > 0 for purchased items | Suggestion with qty + date |
| M-07 | Zero demand = no suggestions | Demand = 0 | Empty suggestions |
| M-08 | Capacity requirements calculation | Production plan + routing | Hours per work center |
| M-09 | BOM with phantom assemblies | Phantom sub-assembly | Components flow through |
| M-10 | Circular BOM detection | A→B→C→A | Error thrown (no infinite loop) |

### 2.6 `inventoryCosting.js` — Valuation Engine (P1)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| IC-01 | FIFO: oldest cost used first | 3 receipts, 1 issue | Issue costed at oldest price |
| IC-02 | FIFO: partial lot consumption | Receipt 100@$10, issue 60 | 60@$10, remaining 40@$10 |
| IC-03 | LIFO: newest cost used first | 3 receipts, 1 issue | Issue costed at newest price |
| IC-04 | Weighted average recalculation | Multiple receipts | Correct blended cost |
| IC-05 | Moving average after each receipt | Sequential receipts | Average updates each time |
| IC-06 | Inventory valuation report | Mixed transactions | Total value by method |
| IC-07 | Edge: issue qty > on-hand | Over-issue attempt | Error or negative stock flag |

### 2.7 `threeWayMatch.js` — PO/GR/Invoice Matching (P1)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| TW-01 | Perfect match (PO=GR=INV) | All equal | Match status: "matched" |
| TW-02 | Price within tolerance | 2% variance, tolerance=5% | Auto-approved |
| TW-03 | Price exceeds tolerance | 8% variance, tolerance=5% | Flagged for review |
| TW-04 | Quantity mismatch | PO=100, GR=95 | Variance reported |
| TW-05 | Missing GR (2-way only) | PO + INV, no GR | Partial match |
| TW-06 | Calculate price variance % | PO=$100, INV=$105 | Variance = 5% |

### 2.8 `einvoice.js` — E-Invoice / Turnkey (P1)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| EI-01 | Valid 統一編號 (8 digits) | "12345678" | Valid |
| EI-02 | Invalid 統一編號 (wrong length) | "1234567" | Invalid |
| EI-03 | Invalid 統一編號 (non-numeric) | "1234567A" | Invalid |
| EI-04 | Invoice number format | Prefix + date | Correct format (AA-12345678) |
| EI-05 | Tax calculation (5% VAT) | Amount = 1000 | Tax = 50, total = 1050 |
| EI-06 | Tax-exempt item | Tax-free product | Tax = 0 |
| EI-07 | E-Invoice XML structure | Full invoice data | Valid MIG XML output |
| EI-08 | Carrier barcode format | Mobile barcode | Correct format string |

### 2.9 `taxReport.js` — Tax Compliance (P1)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| TR-01 | 401 營業稅 report generation | Sales + purchase data | Correct taxable amount |
| TR-02 | 403 扣繳申報 generation | Withholding data | Correct per-employee totals |
| TR-03 | Business tax calculation | Revenue data | 5% VAT computed |
| TR-04 | Tax period formatting | Year/month | ROC year format (e.g., 115年) |
| TR-05 | Media file output format | Report data | Correct fixed-width/CSV format |

### 2.10 `currency.js` — Multi-Currency (P1)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| CU-01 | TWD → USD conversion | 1000 TWD, rate=0.032 | $32.00 |
| CU-02 | USD → TWD conversion | $100, rate=31.5 | 3,150 TWD |
| CU-03 | Exchange gain calculation | Book vs realized rate | Positive gain |
| CU-04 | Exchange loss calculation | Book vs realized rate | Negative (loss) |
| CU-05 | Same-currency = no conversion | TWD → TWD | Amount unchanged |
| CU-06 | Format currency with symbol | 1000, "USD" | "$1,000.00" |
| CU-07 | Unsupported currency handling | "XYZ" | Error or fallback |

### 2.11 `payment.js` — Payment Gateway (P1)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| PY-01 | Create ECPay payment request | Order data | Correct request payload |
| PY-02 | Create LINE Pay request | Order data | Correct request payload |
| PY-03 | Verify valid callback | Signed callback | Verified = true |
| PY-04 | Reject tampered callback | Modified payload | Verified = false |
| PY-05 | Process refund | Transaction ID + amount | Refund request generated |
| PY-06 | Payment status lookup | Transaction ID | Current status returned |

### 2.12 `crmEngine.js` — CRM Logic (P1)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| CR-01 | Lead score calculation | Activity data | Score 0–100 |
| CR-02 | CLV (Customer Lifetime Value) | Purchase history | Calculated CLV |
| CR-03 | Segment evaluation | Customer + segment rules | In/out of segment |
| CR-04 | SLA status calculation | Ticket + SLA policy | On-time / breached |
| CR-05 | Auto-assign ticket | Ticket + team capacity | Assigned to least-loaded rep |
| CR-06 | Escalation check | Overdue ticket | Escalation triggered |
| CR-07 | Funnel conversion rate | Stage counts | % per stage transition |
| CR-08 | Points earned (loyalty) | Transaction amount + tier | Correct points per tier rules |
| CR-09 | Tier upgrade calculation | Accumulated points | Correct tier (bronze→silver→gold→platinum→diamond) |
| CR-10 | Company–contact linking | Company + contact IDs | Association created |

### 2.13 `dripCampaign.js` — Campaign Automation (P2)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| DC-01 | Create campaign with steps | Campaign config | Campaign + ordered steps |
| DC-02 | Evaluate wait condition | Time elapsed | Step triggers at correct time |
| DC-03 | Evaluate action condition | User behavior data | Correct branch taken |
| DC-04 | Simulate full campaign | Contact list + campaign | Projected metrics per step |
| DC-05 | Calculate drip metrics | Send/open/click data | Open rate, click rate, conversion |
| DC-06 | All 6 templates load correctly | Each template key | Valid template structure |

### 2.14 `automation.js` — Trigger Engine (P1)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| AU-01 | Low stock triggers auto-PR | Stock < reorder point | Purchase request created |
| AU-02 | Shipment creates AR entry | Completed shipment | AR record created |
| AU-03 | GR creates AP entry | Goods receipt | AP record created |
| AU-04 | Profitability calculation | Revenue + costs | Correct margin % |
| AU-05 | Annual leave settlement | Employee tenure + usage | Settlement amount calculated |

### 2.15 `approval.js` — Approval Routing (P1)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| AP-01 | Get supervisor by employee | Employee ID | Correct supervisor returned |
| AP-02 | Approval chain by hierarchy | Employee 3 levels deep | Chain = [supervisor, manager, director] |
| AP-03 | Submit for approval | Document + requester | Pending approval created |
| AP-04 | Amount-based routing | High-value PO | Routes to higher authority |

### 2.16 `dataMasking.js` — PII Protection (P1)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| DM-01 | Mask phone number | "0912345678" | "0912***678" |
| DM-02 | Mask email | "user@example.com" | "u***@example.com" |
| DM-03 | Mask ID number | "A123456789" | "A1234****9" |
| DM-04 | Mask address | Full address | Partially masked |
| DM-05 | Admin can view full data | Admin role | No masking applied |
| DM-06 | Non-admin sees masked data | Employee role | Masking applied |

### 2.17 `messaging.js` — Notifications (P2)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| MS-01 | Email template rendering | Template + variables | Variables substituted |
| MS-02 | LINE message formatting | Message data | Correct LINE API payload |
| MS-03 | SMS message formatting | Message data | Correct SMS payload |
| MS-04 | Bulk email batching | 500 recipients | Batched correctly |
| MS-05 | All templates have required fields | Each template | subject, body, variables defined |

### 2.18 `exportPdf.js` + `exportUtils.js` — Reports (P2)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| EX-01 | Attendance PDF has correct columns | Attendance data | PDF contains all fields |
| EX-02 | Salary PDF has correct totals | Salary records | Totals match sum |
| EX-03 | CSV export with headers | Data array | Valid CSV string |
| EX-04 | PDF export generates blob | Data array | Non-empty PDF blob |

### 2.19 `auditLogger.js` — Audit Trail (P1)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| AL-01 | Log field-level change | Old value → new value | Audit record with who/what/when/old/new |
| AL-02 | Log inventory change | Stock adjustment | Record with item, qty, reason |
| AL-03 | Log customer change | Customer update | Record with fields changed |
| AL-04 | Audit log includes timestamp | Any change | ISO timestamp present |

---

## 3. Component Tests — Page Rendering & Interactions

> **Framework**: Vitest + React Testing Library
> **Location**: `src/pages/__tests__/<module>/<Page>.test.jsx`
> **Strategy**: Supabase calls mocked via MSW; test rendering, user interactions, state changes.

---

### 3.1 Global Test Setup (applies to all components)

| # | Test Case | Description |
|---|-----------|-------------|
| G-01 | Every page renders without crash | Smoke test — import + render, no thrown errors |
| G-02 | Every page shows loading state | Initial render before data loads shows spinner |
| G-03 | Every page handles empty data | Zero records → "No data" message, not a crash |
| G-04 | Every page handles API error | Supabase error → error message displayed |

### 3.2 Dashboard (`src/pages/Dashboard.jsx`)

| # | Test Case | Steps |
|---|-----------|-------|
| D-01 | KPI cards display correct values | Mock data → verify 4 stat cards show numbers |
| D-02 | Charts render with data | Mock data → verify Chart.js canvas elements |
| D-03 | Quick action buttons navigate | Click button → verify route change |
| D-04 | Recent activity list populated | Mock data → verify list items |

### 3.3 HR Module Components

| # | Component | Test Case |
|---|-----------|-----------|
| HR-01 | Attendance | Clock-in button updates status to "checked in" |
| HR-02 | Attendance | Clock-out button records duration |
| HR-03 | Attendance | Attendance table shows employee records |
| HR-04 | Leave | Submit leave form with all required fields |
| HR-05 | Leave | Leave type dropdown shows all 16 types |
| HR-06 | Leave | Balance display updates after submission |
| HR-07 | Leave | Approve/reject buttons trigger status change |
| HR-08 | Overtime | OT request form validates hours ≤ 46/month |
| HR-09 | Overtime | OT calculation preview shows tiered rates |
| HR-10 | Salary | Payroll batch processing runs for all employees |
| HR-11 | Salary | Pay slip shows all deduction line items |
| HR-12 | Salary | Export salary report generates PDF |
| HR-13 | Schedule | Drag shift to different time slot |
| HR-14 | Schedule | Compliance violation highlighted in red |
| HR-15 | Performance | KRA score entry (1–5 scale) |
| HR-16 | Performance | 360° feedback form rendering |
| HR-17 | Recruitment | Job posting form CRUD |
| HR-18 | Recruitment | Applicant pipeline Kanban movement |
| HR-19 | Documents | File upload and list display |
| HR-20 | Expenses | Expense form with receipt attachment |
| HR-21 | Bonus | Bonus calculation runs per employee |
| HR-22 | BusinessTravel | Trip request form with approval chain |
| HR-23 | Holidays | Holiday calendar CRUD operations |

### 3.4 Finance Module Components

| # | Component | Test Case |
|---|-----------|-----------|
| FI-01 | JournalEntries | Add debit/credit lines inline |
| FI-02 | JournalEntries | Debit≠Credit prevents posting |
| FI-03 | JournalEntries | Post button changes status draft→posted |
| FI-04 | JournalEntries | Void button on posted entry |
| FI-05 | TrialBalance | Report generates with correct totals |
| FI-06 | BalanceSheet | Assets = Liabilities + Equity displayed |
| FI-07 | ProfitLoss | Revenue − Expenses = Net Income |
| FI-08 | AccountsReceivable | Aging buckets (current, 30, 60, 90+) |
| FI-09 | AccountsPayable | Payment scheduling display |
| FI-10 | Invoices | Line-item entry with per-line tax |
| FI-11 | Invoices | E-invoice XML generation button |
| FI-12 | BankReconciliation | Match bank transaction to JE |
| FI-13 | Budgets | Budget vs Actual variance % display |
| FI-14 | FixedAssets | Depreciation schedule display |
| FI-15 | TaxReports | 401/403 report generation buttons |

### 3.5 Manufacturing Module Components

| # | Component | Test Case |
|---|-----------|-----------|
| MF-01 | BOM | Multi-level BOM tree rendering |
| MF-02 | BOM | Add/remove component rows |
| MF-03 | BOM | Cost rollup display |
| MF-04 | MRP | Run MRP button generates results |
| MF-05 | MRP | Purchase suggestions table populated |
| MF-06 | ManufacturingOrders | Status transitions (planned→in-progress→done) |
| MF-07 | QualityInspection | Inspection form with pass/fail |
| MF-08 | QualityInspection | Defect logging form |

### 3.6 WMS Module Components

| # | Component | Test Case |
|---|-----------|-----------|
| WM-01 | Inventory | Stock levels table with location |
| WM-02 | Inventory | Barcode search functionality |
| WM-03 | SKUs | SKU master CRUD |
| WM-04 | Inbound | Goods receipt form |
| WM-05 | Outbound | Pick list generation |
| WM-06 | Lots | Lot/batch tracking display |
| WM-07 | Lots | Expiry date highlighting |
| WM-08 | StockCount | Cycle count form with variance |
| WM-09 | Reports | Inventory aging report rendering |

### 3.7 Sales Module Components

| # | Component | Test Case |
|---|-----------|-----------|
| SL-01 | Quotations | Line-item entry (qty × price) |
| SL-02 | Quotations | Convert quote → sales order |
| SL-03 | SalesOrders | Order list with status filter |
| SL-04 | Promotions | Discount rule CRUD |
| SL-05 | Returns | RMA form submission |
| SL-06 | Shipments | Tracking status timeline |

### 3.8 Purchase Module Components

| # | Component | Test Case |
|---|-----------|-----------|
| PU-01 | PurchaseRequests | PR form with budget check display |
| PU-02 | PurchaseOrders | PO generation from PR |
| PU-03 | GoodsReceipts | 3-way match status indicator |
| PU-04 | Suppliers | Supplier rating display |
| PU-05 | Contracts | Contract renewal alert display |

### 3.9 CRM Module Components

| # | Component | Test Case |
|---|-----------|-----------|
| CM-01 | Pipeline | Kanban board drag-and-drop |
| CM-02 | Pipeline | Deal probability display |
| CM-03 | Customers | 360° customer view tabs |
| CM-04 | Marketing | Campaign creation form |
| CM-05 | Marketing | Send tracking metrics display |
| CM-06 | Members | Tier badge display (bronze→diamond) |
| CM-07 | Members | Points history table |
| CM-08 | DripCampaigns | Template selection and preview |
| CM-09 | FormBuilder | Form field CRUD |
| CM-10 | WorkflowBuilder | IF/THEN rule builder |

### 3.10 POS Module Components

| # | Component | Test Case |
|---|-----------|-----------|
| POS-01 | POSTerminal | Add item to cart |
| POS-02 | POSTerminal | Cart total calculation |
| POS-03 | POSTerminal | Payment method selection |
| POS-04 | POSTerminal | Receipt generation |
| POS-05 | POSTerminal | Refund processing |
| POS-06 | POSShifts | Open/close shift |
| POS-07 | POSShifts | Cash reconciliation form |

### 3.11 System Admin Components

| # | Component | Test Case |
|---|-----------|-----------|
| SY-01 | Users | User CRUD with role dropdown |
| SY-02 | Settings | Company settings form save |
| SY-03 | Triggers | Automation rule toggle on/off |
| SY-04 | AuditLog | Audit trail table with filters |
| SY-05 | Notifications | Notification list mark as read |
| SY-06 | DataImportExport | CSV upload and preview |
| SY-07 | DataImportExport | Export button generates file |

### 3.12 Shared Components

| # | Component | Test Case |
|---|-----------|-----------|
| SC-01 | Modal | Opens on trigger, closes on Escape |
| SC-02 | Modal | Focus trap works (Tab cycles within) |
| SC-03 | Modal | Submit callback fires |
| SC-04 | Sidebar | Collapse/expand toggle |
| SC-05 | Sidebar | Active route highlighted |
| SC-06 | Sidebar | Nested menu sections expand |
| SC-07 | Sidebar | Dark/light theme toggle |
| SC-08 | LoadingSpinner | Renders with label text |
| SC-09 | NotificationCenter | Toast appears and auto-dismisses |
| SC-10 | OnboardingWizard | Step progression (next/back) |
| SC-11 | MaskedText | Shows masked value by default |
| SC-12 | MaskedText | Reveals on authorized click |
| SC-13 | StatCard | Renders icon, value, trend |

---

## 4. Integration Tests — Cross-Module Workflows

> **Framework**: Vitest + MSW (mock Supabase at HTTP level)
> **Location**: `src/__tests__/integration/<workflow>.test.js`
> **Purpose**: Verify data flows correctly across module boundaries.

---

### 4.1 Procure-to-Pay (Purchase → Finance)

| # | Test Case | Modules Involved |
|---|-----------|-----------------|
| INT-01 | PR → PO creation links correctly | Purchase |
| INT-02 | PO → GR → 3-way match triggers AP | Purchase + Finance |
| INT-03 | AP entry creates journal entry (Dr Expense, Cr AP) | Finance |
| INT-04 | Payment clears AP and posts JE | Finance |
| INT-05 | Budget check blocks over-budget PR | Purchase + Finance |

### 4.2 Order-to-Cash (Sales → Finance)

| # | Test Case | Modules Involved |
|---|-----------|-----------------|
| INT-06 | Quotation → Sales Order conversion | Sales |
| INT-07 | Sales Order → Shipment creation | Sales + WMS |
| INT-08 | Shipment → AR entry (Dr AR, Cr Revenue) | Sales + Finance |
| INT-09 | Invoice generation with e-invoice XML | Sales + Finance |
| INT-10 | Payment receipt clears AR | Finance |

### 4.3 Manufacturing Flow

| # | Test Case | Modules Involved |
|---|-----------|-----------------|
| INT-11 | BOM explosion feeds MRP calculation | Manufacturing |
| INT-12 | MRP generates purchase suggestions | Manufacturing + Purchase |
| INT-13 | Manufacturing order consumes inventory | Manufacturing + WMS |
| INT-14 | Finished goods receipt increases stock | Manufacturing + WMS |
| INT-15 | Cost rollup from BOM to finished goods | Manufacturing + Finance |

### 4.4 HR-Payroll Flow

| # | Test Case | Modules Involved |
|---|-----------|-----------------|
| INT-16 | Attendance → Overtime auto-calculation | HR |
| INT-17 | Leave approval → Balance deduction | HR |
| INT-18 | Overtime approved → Salary OT component | HR |
| INT-19 | Payroll run → Net salary for all employees | HR + Finance |
| INT-20 | Payroll JE (Dr Salary Expense, Cr Bank/Payable) | HR + Finance |

### 4.5 POS → Finance Flow

| # | Test Case | Modules Involved |
|---|-----------|-----------------|
| INT-21 | POS sale → Inventory deduction | POS + WMS |
| INT-22 | POS sale → Revenue JE created | POS + Finance |
| INT-23 | POS refund → Inventory return + reverse JE | POS + WMS + Finance |
| INT-24 | Shift close → Cash reconciliation report | POS |

### 4.6 CRM → Sales Flow

| # | Test Case | Modules Involved |
|---|-----------|-----------------|
| INT-25 | Pipeline deal won → Quotation created | CRM + Sales |
| INT-26 | Campaign send → Delivery tracking | CRM + Messaging |
| INT-27 | Loyalty purchase → Points accrual | CRM + POS |
| INT-28 | Lead score update triggers assignment | CRM |

### 4.7 Automation Triggers

| # | Test Case | Modules Involved |
|---|-----------|-----------------|
| INT-29 | Low stock → Auto purchase request | WMS + Purchase |
| INT-30 | Approved expense → AP entry | HR + Finance |
| INT-31 | Contract expiring → Notification | Purchase + System |

---

## 5. E2E Tests — Critical User Journeys

> **Framework**: Playwright
> **Location**: `e2e/<journey>.spec.js`
> **Strategy**: Full browser tests against running dev server with seeded data.

---

### 5.1 Authentication & Authorization

| # | Test Case | Steps |
|---|-----------|-------|
| E2E-01 | Login with valid credentials | Navigate → enter email/password → click login → verify dashboard |
| E2E-02 | Login with invalid credentials | Enter wrong password → verify error message |
| E2E-03 | Session persistence | Login → refresh page → still logged in |
| E2E-04 | Logout | Click logout → redirected to login page |
| E2E-05 | Role-based access (admin) | Login as admin → verify all nav items visible |
| E2E-06 | Role-based access (employee) | Login as employee → verify restricted nav |
| E2E-07 | Protected route redirect | Access /finance without login → redirected to /login |

### 5.2 Complete Payroll Run (P0)

| # | Step | Verification |
|---|------|-------------|
| E2E-10 | Navigate to HR → Salary | Page loads with employee list |
| E2E-11 | Click "Run Payroll" for month | Processing indicator shown |
| E2E-12 | Verify 勞保 deduction calculated | Amount matches bracket table |
| E2E-13 | Verify 健保 deduction calculated | Amount matches NHI table |
| E2E-14 | Verify 勞退 6% calculated | = Salary × 6% |
| E2E-15 | Verify 所得稅 withholding | Matches tax bracket |
| E2E-16 | Verify net salary = gross − deductions | Math checks out |
| E2E-17 | Export pay slips to PDF | PDF downloads successfully |

### 5.3 Journal Entry → Financial Statements (P0)

| # | Step | Verification |
|---|------|-------------|
| E2E-20 | Navigate to Finance → Journal Entries | Page loads |
| E2E-21 | Create new JE with 2 balanced lines | Form accepts, saved as draft |
| E2E-22 | Attempt to post unbalanced JE | Error message: "Debit ≠ Credit" |
| E2E-23 | Post the balanced JE | Status changes to "Posted" |
| E2E-24 | Navigate to Trial Balance | Posted JE reflected in balances |
| E2E-25 | Navigate to Balance Sheet | Assets = Liabilities + Equity |
| E2E-26 | Navigate to P&L | Revenue − Expenses = Net Income |

### 5.4 Procure-to-Pay Full Cycle (P0)

| # | Step | Verification |
|---|------|-------------|
| E2E-30 | Create Purchase Request | PR saved with status "pending" |
| E2E-31 | Approve PR | Status → "approved" |
| E2E-32 | Generate PO from PR | PO created, linked to PR |
| E2E-33 | Record Goods Receipt | GR recorded against PO |
| E2E-34 | 3-way match passes | Match status = "matched" |
| E2E-35 | AP entry auto-created | AP record exists |
| E2E-36 | Record payment | AP cleared, JE posted |

### 5.5 Quote-to-Cash Full Cycle (P0)

| # | Step | Verification |
|---|------|-------------|
| E2E-40 | Create quotation with line items | Quote saved with items |
| E2E-41 | Convert quote to sales order | SO created, quote status = "converted" |
| E2E-42 | Create shipment from SO | Shipment record created |
| E2E-43 | Generate invoice with e-invoice | Invoice + XML generated |
| E2E-44 | AR entry auto-created | AR record exists |
| E2E-45 | Record payment receipt | AR cleared |

### 5.6 POS Transaction (P1)

| # | Step | Verification |
|---|------|-------------|
| E2E-50 | Open POS terminal | Terminal interface loads |
| E2E-51 | Add items to cart | Cart updates with items + totals |
| E2E-52 | Apply discount | Total recalculated |
| E2E-53 | Complete payment | Transaction recorded |
| E2E-54 | Print receipt | Receipt dialog shown |
| E2E-55 | Process refund on transaction | Refund recorded, inventory returned |

### 5.7 Leave Request Lifecycle (P1)

| # | Step | Verification |
|---|------|-------------|
| E2E-60 | Employee submits annual leave | Request saved as "pending" |
| E2E-61 | System validates balance | Sufficient balance confirmed |
| E2E-62 | Manager approves leave | Status → "approved" |
| E2E-63 | Balance deducted | Remaining days reduced |
| E2E-64 | Attempt to exceed balance | Validation error shown |

### 5.8 MRP Planning Run (P1)

| # | Step | Verification |
|---|------|-------------|
| E2E-70 | Define BOM (multi-level) | BOM saved with components |
| E2E-71 | Enter demand forecast | Demand quantities saved |
| E2E-72 | Run MRP | Results table populated |
| E2E-73 | Review purchase suggestions | Suggestions with qty + date |
| E2E-74 | Convert suggestion to PR | PR created from suggestion |

### 5.9 CRM Pipeline Management (P2)

| # | Step | Verification |
|---|------|-------------|
| E2E-80 | Create new lead | Lead appears in pipeline |
| E2E-81 | Move lead through stages (drag) | Stage updates correctly |
| E2E-82 | Log activity on deal | Activity in timeline |
| E2E-83 | Win deal | Deal moves to "won", revenue counted |
| E2E-84 | Forecast reflects won deal | Forecast amount updated |

### 5.10 Inventory Management (P1)

| # | Step | Verification |
|---|------|-------------|
| E2E-90 | Create new SKU | SKU in master list |
| E2E-91 | Record inbound goods receipt | Stock level increases |
| E2E-92 | Record outbound shipment | Stock level decreases |
| E2E-93 | Run cycle count | Variance calculated |
| E2E-94 | Lot tracking with expiry | Expiring lots highlighted |

---

## 6. Routing & Navigation Tests

> **Framework**: Vitest + React Testing Library (MemoryRouter)
> **Location**: `src/__tests__/routing.test.jsx`

| # | Test Case | Expected |
|---|-----------|----------|
| R-01 | All 100+ routes render without crash | Lazy-loaded pages mount |
| R-02 | Unknown route shows 404 or redirects | Graceful handling |
| R-03 | Sidebar links navigate to correct routes | Click → URL matches |
| R-04 | Browser back/forward works | History navigation correct |
| R-05 | Deep link to subpage works | Direct URL → correct page |
| R-06 | Lazy loading shows fallback spinner | Suspense boundary works |

---

## 7. Security & Access Control Tests

| # | Test Case | Type | Expected |
|---|-----------|------|----------|
| SEC-01 | Unauthenticated user cannot access admin routes | E2E | Redirect to /login |
| SEC-02 | Employee role cannot access system admin pages | E2E | Access denied or hidden |
| SEC-03 | PII masking active for non-admin roles | Component | Masked data shown |
| SEC-04 | PII masking disabled for admin role | Component | Full data shown |
| SEC-05 | Audit log records all data changes | Integration | Audit entries created |
| SEC-06 | XSS: script tags in form inputs sanitized | E2E | No script execution |
| SEC-07 | SQL injection: special chars in search | E2E | No error, safe query |
| SEC-08 | CSRF: Supabase auth tokens validated | Integration | Invalid tokens rejected |
| SEC-09 | Session timeout after inactivity | E2E | Auto-logout after timeout |
| SEC-10 | Password not stored in localStorage | Unit | Only auth token stored |

---

## 8. Performance & Load Tests

> **Tool**: Playwright + Lighthouse CI

| # | Test Case | Target |
|---|-----------|--------|
| PERF-01 | Dashboard initial load (LCP) | < 2.5s |
| PERF-02 | Page navigation (route change) | < 500ms |
| PERF-03 | Table with 1000 rows renders | < 1s, no jank |
| PERF-04 | Payroll batch (100 employees) | < 5s |
| PERF-05 | MRP calculation (50 BOMs) | < 3s |
| PERF-06 | Bundle size (main chunk) | < 500KB gzip |
| PERF-07 | Lazy-loaded chunk size | < 100KB each |
| PERF-08 | Memory: no leaks after 50 navigations | Heap stable |
| PERF-09 | Chart rendering (12 months data) | < 300ms |
| PERF-10 | PDF export (100-row report) | < 3s |

---

## 9. Accessibility Tests

> **Tool**: axe-core (via @axe-core/playwright)

| # | Test Case | Standard |
|---|-----------|----------|
| A11Y-01 | All pages pass axe-core audit | WCAG 2.1 AA |
| A11Y-02 | Keyboard navigation (Tab order) | Logical flow |
| A11Y-03 | Screen reader: form labels present | aria-label or <label> |
| A11Y-04 | Color contrast ratio | ≥ 4.5:1 text, ≥ 3:1 large |
| A11Y-05 | Modal focus trap | Focus stays within modal |
| A11Y-06 | Error messages announced | aria-live or role="alert" |
| A11Y-07 | Images have alt text | Non-decorative images |
| A11Y-08 | Dark mode maintains contrast | Passes in both themes |

---

## 10. Visual Regression Tests

> **Tool**: Playwright screenshot comparison
> **Location**: `e2e/visual/<page>.spec.js`

| # | Page/Component | Viewports |
|---|---------------|-----------|
| VR-01 | Dashboard | 1920×1080, 1366×768, 375×812 |
| VR-02 | Sidebar (expanded + collapsed) | Desktop + mobile |
| VR-03 | POS Terminal | 1024×768 (tablet), 1920×1080 |
| VR-04 | Modal (open state) | Desktop + mobile |
| VR-05 | Finance reports (TB, BS, P&L) | Desktop |
| VR-06 | CRM Pipeline Kanban | Desktop |
| VR-07 | Dark mode vs Light mode | Dashboard, Sidebar |
| VR-08 | Empty states (no data) | Key pages |
| VR-09 | Loading states | Key pages |
| VR-10 | Print layouts (PDF preview) | A4 portrait |

---

## 11. CI/CD Pipeline Configuration

```yaml
# .github/workflows/test.yml
name: Test Suite

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx vitest run --coverage
      - uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage/

  component-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx vitest run --config vitest.component.config.js

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run build && npx playwright test
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/

  lighthouse:
    runs-on: ubuntu-latest
    needs: [unit-tests]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci && npm run build
      - run: npx @lhci/cli autorun
```

---

## 12. Test Data Strategy

### 12.1 Seed Data Requirements

| Dataset | Records | Purpose |
|---------|---------|---------|
| Employees | 50 | HR, payroll, attendance tests |
| Customers | 30 | CRM, sales, AR tests |
| Suppliers | 20 | Purchase, AP tests |
| SKUs/Products | 100 | WMS, POS, sales tests |
| BOMs | 10 (3-level) | Manufacturing, MRP tests |
| Journal Entries | 50 | Finance, reporting tests |
| Leave Records | 100 | Leave balance, policy tests |
| Sales Orders | 30 | Order-to-cash flow tests |
| Purchase Orders | 20 | Procure-to-pay flow tests |

### 12.2 Data Isolation Strategy

- **Unit tests**: Pure functions, no DB. Use hardcoded inputs.
- **Component tests**: MSW intercepts all Supabase HTTP calls, returns fixture JSON.
- **Integration tests**: MSW with stateful handlers (track created/updated records in memory).
- **E2E tests**: Dedicated Supabase project (test environment) with seed data reset before each suite.

---

## 13. Test File Structure

```
sme-ops/
├── src/
│   ├── lib/
│   │   └── __tests__/
│   │       ├── accounting.test.js          # 13 cases
│   │       ├── payroll.test.js             # 11 cases
│   │       ├── laborLaw.test.js            # 10 cases
│   │       ├── leavePolicy.test.js         # 13 cases
│   │       ├── mrpEngine.test.js           # 10 cases
│   │       ├── inventoryCosting.test.js    # 7 cases
│   │       ├── threeWayMatch.test.js       # 6 cases
│   │       ├── einvoice.test.js            # 8 cases
│   │       ├── taxReport.test.js           # 5 cases
│   │       ├── currency.test.js            # 7 cases
│   │       ├── payment.test.js             # 6 cases
│   │       ├── crmEngine.test.js           # 10 cases
│   │       ├── dripCampaign.test.js        # 6 cases
│   │       ├── automation.test.js          # 5 cases
│   │       ├── approval.test.js            # 4 cases
│   │       ├── dataMasking.test.js         # 6 cases
│   │       ├── messaging.test.js           # 5 cases
│   │       ├── exportPdf.test.js           # 4 cases
│   │       └── auditLogger.test.js         # 4 cases
│   ├── pages/
│   │   └── __tests__/
│   │       ├── Dashboard.test.jsx
│   │       ├── hr/                         # 23 cases across HR pages
│   │       ├── finance/                    # 15 cases
│   │       ├── manufacturing/              # 8 cases
│   │       ├── wms/                        # 9 cases
│   │       ├── sales/                      # 6 cases
│   │       ├── purchase/                   # 5 cases
│   │       ├── crm/                        # 10 cases
│   │       ├── pos/                        # 7 cases
│   │       └── system/                     # 7 cases
│   ├── components/
│   │   └── __tests__/
│   │       ├── Modal.test.jsx              # 3 cases
│   │       ├── Sidebar.test.jsx            # 4 cases
│   │       └── ...                         # 6 more
│   └── __tests__/
│       ├── routing.test.jsx                # 6 cases
│       └── integration/
│           ├── procure-to-pay.test.js      # 5 cases
│           ├── order-to-cash.test.js       # 5 cases
│           ├── manufacturing-flow.test.js  # 5 cases
│           ├── hr-payroll.test.js          # 5 cases
│           ├── pos-finance.test.js         # 4 cases
│           ├── crm-sales.test.js           # 4 cases
│           └── automation-triggers.test.js # 3 cases
├── e2e/
│   ├── auth.spec.js                        # 7 cases
│   ├── payroll-run.spec.js                 # 8 cases
│   ├── journal-to-statements.spec.js       # 7 cases
│   ├── procure-to-pay.spec.js              # 7 cases
│   ├── quote-to-cash.spec.js              # 6 cases
│   ├── pos-transaction.spec.js             # 6 cases
│   ├── leave-lifecycle.spec.js             # 5 cases
│   ├── mrp-planning.spec.js               # 5 cases
│   ├── crm-pipeline.spec.js               # 5 cases
│   ├── inventory-management.spec.js        # 5 cases
│   ├── security.spec.js                    # 10 cases
│   ├── performance.spec.js                 # 10 cases
│   ├── accessibility.spec.js               # 8 cases
│   └── visual/
│       └── *.spec.js                       # 10 cases
├── test/
│   ├── setup.js                            # Global test setup
│   ├── mocks/
│   │   ├── handlers.js                     # MSW request handlers
│   │   ├── server.js                       # MSW server setup
│   │   └── fixtures/                       # JSON fixture data
│   │       ├── employees.json
│   │       ├── customers.json
│   │       ├── inventory.json
│   │       └── ...
│   └── seeds/
│       └── seed.sql                        # E2E test database seed
├── vitest.config.js                        # Unit + component config
├── playwright.config.js                    # E2E config
└── .github/workflows/test.yml              # CI pipeline
```

---

## 14. Implementation Priority & Phases

### Phase 1 — Foundation (Week 1–2)
- [ ] Install Vitest, React Testing Library, MSW, Playwright
- [ ] Configure vitest.config.js and playwright.config.js
- [ ] Set up MSW handlers for Supabase mocking
- [ ] Write seed data fixtures
- [ ] **Unit tests for P0 libs**: accounting, payroll, laborLaw, leavePolicy, mrpEngine

### Phase 2 — Core Business Logic (Week 3–4)
- [ ] **Unit tests for P1 libs**: inventoryCosting, threeWayMatch, einvoice, taxReport, currency, payment, crmEngine, automation, approval, dataMasking, auditLogger
- [ ] **Smoke tests**: All 100+ pages render without crash
- [ ] **Component tests**: Dashboard, JournalEntries, Salary, Leave

### Phase 3 — Integration & E2E (Week 5–6)
- [ ] **Integration tests**: All 7 cross-module workflows
- [ ] **E2E tests**: Auth, Payroll Run, Journal→Statements, Procure-to-Pay
- [ ] **Component tests**: Remaining HR, Finance, Manufacturing pages

### Phase 4 — Complete Coverage (Week 7–8)
- [ ] **E2E tests**: Quote-to-Cash, POS, Leave Lifecycle, MRP, CRM
- [ ] **Component tests**: WMS, Sales, Purchase, CRM, POS, System pages
- [ ] **Security tests**: XSS, access control, audit trail
- [ ] **Performance tests**: Lighthouse, bundle size, batch operations

### Phase 5 — Polish (Week 9–10)
- [ ] **Accessibility tests**: axe-core audit across all pages
- [ ] **Visual regression**: Baseline screenshots for key pages
- [ ] **CI pipeline**: GitHub Actions workflow
- [ ] **Coverage report**: Ensure targets met (90% lib, 100% critical paths)
- [ ] **Unit tests for P2 libs**: dripCampaign, messaging, exportPdf

---

## 15. Total Test Count Summary

| Category | Test Cases |
|----------|-----------|
| Unit Tests (lib/) | **140** |
| Component Tests (pages/) | **94** |
| Component Tests (shared) | **13** |
| Routing Tests | **6** |
| Integration Tests | **31** |
| E2E Tests | **99** |
| Security Tests | **10** |
| Performance Tests | **10** |
| Accessibility Tests | **8** |
| Visual Regression Tests | **10** |
| **TOTAL** | **~421** |

---

## 16. Dependencies to Install

```bash
# Test framework
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event

# DOM environment
npm install -D jsdom

# API mocking
npm install -D msw

# E2E
npm install -D @playwright/test

# Accessibility
npm install -D @axe-core/playwright

# Coverage
npm install -D @vitest/coverage-v8

# Performance
npm install -D @lhci/cli
```

---

## 17. Key Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Supabase dependency in components | Tests fail without network | MSW mocks all Supabase HTTP calls |
| No existing tests (greenfield) | High initial effort | Phase 1 focuses on highest-value P0 tests |
| 100+ pages to cover | Coverage gaps | Automated smoke test renders every page |
| Taiwan-specific calculations | Hard to verify correctness | Use official 勞保/健保 rate tables as test fixtures |
| Chart.js canvas rendering | Cannot assert pixels in JSDOM | Mock Chart.js, test data passed to it |
| jsPDF in tests | No real PDF rendering in JSDOM | Mock jsPDF, verify function calls |
| Lazy loading in tests | Suspense boundaries complicate rendering | Use `waitFor` / `findBy` queries |
| Mock data drift from real schema | Tests pass but prod fails | Generate fixtures from Supabase types |

---

## Appendix A — Focused Test Plan: Projects/Workflow & HRM

> Added: 2026-05-07
> Derived from codebase analysis of `src/modules/ProcessModule` and `src/modules/HRModule`.
> Complements the broad plan above with targeted IDs for these two domains.

### Existing Coverage — Do Not Duplicate

| File | IDs | What's covered |
|------|-----|----------------|
| [src/lib/__tests__/workflowExecutor.test.js](src/lib/__tests__/workflowExecutor.test.js) | WF-01–03 | Template resolution, condition operators, trigger mapping |
| [src/__tests__/integration/hr-payroll.test.js](src/__tests__/integration/hr-payroll.test.js) | INT-16–20 | Attendance→OT, leave→balance, OT→salary, deductions, JE balance |
| [src/lib/__tests__/approval.test.js](src/lib/__tests__/approval.test.js) | — | Approval chain evaluation |

### Infrastructure Notes

- **MSW**: mock all Supabase calls in unit and integration layers — never hit live DB
- **Fixtures**: shared factory functions in `src/__tests__/fixtures/` (see A7 below)
- **Date pinning**: leave/payroll tests must mock `new Date()` or accept a reference date param — Taiwan public holidays change yearly
- **RBAC personas**: E2E needs at least three — `store_staff`, `manager`, `super_admin`
- **Current gap**: `src/lib/db/tasks.js` and `src/lib/db/projects.js` have zero unit tests

### Implementation Priority

```
Phase 1 — critical path / high business risk
  PAY-U01–07, LEAVE-U01–05, HR-INT01–05, WF-INT01–04

Phase 2 — workflow correctness
  WFE-U01–07, PROJ-U01–08, TASK-U01–07, HR-INT06–10

Phase 3 — UI / E2E golden paths
  HR-E2E01–06, WF-E2E01–05

Phase 4 — edge cases / less-used features
  HR-E2E07–12, WF-E2E06–08, HRD-U01–06
```

---

### A1. Projects / Workflow — Unit Tests

**Target**: [src/lib/db/projects.js](src/lib/db/projects.js) · **Output**: `src/lib/__tests__/db-projects.test.js`

| ID | Status | Test description | Assert |
|----|--------|-----------------|--------|
| PROJ-U01 | [ ] | `createProject` with valid data | Returns `{ id, name, status }`, no error |
| PROJ-U02 | [ ] | `createProject` missing required field | Throws / rejects with validation error |
| PROJ-U03 | [ ] | `getProjectSections` for project without sections | Returns `[]` |
| PROJ-U04 | [ ] | `createProjectSection` → `getProjectSections` | Section appears with correct `sort_order` |
| PROJ-U05 | [ ] | `deleteProjectSection` cascade | Tasks in section reassigned or deleted |
| PROJ-U06 | [ ] | `upsertTaskCustomFieldValue` idempotency | Two calls with same key produce one row |
| PROJ-U07 | [ ] | `logTaskActivity` → `getTaskActivity` | Entry has `actor_id`, `action`, `meta` |
| PROJ-U08 | [ ] | `getTasksExpanded` with `assignee_id` filter | Only returns tasks for that employee |

**Target**: [src/lib/db/workflows.js](src/lib/db/workflows.js) · **Output**: `src/lib/__tests__/db-workflows.test.js`

| ID | Status | Test description | Assert |
|----|--------|-----------------|--------|
| WF-U01 | [ ] | `createWorkflow` with steps | Returns definition with nested steps |
| WF-U02 | [ ] | `deleteWorkflow` with active instances | Rejects or cascade-checks |
| WF-U03 | [ ] | `createWorkflowInstance` from template | Instance inherits template steps as `workflow_steps` rows |
| WF-U04 | [ ] | `updateWorkflowInstance` status transitions | `draft→active→completed` valid; `completed→draft` invalid |
| WF-U05 | [ ] | `getWorkflowInstances` with `status` filter | Only returns matching status |
| WF-U06 | [ ] | `createWorkflowCategory` duplicate name | Rejects or returns existing |

**Target**: [src/lib/db/tasks.js](src/lib/db/tasks.js) · **Output**: `src/lib/__tests__/db-tasks.test.js`

| ID | Status | Test description | Assert |
|----|--------|-----------------|--------|
| TASK-U01 | [ ] | `createTask` with circular `depends_on` | Rejects with cycle error |
| TASK-U02 | [ ] | `createTaskDependency` → `getTaskDependenciesByInstance` | Dependency appears in result |
| TASK-U03 | [ ] | `deleteTask` with dependents | Dependency row removed from dependents |
| TASK-U04 | [ ] | `createTaskComment` → `getTaskComments` | Comment has `author_id`, `body`, `created_at` |
| TASK-U05 | [ ] | `addTaskWatcher` duplicate | Idempotent — no duplicate row |
| TASK-U06 | [ ] | `createTaskConfirmation` → `updateTaskConfirmation` | Status changes `pending → signed` |
| TASK-U07 | [ ] | `createTasksBatch` with 100 rows | All inserted, no partial failure |

**Target**: [src/lib/workflowExecutor.js](src/lib/workflowExecutor.js) · **Output**: `src/lib/__tests__/workflowExecutor-actions.test.js` *(extends existing WF-01–03)*

| ID | Status | Test description | Assert |
|----|--------|-----------------|--------|
| WFE-U01 | [ ] | `send_email` action on trigger event | Mock email handler called with resolved template |
| WFE-U02 | [ ] | `create_task` action | Task row inserted with correct `workflow_instance_id` |
| WFE-U03 | [ ] | `update_field` action | Target field updated, others unchanged |
| WFE-U04 | [ ] | Condition `contains` with array field | Matches when array includes value |
| WFE-U05 | [ ] | Condition `greater_than` with ISO date | Correct date comparison |
| WFE-U06 | [ ] | Multiple actions on single trigger | All execute, none silently skipped |
| WFE-U07 | [ ] | Unknown action type | Logs warning, does not throw |

---

### A2. Projects / Workflow — Integration Tests

**Output**: `src/__tests__/integration/workflow-process.test.js`

| ID | Status | Flow |
|----|--------|------|
| WF-INT01 | [ ] | `createWorkflow` → `createWorkflowInstance` → instance has correct step count |
| WF-INT02 | [ ] | `updateWorkflowStep` × N all done → `getWorkflowInstances` shows `completed` |
| WF-INT03 | [ ] | Task B blocked until Task A `status = done` (dependency gate) |
| WF-INT04 | [ ] | Approval step creates `approval_request` → approval unblocks next step |
| WF-INT05 | [ ] | `createProject` → `createTask(project_id)` → `getTasksExpanded` returns project name |
| WF-INT06 | [ ] | Publish EventBus event → executor creates task via `create_task` action |
| WF-INT07 | [ ] | `linkTaskChecklist` → `getTaskChecklistItems` → items appear on task |

---

### A3. Projects / Workflow — E2E Tests

**Output**: `e2e/process/projects-workflows.spec.js`

| ID | Status | Scenario | Key steps |
|----|--------|----------|-----------|
| WF-E2E01 | [ ] | Create project end-to-end | `/process/projects` → New → add section → add task → assign member → verify Kanban |
| WF-E2E02 | [ ] | Kanban drag-drop persists | Drag task "Todo"→"Done" → reload → status retained |
| WF-E2E03 | [ ] | Deploy SOP from template | `/process/sop` → select template → Deploy → pick store → verify instance at `/process/workflows` |
| WF-E2E04 | [ ] | Complete workflow instance | Open instance → mark each step done → status = completed |
| WF-E2E05 | [ ] | Task dependency blocks progress | Mark dependent task — verify blocked indicator |
| WF-E2E06 | [ ] | Calendar view shows tasks | `/process/tasks` → Calendar tab → task on correct date |
| WF-E2E07 | [ ] | Approval request flow | Workflow approval step → approver approves → next step unlocks |
| WF-E2E08 | [ ] | Custom fields on project | Create select-type custom field → fill on task → value persists on reload |

---

### A4. HRM — Unit Tests

**Target**: [src/lib/hrWorkflow.js](src/lib/hrWorkflow.js) · **Output**: `src/lib/__tests__/hrWorkflow.test.js`

| ID | Status | Test description | Assert |
|----|--------|-----------------|--------|
| HR-U01 | [ ] | `createOnboardingPlan` new hire | Returns plan with ≥1 step, `status = pending` |
| HR-U02 | [ ] | `updateOnboardingStep` all steps done | Plan `status` becomes `completed` |
| HR-U03 | [ ] | `calculateLeaveDays` weekdays only | Excludes weekends and public holidays |
| HR-U04 | [ ] | `calculateLeaveDays` over entitlement | Returns `{ valid: false, reason }` |
| HR-U05 | [ ] | `calculateProbationStatus` past end date | Returns `{ expired: true }` |
| HR-U06 | [ ] | `validateSalaryChange` >50% increase | Returns warning flag |
| HR-U07 | [ ] | `getTotalCompensation` with benefits | Sum includes all benefit values |
| HR-U08 | [ ] | `createOffboardingPlan` | Returns plan with resignation, IT, and finance steps |

**Target**: [src/lib/payroll.js](src/lib/payroll.js) · **Output**: `src/lib/__tests__/payroll.test.js` *(supplements P-01–11 above)*

| ID | Status | Test description | Assert |
|----|--------|-----------------|--------|
| PAY-U01 | [ ] | Labor insurance deduction | Matches NHI table bracket for given salary |
| PAY-U02 | [ ] | Health insurance employee share | Correct % of insured salary |
| PAY-U03 | [ ] | Pension contribution (6%) | Employer + employee split correct |
| PAY-U04 | [ ] | Withholding tax progressive bracket | Correct rate at each threshold |
| PAY-U05 | [ ] | Net pay = gross − all deductions | No double-deduction |
| PAY-U06 | [ ] | Mid-month hire prorating | Proportional pay for partial month |
| PAY-U07 | [ ] | OT hours × 1.34 / 1.67 rate | Correct multiplier per Taiwan Labor Standards Act |

**Target**: [src/lib/leavePolicy.js](src/lib/leavePolicy.js) · **Output**: `src/lib/__tests__/leavePolicy.test.js` *(supplements LP-01–13 above)*

| ID | Status | Test description | Assert |
|----|--------|-----------------|--------|
| LEAVE-U01 | [ ] | Annual leave entitlement by seniority | 0–1yr=0d, 1yr=7d, 3yr=10d, 5yr=14d |
| LEAVE-U02 | [ ] | Balance decremented after approved request | Correct days deducted |
| LEAVE-U03 | [ ] | Sick leave cap enforcement | Rejects request exceeding statutory max |
| LEAVE-U04 | [ ] | Maternity leave duration | 8 weeks pre + post birth |
| LEAVE-U05 | [ ] | Carry-over calculation | Unused days ≤ statutory cap carried forward |

**Target**: [src/lib/db/hr.js](src/lib/db/hr.js) · **Output**: `src/lib/__tests__/db-hr.test.js`

| ID | Status | Test description | Assert |
|----|--------|-----------------|--------|
| HRD-U01 | [ ] | `createRecruitmentJob` → `getRecruitmentJobs` | Job appears with `status = open` |
| HRD-U02 | [ ] | `updateBusinessTripStatus` reject with reason | `status = rejected`, `reject_reason` saved |
| HRD-U03 | [ ] | `upsertAttritionSnapshot` idempotency | Second call for same date updates, no duplicate row |
| HRD-U04 | [ ] | `submitEngagementResponse` duplicate prevention | Second submission from same employee rejects |
| HRD-U05 | [ ] | `createProbationRecord` → `updateProbationRecord` | Status change persists |
| HRD-U06 | [ ] | `deleteBenefitPolicy` with active enrollments | Rejects or cascade-warns |

---

### A5. HRM — Integration Tests

**Output**: `src/__tests__/integration/hr-lifecycle.test.js`

| ID | Status | Flow |
|----|--------|------|
| HR-INT01 | [ ] | Hire employee → `createOnboardingPlan` → complete all steps → `hr.employee.onboarded` event fires |
| HR-INT02 | [ ] | Submit leave → `approval_request` created → manager approves → balance deducted → calendar updated |
| HR-INT03 | [ ] | Log OT hours → approve → next payroll run includes OT line item |
| HR-INT04 | [ ] | Submit punch correction → approve → attendance record updated |
| HR-INT05 | [ ] | Submit resignation → `hr.offboarding.started` event → offboarding checklist created |
| HR-INT06 | [ ] | `calculateProbationStatus` expiring → event triggers notification |
| HR-INT07 | [ ] | Approve transfer → employee `department_id` changes → org chart reflects new position |
| HR-INT08 | [ ] | Approve expense → finance handler creates journal entry debit |
| HR-INT09 | [ ] | Run payroll → `hr.salary.calculated` → `hr.payslip.sent` event → employee notified |
| HR-INT10 | [ ] | Low engagement survey score → `hr.attrition.high_risk` event → attrition snapshot updated |

---

### A6. HRM — E2E Tests

**Output**: `e2e/hr/hr-core.spec.js`

| ID | Status | Scenario | Key steps |
|----|--------|----------|-----------|
| HR-E2E01 | [ ] | Attendance clock in/out | `/hr/attendance` → Clock In → verify timestamp → Clock Out → verify duration |
| HR-E2E02 | [ ] | Submit leave request | `/hr/leave` → New Request → select dates → submit → status = pending |
| HR-E2E03 | [ ] | Manager approves leave | Login as manager → approve → verify employee balance decremented |
| HR-E2E04 | [ ] | Schedule roster creation | `/hr/schedule` → assign shifts → verify no overlap warning |
| HR-E2E05 | [ ] | Run payroll | `/hr/payroll` → select month → Run → verify summary totals per employee |
| HR-E2E06 | [ ] | Employee self-service | `/hr/self-service` → view payslip → view leave balance → update emergency contact |
| HR-E2E07 | [ ] | Recruitment pipeline | `/hr/recruitment` → post job → add candidate → move through stages |
| HR-E2E08 | [ ] | Performance review cycle | `/hr/performance` → create review → fill KPIs → submit → manager sees it |
| HR-E2E09 | [ ] | Training enrollment | `/hr/training` → enroll employee → complete course → verify certification |
| HR-E2E10 | [ ] | Resignation form workflow | `/hr/forms/resignation` → fill → submit → HR sees pending offboarding |
| HR-E2E11 | [ ] | Probation tracker alert | `/hr/probation` → employee near end date shows warning badge |
| HR-E2E12 | [ ] | Salary structure assignment | `/hr/salary-structures` → create structure → assign to employee → salary page reflects it |

---

### A7. Suggested Fixture Structure

```
src/__tests__/fixtures/
  employee.js       — createEmployee(overrides), createManager(overrides)
  org.js            — createOrg(), createDepartment()
  workflow.js       — createWorkflowTemplate(), createWorkflowInstance()
  project.js        — createProject(), createTask(projectId)
  leave.js          — createLeaveRequest(employeeId, dates)
  payroll.js        — createPayrollRun(month, employeeIds)

src/__tests__/mocks/
  supabase-handlers.js   — Supabase REST + RPC intercepts
  handlers.js            — aggregated handler list for setupServer()
```

### A8. Status Tracking

When implementing a test from this appendix, change `[ ]` to `[x]` in the Status column of the relevant table.
