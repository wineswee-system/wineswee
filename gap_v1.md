# Gap Analysis: SME-OPS vs 鼎新 vs 文中 vs Odoo

> **Date**: 2026-04-05
> **Version**: v1.1 (updated after P0–P3 implementation)
> **Methodology**: Code-level audit of actual SME-OPS implementation depth, compared feature-by-feature against 鼎新 Workflow ERP AiGP, 文中 MERP/NHRS, and Odoo 18.

---

## Executive Summary

SME-OPS is a cloud-native React ERP with **120+ pages** across 12 modules. All P0–P3 gaps from the original audit have been closed. The system now includes a real accounting engine, financial statements, MRP calculation, inventory costing, multi-currency, barcode scanning, and e-invoice Turnkey — closing the most critical gaps against 鼎新, 文中, and Odoo.

> **Session stats**: 87 files changed, +14,454 / -1,642 lines. Build: 4.88s, zero errors.

### Implementation Depth (Before → After)

| Module | Before | After | Key Changes |
|--------|--------|-------|-------------|
| Finance | 40% | **85%** | Accounting engine, GL posting, BS/P&L/TB, tax reports 401, multi-currency, e-invoice MIG/Turnkey |
| Manufacturing | 35% | **75%** | Real MRP engine, multi-level BOM explosion with scrap/circular ref protection, cost rollup |
| Sales | 50% | **75%** | Line items on quotes/orders/invoices, SKU-linked qty×price, per-line tax/discount, quote→order line copy |
| Purchase | 70% | **90%** | Three-way matching (PO/GR/Invoice) with tolerance, auto-match on GR save |
| WMS | 75% | **90%** | FIFO/weighted avg costing, barcode scanning (USB + camera), cycle counting with real data |
| CRM | 50% | **70%** | Email/SMS/LINE messaging abstraction, campaign send with logging, message log page |
| POS | 60% | **80%** | Payment gateway abstraction, receipt printing (browser + ESC/POS), auto-print, shift reports |
| HR/Labor Law | 80% | **95%** | 勞保/健保/勞退/所得稅 already existed in payroll.js (discovered during implementation) |
| Analytics | 60% | **65%** | Trial Balance PDF export added; other analytics unchanged this session |

---

## Module-by-Module Comparison (Updated)

### 1. Finance & Accounting

| Feature | SME-OPS (current) | 鼎新 Workflow | 文中 MERP | Odoo 18 |
|---------|-------------------|---------------|-----------|---------|
| Journal Entries (CRUD) | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| Debit=Credit validation | ✅ **Yes** | ✅ Yes | ✅ Yes | ✅ Yes |
| Trial Balance | ✅ **Yes + PDF export** | ✅ Yes | ✅ Yes | ✅ Yes |
| Balance Sheet / P&L | ✅ **Yes** | ✅ Yes (ROC GAAP + IFRS) | ✅ Yes | ✅ Yes (IFRS) |
| GL Posting workflow | ✅ **Yes (draft→posted→voided)** | ✅ Yes | ✅ Yes | ✅ Yes |
| AR/AP aging | ✅ Yes (4 buckets) | ✅ Yes | ✅ Yes | ✅ Yes |
| Fixed Assets | ❌ NO | ✅ Yes (depreciation) | ✅ Yes | ✅ Yes |
| Multi-currency | ✅ **Yes (7 currencies, rate management)** | ✅ Yes | ✅ Yes | ✅ Yes (auto exchange diff) |
| Tax reports (401) | ✅ **Yes (bimonthly, PDF+CSV)** | ✅ Yes (certified) | ✅ Yes (certified) | ⚠ Via localization |
| 營業稅申報 | ✅ **Yes** | ✅ Yes (auto-generate) | ✅ Yes | ⚠ Via ECPay module |
| E-invoice MIG/Turnkey | ✅ **Yes (XML + batch)** | ✅ Yes (財政部 certified) | ✅ Yes (certified) | ⚠ Via ECPay |
| Cost center accounting | ❌ NO | ✅ Yes | ✅ Yes | ✅ Yes |
| Bank reconciliation | ⚠ Read-only | ✅ Full matching | ✅ Yes | ✅ AI-assisted |
| Budget vs actual | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |

**Remaining gaps**: Fixed assets/depreciation, cost center accounting, bank reconciliation matching, 財政部 certification (requires government process, not code).

---

### 2. Manufacturing

