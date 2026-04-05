# SME-OPS Full Testing Plan

**Project**: SME-OPS (React 19 + Vite 6 + Supabase ERP)  
**Date**: 2026-04-05  
**Branch**: updatev1

---

## 1. Current State Summary

| Layer | Files | Test Cases | Status |
|-------|-------|-----------|--------|
| Unit Tests (lib/) | 21 | 443 | Automated |
| Integration Tests | 5 | 75 | Automated |
| Component Tests | 3 | 24 | Automated |
| E2E Tests (Playwright) | 4 | 22 | Automated |
| **Total Automated** | **33** | **564** | |
| Page Smoke Tests | 0 / 122 | 0 | **Not started** |
| Lib modules untested | 9 / 30 | 0 | **Not started** |

### Testing Infrastructure Already In Place
- **Vitest** — unit/component/integration (jsdom, v8 coverage)
- **Playwright** — E2E (html reporter, 2 retries on CI)
- **MSW** — API mocking with in-memory store
- **React Testing Library** — component rendering
- **npm scripts**: `test`, `test:watch`, `test:coverage`, `test:e2e`

---

## 2. Functions & Features Inventory

### 2A. Business Logic Engines (src/lib/) — 30 modules

#### AUTOMATED — 21 modules with unit tests

| # | Module | Exports | Tests | Key Functions Tested | Pass Criteria |
|---|--------|---------|-------|---------------------|---------------|
| 1 | `accounting.js` | 14 | 61 | Journal entry validation, GL posting, trial balance, balance sheet, P&L, depreciation | Debits = Credits; Assets = Liabilities + Equity; correct depreciation amounts |
| 2 | `payroll.js` | 8 | 32 | Labor insurance brackets, health insurance, pension 6%, income tax, net salary | Net = Gross - LI - HI - Pension - Tax; correct bracket matching for 29,500-45,800 range |
| 3 | `laborLaw.js` | 5 | 24 | Daily/weekly hour limits, OT rates (1.34x/1.67x), rest day/holiday pay, monthly OT cap | Rates match Taiwan Labor Standards Act SS24/30/32/39 |
| 4 | `leavePolicy.js` | 4 | 39 | Annual leave by tenure (3/7/10/14/15 days), sick/menstrual/family care/maternity/paternity | Entitlements match Taiwan labor law for all 16 leave types |
| 5 | `mrpEngine.js` | 7 | 29 | BOM explosion (single/multi-level), net requirements, lead time offset, purchase suggestions, circular ref detection | Net Req = Gross - Stock - InTransit; circular refs throw error |
| 6 | `inventoryCosting.js` | 10 | 16 | FIFO, LIFO, weighted avg, moving avg, cost layers, over-issue prevention | Cost layers consumed in correct order; negative stock flagged |
| 7 | `threeWayMatch.js` | 6 | 13 | PO/GR/INV matching, tolerance (1%/NT$10), variance calc | Perfect match = PASS; variance within tolerance = PASS; beyond = FAIL |
| 8 | `einvoice.js` | 8 | 22 | Tax ID validation, invoice format (AA-12345678), 5% VAT, MIG XML, Turnkey batch, carrier barcode | Valid Tax ID = 8 digits checksum; XML validates against MIG schema |
| 9 | `taxReport.js` | 5 | 22 | 401 bimonthly VAT report, 403 withholding report, ROC year format | Tax amounts = sum of invoice taxes; ROC year = AD - 1911 |
| 10 | `currency.js` | 9 | 21 | Multi-currency conversion (TWD/USD/CNY/EUR/JPY/SGD/HKD), FX gains/losses | Converted amount = original x rate; same-currency = pass-through |
| 11 | `payment.js` | 5 | 16 | ECPay/LINE Pay requests, callback signature verification, refunds | Signature = HMAC match; refund amount <= original |
| 12 | `crmEngine.js` | 10 | 51 | CLV, lead scoring, segmentation, SLA, auto-assignment, funnel rates, loyalty tiers | CLV = avg order x frequency x lifespan; tier upgrade at threshold |
| 13 | `messaging.js` | 8 | 13 | Email templating, LINE format, SMS payload, bulk batching, campaign logging | Variables substituted; batch size <= limit |
| 14 | `dripCampaign.js` | 6 | 23 | Step ordering, wait/action conditions, campaign projection | Steps execute in order; conditions evaluate correctly |
| 15 | `approval.js` | 3 | 11 | Supervisor lookup, approval chain, amount-based routing | Chain follows org hierarchy; amount > threshold escalates |
| 16 | `dataMasking.js` | 6 | 17 | Phone/email/ID/address masking, role-based bypass | Masked output hides middle chars; admin role = no masking |
| 17 | `auditLogger.js` | 4 | 19 | Field-level change log, inventory/customer changes, timestamps | Log entry contains who/what/when/old/new |
| 18 | `exportUtils.js` | 4 | 4 | CSV generation, PDF blob, column formatting | CSV has correct headers/rows; PDF blob is valid |
| 19 | `i18n.js` | 4 | 13 | Locale detection, translation lookup, date/number formatting | Correct locale returned; keys resolve to translations |
| 20 | `laborInspection.js` | 5 | 17 | Checklist evaluation, compliance checks | Non-compliant items flagged; score = pass count / total |
| 21 | `exportPdf.js` (via exportUtils) | — | — | PDF generation | Covered in exportUtils tests |

