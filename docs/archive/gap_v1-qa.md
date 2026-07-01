# QA Test Plan: SME-OPS Full System Validation

> **Date**: 2026-04-05
> **Version**: v1-QA (companion to gap_v1.md)
> **Methodology**: Automation test plan mapped 1:1 against gap analysis — every claimed feature, every closed gap, every engine library is verified.
> **Total Test Cases**: 421

---

## Executive Summary

This QA plan validates every feature claimed in the gap analysis. The gap_v1.md states all P0–P3 gaps are closed and 13 new engine libraries are implemented. **This test plan proves it.**

### Test Pyramid

```
          ╱  E2E Tests  ╲          ← 99 cases — Critical user journeys (Playwright)
         ╱  Integration   ╲        ← 31 cases — Cross-module workflows
        ╱   Component      ╲       ← 107 cases — Page rendering & interactions
       ╱    Unit Tests      ╲      ← 140 cases — Lib engines, pure calculations
      ╱  Security/Perf/A11Y  ╲     ← 44 cases — Non-functional requirements
```

### Technology Stack

| Layer | Tool | Purpose |
|-------|------|---------|
| Unit + Component | **Vitest** + React Testing Library | Fast, Vite-native, JSX support |
| E2E | **Playwright** | Cross-browser, reliable, built-in assertions |
| Coverage | **v8** (via Vitest) | Line/branch/function coverage |
| API Mocking | **MSW (Mock Service Worker)** | Intercept Supabase calls |
| CI | **GitHub Actions** | Automated on every PR |

### Coverage Targets

| Metric | Target | Minimum |
|--------|--------|---------|
| Line coverage (lib/) | 90% | 80% |
| Branch coverage (lib/) | 85% | 75% |
| Component render (pages/) | 100% | 95% |
| E2E critical paths | 100% | 100% |

---

## 1. Finance & Accounting — Gap Validation

> **Gap Status**: 40% → 85%
> **New Libraries**: `accounting.js`, `taxReport.js`, `currency.js`
> **New Pages**: Trial Balance, Balance Sheet, P&L, Tax Reports, Fixed Assets

### 1.1 Unit Tests — `accounting.js` (P0)

Validates: Debit=Credit validation, GL posting, financial statements, depreciation

| # | Test Case | Gap Validated | Expected |
|---|-----------|---------------|----------|
| FIN-U01 | Balanced JE passes validation | P0: Debit=Credit validation | `{valid: true}` |
| FIN-U02 | Unbalanced JE fails validation | P0: Debit=Credit validation | `{valid: false, error: "Debit ≠ Credit"}` |
| FIN-U03 | Zero-amount JE rejected | P0: Debit=Credit validation | Validation error |
| FIN-U04 | Post JE: draft→posted transition | P0: GL posting workflow | Status = "posted" |
| FIN-U05 | Cannot post already-posted JE | P0: GL posting workflow | Error / no-op |
| FIN-U06 | Trial balance: debits = credits | P0: Financial statements | `totalDebits === totalCredits` |
| FIN-U07 | Trial balance excludes drafts | P0: Financial statements | Only posted JEs included |
| FIN-U08 | Balance sheet: A = L + E | P0: Financial statements | Equation holds |
| FIN-U09 | P&L: Revenue − Expenses = NI | P0: Financial statements | Correct net income |
| FIN-U10 | Chart of Accounts structure | P0: Taiwan CoA | All accounts have code, name, type |
| FIN-U11 | getAccountType correct | P0: Taiwan CoA | Account "1100" → "asset" |
| FIN-U12 | Depreciation straight-line | P1: Fixed assets | Cost=100K, life=5yr, salvage=10K → 18,000/yr |
| FIN-U13 | Depreciation partial year | P1: Fixed assets | Pro-rated for mid-year acquisition |

### 1.2 Unit Tests — `taxReport.js` (P1)

Validates: 401 營業稅, 403 扣繳申報, 媒體申報 file output

| # | Test Case | Gap Validated | Expected |
|---|-----------|---------------|----------|
| FIN-U14 | 401 營業稅 report generation | P1: Tax reports | Correct taxable amount + 5% VAT |
| FIN-U15 | 403 扣繳申報 generation | P1: Tax reports | Correct per-employee withholding totals |
| FIN-U16 | Business tax calculation | P1: Tax reports | 5% on revenue |
| FIN-U17 | Tax period ROC formatting | P1: Tax reports | e.g. "115年03-04月" |
| FIN-U18 | Media file output format | P1: Tax reports | Correct fixed-width/CSV format |

### 1.3 Unit Tests — `currency.js` (P2)

Validates: Multi-currency conversion, exchange difference

| # | Test Case | Gap Validated | Expected |
|---|-----------|---------------|----------|
| FIN-U19 | TWD → USD conversion | P2: Multi-currency | 1000 TWD @ 0.032 = $32 |
| FIN-U20 | USD → TWD conversion | P2: Multi-currency | $100 @ 31.5 = 3,150 TWD |
| FIN-U21 | Exchange gain calculation | P2: Multi-currency (匯兌損益) | Positive gain |
| FIN-U22 | Exchange loss calculation | P2: Multi-currency (匯兌損益) | Negative loss |
| FIN-U23 | Same-currency no-op | P2: Multi-currency | Amount unchanged |
| FIN-U24 | Format with currency symbol | P2: Multi-currency | "$1,000.00" |
| FIN-U25 | Unsupported currency error | P2: Multi-currency | Error or fallback |

### 1.4 Component Tests — Finance Pages

| # | Test Case | Page | Gap Validated |
|---|-----------|------|---------------|
| FIN-C01 | Add debit/credit lines inline | JournalEntries | P0: GL posting |
| FIN-C02 | Debit≠Credit blocks posting | JournalEntries | P0: Debit=Credit validation |
| FIN-C03 | Post button: draft→posted | JournalEntries | P0: GL posting workflow |
| FIN-C04 | Void button on posted entry | JournalEntries | P0: GL posting workflow |
| FIN-C05 | Report generates with totals | TrialBalance | P0: Trial Balance (new page) |
| FIN-C06 | A = L + E displayed | BalanceSheet | P0: Balance Sheet (new page) |
| FIN-C07 | Rev − Exp = NI displayed | ProfitLoss | P0: P&L (new page) |
| FIN-C08 | Aging buckets render | AccountsReceivable | Existing: AR aging |
| FIN-C09 | Payment scheduling display | AccountsPayable | Existing: AP |
| FIN-C10 | Line items with per-line tax | Invoices | P1: Line-item support |
| FIN-C11 | E-invoice XML generation | Invoices | P2: E-invoice Turnkey |
| FIN-C12 | Bank transaction matching | BankReconciliation | Updated: Auto-matching engine |
| FIN-C13 | Budget vs Actual variance % | Budgets | Existing: Budget |
| FIN-C14 | Depreciation schedule display | FixedAssets | P1: Fixed assets (new page) |
| FIN-C15 | 401/403 report generation | TaxReports | P1: Tax reports (new page) |