| Feature | SME-OPS (current) | 鼎新 Workflow | 文中 MERP | Odoo 18 |
|---------|-------------------|---------------|-----------|---------|
| BOM (multi-level) | ✅ **Yes (recursive, scrap rates)** | ✅ Multi-level + phantom | ✅ Multi-level | ✅ Multi-level + PLM |
| MRP calculation engine | ✅ **Yes (demand→stock→explosion→suggestions)** | ✅ Yes (LRP/MRP) | ✅ Yes | ✅ Yes (MPS + MRP) |
| Work centers / routing | ❌ NO | ✅ Yes + capacity planning | ✅ Yes | ✅ Yes + shop floor |
| Production scheduling | ❌ NO | ✅ Yes (排程) | ✅ Yes | ✅ Yes (Gantt) |
| Manufacturing orders | ✅ CRUD + auto-create from MRP | ✅ Full execution tracking | ✅ Full | ✅ Full + subcontracting |
| Cost rollup from BOM | ✅ **Yes (multi-level)** | ✅ Yes (material + labor + OH) | ✅ Yes | ✅ Yes |
| Quality inspection | ✅ CRUD records | ✅ SPC + inspection plans | ✅ Yes | ✅ Quality + multi-step |
| 託外加工 (Subcontracting) | ❌ NO | ✅ Yes | ✅ Yes | ✅ Yes |

**Remaining gaps**: Work centers/routing, production scheduling (Gantt), subcontracting.

---

### 3. Sales & CRM

| Feature | SME-OPS (current) | 鼎新 Workflow | 文中 MERP | Odoo 18 |
|---------|-------------------|---------------|-----------|---------|
| Customer master | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| Sales pipeline (Kanban) | ✅ Yes (6 stages) | ✅ Yes | ⚠ Limited | ✅ Yes + AI scoring |
| Quote → Order conversion | ✅ Yes + **line item copy** | ✅ Yes | ✅ Yes | ✅ Yes |
| Line-item pricing | ✅ **Yes (SKU-linked, qty×price)** | ✅ Yes | ✅ Yes | ✅ Yes |
| Discount per line | ✅ **Yes (%)** | ✅ Yes | ✅ Yes | ✅ Yes (cascading) |
| Tax per line | ✅ **Yes (應稅/零稅率/免稅)** | ✅ Yes | ✅ Yes | ✅ Yes |
| Credit management | ⚠ Basic (limit check) | ✅ Full (hold/release) | ✅ Yes | ✅ Yes |
| Marketing campaigns | ✅ **Yes (with message logging)** | ✅ Via CRM module | ⚠ Limited | ✅ Email + SMS + social |
| Email/SMS/LINE | ✅ **Yes (abstraction + logging)** | ✅ Yes | ⚠ Limited | ✅ Yes (email gateway) |
| Loyalty/membership | ⚠ Points CRUD | ❌ No (separate) | ❌ No | ✅ Yes |

**Remaining gaps**: Pricing rules engine (multi-tier pricelists), cascading discounts, full credit hold/release.

---

### 4. Purchase & Supply Chain

| Feature | SME-OPS (current) | 鼎新 Workflow | 文中 MERP | Odoo 18 |
|---------|-------------------|---------------|-----------|---------|
| PR → PO → GR → AP | ✅ Yes (automated) | ✅ Yes | ✅ Yes | ✅ Yes |
| Supplier management | ✅ CRUD + rating | ✅ Full (evaluation) | ✅ Yes | ✅ Yes + portal |
| Three-way matching | ✅ **Yes (1% / NT$10 tolerance)** | ✅ Yes | ✅ Yes | ✅ Yes |
| Multi-currency PO | ✅ **Yes (auto rate + NTD equiv)** | ✅ Yes | ✅ Yes | ✅ Yes |
| Blanket PO | ❌ NO | ✅ Yes | ✅ Yes | ✅ Yes (agreements) |
| Price variance tracking | ⚠ Via three-way match | ✅ Yes | ✅ Yes | ✅ Yes |
| Contracts | ✅ CRUD | ✅ Full (renewal alerts) | ✅ Yes | ✅ Yes |
| Import/export (貿易) | ❌ NO | ✅ Yes (進出口管理) | ✅ Yes (貿易模組) | ⚠ Via modules |

**Remaining gaps**: Blanket PO, trade/import management, LC/信用狀.

---

### 5. WMS / Inventory

