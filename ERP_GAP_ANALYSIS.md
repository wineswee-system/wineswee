# SME-OPS ERP Gap Analysis vs Industry Standard ERP Flows

**Date**: 2026-04-05  
**Compared Against**: SAP Business One, Oracle NetSuite, Odoo 17, ERPNext

---

## 1. Finance Module — Gap Analysis

### What's Implemented
| Feature | Status | Notes |
|---------|--------|-------|
| Chart of Accounts (Taiwan 7-class) | Done | 1xxx-7xxx compliant |
| Journal Entry (draft -> posted) | Done | Debit/credit balance enforced |
| Trial Balance | Done | Type-aware balance calculation |
| Balance Sheet | Done | Current/Fixed asset categories |
| Income Statement (P&L) | Done | Revenue -> COGS -> OpEx -> Net Income |
| Depreciation (SL, DB, SYD) | Done | Monthly calculation |
| Multi-currency (7 currencies) | Done | TWD/USD/CNY/EUR/JPY/SGD/HKD |
| FX Gains/Losses | Done | Unrealized calculation |
| 5% VAT calculation | Done | Taxable, zero-rated, exempt |
| 401 VAT bimonthly report | Done | Pipe-delimited media format |
| 403 Withholding report | Done | 9 income type categories |
| E-invoice (Turnkey/MIG XML) | Done | Tax ID validation, carrier barcodes |

### What's Missing (Standard in SAP/NetSuite/Odoo)

| Gap | Standard ERP Behavior | Impact | Priority |
|-----|----------------------|--------|----------|
| **Cost Centers** | Every transaction tagged to cost center/profit center for departmental P&L | Cannot report profitability by department | P1 |
| **Budget vs Actual variance** | Budget allocated by account+period; system shows variance (favorable/unfavorable) | Budget page exists but no variance calculation or alerts | P1 |
| **Multi-entity consolidation** | Group companies roll up into consolidated financial statements with intercompany eliminations | Single company only | P2 |
| **Bank Reconciliation automation** | Import bank statement (CSV/OFX/MT940), auto-match to open AR/AP | Page exists but no import/matching engine | P1 |
| **Recurring journal entries** | Templates for monthly entries (rent, depreciation, amortization) auto-posted on schedule | Manual creation only | P2 |
| **Journal entry reversal** | One-click reversal creates mirror JE with reference to original | Not implemented | P2 |
| **Fiscal year close** | Period close locks transactions; opening balances carried forward | No period locking mechanism | P1 |
| **Revenue recognition (IFRS 15)** | Multi-step recognition for contracts, subscriptions, milestones | Simple accrual only | P3 |
| **Aged AR/AP reports** | Buckets: Current, 30, 60, 90, 120+ days with drill-down | Pages exist but bucket calculation not in lib | P1 |
| **Payment allocation** | Partial payments allocated to specific invoices | Not implemented | P1 |
| **Credit notes / Debit memos** | Issue adjustments linked to original invoice | Not implemented | P1 |
| **Withholding tax on payments** | Auto-deduct withholding on vendor payments | Not automated | P2 |

### Testing Implication
- **Test existing**: Budget page should at minimum display budget data; verify no broken UI
- **Test gap**: Bank reconciliation page — verify it renders but note matching logic is missing
- **Add test**: Aged AR/AP bucket calculation if/when implemented

---

## 2. HR & Payroll Module — Gap Analysis

### What's Implemented
| Feature | Status | Notes |
|---------|--------|-------|
| Labor Insurance (12%, bracket 29,500-45,800) | Done | Employee 20% / Employer 70% split |
| Health Insurance (5.17%, up to 3 dependents) | Done | 2026 rates |
| Pension 6% employer + voluntary employee | Done | Ceiling NT$150,000 |
| Income Tax withholding (progressive) | Done | 5 brackets, exemptions, deductions |
| 16 leave types (Taiwan law) | Done | Including 2026 mental health leave |
| Labor law compliance (hours, OT rates) | Done | SS24/30/32/34/35/36/39 |
| Schedule validation | Done | Min rest, max consecutive, shift interval |
| Labor inspection 15-item checklist | Done | Compliance scoring |
| Overtime rate calculation | Done | 1.34x / 1.67x / 2.67x |

### What's Missing (Standard in SAP SuccessFactors / Oracle HCM)