### 1.5 E2E — Journal Entry → Financial Statements

| # | Step | Verification | Gap Validated |
|---|------|-------------|---------------|
| FIN-E01 | Navigate to Finance → Journal Entries | Page loads | — |
| FIN-E02 | Create JE with balanced lines | Saved as draft | P0: GL posting |
| FIN-E03 | Attempt to post unbalanced JE | Error: "Debit ≠ Credit" | P0: Validation |
| FIN-E04 | Post balanced JE | Status → "Posted" | P0: GL posting |
| FIN-E05 | Navigate to Trial Balance | Posted JE reflected | P0: Trial Balance |
| FIN-E06 | Navigate to Balance Sheet | A = L + E | P0: Balance Sheet |
| FIN-E07 | Navigate to P&L | Rev − Exp = NI | P0: P&L |

---

## 2. HR & Labor Law — Gap Validation

> **Gap Status**: 80% → 92%
> **New Libraries**: `payroll.js`, `leavePolicy.js` (enhanced), `laborLaw.js` (existing)
> **Key Claim**: 16 leave types + 勞基法 §30-§49 + 勞保/健保/勞退/所得稅

### 2.1 Unit Tests — `payroll.js` (P0)

Validates: 勞保/健保/勞退/所得稅 auto-calculation with 2026 rate tables

| # | Test Case | Gap Validated | Expected |
|---|-----------|---------------|----------|
| HR-U01 | 勞保 — minimum bracket | P0: 勞健保計算 | Correct split at salary ≤ 27,470 |
| HR-U02 | 勞保 — maximum bracket | P0: 勞健保計算 | Capped at max bracket |
| HR-U03 | 勞保 — mid bracket lookup | P0: 勞健保計算 | Correct bracket for salary = 36,000 |
| HR-U04 | 健保 — single (0 dependents) | P0: 勞健保計算 | Correct NHI amount |
| HR-U05 | 健保 — with 3 dependents | P0: 勞健保計算 | Higher NHI amount |
| HR-U06 | 勞退 6% employer contribution | P0: 勞健保計算 | 40,000 × 6% = 2,400 |
| HR-U07 | 所得稅 — low salary | P0: 所得稅扣繳 | Minimal/zero tax at 30K |
| HR-U08 | 所得稅 — high salary | P0: 所得稅扣繳 | Progressive rate at 150K |
| HR-U09 | Net = Gross − all deductions | P0: Full payroll | Sum check |
| HR-U10 | Withholding matches 2026 table | P0: 所得稅扣繳 | Matches official tax brackets |
| HR-U11 | Boundary value bracket test | P0: Edge case | Correct at exact boundary |

### 2.2 Unit Tests — `laborLaw.js` (Competitive Advantage)

Validates: 勞基法 §30-§49 compliance engine — claimed differentiator vs Odoo

| # | Test Case | Statute | Expected |
|---|-----------|---------|----------|
| HR-U12 | Normal ≤ 8h/day | §30 | Valid |
| HR-U13 | Reject > 8h without OT | §30 | Invalid |
| HR-U14 | Weekly ≤ 40h | §30 | Valid |
| HR-U15 | Reject weekly > 40h | §30 | Violation flagged |
| HR-U16 | OT first 2h at 1.34× | §24 | Pay = 2 × hourly × 1.34 |
| HR-U17 | OT next 2h at 1.67× | §24 | First 2h @1.34 + next 2h @1.67 |
| HR-U18 | Rest day OT higher rate | §24 | Higher multiplier |
| HR-U19 | National holiday OT = 2× | §39 | Double pay |
| HR-U20 | Monthly OT cap 46h | §32 | Violation at 47h |
| HR-U21 | Extended OT cap 54h | §32 exception | Valid with agreement flag |

### 2.3 Unit Tests — `leavePolicy.js` (Competitive Advantage)

Validates: 16 leave types — claimed depth vs all competitors

| # | Test Case | Leave Type | Expected |
|---|-----------|-----------|----------|
| HR-U22 | Annual: 6mo–1yr = 3 days | 特休 | 3 days |
| HR-U23 | Annual: 1–2yr = 7 days | 特休 | 7 days |
| HR-U24 | Annual: 3–5yr = 10 days | 特休 | 10 days |
| HR-U25 | Annual: 5–10yr = 14 days | 特休 | 14 days |
| HR-U26 | Annual: 10+yr = 15+ days | 特休 | 15 + extra per year |
| HR-U27 | Sick leave max 30 days/year | 病假 | Reject 31st day |
| HR-U28 | Menstrual leave 1 day/month | 生理假 | Approved |
| HR-U29 | Family care leave 7 days/year | 家庭照顧假 | Reject 8th day |
| HR-U30 | Maternity leave 8 weeks | 產假 | 56 calendar days |
| HR-U31 | Paternity leave 7 days | 陪產假 | 7 days |
| HR-U32 | Overlap detection | Any | Validation error |
| HR-U33 | Balance insufficient | Any | Validation error |
| HR-U34 | All 16 types recognized | All | Valid info for each type code |

### 2.4 Component Tests — HR Pages

| # | Test Case | Page | Feature Validated |
|---|-----------|------|-------------------|
| HR-C01 | Clock-in updates status | Attendance | Existing: Clock in/out |
| HR-C02 | Clock-out records duration | Attendance | Existing: Clock in/out |
| HR-C03 | Attendance table renders | Attendance | Existing: Attendance |
| HR-C04 | Leave form: all required fields | Leave | 16 leave types |
| HR-C05 | Leave dropdown: 16 types shown | Leave | 16 leave types (competitive advantage) |
| HR-C06 | Balance updates after submission | Leave | Leave balance tracking |
| HR-C07 | Approve/reject buttons work | Leave | Approval workflow |
| HR-C08 | OT form validates ≤ 46h/month | Overtime | §32 compliance |
| HR-C09 | OT calculation shows tiered rates | Overtime | §24 tiered OT |
| HR-C10 | Batch payroll runs all employees | Salary | P0: Batch payroll (upgraded) |
| HR-C11 | Pay slip shows deduction breakdown | Salary | P0: 勞保/健保/勞退/所得稅 breakdown |
| HR-C12 | Export salary PDF | Salary | Report export |
| HR-C13 | Shift drag to time slot | Schedule | Shift scheduling |
| HR-C14 | Compliance violation highlighted | Schedule | §30 compliance check |
| HR-C15 | KRA score entry (1–5) | Performance | Performance reviews |
| HR-C16 | 360° feedback form | Performance | Performance reviews |
| HR-C17 | Job posting CRUD | Recruitment | Recruitment pipeline |
| HR-C18 | Applicant pipeline Kanban | Recruitment | Recruitment pipeline |
| HR-C19 | File upload and list | Documents | Document management |
| HR-C20 | Expense form with receipt | Expenses | Expense claims |
| HR-C21 | Bonus calculation | Bonus | Performance bonus |
| HR-C22 | Trip request with approval | BusinessTravel | Business travel |
| HR-C23 | Holiday calendar CRUD | Holidays | Holidays |