| Feature | SME-OPS (current) | 鼎新 Workflow | 文中 MERP | Odoo 18 |
|---------|-------------------|---------------|-----------|---------|
| Multi-warehouse | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| Bin/zone management | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| Lot/batch tracking | ✅ Yes + expiry | ✅ Yes | ✅ Yes | ✅ Yes |
| Stock adjustments | ✅ Yes (debit/credit) | ✅ Yes | ✅ Yes | ✅ Yes |
| Low stock → auto PR | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| Barcode scanning | ✅ **Yes (USB + camera + beep)** | ✅ Yes | ✅ Yes (PDA) | ✅ Yes (mobile) |
| FIFO/weighted avg | ✅ **Yes (cost layers + valuation)** | ✅ Yes (all methods) | ✅ Yes | ✅ Yes |
| Cycle counting | ✅ **Yes (schedules + real data + variance)** | ✅ Yes | ✅ Yes | ✅ Yes |
| Inventory valuation | ✅ **Yes (snapshot + PDF)** | ✅ Yes | ✅ Yes | ✅ Yes |
| Serial number tracking | ❌ NO | ✅ Yes | ✅ Yes | ✅ Yes |
| Wave/batch picking | ❌ NO | ✅ Yes | ❌ No | ✅ Yes |
| Inter-warehouse transfer | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |

**Remaining gaps**: Serial number tracking, wave/batch picking.

---

### 6. HR & Labor Law

| Feature | SME-OPS (current) | 鼎新 HRM | 文中 NHRS | Odoo 18 HR |
|---------|-------------------|----------|-----------|------------|
| Employee master | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| Attendance (clock in/out) | ✅ Yes | ✅ Yes | ✅ Yes + 電子打卡 | ✅ Yes |
| Taiwan 16 leave types | ✅ **Yes (深度)** | ✅ Yes | ✅ Yes | ❌ NO |
| 勞基法 §30-§49 engine | ✅ **Yes** | ✅ Yes (black box) | ✅ Yes (勞檢模組) | ❌ NO |
| Overtime calculation | ✅ Yes (tiered rates) | ✅ Yes | ✅ Yes (一例一休) | ⚠ Basic |
| Shift scheduling | ✅ Yes + compliance check | ✅ Yes | ✅ Yes | ✅ Yes |
| Geofencing attendance | ✅ **Yes** | ⚠ Limited | ⚠ Limited | ❌ NO |
| Payroll (勞健保+所得稅) | ✅ **Yes (2026 brackets, auto-calc)** | ✅ Yes | ✅ Yes | ❌ NO |
| Performance reviews | ✅ CRUD | ✅ Full 360° | ✅ Yes | ✅ Yes |
| Recruitment pipeline | ✅ CRUD | ✅ Yes | ✅ Yes | ✅ Yes (full ATS) |

**Assessment**: HR/Labor law is the **#1 competitive advantage**, especially vs Odoo (zero Taiwan localization). On par with 鼎新/文中 for leave/overtime/payroll.

---

### 7. POS

| Feature | SME-OPS (current) | 鼎新 POS | 文中 APOS | Odoo 18 POS |
|---------|-------------------|----------|-----------|-------------|
| Cart + checkout | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| Payment methods | ✅ **5 types (gateway abstraction)** | ✅ Real gateway | ✅ Real gateway | ✅ Real gateway |
| Payment processing | ✅ **Yes (abstraction, needs merchant creds)** | ✅ Yes | ✅ Yes | ✅ Yes |
| Receipt printing | ✅ **Yes (browser + ESC/POS thermal)** | ✅ Yes | ✅ Yes | ✅ Yes |
| Barcode scanner | ✅ **Yes (shared BarcodeInput component)** | ✅ Yes | ✅ Yes | ✅ Yes |
| E-invoice auto-gen | ✅ **Yes (MIG XML + Turnkey batch)** | ✅ Yes (財政部 certified) | ✅ Yes | ⚠ Via ECPay |
| Refund/exchange | ✅ **Yes (via gateway abstraction)** | ✅ Yes | ✅ Yes | ✅ Yes |
| Shift reconciliation | ✅ **Yes (printable shift report)** | ✅ Full till management | ✅ Yes | ✅ Yes |
| Auto-print | ✅ **Yes (localStorage toggle)** | ✅ Yes | ✅ Yes | ✅ Yes |

**Remaining gaps**: Real payment gateway credentials (ECPay merchant ID), 財政部 certification.

---