| Gap | Standard ERP Behavior | Impact | Priority |
|-----|----------------------|--------|----------|
| **Employee onboarding workflow** | Checklist: contract signed, ID collected, bank account, IT setup, training scheduled | No structured onboarding | P1 |
| **Employee offboarding** | Separation checklist: final pay calc, leave settlement, asset return, access revocation | Leave settlement calculated but no structured workflow | P1 |
| **Salary revision history** | Track salary changes over time with effective dates and approval | No revision tracking | P1 |
| **Payslip generation** | Monthly payslip PDF with all deductions, employer contributions, YTD totals | Net salary calculated but no payslip document | P1 |
| **Benefits management** | Track employee benefits (meal allowance, transportation, insurance add-ons) | Not tracked beyond statutory deductions | P2 |
| **Training / LMS** | Course catalog, enrollment, completion tracking, certification expiry | Not implemented | P3 |
| **Performance review workflow** | Goal setting -> self-assessment -> manager review -> calibration -> final rating | Page exists but no structured workflow engine | P2 |
| **Recruitment pipeline** | Job posting -> applications -> screening -> interview -> offer -> hire | Page exists but workflow depth unknown | P2 |
| **Leave accrual forecast** | Show projected available balance at future date | Entitlement calculated but no projection | P2 |
| **Leave carryover policy** | Unused annual leave rolls over or paid out per policy | Not implemented | P1 |
| **Attendance integration** | API to clock-in hardware (fingerprint, face, card) | Manual entry only | P2 |
| **Expense reimbursement** | Submit receipt -> approve -> reimburse via payroll | Page exists but payroll integration unclear | P2 |

### Testing Implication
- **Critical test**: Payroll calculation accuracy is the #1 risk — must test all bracket boundaries
- **Missing test**: Offboarding leave settlement flow (automation.js has it but no E2E)
- **Add test**: Salary revision history when implemented

---

## 3. Purchase Module — Gap Analysis

### What's Implemented
| Feature | Status | Notes |
|---------|--------|-------|
| Three-way match (PO/GR/Invoice) | Done | 1% / NT$10 tolerance |
| Variance calculation | Done | Qty and price variances |
| Match status (matched/partial/mismatch) | Done | Item-level checking |
| Auto-PR from low stock | Done | Via automation.js |
| GR linked to PO | Done | po_id reference |
| AP creation from GR | Done | Via automation.js |

### What's Missing (Standard in SAP MM / Oracle Procurement)

| Gap | Standard ERP Behavior | Impact | Priority |
|-----|----------------------|--------|----------|
| **Purchase Requisition approval** | PR -> multi-level approval based on amount thresholds | Approval engine exists but not wired to PR workflow | P0 |
| **PO amendment / version history** | Track PO changes (qty, price, delivery date) with version numbers | No versioning | P1 |
| **Blanket/Framework PO** | Long-term agreement with scheduled releases | Not implemented | P2 |
| **Vendor rating / scorecard** | On-time delivery %, quality %, price competitiveness scored automatically | Page exists but no automated scoring engine | P1 |
| **RFQ (Request for Quotation)** | Send RFQ to multiple vendors -> compare -> select | Not implemented | P2 |
| **Partial GR** | Receive partial qty against PO line; track remaining | GR structure unclear on partial handling | P1 |
| **GR reversal** | Reverse incorrect GR, restore PO open qty | Not implemented | P1 |
| **Invoice hold for variance** | Auto-hold AP invoice when 3-way match fails; route to exception handler | Match reports variance but no hold/workflow | P0 |
| **Vendor advance payment** | Track prepayments against future invoices | Not implemented | P2 |
| **Procurement analytics** | Spend by vendor/category/period, savings tracking | VendorPerformance page exists but engine unclear | P2 |

### Testing Implication
- **Critical test**: Three-way match boundary cases (exactly at tolerance, just over)
- **Missing flow**: PR approval -> PO creation -> partial GR -> second GR -> match
- **Add test**: Invoice hold workflow when variance detected

---

## 4. Sales Module — Gap Analysis

### What's Implemented
| Feature | Status | Notes |
|---------|--------|-------|
| Quotation CRUD | Done | Line items with pricing |
| Sales Order CRUD | Done | Quote-to-order conversion |
| Shipment tracking | Done | Delivery date |
| Returns handling | Done | Return request workflow |
| Promotions / Discounts | Done | Discount rules |
| Auto-AR on shipment | Done | Via automation.js |
| Auto-JE for revenue | Done | DR: AR / CR: Revenue |

### What's Missing (Standard in SAP SD / Oracle Order Management)