#### NOT AUTOMATED — 9 modules missing unit tests

| # | Module | Key Functions | Pass Criteria | Priority |
|---|--------|---------------|---------------|----------|
| 1 | `automation.js` | Low stock auto-PR, shipment->AR, GR->AP, profitability calc, leave settlement | Trigger fires when condition met; correct records created | P1 |
| 2 | `barcodeScanner.js` | USB listener, camera scanner init, SKU lookup, beep feedback | Barcode input resolves to correct SKU; error beep on unknown | P2 |
| 3 | `paymentGateway.js` | ECPay/LINE Pay/Apple Pay integration, payment request, callback | Request payload matches gateway spec; callback verified | P1 |
| 4 | `aiTemplateEngine.js` | AI-powered template rendering | Template variables replaced; output matches expected format | P2 |
| 5 | `wenzhong.js` | Data import from external system | Import maps fields correctly; invalid data rejected | P2 |
| 6 | `db.js` | Database CRUD helpers | Correct SQL generated; error handling works | P1 |
| 7 | `exportPdf.js` | PDF report generation | PDF blob generated; correct content structure | P2 |
| 8 | `receiptPrinter.js` | POS receipt formatting/printing | Receipt layout correct; printer command format valid | P2 |
| 9 | `supabase.js` | Supabase client initialization | Client connects; auth methods work | P3 (config only) |

---

### 2B. Integration Workflows — 5 automated, 5 needed

#### AUTOMATED — 5 cross-module workflows

| # | Workflow | Tests | Modules Involved | Pass Criteria |
|---|----------|-------|-----------------|---------------|
| 1 | Procure-to-Pay | 13 | PO -> GR -> 3-way match -> AP -> JE | AP amount matches invoice; JE balanced |
| 2 | Order-to-Cash | 15 | Quote -> SO -> Ship -> AR -> JE | AR created on shipment; revenue JE posted |
| 3 | HR Payroll -> GL | 14 | Salary calc -> deductions -> JE | Net salary correct; JE splits to expense/payable |
| 4 | POS -> Finance | 22 | Cart -> payment -> e-invoice -> JE | Payment captured; invoice XML valid; GL updated |
| 5 | Manufacturing | 11 | BOM -> MRP -> MO -> cost rollup | Purchase suggestions match net requirements |

#### NOT AUTOMATED — needs manual or new integration tests

| # | Workflow | Modules Involved | Pass Criteria | Priority |
|---|----------|-----------------|---------------|----------|
| 1 | Multi-currency FX | PO (USD) -> rate change -> invoice -> FX gain/loss JE | FX gain/loss = (invoice rate - PO rate) x amount | P1 |
| 2 | CRM -> Sales | Opportunity won -> auto-create SO | SO linked to customer; lines from opportunity | P1 |
| 3 | HR Leave -> Settlement | Leave approved -> balance updated -> employment end settlement | Settlement amount = unused days x daily rate | P1 |
| 4 | Campaign -> Messaging | Campaign send -> channel dispatch -> message log | All recipients get message; log records delivery status | P2 |
| 5 | Inventory Reorder -> Auto-PR | Stock < reorder point -> automation trigger -> PR created | PR quantity = reorder qty; correct supplier selected | P1 |