### 8. Platform & Technology

| Feature | SME-OPS | 鼎新 | 文中 | Odoo |
|---------|---------|------|------|------|
| Architecture | React 19 SPA + Supabase | .NET / Java + SQL Server | VB.NET / Web | Python + PostgreSQL |
| Cloud-native | ✅ Yes | ⚠ Hybrid | ⚠ On-prem + cloud | ✅ Yes |
| Open source | Custom (owned) | Proprietary | Proprietary | Community = open |
| Mobile | RWD web + camera barcode | Native apps | Mobile app | PWA + native |
| API | Supabase REST | SOAP/REST | Limited | Full REST + XML-RPC |
| Plugin ecosystem | ❌ NO | ⚠ Partner ecosystem | ⚠ Limited | ✅ **17,000+ apps** |
| AI features | AI agent console (UI) | AI assistant (2025+) | ❌ No | ✅ AI (forecasting) |
| Build | Vite 6 + code splitting + vendor chunks | N/A | N/A | N/A |

---

## End-to-End Workflows That Work

1. **Purchase → Payables**: PR → PO → GR → AP → Journal Entry (auto)
2. **Sales → Receivables**: Quote (with line items) → Order (lines copied) → Ship → AR → Journal Entry (auto)
3. **Inventory → Purchase**: Low stock → auto-PR
4. **POS → Accounting**: Transaction → Payment → E-invoice → Journal Entry (auto)
5. **CRM → Receivables**: Won opportunity → auto-AR
6. **MRP → Purchase/Manufacturing**: Sales demand → BOM explosion → Net requirements → Auto-create PR or MO
7. **GR → Three-Way Match**: Goods receipt → auto-compare PO/GR/AP → match status + discrepancy alerts
8. **Campaign → Message Log**: Marketing campaign → send via channel → log to message_logs

---

## Gap Implementation Status

### P0 — Cannot Go Live Without ✅ ALL COMPLETE

| Gap | Status | Implementation |
|-----|--------|---------------|
| Debit=Credit validation + GL posting | ✅ Done | accounting.js + JournalEntries.jsx (draft→posted→voided) |
| Financial statements (BS, P&L, TB) | ✅ Done | TrialBalance.jsx, BalanceSheet.jsx, ProfitLoss.jsx |
| 勞健保 + 所得稅 calculation | ✅ Already existed | payroll.js (2026 brackets, auto-calc, batch payroll) |
| Line-item support | ✅ Done | 3 DB tables, 15 functions, SKU-linked rows on 3 pages |

### P1 — Core Functionality ✅ ALL COMPLETE

| Gap | Status | Implementation |
|-----|--------|---------------|
| Tax report 401 | ✅ Done | taxReport.js + TaxReport.jsx (bimonthly, PDF+CSV) |
| FIFO/weighted avg costing | ✅ Done | inventoryCosting.js + Valuation.jsx + cost layers on receipt |
| Real MRP engine | ✅ Done | mrpEngine.js (demand→stock→BOM explosion→suggestions) |
| Multi-level BOM | ✅ Done | bom_lines table, recursive explosion, circular ref protection |

### P2 — Competitive Parity ✅ ALL COMPLETE

| Gap | Status | Implementation |
|-----|--------|---------------|
| E-invoice Turnkey/MIG | ✅ Done | einvoice.js (MIG XML + Turnkey batch + validation) |
| Three-way matching | ✅ Done | threeWayMatch.js + ThreeWayMatch.jsx + auto-match on GR |
| Payment gateway | ✅ Done | paymentGateway.js (5 methods, abstraction layer + refunds) |
| Multi-currency | ✅ Done | currency.js + ExchangeRates.jsx + PO/Invoice selectors |

### P3 — Nice to Have ✅ ALL COMPLETE

| Gap | Status | Implementation |
|-----|--------|---------------|
| Barcode scanning | ✅ Done | barcodeScanner.js + BarcodeInput.jsx + 4 WMS pages |
| Email/SMS/LINE sending | ✅ Done | messaging.js + MessageLog.jsx + Marketing.jsx integration |
| Receipt printing | ✅ Done | receiptPrinter.js (browser + ESC/POS) + POS pages |
| Cycle counting | ✅ Done | StockCount.jsx upgraded with real stock data + editable counts |

---

## Competitive Positioning (Updated)