| Gap | Standard ERP Behavior | Impact | Priority |
|-----|----------------------|--------|----------|
| **Pricing rules engine** | Tiered pricing, volume discounts, customer-specific pricing, date-effective prices | Promotions page exists but no complex pricing engine | P1 |
| **Credit limit check** | Block SO if customer exceeds credit limit; require approval to override | Not implemented | P1 |
| **Available-to-Promise (ATP)** | Check stock + incoming before confirming delivery date | Not implemented | P1 |
| **Backorder management** | Auto-create backorder when stock insufficient; fulfill when stock arrives | Not implemented | P1 |
| **Picking / Packing workflow** | Generate pick list -> wave picking -> pack -> ship | Outbound page exists but no structured picking | P2 |
| **Shipping integration** | Carrier API (7-11, FamilyMart, 黑貓, 新竹物流) for tracking numbers | Not implemented | P2 |
| **Sales commission** | Calculate rep commission based on rules (% of margin, tiered) | Not implemented | P2 |
| **Partial shipment** | Ship partial qty; track remaining on SO | Structure unclear | P1 |
| **Sales return to inventory** | Return creates stock receipt + credit note | Returns page exists but inventory restock unclear | P1 |
| **Quote validity / expiry** | Quotation expires after X days; notification to follow up | Not implemented | P2 |

### Testing Implication
- **Critical flow**: Quote -> SO -> partial ship -> remaining ship -> AR -> payment
- **Missing test**: Credit limit blocking
- **Add test**: Returns flow including inventory restock

---

## 5. WMS / Inventory Module — Gap Analysis

### What's Implemented
| Feature | Status | Notes |
|---------|--------|-------|
| FIFO costing | Done | Cost layer tracking |
| LIFO costing | Done | Reverse order consumption |
| Weighted average | Done | Recalculated per purchase |
| Moving average | Done | Historical progression |
| Cost layer persistence | Done | Supabase table |
| Barcode scanning (USB + camera) | Done | BarcodeDetector API |
| SKU lookup by barcode | Done | Database query |
| Inventory valuation report | Done | By SKU, method-aware |

### What's Missing (Standard in SAP WM / Oracle WMS)

| Gap | Standard ERP Behavior | Impact | Priority |
|-----|----------------------|--------|----------|
| **Lot / Batch tracking** | Track materials by lot with expiry dates, supplier lot#, CoA | Lot field exists in cost layers but no full traceability | P1 |
| **Serial number tracking** | Unique serial per unit for warranty, recall, service | Not implemented | P2 |
| **Warehouse zones / bins** | Multi-zone (receiving, storage, picking, shipping) with bin locations | Single-level warehouse | P1 |
| **Stock reservation** | Reserve stock for SO before picking; prevent overselling | Not implemented | P0 |
| **Reorder point alerts** | Auto-notify when stock falls below reorder point | DB field exists but no alert mechanism | P1 |
| **Cycle counting** | Scheduled partial counts (ABC analysis driven) | StockCount page exists but no scheduling/ABC | P2 |
| **Stock transfer** | Move stock between warehouses with transfer order | Not implemented | P2 |
| **Inventory adjustment reasons** | Track adjustment reasons (damage, theft, count variance) with approval | Not implemented | P1 |
| **FEFO (First Expiry First Out)** | For perishables — consume earliest expiry first | Not implemented | P2 |
| **Min/Max stock levels** | Auto-suggest replenishment between min and max | Not implemented | P1 |
| **Goods-in-transit** | Track stock between locations (shipped but not received) | MRP references in_transit but no tracking page | P2 |

### Testing Implication
- **Critical test**: Cost layer consumption order (FIFO vs LIFO boundary)
- **Missing test**: Stock reservation preventing oversell
- **Add test**: Lot expiry tracking when implemented

---

## 6. Manufacturing Module — Gap Analysis

### What's Implemented
| Feature | Status | Notes |
|---------|--------|-------|
| Multi-level BOM explosion | Done | Recursive with circular ref detection |
| MRP net requirements | Done | Gross - OnHand - OnOrder |
| Lead time offset | Done | Days backward from due date |
| Purchase suggestions | Done | Grouped by supplier, MOQ applied |
| Capacity requirements (CRP) | Done | Utilization %, overload flag |
| Scrap rate in BOM | Done | Applied to required qty |

### What's Missing (Standard in SAP PP / Oracle Manufacturing)