---

### 2C. Page Components — 122 pages across 12 modules

#### AUTOMATED — 3 shared component tests only

| Component | Tests | Pass Criteria |
|-----------|-------|---------------|
| `LoadingSpinner` | 4 | Renders spinner; correct size/color props |
| `Modal` | 14 | Opens/closes; renders children; backdrop click closes |
| `StatCard` | 6 | Displays title/value/icon; correct formatting |

#### NOT AUTOMATED — 122 page components need smoke + interaction tests

| Module | Pages | Critical Pages Needing Interaction Tests | Pass Criteria |
|--------|-------|----------------------------------------|---------------|
| **Finance** | 14 | JournalEntries, Invoices, AR, AP, TaxReport | Forms validate; CRUD works; PDF export triggers |
| **HR** | 16 | Salary, Attendance, Leave, Overtime, Schedule | Calculations display correctly; leave balance updates |
| **Manufacturing** | 5 | BOM, MRP, ManufacturingOrders | BOM tree renders; MRP results table populates |
| **Sales** | 6 | Quotations, SalesOrders, Shipments | Line items add/remove; quote->order conversion |
| **Purchase** | 10 | PurchaseOrders, GoodsReceipts, ThreeWayMatch | Multi-currency selector works; match status displays |
| **WMS** | 9 | Inventory, SKUs, StockCount, Valuation | Stock table filters; valuation method toggle works |
| **CRM** | 9 | Pipeline, Marketing, DripCampaigns | Kanban drag-drop; campaign builder step sequencing |
| **POS** | 3 | POSTerminal, POSShifts | Cart add/remove; payment flow; shift open/close |
| **Analytics** | 11 | SalesForecast, DashboardBuilder | Charts render with data; date range filters |
| **Org** | 8 | Employees, OrgChart | Employee CRUD form; org chart hierarchy renders |
| **System** | 9 | Users, AuditLog, Settings | User role assignment; audit log search/filter |
| **Process** | 5 | Workflows, Tasks | Workflow builder canvas; task assignment |
| **Integration** | 3 | Ecommerce, WenzhongImport | API connection test; data mapping UI |
| **AI** | 3 | AgentConsole | Chat interface sends/receives |
| **Portal** | 2 | PortalHome | Portal renders with correct role-based content |
| **Root** | 5 | Dashboard, Login | KPI cards load; login form validates |

---

### 2D. E2E User Journeys — 4 automated, 16+ needed

#### AUTOMATED — 4 Playwright spec files (22 test cases)

| File | Tests | Coverage |
|------|-------|----------|
| `auth.spec.js` | 7 | App loads, layout visible, sidebar navigation |
| `critical-pages.spec.js` | 1 | Main pages render without crash |
| `finance-flow.spec.js` | 7 | JE creation, posting, trial balance, balance sheet |
| `hr-payroll.spec.js` | 7 | Employee creation, salary calc, leave request |

#### NOT AUTOMATED — needs new E2E specs