### 2.5 E2E — Complete Payroll Run

| # | Step | Verification | Gap Validated |
|---|------|-------------|---------------|
| HR-E01 | Navigate to HR → Salary | Employee list loads | — |
| HR-E02 | Click "Run Payroll" for month | Processing indicator | P0: Batch payroll |
| HR-E03 | Verify 勞保 deduction | Matches bracket table | P0: 勞保 |
| HR-E04 | Verify 健保 deduction | Matches NHI table | P0: 健保 |
| HR-E05 | Verify 勞退 6% | = Salary × 6% | P0: 勞退 |
| HR-E06 | Verify 所得稅 withholding | Matches tax bracket | P0: 所得稅 |
| HR-E07 | Verify net = gross − deductions | Math checks out | P0: Full payroll |
| HR-E08 | Export pay slips PDF | PDF downloads | Report export |

### 2.6 E2E — Leave Request Lifecycle

| # | Step | Verification | Gap Validated |
|---|------|-------------|---------------|
| HR-E09 | Employee submits annual leave | Status = "pending" | Leave workflow |
| HR-E10 | System validates balance | Sufficient balance confirmed | Leave validation |
| HR-E11 | Manager approves | Status → "approved" | Approval workflow |
| HR-E12 | Balance deducted | Remaining days reduced | Leave tracking |
| HR-E13 | Attempt to exceed balance | Validation error | Leave validation |

---

## 3. Manufacturing — Gap Validation

> **Gap Status**: 35% → 75%
> **New Libraries**: `mrpEngine.js`, `inventoryCosting.js` (also WMS)
> **Key Changes**: Real MRP engine, multi-level BOM explosion, cost rollup

### 3.1 Unit Tests — `mrpEngine.js` (P1)

Validates: MRP was "manual data entry" → now a real calculation engine

| # | Test Case | Gap Validated | Expected |
|---|-----------|---------------|----------|
| MFG-U01 | Single-level BOM explosion | P3: Multi-level BOM | Correct qty per component |
| MFG-U02 | Multi-level BOM (recursive) | P3: Multi-level BOM | All levels exploded |
| MFG-U03 | Net req = Gross − On-hand | P1: Real MRP engine | Demand=100, Stock=30 → Net=70 |
| MFG-U04 | Net req with safety stock | P1: Real MRP engine | Demand=100, Stock=30, SS=20 → Net=90 |
| MFG-U05 | Lead time offset | P1: Real MRP engine | Order date = need date − lead time |
| MFG-U06 | Purchase suggestions generated | P1: Real MRP engine | Suggestions with qty + date |
| MFG-U07 | Zero demand = no suggestions | P1: Real MRP engine | Empty |
| MFG-U08 | Capacity requirements | P1: Real MRP engine | Hours per work center |
| MFG-U09 | Phantom assembly passthrough | P3: Multi-level BOM | Components flow through |
| MFG-U10 | Circular BOM detection | P3: Multi-level BOM | Error (no infinite loop) |

### 3.2 Unit Tests — `inventoryCosting.js` (P1)

Validates: "No costing methods" → FIFO, LIFO, weighted avg, moving avg

| # | Test Case | Gap Validated | Expected |
|---|-----------|---------------|----------|
| MFG-U11 | FIFO: oldest cost first | P1: FIFO costing | Issue at oldest price |
| MFG-U12 | FIFO: partial lot consumption | P1: FIFO costing | Correct remaining qty/cost |
| MFG-U13 | LIFO: newest cost first | P1: LIFO costing | Issue at newest price |
| MFG-U14 | Weighted average recalc | P1: Weighted avg costing | Correct blended cost |
| MFG-U15 | Moving average after receipt | P1: Moving avg costing | Average updates each time |
| MFG-U16 | Inventory valuation report | P1: Costing methods | Total value by method |
| MFG-U17 | Over-issue handling | Edge case | Error or negative stock flag |

### 3.3 Component Tests — Manufacturing Pages

| # | Test Case | Page | Gap Validated |
|---|-----------|------|---------------|
| MFG-C01 | Multi-level BOM tree rendering | BOM | P3: Multi-level BOM |
| MFG-C02 | Add/remove component rows | BOM | BOM CRUD |
| MFG-C03 | Cost rollup display | BOM | P1: Cost rollup from BOM |
| MFG-C04 | Run MRP → results table | MRP | P1: Real MRP engine |
| MFG-C05 | Purchase suggestions populated | MRP | P1: Purchase suggestions |
| MFG-C06 | Status: planned→in-progress→done | ManufacturingOrders | MO tracking |
| MFG-C07 | Inspection pass/fail form | QualityInspection | QI CRUD |
| MFG-C08 | Defect logging form | QualityInspection | QI CRUD |

### 3.4 E2E — MRP Planning Run

| # | Step | Verification | Gap Validated |
|---|------|-------------|---------------|
| MFG-E01 | Define multi-level BOM | BOM saved with components | P3: Multi-level BOM |
| MFG-E02 | Enter demand forecast | Demand quantities saved | — |
| MFG-E03 | Run MRP | Results table populated | P1: Real MRP engine |
| MFG-E04 | Review purchase suggestions | Suggestions with qty + date | P1: Purchase suggestions |
| MFG-E05 | Convert suggestion to PR | PR created | Integration |

---

## 4. Sales — Gap Validation

> **Gap Status**: 50% → 80%
> **Key Changes**: Line items on quotes/orders/invoices, qty×price, per-line tax/discount

### 4.1 Unit Tests — `einvoice.js` (P2)

Validates: E-invoice Turnkey, 統一編號 validation

| # | Test Case | Gap Validated | Expected |
|---|-----------|---------------|----------|
| SLS-U01 | Valid 統一編號 (8 digits) | P2: E-invoice | Valid |
| SLS-U02 | Invalid 統一編號 (wrong length) | P2: E-invoice | Invalid |
| SLS-U03 | Invalid 統一編號 (non-numeric) | P2: E-invoice | Invalid |
| SLS-U04 | Invoice number format | P2: E-invoice | AA-12345678 format |
| SLS-U05 | Tax calculation (5% VAT) | P2: E-invoice | Amount=1000 → Tax=50 |
| SLS-U06 | Tax-exempt item | P2: E-invoice | Tax = 0 |
| SLS-U07 | E-Invoice XML structure | P2: E-invoice MIG XML | Valid MIG Turnkey XML |
| SLS-U08 | Carrier barcode format | P2: E-invoice | Correct format |