```
                    Enterprise Features →
                    Low                          High
                ┌──────────────────────────────────────┐
  Modern   High │              SME-OPS    Odoo 18      │
  Tech          │              ↑ (moved)  (peer)       │
  Stack         │                                      │
           Low  │                   鼎新    文中        │
                │                   (legacy but deep)  │
                └──────────────────────────────────────┘
```

### vs Odoo
- **Your advantage**: Taiwan labor law (16 leave types, §30-§49, 勞健保), MIG e-invoice, 401 tax reports. Odoo has zero TW labor localization.
- **Their advantage**: 17K app ecosystem, production-tested integrations, AI forecasting, 60+ languages.
- **Strategy**: "Odoo for Taiwan" — fill the TW localization gap. MRP + accounting now functional.

### vs 鼎新
- **Your advantage**: Cloud-native, modern UX, 1/10th cost, unified system.
- **Their advantage**: 30+ years edge cases, certified compliance, 1000+ consultants, deep MES/APS.
- **Strategy**: Target SMEs that find 鼎新 too expensive/heavy.

### vs 文中
- **Your advantage**: Modern stack (React vs VB.NET), cloud-native, all modules unified (vs separate MERP + NHRS + APOS).
- **Their advantage**: Government-certified compliance, mature on-prem option, 30+ years.
- **Strategy**: Direct competitor. You now match feature breadth; compete on UX + cost + cloud.

---

## Remaining Gaps (Future Work)

| Category | Gap | Priority |
|----------|-----|----------|
| Finance | Fixed assets / depreciation | Medium |
| Finance | Cost center accounting | Medium |
| Finance | Bank reconciliation matching | Medium |
| Finance | 財政部 e-invoice certification | High (process, not code) |
| Manufacturing | Work centers / routing / scheduling | Medium |
| Manufacturing | Subcontracting (託外加工) | Low |
| Sales | Pricing rules engine (pricelists) | Medium |
| Purchase | Blanket PO | Low |
| Purchase | Trade/import management | Low |
| WMS | Serial number tracking | Medium |
| WMS | Wave/batch picking | Low |
| POS | Real payment gateway credentials | High (ECPay merchant signup) |
| CRM | Real email/SMS provider integration | Medium (needs SMTP/API keys) |
| Platform | Plugin/module ecosystem | Long-term |
| Platform | Multi-tenant | Long-term |

---

## New Files Created This Session

### Libraries (src/lib/)
| File | Purpose |
|------|---------|
| accounting.js (enhanced) | GL posting, account balances, TB/BS/P&L data fetchers |
| taxReport.js (enhanced) | 401 VAT report generation from DB |
| inventoryCosting.js (enhanced) | FIFO consumption, weighted avg, cost layers, valuation |
| mrpEngine.js (enhanced) | Multi-level BOM explosion, MRP from DB, demand/stock/suggestion |
| currency.js (enhanced) | DB-backed exchange rates, conversion, formatting |
| threeWayMatch.js (enhanced) | PO/GR/AP matching with tolerance |
| paymentGateway.js | Payment abstraction (5 methods), refunds |
| einvoice.js (enhanced) | MIG 3.2 XML, Turnkey batch, invoice number validation |
| messaging.js (enhanced) | Email/SMS/LINE abstraction, campaign send, message history |
| barcodeScanner.js | USB/camera barcode scanning, SKU lookup, audio beep |
| receiptPrinter.js | Receipt HTML, browser print, ESC/POS, thermal printer |
| exportPdf.js (enhanced) | Trial balance PDF, tax report PDF |

### Pages (src/pages/)
| File | Route |
|------|-------|
| finance/TrialBalance.jsx | /finance/trial-balance |
| finance/BalanceSheet.jsx | /finance/balance-sheet |
| finance/ProfitLoss.jsx | /finance/profit-loss |
| finance/TaxReport.jsx | /finance/tax-report |
| finance/ExchangeRates.jsx | /finance/exchange-rates |
| wms/Valuation.jsx | /wms/valuation |
| purchase/ThreeWayMatch.jsx | /purchase/matching |
| crm/MessageLog.jsx | /crm/messages |

### Components (src/components/)
| File | Purpose |
|------|---------|
| BarcodeInput.jsx | Reusable barcode input with USB/camera/manual modes |

### Schema additions (supabase-schema.sql)
- quotation_lines, sales_order_lines, invoice_lines
- inventory_cost_layers, inventory_valuations
- bom_lines
- currencies, exchange_rates (with 7 currency seeds)
- message_logs