| # | Scenario | Steps | Pass Criteria | Priority |
|---|----------|-------|---------------|----------|
| 1 | Sales: Quote to Order | Create quote -> add lines -> convert to SO | SO has same line items as quote | P0 |
| 2 | Sales: Order to Shipment | Create SO -> create shipment -> verify AR | AR record auto-created | P0 |
| 3 | Purchase: PO to GR | Create PO -> receive goods -> verify stock | Stock qty increased by GR qty | P0 |
| 4 | Purchase: Three-Way Match | PO + GR + invoice -> match -> verify | Match status = PASS when within tolerance | P0 |
| 5 | POS: Full Transaction | Add items -> process payment -> print receipt | Payment captured; receipt generated | P0 |
| 6 | POS: Shift Reconciliation | Open shift -> transactions -> close shift | Close balance = open + sales - refunds | P1 |
| 7 | Inventory: Stock Count | Start count -> enter qty -> verify variance | Variance = system qty - counted qty | P1 |
| 8 | Inventory: Valuation | Switch FIFO/weighted avg -> verify amounts | Valuation changes with method | P1 |
| 9 | CRM: Pipeline Management | Create opportunity -> move through stages | Stage history recorded; won = closed | P1 |
| 10 | CRM: Marketing Campaign | Create campaign -> select recipients -> send | Message log shows sent status | P1 |
| 11 | Manufacturing: BOM + MRP | Create BOM -> run MRP -> verify suggestions | Suggestions match net requirements | P1 |
| 12 | HR: Overtime Approval | Submit OT -> approve -> verify payroll impact | OT hours at correct rate in salary | P1 |
| 13 | HR: Attendance Tracking | Clock in -> clock out -> verify hours | Attendance record = clock out - clock in | P2 |
| 14 | Finance: Multi-currency | Create USD PO -> receive -> verify FX | FX gain/loss JE posted | P2 |
| 15 | Analytics: Dashboard Builder | Create custom dashboard -> add widgets | Dashboard persists on refresh | P2 |
| 16 | System: Audit Trail | Perform actions -> verify audit log entries | All CRUD actions logged with user/timestamp | P2 |

---

## 3. Passing Criteria by Category

### Unit Tests
- **All assertions pass** (zero failures)
- **Line coverage >= 90%** for lib/ modules
- **Branch coverage >= 85%** for P0 engines (accounting, payroll, laborLaw, leavePolicy, mrpEngine)
- **Edge cases covered**: boundary values, empty inputs, invalid data, overflow

### Component Tests
- **Smoke**: Every page renders without crash (no uncaught exceptions)
- **Data loading**: Loading state shown -> data renders after mock API response
- **Forms**: Required field validation fires; submit sends correct payload
- **Navigation**: Breadcrumbs correct; links navigate to expected routes
- **Error states**: API failure shows error message, not blank screen

### Integration Tests
- **Workflow completes end-to-end** through all involved modules
- **Data consistency**: Records created in module A are correctly read by module B
- **GL always balanced**: Every JE created by any workflow has debits = credits
- **Idempotency**: Re-running same operation doesn't create duplicates

### E2E Tests
- **User can complete the full journey** without errors
- **Visual correctness**: Key elements visible (tables populated, forms rendered)
- **Navigation works**: Sidebar links reach correct pages
- **Data persists**: Created records appear in list views after navigation

---

## 4. Automated vs. Manual Verification Matrix

### Fully Automated (run via `npm test` / `npm run test:e2e`)

| Area | What's Automated | Tool |
|------|-----------------|------|
| 21 lib engine calculations | All core business logic | Vitest |
| 5 cross-module workflows | Procure-to-pay, order-to-cash, payroll, POS, manufacturing | Vitest + MSW |
| 3 shared components | LoadingSpinner, Modal, StatCard | Vitest + RTL |
| 4 E2E critical paths | Auth, page loads, finance flow, HR payroll | Playwright |

### Needs Automation (test files to be written)

| Area | What's Missing | Estimated Effort | Files to Create |
|------|---------------|-----------------|-----------------|
| 9 lib modules | automation, barcodeScanner, paymentGateway, aiTemplateEngine, wenzhong, db, exportPdf, receiptPrinter, supabase | 3-4 days | 9 test files |
| 122 page smoke tests | Every page renders without crash | 5-7 days | 60+ test files |
| 30+ page interaction tests | Forms, CRUD, filters on critical pages | 5-7 days | Included above |
| 5 integration workflows | FX, CRM->Sales, leave settlement, campaign, auto-reorder | 3-4 days | 5 test files |
| 16 E2E scenarios | Sales, purchase, POS, inventory, CRM, manufacturing, analytics | 5-7 days | 12+ spec files |

### Requires Manual Verification (cannot be fully automated)