### 4.2 Component Tests — Sales Pages

| # | Test Case | Page | Gap Validated |
|---|-----------|------|---------------|
| SLS-C01 | Line-item entry (qty × price) | Quotations | P1: Line-item support |
| SLS-C02 | Convert quote → sales order | Quotations | Existing: Q→O conversion |
| SLS-C03 | Order list with status filter | SalesOrders | Updated: Line items |
| SLS-C04 | Discount rule CRUD | Promotions | Promotions |
| SLS-C05 | RMA form submission | Returns | Returns |
| SLS-C06 | Tracking status timeline | Shipments | Shipments |

### 4.3 E2E — Quote-to-Cash Full Cycle

| # | Step | Verification | Gap Validated |
|---|------|-------------|---------------|
| SLS-E01 | Create quotation with line items | Quote saved with items | P1: Line items |
| SLS-E02 | Convert quote → sales order | SO created, quote = "converted" | Existing flow |
| SLS-E03 | Create shipment from SO | Shipment created | Existing flow |
| SLS-E04 | Generate invoice + e-invoice | Invoice + XML generated | P2: E-invoice |
| SLS-E05 | AR entry auto-created | AR record exists | Existing automation |
| SLS-E06 | Record payment receipt | AR cleared | Finance integration |

---

## 5. Purchase & Supply Chain — Gap Validation

> **Gap Status**: 70% → 90%
> **New Libraries**: `threeWayMatch.js`
> **Key Changes**: Three-way matching, line items on POs, price variance

### 5.1 Unit Tests — `threeWayMatch.js` (P2)

Validates: "Missing three-way matching" → now PO vs GR vs Invoice matching

| # | Test Case | Gap Validated | Expected |
|---|-----------|---------------|----------|
| PUR-U01 | Perfect match (PO=GR=INV) | P2: Three-way matching | Status: "matched" |
| PUR-U02 | Within tolerance (2% var, 5% tol) | P2: Three-way matching | Auto-approved |
| PUR-U03 | Exceeds tolerance (8% var, 5% tol) | P2: Three-way matching | Flagged for review |
| PUR-U04 | Quantity mismatch | P2: Three-way matching | Variance reported |
| PUR-U05 | Missing GR (2-way only) | P2: Three-way matching | Partial match |
| PUR-U06 | Price variance % calculation | P2: Price variance | Correct % |

### 5.2 Component Tests — Purchase Pages

| # | Test Case | Page | Gap Validated |
|---|-----------|------|---------------|
| PUR-C01 | PR form with budget check | PurchaseRequests | Existing |
| PUR-C02 | PO generation from PR | PurchaseOrders | Updated: Line items |
| PUR-C03 | 3-way match status indicator | GoodsReceipts | P2: Three-way matching |
| PUR-C04 | Supplier rating display | Suppliers | Existing |
| PUR-C05 | Contract renewal alert | Contracts | Existing |

### 5.3 E2E — Procure-to-Pay Full Cycle

| # | Step | Verification | Gap Validated |
|---|------|-------------|---------------|
| PUR-E01 | Create Purchase Request | PR saved, status "pending" | Existing |
| PUR-E02 | Approve PR | Status → "approved" | Existing |
| PUR-E03 | Generate PO from PR | PO created, linked to PR | Existing |
| PUR-E04 | Record Goods Receipt | GR recorded against PO | Existing |
| PUR-E05 | 3-way match passes | Status = "matched" | P2: Three-way matching |
| PUR-E06 | AP entry auto-created | AP record exists | Existing automation |
| PUR-E07 | Record payment | AP cleared, JE posted | Finance integration |

---

## 6. WMS / Inventory — Gap Validation

> **Gap Status**: 75% → 90%
> **Key Changes**: FIFO/weighted avg costing, barcode scanning, cycle count, variance analysis

### 6.1 Component Tests — WMS Pages

| # | Test Case | Page | Gap Validated |
|---|-----------|------|---------------|
| WMS-C01 | Stock levels with location | Inventory | Updated: Costing methods |
| WMS-C02 | Barcode search works | Inventory | P3: Barcode scanning |
| WMS-C03 | SKU master CRUD | SKUs | Updated: Costing method field |
| WMS-C04 | Goods receipt form | Inbound | Existing |
| WMS-C05 | Pick list generation | Outbound | Existing |
| WMS-C06 | Lot/batch tracking | Lots | Existing: Lot tracking |
| WMS-C07 | Expiry date highlighting | Lots | Existing: Expiry |
| WMS-C08 | Cycle count with variance | StockCount | Updated: Variance analysis |
| WMS-C09 | Inventory aging report | Reports | Existing |

### 6.2 E2E — Inventory Management

| # | Step | Verification | Gap Validated |
|---|------|-------------|---------------|
| WMS-E01 | Create new SKU | SKU in master list | Updated: Costing method field |
| WMS-E02 | Record inbound receipt | Stock level increases | Existing |
| WMS-E03 | Record outbound shipment | Stock level decreases | Existing |
| WMS-E04 | Run cycle count | Variance calculated | Updated: Variance analysis |
| WMS-E05 | Lot tracking with expiry | Expiring lots highlighted | Existing |

---

## 7. CRM — Gap Validation

> **Gap Status**: 50% → 80%
> **New Libraries**: `crmEngine.js`, `dripCampaign.js`, `aiTemplateEngine.js`, `messaging.js`
> **New Pages**: DripCampaigns, FormBuilder, WorkflowBuilder
> **Key Changes**: Email/LINE/SMS sending, drip campaigns with AI, campaign analytics

### 7.1 Unit Tests — `crmEngine.js` (P1)

| # | Test Case | Gap Validated | Expected |
|---|-----------|---------------|----------|
| CRM-U01 | Lead score calculation | CRM-P1: Contact scoring | Score 0–100 |
| CRM-U02 | CLV calculation | CRM-P1: CLV | Correct lifetime value |
| CRM-U03 | Segment evaluation | CRM-P0: Dynamic segments | In/out of segment |
| CRM-U04 | SLA status calculation | CRM-P1: SLA management | On-time / breached |
| CRM-U05 | Auto-assign ticket | CRM-P1: Ticket assignment | Least-loaded rep |
| CRM-U06 | Escalation check | CRM-P1: Escalation | Triggered on overdue |
| CRM-U07 | Funnel conversion rate | CRM-P1: Conversion analytics | % per stage |
| CRM-U08 | Points earned per tier | CRM-P0: Points automation | Correct per tier rules |
| CRM-U09 | Tier upgrade logic | CRM-P0: Tier rules | bronze→silver→gold→platinum→diamond |
| CRM-U10 | Company–contact linking | CRM-P0: Contact hierarchy | Association created |