| Gap | Standard ERP Behavior | Impact | Priority |
|-----|----------------------|--------|----------|
| **Manufacturing Order lifecycle** | MO: Planned -> Released -> In Progress -> Completed -> Closed | Page exists but state machine unclear | P0 |
| **Shop floor execution** | Clock on/off operations, actual vs planned time, operator assignment | ShopFloor page exists but no time tracking engine | P1 |
| **Quality inspection** | Incoming/in-process/final inspection with accept/reject/rework decisions | QualityInspection page exists but no inspection engine | P1 |
| **Routing / Operations** | Sequence of operations with work centers, setup time, run time per unit | Not implemented | P1 |
| **Work center scheduling** | Forward/backward scheduling based on capacity and priority | CRP calculates load but no scheduling | P2 |
| **BOM versioning** | Track BOM changes with effective dates (engineering change orders) | Not implemented | P1 |
| **Co-products / By-products** | Manufacturing process yields multiple outputs | Not implemented | P3 |
| **Subcontracting** | Send materials to vendor for processing; receive finished goods | Not implemented | P2 |
| **Production cost variance** | Standard vs actual cost variance (material, labor, overhead) | Not implemented | P1 |
| **OEE (Overall Equipment Effectiveness)** | Availability x Performance x Quality metric | Analytics page references but no calculation engine | P2 |

### Testing Implication
- **Critical test**: MRP with multi-level BOM + scrap rate + lead time offset
- **Missing test**: MO state transitions and shop floor time tracking
- **Add test**: Quality inspection accept/reject/rework flow

---

## 7. CRM Module — Gap Analysis

### What's Implemented
| Feature | Status | Notes |
|---------|--------|-------|
| CLV calculation | Done | 24-month forecast |
| Lead scoring (0-100) | Done | 5 factors weighted |
| Segmentation (dynamic rules) | Done | Multiple operators |
| SLA tracking | Done | Response + resolution time |
| Auto-assignment (round-robin) | Done | Agent rotation |
| Funnel conversion analysis | Done | By rep, by stage |
| Loyalty tiers (4 levels) | Done | Points earn/redeem |
| Drip campaigns | Done | Step sequencing, conditions |
| Messaging (Email/LINE/SMS) | Done | Template variables, batching |
| Unsubscribe management | Done | By channel |
| CSAT/NPS surveys | Done | Post-ticket closure |
| Form builder | Done | Custom fields |

### What's Missing (Standard in Salesforce / HubSpot / Zoho)

| Gap | Standard ERP Behavior | Impact | Priority |
|-----|----------------------|--------|----------|
| **Pipeline stage configuration** | Custom pipeline stages with win probability per stage | Stages referenced but not configurable | P1 |
| **Activity logging** | Log calls, meetings, emails, notes per contact/deal | Not implemented | P1 |
| **Email sync** | 2-way sync with Gmail/Outlook; auto-log conversations | Not implemented | P2 |
| **Calendar / Meeting scheduler** | Schedule meetings with availability check, send invites | Not implemented | P2 |
| **Territory management** | Assign accounts to territories for reporting and access | Not implemented | P3 |
| **Deal forecasting** | Weighted pipeline value (stage probability x deal value) | Funnel analysis exists but no forecast | P1 |
| **Duplicate detection** | Merge duplicate contacts/companies | Not implemented | P2 |
| **Web-to-lead** | Website form submission auto-creates lead | Form builder exists but no auto-lead | P2 |
| **Campaign ROI** | Track cost per campaign, calculate return on investment | Message tracking exists but no cost/ROI | P2 |
| **A/B testing** | Split test email subject/content/send time | Not implemented | P3 |

### Testing Implication
- **Critical test**: Lead scoring boundary (Hot >= 70, Warm 40-70, Cold < 40)
- **Missing test**: Pipeline stage-to-stage conversion with probability
- **Add test**: Campaign send -> delivery tracking -> open/click rates

---

## 8. POS Module — Gap Analysis

### What's Implemented
| Feature | Status | Notes |
|---------|--------|-------|
| Payment gateway integration (ECPay, LINE Pay) | Done | Request generation, signature verification |
| Receipt printing (jsPDF) | Done | Basic formatting |
| Barcode scanning | Done | USB + camera |

### What's Missing (Standard in Square / Lightspeed / iCHEF)