| Area | What Needs Manual Check | Why Manual | Verification Method |
|------|------------------------|-----------|-------------------|
| **PDF output quality** | Layout, fonts, alignment, Chinese characters in exported PDFs | Visual layout validation | Open generated PDF, verify formatting |
| **E-invoice XML submission** | Actual Turnkey/MIG gateway acceptance | Requires govt test environment | Submit to MOEA test platform, check response |
| **Payment gateway live flow** | ECPay/LINE Pay actual charge/refund | Requires sandbox credentials + UI | Use gateway sandbox, verify transaction in dashboard |
| **Barcode scanner hardware** | USB scanner input, camera activation | Physical hardware dependency | Connect scanner, scan known barcode, verify SKU |
| **Receipt printer output** | Thermal printer formatting, paper alignment | Physical hardware dependency | Print test receipt, verify layout |
| **LINE messaging delivery** | Actual LINE message received by user | External service dependency | Send test message, verify in LINE app |
| **Email delivery** | Email received in inbox (not spam) | External SMTP dependency | Send test email, verify receipt and formatting |
| **SMS delivery** | SMS received on phone | External service dependency | Send test SMS, verify receipt |
| **Mobile responsiveness** | UI layout on various screen sizes | Visual + interaction quality | Test on real devices (iPhone, Android, tablet) |
| **Browser compatibility** | Behavior across Chrome/Firefox/Safari/Edge | Browser-specific rendering | Open app in each browser, test critical flows |
| **Performance under load** | Response times with 100+ concurrent users | Requires load test infrastructure | Use k6/Artillery against staging |
| **Data migration (wenzhong)** | Import correctness from legacy system | Legacy data edge cases | Import sample dataset, compare field-by-field |
| **Org chart visual layout** | Hierarchy rendering, node overlap | Visual/spatial validation | View org chart with 50+ employees, check layout |
| **Dashboard builder drag-drop** | Widget placement, resize, persistence | Complex mouse interaction | Manually drag widgets, resize, refresh page |
| **Multi-tenant isolation** | Tenant A cannot see Tenant B data | Security boundary testing | Login as Tenant A, attempt to access Tenant B URLs |

---

## 5. Test Execution Commands

```bash
# Run all unit + component + integration tests
npm run test

# Run with coverage report
npm run test:coverage

# Run in watch mode (during development)
npm run test:watch

# Run E2E tests
npm run test:e2e

# Run specific test file
npx vitest run src/lib/__tests__/accounting.test.js

# Run specific E2E spec
npx playwright test e2e/finance-flow.spec.js
```

---

## 6. Implementation Priority

### Phase 1 — Fill Unit Test Gaps (P0)
Write tests for 9 untested lib modules. Estimated: 9 files, ~80 test cases.

### Phase 2 — Page Smoke Tests (P0)
Write render tests for all 122 pages. Estimated: 60+ files, ~150 test cases.

### Phase 3 — Missing Integration Workflows (P1)
Write 5 new integration test suites. Estimated: 5 files, ~40 test cases.

### Phase 4 — E2E Expansion (P1)
Write 16 new E2E scenarios. Estimated: 12+ spec files, ~50 test cases.

### Phase 5 — CI/CD & Coverage Gates (P2)
- GitHub Actions workflow for automated test runs on PR
- Coverage thresholds enforced (80% min)
- Playwright HTML reports published

### Phase 6 — Manual Test Execution (P2)
- Execute all items in the manual verification matrix
- Document results in a test report
- Create regression checklist for future releases

---

## 7. Target State After Full Implementation

| Metric | Current | Target |
|--------|---------|--------|
| Unit test files | 21 | 30 |
| Unit test cases | 443 | ~520 |
| Integration test files | 5 | 10 |
| Integration test cases | 75 | ~115 |
| Component test files | 3 | 65+ |
| Component test cases | 24 | ~175 |
| E2E spec files | 4 | 16+ |
| E2E test cases | 22 | ~70 |
| **Total automated tests** | **564** | **~880** |
| Lib module coverage | 21/30 (70%) | 30/30 (100%) |
| Page smoke coverage | 0/122 (0%) | 122/122 (100%) |
| Line coverage (lib/) | ~75% est. | 90%+ |