### 7.2 Unit Tests — `dripCampaign.js` (Bonus)

| # | Test Case | Gap Validated | Expected |
|---|-----------|---------------|----------|
| CRM-U11 | Create campaign with steps | Drip campaigns | Campaign + ordered steps |
| CRM-U12 | Evaluate wait condition | Drip campaigns | Step at correct time |
| CRM-U13 | Evaluate action condition | Drip campaigns | Correct branch |
| CRM-U14 | Simulate full campaign | Drip campaigns | Projected metrics per step |
| CRM-U15 | Calculate drip metrics | Drip campaigns | Open/click/conversion rates |
| CRM-U16 | All 6 templates load | Drip campaigns | Valid template structures |

### 7.3 Unit Tests — `messaging.js` (P3)

Validates: "Email/LINE integration: NO" → now actual sending

| # | Test Case | Gap Validated | Expected |
|---|-----------|---------------|----------|
| CRM-U17 | Email template rendering | P3: Email sending | Variables substituted |
| CRM-U18 | LINE message formatting | P3: LINE sending | Correct API payload |
| CRM-U19 | SMS message formatting | P3: SMS sending | Correct payload |
| CRM-U20 | Bulk email batching | P3: Email sending | 500 recipients batched |
| CRM-U21 | All templates have fields | P3: Templates | subject, body, variables |

### 7.4 Component Tests — CRM Pages

| # | Test Case | Page | Gap Validated |
|---|-----------|------|---------------|
| CRM-C01 | Kanban board renders | Pipeline | Existing |
| CRM-C02 | Deal probability display | Pipeline | Existing |
| CRM-C03 | 360° customer view tabs | Customers | Existing |
| CRM-C04 | Campaign creation form | Marketing | Updated: Actual sending |
| CRM-C05 | Send tracking metrics | Marketing | Updated: Campaign execution |
| CRM-C06 | Tier badge display | Members | Existing |
| CRM-C07 | Points history table | Members | Existing |
| CRM-C08 | Template selection & preview | DripCampaigns | Bonus: New page |
| CRM-C09 | Form field CRUD | FormBuilder | CRM-P2: Lead capture |
| CRM-C10 | IF/THEN rule builder | WorkflowBuilder | CRM-P2: Visual workflow |

### 7.5 E2E — CRM Pipeline

| # | Step | Verification | Gap Validated |
|---|------|-------------|---------------|
| CRM-E01 | Create new lead | Lead in pipeline | — |
| CRM-E02 | Move through stages | Stage updates | Kanban pipeline |
| CRM-E03 | Log activity on deal | Activity in timeline | Activity tracking |
| CRM-E04 | Win deal | Moved to "won", revenue counted | Revenue recognition |
| CRM-E05 | Forecast reflects won deal | Amount updated | Weighted forecast |

---

## 8. POS — Gap Validation

> **Gap Status**: 60% → 85%
> **New Libraries**: `payment.js`, `einvoice.js` (shared)
> **Key Changes**: Payment processing, receipt printing, e-invoice, refunds, shift reconciliation

### 8.1 Unit Tests — `payment.js` (P2)

Validates: "No payment processing" → ECPay/LINE Pay structure

| # | Test Case | Gap Validated | Expected |
|---|-----------|---------------|----------|
| POS-U01 | ECPay payment request | P2: Payment gateway | Correct payload |
| POS-U02 | LINE Pay request | P2: Payment gateway | Correct payload |
| POS-U03 | Verify valid callback | P2: Payment gateway | Verified = true |
| POS-U04 | Reject tampered callback | P2: Payment security | Verified = false |
| POS-U05 | Process refund | P3: Refunds | Refund generated |
| POS-U06 | Payment status lookup | P2: Payment gateway | Status returned |

### 8.2 Component Tests — POS Pages

| # | Test Case | Page | Gap Validated |
|---|-----------|------|---------------|
| POS-C01 | Add item to cart | POSTerminal | Existing |
| POS-C02 | Cart total calculation | POSTerminal | Existing |
| POS-C03 | Payment method selection | POSTerminal | Updated: Real processing |
| POS-C04 | Receipt generation | POSTerminal | P3: Receipt printing |
| POS-C05 | Refund processing | POSTerminal | P3: Refunds |
| POS-C06 | Open/close shift | POSShifts | Updated: Reconciliation |
| POS-C07 | Cash reconciliation form | POSShifts | Updated: Payment breakdown |

### 8.3 E2E — POS Transaction

| # | Step | Verification | Gap Validated |
|---|------|-------------|---------------|
| POS-E01 | Open POS terminal | Interface loads | — |
| POS-E02 | Add items to cart | Cart updates | Existing |
| POS-E03 | Apply discount | Total recalculated | Discount |
| POS-E04 | Complete payment | Transaction recorded | P2: Payment processing |
| POS-E05 | Print receipt | Receipt dialog | P3: Receipt printing |
| POS-E06 | Process refund | Refund recorded | P3: Refunds |

---

## 9. Analytics & Dashboard — Gap Validation

> **Gap Status**: 45% → 70%
> **Key Changes**: Real data (no Math.random()), cross-module dashboard, date picker, CSV/PDF export
> **New Component**: DateRangePicker

### 9.1 Component Tests — Analytics Pages

| # | Test Case | Page | Gap Validated |
|---|-----------|------|---------------|
| ANA-C01 | KPI cards show real values | Dashboard | Analytics-P0: Cross-module |
| ANA-C02 | AR/AP balance cards | Dashboard | Analytics-P1: Business KPIs |
| ANA-C03 | Pipeline value card | Dashboard | Analytics-P1: Business KPIs |
| ANA-C04 | Inventory alerts card | Dashboard | Analytics-P1: Business KPIs |
| ANA-C05 | Charts render with data | Analytics | Analytics-P0: Real data |
| ANA-C06 | Date range picker works | Analytics | Analytics-P0: Date picker |
| ANA-C07 | CSV export button | Analytics | Analytics-P1: Export |
| ANA-C08 | PDF export button | Analytics | Analytics-P1: Export |
| ANA-C09 | Revenue chart: real data | SalesForecast | Analytics-P0: No Math.random() |
| ANA-C10 | Forecast: weighted MA | SalesForecast | Analytics-P1: Real forecasting |

---

## 10. Process Management — Feature Validation

> **Gap Status**: ~70% (no gap closure in this round)

### 10.1 Component Tests — Process Pages

| # | Test Case | Page |
|---|-----------|------|
| PRC-C01 | Workflow KPI display | ProcessOverview |
| PRC-C02 | Task assignment form | Tasks |
| PRC-C03 | Task status tracking | Tasks |
| PRC-C04 | Checklist template CRUD | Checklists |
| PRC-C05 | SOP version control display | SOPTemplates |
| PRC-C06 | Workflow definition CRUD | Workflows |