| Gap | Standard ERP Behavior | Impact | Priority |
|-----|----------------------|--------|----------|
| **Cart management** | Add/remove items, qty adjustment, line discount, notes | POSTerminal page exists but cart engine unclear | P0 |
| **Discount application** | Item-level, order-level, coupon code, member discount | Not implemented as engine | P0 |
| **Split payment** | Pay partial by cash, partial by card | Not implemented | P1 |
| **Cash drawer management** | Opening float, cash-in/out, expected vs actual at close | POSShifts page exists but no cash tracking engine | P1 |
| **Offline mode** | Queue transactions when internet drops; sync when back | Not implemented | P1 |
| **Kitchen display / order queue** | For F&B: send order to kitchen, track preparation status | Not implemented | P2 |
| **Customer display** | Show items and total on customer-facing screen | Not implemented | P3 |
| **Gift cards / Store credit** | Issue and redeem store credit | Not implemented | P2 |
| **Tax-inclusive pricing** | Toggle between tax-inclusive and tax-exclusive display | Not implemented | P1 |
| **Daily Z-report** | End-of-day summary (sales, refunds, payment methods, tax) | Not implemented | P1 |

### Testing Implication
- **Critical test**: Full POS transaction (scan -> cart -> payment -> receipt -> inventory deduction)
- **Missing test**: Shift open/close with cash reconciliation
- **Add test**: E-invoice generation from POS sale

---

## 9. Cross-Module Workflow Gaps

### Standard ERP Workflows Not Fully Implemented

| # | Workflow | Standard Steps | What's Missing | Priority |
|---|----------|---------------|---------------|----------|
| 1 | **Procure-to-Pay** | PR -> Approval -> RFQ -> PO -> GR -> QC -> 3-way Match -> AP -> Payment -> Bank Rec | RFQ step, QC step, Payment step, Bank Rec step | P0 |
| 2 | **Order-to-Cash** | Quote -> SO -> Credit Check -> Pick -> Pack -> Ship -> Invoice -> AR -> Payment -> Bank Rec | Credit check, Pick/Pack, Payment receipt, Bank Rec | P0 |
| 3 | **Plan-to-Produce** | Demand -> MRP -> MO -> Release -> Shop Floor -> QC -> FG Receipt -> Cost Variance | MO lifecycle, shop floor tracking, QC, cost variance | P1 |
| 4 | **Hire-to-Retire** | Recruit -> Onboard -> Probation -> Confirm -> Reviews -> Salary Rev -> Offboard -> Final Pay | Onboarding, probation tracking, salary revision, offboarding | P1 |
| 5 | **Record-to-Report** | JE -> Post -> Period Close -> TB -> Adjustments -> Financial Statements -> Audit -> File | Period close, adjusting entries, audit trail report | P1 |
| 6 | **Lead-to-Cash** | Lead -> Qualify -> Opportunity -> Quote -> SO -> Deliver -> Invoice -> Collect | Lead qualification, opportunity-to-quote conversion | P2 |

---

## 10. Field-Level Gaps (Missing Standard Fields)

### Journal Entry
| Field | Status | Standard |
|-------|--------|----------|
| Entry number | Done | Auto-generated sequence |
| Date | Done | Transaction date |
| Description | Done | Memo/narration |
| Lines (account, debit, credit) | Done | Multi-line |
| Status (draft/posted) | Done | Lifecycle |
| **Reference number** | **Missing** | Link to source document (invoice, PO, etc.) |
| **Reversal reference** | **Missing** | Link to reversed JE |
| **Attachment** | **Missing** | Supporting document upload |
| **Approver** | **Missing** | Who approved posting |
| **Period** | **Missing** | Fiscal period for close control |

### Purchase Order
| Field | Status | Standard |
|-------|--------|----------|
| PO number | Done | Auto-generated |
| Supplier | Done | Linked to vendor master |
| Lines (item, qty, price) | Done | Multi-line |
| Currency | Done | Multi-currency support |
| **Payment terms** | **Partial** | Referenced in automation but not on form |
| **Delivery address** | **Missing** | Ship-to location |
| **Incoterms** | **Missing** | FOB, CIF, EXW, etc. |
| **Approval status** | **Missing** | Pending/Approved/Rejected |
| **Version number** | **Missing** | Amendment tracking |
| **Buyer** | **Missing** | Responsible purchaser |
| **Expected delivery date** | **Missing** | Per line item |
| **Tax code per line** | **Missing** | Different tax rates per item |