---

## 11. Organization — Feature Validation

### 11.1 Component Tests — Org Pages

| # | Test Case | Page |
|---|-----------|------|
| ORG-C01 | Org structure dashboard | OrgOverview |
| ORG-C02 | Employee directory CRUD | Employees |
| ORG-C03 | Department master CRUD | Departments |
| ORG-C04 | Company master CRUD | Companies |
| ORG-C05 | Location management | Locations |
| ORG-C06 | LINE integration settings | LineIntegration |

---

## 12. System Administration — Feature Validation

### 12.1 Unit Tests — Support Libraries

| # | Test Case | Library | Expected |
|---|-----------|---------|----------|
| SYS-U01 | Log field-level change | `auditLogger.js` | who/what/when/old/new |
| SYS-U02 | Log inventory change | `auditLogger.js` | Item, qty, reason |
| SYS-U03 | Log customer change | `auditLogger.js` | Fields changed |
| SYS-U04 | Audit timestamp present | `auditLogger.js` | ISO timestamp |
| SYS-U05 | Get supervisor by employee | `approval.js` | Correct supervisor |
| SYS-U06 | Approval chain by hierarchy | `approval.js` | [supervisor, manager, director] |
| SYS-U07 | Submit for approval | `approval.js` | Pending approval created |
| SYS-U08 | Amount-based routing | `approval.js` | Higher authority for high-value |
| SYS-U09 | Mask phone number | `dataMasking.js` | "0912***678" |
| SYS-U10 | Mask email | `dataMasking.js` | "u***@example.com" |
| SYS-U11 | Mask ID number | `dataMasking.js` | "A1234****9" |
| SYS-U12 | Admin sees full data | `dataMasking.js` | No masking |
| SYS-U13 | Non-admin sees masked data | `dataMasking.js` | Masking applied |
| SYS-U14 | Low stock → auto PR | `automation.js` | PR created |
| SYS-U15 | Shipment → AR entry | `automation.js` | AR record |
| SYS-U16 | GR → AP entry | `automation.js` | AP record |
| SYS-U17 | Profitability calculation | `automation.js` | Correct margin % |
| SYS-U18 | Annual leave settlement | `automation.js` | Settlement amount |

### 12.2 Unit Tests — Export Utilities

| # | Test Case | Library | Expected |
|---|-----------|---------|----------|
| SYS-U19 | Attendance PDF columns | `exportPdf.js` | All fields present |
| SYS-U20 | Salary PDF totals | `exportPdf.js` | Totals match sum |
| SYS-U21 | CSV export with headers | `exportUtils.js` | Valid CSV string |
| SYS-U22 | PDF export generates blob | `exportUtils.js` | Non-empty blob |

### 12.3 Component Tests — System Pages

| # | Test Case | Page |
|---|-----------|------|
| SYS-C01 | User CRUD with role dropdown | Users |
| SYS-C02 | Company settings save | Settings |
| SYS-C03 | Automation rule toggle | Triggers |
| SYS-C04 | Audit trail table + filters | AuditLog |
| SYS-C05 | Notification mark as read | Notifications |
| SYS-C06 | CSV upload and preview | DataImportExport |
| SYS-C07 | Export button generates file | DataImportExport |

---

## 13. Cross-Module Integration Tests

> **Framework**: Vitest + MSW (stateful mock handlers)
> **Purpose**: Validate the 5 end-to-end workflows listed as "fully implemented" in gap_v1.md

### 13.1 Procure-to-Pay (gap_v1 Workflow #1)

Validates: "PR → PO → GR → AP (auto-creates journal entry)"

| # | Test Case | Modules |
|---|-----------|---------|
| INT-01 | PR → PO creation links correctly | Purchase |
| INT-02 | PO → GR → 3-way match triggers AP | Purchase + Finance |
| INT-03 | AP entry creates journal entry | Finance |
| INT-04 | Payment clears AP and posts JE | Finance |
| INT-05 | Budget check blocks over-budget PR | Purchase + Finance |

### 13.2 Order-to-Cash (gap_v1 Workflow #2)

Validates: "Quote → Order → Ship → AR (auto-creates journal entry)"

| # | Test Case | Modules |
|---|-----------|---------|
| INT-06 | Quotation → Sales Order | Sales |
| INT-07 | Sales Order → Shipment | Sales + WMS |
| INT-08 | Shipment → AR entry (Dr AR, Cr Revenue) | Sales + Finance |
| INT-09 | Invoice generation + e-invoice XML | Sales + Finance |
| INT-10 | Payment receipt clears AR | Finance |

### 13.3 Inventory-to-Purchase (gap_v1 Workflow #3)

Validates: "Low stock alert → auto-generates PR"

| # | Test Case | Modules |
|---|-----------|---------|
| INT-11 | Stock below reorder point triggers PR | WMS + Purchase |
| INT-12 | Auto-PR has correct item + qty | WMS + Purchase |

### 13.4 POS-to-Accounting (gap_v1 Workflow #4)

Validates: "Transaction → auto-creates invoice + journal entry"

| # | Test Case | Modules |
|---|-----------|---------|
| INT-13 | POS sale → inventory deduction | POS + WMS |
| INT-14 | POS sale → revenue JE created | POS + Finance |
| INT-15 | POS refund → inventory return + reverse JE | POS + WMS + Finance |
| INT-16 | Shift close → reconciliation | POS |

### 13.5 CRM-to-Receivables (gap_v1 Workflow #5)

Validates: "Won opportunity → auto-creates AR"

| # | Test Case | Modules |
|---|-----------|---------|
| INT-17 | Pipeline win → AR created | CRM + Finance |
| INT-18 | Campaign send → delivery tracking | CRM + Messaging |

### 13.6 Manufacturing Flow

| # | Test Case | Modules |
|---|-----------|---------|
| INT-19 | BOM explosion feeds MRP | Manufacturing |
| INT-20 | MRP generates purchase suggestions | Manufacturing + Purchase |
| INT-21 | Manufacturing order consumes inventory | Manufacturing + WMS |
| INT-22 | Finished goods receipt → stock increase | Manufacturing + WMS |
| INT-23 | Cost rollup from BOM | Manufacturing + Finance |

### 13.7 HR-Payroll Flow

| # | Test Case | Modules |
|---|-----------|---------|
| INT-24 | Attendance → OT auto-calculation | HR |
| INT-25 | Leave approval → balance deduction | HR |
| INT-26 | OT approved → salary OT component | HR |
| INT-27 | Payroll run → net salary all employees | HR |
| INT-28 | Payroll JE (Dr Salary Exp, Cr Payable) | HR + Finance |

### 13.8 Automation Triggers