### Sales Order
| Field | Status | Standard |
|-------|--------|----------|
| SO number | Done | Auto-generated |
| Customer | Done | Linked to customer master |
| Lines (item, qty, price) | Done | Multi-line |
| **Shipping method** | **Missing** | Carrier selection |
| **Promised delivery date** | **Missing** | Per line item |
| **Credit status** | **Missing** | Within/over limit indicator |
| **Commission rep** | **Missing** | Sales rep for commission calc |
| **Discount structure** | **Missing** | Item/order level discounts with reason |
| **Terms & conditions** | **Missing** | Payment/delivery terms |

### Employee Master
| Field | Status | Standard |
|-------|--------|----------|
| Name, ID, hire date | Done | Basic info |
| Department, position | Done | Org structure |
| Salary | Done | Compensation |
| **Emergency contact** | **Missing** | Name, phone, relationship |
| **Bank account** | **Missing** | For salary disbursement |
| **Contract type** | **Missing** | Full-time/Part-time/Contract/Intern |
| **Probation end date** | **Missing** | Probation period tracking |
| **Work permit / ARC** | **Missing** | For foreign workers (居留證) |
| **Education / Certifications** | **Missing** | Skills inventory |
| **Dependents** | **Missing** | For HI calculation (currently input, not stored) |

### Inventory / SKU Master
| Field | Status | Standard |
|-------|--------|----------|
| SKU code, name | Done | Basic info |
| Barcode | Done | For scanning |
| Cost layers | Done | FIFO/LIFO/Avg |
| **Reorder point** | **Missing** | Min stock trigger |
| **Reorder quantity** | **Missing** | Default order qty |
| **Lead time** | **Missing** | Supplier lead time |
| **Weight / Dimensions** | **Missing** | For shipping calc |
| **Shelf life / Expiry** | **Missing** | For FEFO |
| **Category / Classification** | **Missing** | ABC analysis grouping |
| **Default supplier** | **Missing** | Preferred vendor |
| **Min order qty (MOQ)** | **Missing** | From supplier |
| **Unit of measure conversions** | **Missing** | Box = 12 pcs, pallet = 48 boxes |

---

## 11. Summary: Testing Plan Additions Based on Gap Analysis

### New Tests to Add (Based on Missing Flows)

| # | Test Area | What to Verify | Type |
|---|-----------|---------------|------|
| 1 | PO Approval flow | PR amount triggers correct approval level | Integration |
| 2 | Partial GR against PO | Remaining qty tracked correctly | Integration |
| 3 | Invoice hold on mismatch | AP blocked when 3-way match fails | Integration |
| 4 | Credit limit on SO | SO blocked when customer over limit | Unit + E2E |
| 5 | Stock reservation | Reserved stock not available for other SOs | Unit + E2E |
| 6 | MO state machine | Planned -> Released -> In Progress -> Completed | Unit + E2E |
| 7 | Leave carryover | Unused leave rolls over or settles correctly | Unit |
| 8 | Period close | No JE posting allowed in closed period | Unit + E2E |
| 9 | POS shift reconciliation | Cash expected = opening + sales - refunds | Integration |
| 10 | Aged AR buckets | Correct bucketing at 30/60/90/120+ days | Unit |
| 11 | Payment allocation | Partial payment reduces AR correctly | Integration |
| 12 | Returns to inventory | Return restocks SKU + creates credit note | Integration |
| 13 | BOM versioning | Old BOM used for existing MOs; new BOM for new MOs | Unit |
| 14 | Vendor scorecard | On-time %, quality %, auto-calculated | Unit |
| 15 | Payslip generation | All deductions, employer contributions, YTD | Unit + E2E |

### Existing Tests to Enhance

| # | Current Test | Enhancement Needed |
|---|-------------|-------------------|
| 1 | `threeWayMatch.test.js` | Add partial GR match, invoice hold scenario |
| 2 | `accounting.test.js` | Add period close validation, JE reversal |
| 3 | `inventoryCosting.test.js` | Add lot/batch layer tracking, FEFO |
| 4 | `mrpEngine.test.js` | Add safety stock, lot sizing (EOQ/POQ) |
| 5 | `leavePolicy.test.js` | Add carryover calculation, accrual projection |
| 6 | `payroll.test.js` | Add payslip field generation, YTD totals |
| 7 | `crmEngine.test.js` | Add pipeline probability, deal forecast |
| 8 | `einvoice.test.js` | Add invoice number sequence gap detection |
| 9 | `currency.test.js` | Add realized vs unrealized gain/loss separation |
| 10 | `automation.test.js` (new) | Test all 5 automation triggers end-to-end |