| # | Test Case | Modules |
|---|-----------|---------|
| INT-29 | Low stock → auto PR | WMS + Purchase |
| INT-30 | Approved expense → AP entry | HR + Finance |
| INT-31 | Contract expiring → notification | Purchase + System |

---

## 14. Shared Component Tests

| # | Test Case | Component |
|---|-----------|-----------|
| SC-01 | Opens on trigger, closes on Escape | Modal |
| SC-02 | Focus trap (Tab cycles within) | Modal |
| SC-03 | Submit callback fires | Modal |
| SC-04 | Collapse/expand toggle | Sidebar |
| SC-05 | Active route highlighted | Sidebar |
| SC-06 | Nested menu sections expand | Sidebar |
| SC-07 | Dark/light theme toggle | Sidebar |
| SC-08 | Renders with label text | LoadingSpinner |
| SC-09 | Toast appears and auto-dismisses | NotificationCenter |
| SC-10 | Step progression (next/back) | OnboardingWizard |
| SC-11 | Shows masked value by default | MaskedText |
| SC-12 | Reveals on authorized click | MaskedText |
| SC-13 | Renders icon, value, trend | StatCard |

---

## 15. Routing Tests

| # | Test Case | Expected |
|---|-----------|----------|
| RT-01 | All 100+ routes render without crash | Lazy pages mount |
| RT-02 | Unknown route → 404 or redirect | Graceful handling |
| RT-03 | Sidebar links → correct routes | Click → URL matches |
| RT-04 | Browser back/forward works | History correct |
| RT-05 | Deep link to subpage | Direct URL → correct page |
| RT-06 | Lazy loading shows spinner | Suspense boundary works |

---

## 16. Security & Access Control Tests

| # | Test Case | Type | Expected |
|---|-----------|------|----------|
| SEC-01 | Unauthenticated → redirect to /login | E2E | Redirect |
| SEC-02 | Employee cannot access system admin | E2E | Access denied |
| SEC-03 | PII masked for non-admin | Component | Masked data |
| SEC-04 | PII visible for admin | Component | Full data |
| SEC-05 | Audit log records all changes | Integration | Entries created |
| SEC-06 | XSS: script tags in inputs | E2E | No execution |
| SEC-07 | SQL injection: special chars | E2E | Safe query |
| SEC-08 | CSRF: Supabase tokens validated | Integration | Invalid rejected |
| SEC-09 | Session timeout after inactivity | E2E | Auto-logout |
| SEC-10 | Password not in localStorage | Unit | Only auth token |

---

## 17. Performance Tests

| # | Test Case | Target |
|---|-----------|--------|
| PERF-01 | Dashboard LCP | < 2.5s |
| PERF-02 | Route navigation | < 500ms |
| PERF-03 | Table with 1000 rows | < 1s |
| PERF-04 | Payroll batch (100 employees) | < 5s |
| PERF-05 | MRP calculation (50 BOMs) | < 3s |
| PERF-06 | Bundle size (main chunk) | < 500KB gzip |
| PERF-07 | Lazy chunk size | < 100KB each |
| PERF-08 | Memory: no leaks after 50 navigations | Heap stable |
| PERF-09 | Chart rendering (12mo data) | < 300ms |
| PERF-10 | PDF export (100-row report) | < 3s |

---

## 18. Accessibility Tests

| # | Test Case | Standard |
|---|-----------|----------|
| A11Y-01 | All pages pass axe-core | WCAG 2.1 AA |
| A11Y-02 | Keyboard Tab order | Logical flow |
| A11Y-03 | Form labels present | aria-label / `<label>` |
| A11Y-04 | Color contrast ratio | ≥ 4.5:1 |
| A11Y-05 | Modal focus trap | Focus within |
| A11Y-06 | Error messages announced | aria-live |
| A11Y-07 | Images have alt text | Non-decorative |
| A11Y-08 | Dark mode contrast | Passes both themes |

---

## 19. Visual Regression Tests

| # | Page/Component | Viewports |
|---|---------------|-----------|
| VR-01 | Dashboard | 1920×1080, 1366×768, 375×812 |
| VR-02 | Sidebar (expanded + collapsed) | Desktop + mobile |
| VR-03 | POS Terminal | 1024×768, 1920×1080 |
| VR-04 | Modal (open state) | Desktop + mobile |
| VR-05 | Finance reports (TB, BS, P&L) | Desktop |
| VR-06 | CRM Pipeline Kanban | Desktop |
| VR-07 | Dark mode vs Light mode | Dashboard, Sidebar |
| VR-08 | Empty states (no data) | Key pages |
| VR-09 | Loading states | Key pages |
| VR-10 | Print layouts (PDF preview) | A4 portrait |

---

## 20. E2E — Authentication & Authorization

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| AUTH-E01 | Login valid credentials | Email/password → login | Dashboard shown |
| AUTH-E02 | Login invalid credentials | Wrong password | Error message |
| AUTH-E03 | Session persistence | Login → refresh | Still logged in |
| AUTH-E04 | Logout | Click logout | Redirect to /login |
| AUTH-E05 | Admin sees all nav items | Login as admin | Full nav |
| AUTH-E06 | Employee restricted nav | Login as employee | Limited nav |
| AUTH-E07 | Protected route redirect | /finance without login | Redirect to /login |

---

## 21. Test Count Summary

| Category | Cases | % of Total |
|----------|-------|------------|
| **Unit Tests — Finance** | 25 | 6% |
| **Unit Tests — HR/Labor** | 23 | 5% |
| **Unit Tests — Manufacturing** | 17 | 4% |
| **Unit Tests — Sales (e-invoice)** | 8 | 2% |
| **Unit Tests — Purchase (3-way match)** | 6 | 1% |
| **Unit Tests — CRM** | 21 | 5% |
| **Unit Tests — POS (payment)** | 6 | 1% |
| **Unit Tests — System (audit/approval/mask/auto/export)** | 22 | 5% |
| **Component Tests — All pages** | 107 | 26% |
| **Shared Component Tests** | 13 | 3% |
| **Routing Tests** | 6 | 1% |
| **Integration Tests** | 31 | 7% |
| **E2E — Auth** | 7 | 2% |
| **E2E — Finance** | 7 | 2% |
| **E2E — HR** | 13 | 3% |
| **E2E — Manufacturing** | 5 | 1% |
| **E2E — Sales** | 6 | 1% |
| **E2E — Purchase** | 7 | 2% |
| **E2E — WMS** | 5 | 1% |
| **E2E — CRM** | 5 | 1% |
| **E2E — POS** | 6 | 1% |
| **Security Tests** | 10 | 2% |
| **Performance Tests** | 10 | 2% |
| **Accessibility Tests** | 8 | 2% |
| **Visual Regression Tests** | 10 | 2% |
| **TOTAL** | **~421** | **100%** |

---

## 22. Gap-to-Test Traceability Matrix

Every closed gap in gap_v1.md maps to at least one test:

| Gap (from gap_v1.md) | Priority | Test IDs |
|----------------------|----------|----------|
| Debit=Credit validation + GL posting | P0 | FIN-U01–U05, FIN-C01–C04, FIN-E02–E04 |
| Financial statements (BS, P&L, TB) | P0 | FIN-U06–U09, FIN-C05–C07, FIN-E05–E07 |
| 勞健保 + 所得稅 calculation | P0 | HR-U01–U11, HR-C10–C11, HR-E03–E07 |
| Line-item support | P1 | SLS-C01, SLS-E01, FIN-C10, PUR-C02 |
| Tax report generation (401/403) | P1 | FIN-U14–U18, FIN-C15 |
| FIFO/weighted avg costing | P1 | MFG-U11–U17, WMS-C01 |
| Real MRP calculation engine | P1 | MFG-U01–U10, MFG-C04–C05, MFG-E01–E05 |
| E-invoice Turnkey | P2 | SLS-U01–U08, FIN-C11, SLS-E04 |
| Three-way matching | P2 | PUR-U01–U06, PUR-C03, PUR-E05 |
| Payment gateway | P2 | POS-U01–U06, POS-C03, POS-E04 |
| Multi-currency | P2 | FIN-U19–U25 |
| Barcode scanning | P3 | WMS-C02 |
| Email/LINE/SMS sending | P3 | CRM-U17–U21, CRM-C04–C05 |
| Receipt printing | P3 | POS-C04, POS-E05 |
| Multi-level BOM | P3 | MFG-U01–U02, MFG-U09–U10, MFG-C01, MFG-E01 |
| AI drip campaigns (bonus) | Bonus | CRM-U11–U16, CRM-C08 |
| Cross-module dashboard | Analytics-P1 | ANA-C01–C04 |
| Date range picker | Analytics-P0 | ANA-C06 |
| CSV/PDF export | Analytics-P1 | ANA-C07–C08 |
| Real forecasting (weighted MA) | Analytics-P1 | ANA-C10 |
| No Math.random() | Analytics-P0 | ANA-C05, ANA-C09 |

---

## 23. Implementation Phases

### Phase 1 — Foundation + P0 Validation (Week 1–2)
- [ ] Install Vitest, RTL, MSW, Playwright
- [ ] Configure `vitest.config.js`, `playwright.config.js`
- [ ] Set up MSW handlers for Supabase mocking
- [ ] Write seed data fixtures
- [ ] **Unit tests**: `accounting.js` (FIN-U01–U13)
- [ ] **Unit tests**: `payroll.js` (HR-U01–U11)
- [ ] **Unit tests**: `laborLaw.js` (HR-U12–U21)
- [ ] **Unit tests**: `leavePolicy.js` (HR-U22–U34)
- [ ] **Unit tests**: `mrpEngine.js` (MFG-U01–U10)
- [ ] **Smoke test**: All 100+ pages render

### Phase 2 — P1–P2 Validation (Week 3–4)
- [ ] **Unit tests**: `inventoryCosting.js`, `threeWayMatch.js`, `einvoice.js`, `taxReport.js`, `currency.js`
- [ ] **Unit tests**: `payment.js`, `crmEngine.js`, `automation.js`, `approval.js`, `dataMasking.js`, `auditLogger.js`
- [ ] **Component tests**: Dashboard, JournalEntries, Salary, Leave, BOM, MRP
- [ ] **Component tests**: Invoices, GoodsReceipts, POSTerminal, Analytics

### Phase 3 — Integration + E2E Critical Paths (Week 5–6)
- [ ] **Integration tests**: All 8 workflow groups (INT-01 through INT-31)
- [ ] **E2E**: Auth (AUTH-E01–E07)
- [ ] **E2E**: Payroll Run (HR-E01–E08)
- [ ] **E2E**: Journal → Statements (FIN-E01–E07)
- [ ] **E2E**: Procure-to-Pay (PUR-E01–E07)

### Phase 4 — Full Coverage (Week 7–8)
- [ ] **E2E**: Quote-to-Cash (SLS-E01–E06)
- [ ] **E2E**: POS Transaction (POS-E01–E06)
- [ ] **E2E**: Leave Lifecycle (HR-E09–E13)
- [ ] **E2E**: MRP Planning (MFG-E01–E05)
- [ ] **E2E**: CRM Pipeline (CRM-E01–E05)
- [ ] **E2E**: Inventory (WMS-E01–E05)
- [ ] **Component tests**: All remaining pages

### Phase 5 — Non-Functional + CI (Week 9–10)
- [ ] **Security tests**: SEC-01 through SEC-10
- [ ] **Performance tests**: PERF-01 through PERF-10
- [ ] **Accessibility tests**: A11Y-01 through A11Y-08
- [ ] **Visual regression**: VR-01 through VR-10
- [ ] **CI pipeline**: GitHub Actions workflow
- [ ] **Coverage audit**: Verify 90% lib / 100% critical paths

---

## 24. Dependencies to Install

```bash
# Unit + Component testing
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom

# API mocking
npm install -D msw

# E2E testing
npm install -D @playwright/test

# Accessibility
npm install -D @axe-core/playwright

# Coverage
npm install -D @vitest/coverage-v8

# Performance
npm install -D @lhci/cli
```

---

## 25. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Supabase dependency | Tests fail without network | MSW mocks all HTTP calls |
| No existing tests | High initial effort | Phase 1 targets highest-value P0 |
| 100+ pages | Coverage gaps | Automated smoke renders every page |
| Taiwan calculation correctness | Wrong payroll/tax | Official 2026 rate tables as fixtures |
| Chart.js in JSDOM | Can't assert pixels | Mock Chart.js, test data inputs |
| jsPDF in JSDOM | No real PDF | Mock jsPDF, verify calls |
| Lazy loading | Suspense complicates tests | `waitFor` / `findBy` queries |
| Math.random() regression | Charts show fake data again | Snapshot tests on data-fetching hooks |

---

## 26. Remaining Gaps (Not Testable Yet)

These items from gap_v1.md's "Remaining Gaps" cannot be automated until external dependencies are met:

| Gap | Blocker | Test When Ready |
|-----|---------|----------------|
| 勞檢報表 certified format | Awaiting 勞動部 spec | Format validation test |
| 營業稅 certified submission | Awaiting 財政部 API credentials | API integration test |
| Real payment credentials | Awaiting ECPay/LINE Pay merchant accounts | End-to-end payment test |
| IoT / shop floor | Hardware-dependent | Device simulator test |
| Multi-tenant | Infrastructure change | Tenant isolation test |
| i18n | Scope decision pending | Language switching test |
