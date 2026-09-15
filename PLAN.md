# SME Ops System — Project Plan

> Last updated: 2026-09-15 — Manufacturing, Integration, the standalone `/ai` module, and the Finance module's pages were removed as add-ons (internal-only tool now, not sold to other tenants); see [ADDON_MODULE_REMOVAL_PLAN.md](ADDON_MODULE_REMOVAL_PLAN.md). Shared library code that other modules depend on (`lib/db/finance.js`, `lib/einvoice/`, `lib/accounting/`) was kept, not deleted — real accounting/e-invoicing now runs through the external 文中 CERP system.

## Current State

SME-OPS is a cloud-native React ERP covering HR, CRM, POS, WMS, Purchasing, Sales, Analytics, and Process/workflow management for wineswee's internal operations.

### Module Maturity

| Module | Completion | Notes |
|--------|-----------|-------|
| HR / Payroll | 95% | 勞保/健保/勞退/所得稅 fully implemented, Taiwan labor law compliant |
| Purchase | 90% | Three-way matching with tolerance, auto-PR from low stock |
| WMS | 90% | FIFO/LIFO/weighted avg costing, barcode scanning |
| POS | 80% | Payment gateway, receipt printing, shift reports |
| Sales | 75% | Line items, SKU-linked pricing, quote-to-order conversion |
| CRM | 70% | Pipeline, drip campaigns, messaging (Email/LINE/SMS) |
| Analytics | 65% | Cross-system dashboards, PDF export |

---

## Roadmap

### Phase 1 — Critical Gaps (P0)

These are blocking gaps that prevent core ERP workflows from functioning end-to-end.

| # | Item | Module | Description |
|---|------|--------|-------------|
| 1 | Stock reservation | WMS | Reserve stock for SO before picking; prevent overselling |
| 2 | PO approval workflow | Purchase | PR → multi-level approval based on amount thresholds |
| 3 | Invoice hold on mismatch | Purchase | Auto-hold AP invoice when 3-way match fails |
| 4 | MO lifecycle state machine | Manufacturing | Planned → Released → In Progress → Completed → Closed |
| 5 | POS cart engine | POS | Add/remove items, qty adjustment, line discount, notes |
| 6 | POS discount engine | POS | Item-level, order-level, coupon code, member discount |

### Phase 2 — Core Enhancement (P1)

| # | Item | Module | Description |
|---|------|--------|-------------|
| 1 | Cost center accounting | Finance | Tag transactions to cost centers for departmental P&L |
| 2 | Budget vs actual variance | Finance | Variance calculation with favorable/unfavorable alerts |
| 3 | Bank reconciliation matching | Finance | Import bank statement, auto-match to open AR/AP |
| 4 | Fiscal year / period close | Finance | Lock periods, carry forward opening balances |
| 5 | Aged AR/AP bucket engine | Finance | 30/60/90/120+ day buckets with drill-down |
| 6 | Payment allocation | Finance | Partial payments allocated to specific invoices |
| 7 | Credit notes / debit memos | Finance | Adjustments linked to original invoice |
| 8 | Employee onboarding workflow | HR | Checklist: contract, ID, bank account, IT setup, training |
| 9 | Employee offboarding | HR | Separation checklist with final pay calculation |
| 10 | Salary revision history | HR | Track changes with effective dates and approval |
| 11 | Payslip PDF generation | HR | Monthly payslip with deductions, contributions, YTD |
| 12 | Leave carryover policy | HR | Unused leave rolls over or paid out per policy |
| 13 | Pricing rules engine | Sales | Tiered pricing, volume discounts, customer-specific |
| 14 | Credit limit check on SO | Sales | Block SO if customer exceeds credit limit |
| 15 | Available-to-Promise (ATP) | Sales | Check stock + incoming before confirming delivery date |
| 16 | Backorder management | Sales | Auto-create backorder when stock insufficient |
| 17 | Partial shipment tracking | Sales | Ship partial qty, track remaining on SO |
| 18 | Lot / batch tracking | WMS | Expiry dates, supplier lot#, traceability |
| 19 | Warehouse zones / bins | WMS | Multi-zone with bin locations |
| 20 | Reorder point alerts | WMS | Auto-notify when stock below reorder point |
| 21 | PO amendment / version history | Purchase | Track PO changes with version numbers |
| 22 | Vendor rating scorecard | Purchase | On-time delivery %, quality %, auto-scored |
| 23 | Partial GR handling | Purchase | Receive partial qty, track remaining |
| 24 | GR reversal | Purchase | Reverse incorrect GR, restore PO open qty |
| 25 | Shop floor execution | Manufacturing | Clock on/off, actual vs planned time |
| 26 | Quality inspection engine | Manufacturing | Incoming/in-process/final with accept/reject/rework |
| 27 | Routing / operations | Manufacturing | Operation sequences with work centers and time |
| 28 | BOM versioning | Manufacturing | Track changes with effective dates |
| 29 | Production cost variance | Manufacturing | Standard vs actual (material, labor, overhead) |
| 30 | Pipeline stage configuration | CRM | Custom stages with win probability |
| 31 | Activity logging | CRM | Log calls, meetings, emails per contact/deal |
| 32 | Deal forecasting | CRM | Weighted pipeline value |
| 33 | Split payment | POS | Partial by cash, partial by card |
| 34 | Cash drawer management | POS | Opening float, cash-in/out, reconciliation |
| 35 | POS offline mode | POS | Queue transactions when offline; sync on reconnect |
| 36 | Tax-inclusive pricing toggle | POS | Tax-inclusive vs tax-exclusive display |
| 37 | Daily Z-report | POS | End-of-day summary |

### Phase 3 — Nice to Have (P2-P3)

| # | Item | Module |
|---|------|--------|
| 1 | Multi-entity consolidation | Finance |
| 2 | Recurring journal entries | Finance |
| 3 | Revenue recognition (IFRS 15) | Finance |
| 4 | Benefits management | HR |
| 5 | Performance review workflow | HR |
| 6 | Recruitment pipeline | HR |
| 7 | Training / LMS | HR |
| 8 | Serial number tracking | WMS |
| 9 | Stock transfer between warehouses | WMS |
| 10 | FEFO for perishables | WMS |
| 11 | Blanket / framework PO | Purchase |
| 12 | RFQ process | Purchase |
| 13 | Work center scheduling (Gantt) | Manufacturing |
| 14 | Subcontracting | Manufacturing |
| 15 | OEE calculation | Manufacturing |
| 16 | Shipping carrier integration | Sales |
| 17 | Sales commission | Sales |
| 18 | Email sync (Gmail/Outlook) | CRM |
| 19 | Calendar / meeting scheduler | CRM |
| 20 | Campaign ROI tracking | CRM |
| 21 | Duplicate detection & merge | CRM |
| 22 | Kitchen display / order queue | POS |
| 23 | Gift cards / store credit | POS |

---

## Event-Driven Architecture (Kafka Future-Ready)

The system is built on a **pluggable event-driven architecture** designed for seamless Kafka migration when scale demands it. The current in-memory transport can be swapped for Kafka by changing a single line — no handler, middleware, or business logic changes required.

### Current Architecture (Phase 1 — In-Memory)

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Publisher   │────▶│    EventBus       │────▶│  InMemoryTransport│
│  (any page)  │     │  ┌─────────────┐ │     │  (synchronous)   │
│              │     │  │ Middleware   │ │     └────────┬─────────┘
│ bus.publish( │     │  │ 1.Tenant    │ │              │
│  'wms.ship', │     │  │ 2.Idempotent│ │     ┌────────▼─────────┐
│  payload     │     │  │ 3.Validator │ │     │   Subscribers    │
│ )            │     │  │ 4.AuditLog  │ │     │  (domain handlers)│
└─────────────┘     │  │ 5.DLQ       │ │     └──────────────────┘
                    │  └─────────────┘ │
                    └──────────────────┘
```

### Kafka Migration (Phase 2 — One-Line Swap)

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Publisher   │────▶│    EventBus       │────▶│  KafkaTransport  │
│  (any page)  │     │  (same middleware)│     │  ┌────────────┐  │
│              │     │                  │     │  │ Producer   │  │
│              │     │                  │     │  └─────┬──────┘  │
└─────────────┘     └──────────────────┘     │        │ Kafka   │
                                             │  ┌─────▼──────┐  │
                                             │  │ Consumer   │  │
                                             │  │ Group      │  │
                                             │  └─────┬──────┘  │
                                             └────────┼─────────┘
                                                      │
                                             ┌────────▼─────────┐
                                             │   Same Handlers  │
                                             │  (no code change) │
                                             └──────────────────┘
```

### What's Built (Kafka-Ready Infrastructure)

| Component | Location | Status |
|-----------|----------|--------|
| **EventBus core** | `src/lib/events/EventBus.js` | Done — pluggable transport interface |
| **Event catalog** (8 domains) | `src/lib/events/catalog/` | Done — schema validation per event type |
| **Middleware chain** (5 layers) | `src/lib/events/middleware/` | Done |
| ├ Tenant context | `middleware/tenantContext.js` | Injects tenant_id for multi-tenant partitioning |
| ├ Idempotency | `middleware/idempotency.js` | Deduplicates events (critical for Kafka at-least-once) |
| ├ Schema validator | `middleware/validator.js` | Validates payload against catalog |
| ├ Audit logger | `middleware/auditLogger.js` | Persists all events to `business_events` table |
| └ Dead letter queue | `middleware/deadLetterQueue.js` | Captures handler errors to `dead_letter_queue` table |
| **Retry middleware** | `middleware/retry.js` | Exponential backoff with configurable retries |
| **InMemoryTransport** | `transports/InMemoryTransport.js` | Current production transport |
| **KafkaTransport** (placeholder) | `transports/KafkaTransport.js` | Drop-in replacement with topic config |
| **Event store** | `store/EventStore.js` | Query + replay persisted events |
| **Domain handlers** (7 modules) | `handlers/` | All major domains wired |

### Event Flow Across Modules

All 8 domains publish and subscribe to events. Key cross-module chains:

| Trigger Event | → Handler | → Downstream Event |
|--------------|-----------|-------------------|
| `sales.order.created` | Purchase: check stock → auto-PR | `purchase.pr.created` |
| `sales.order.created` | Manufacturing: check BOM → auto-MO | `manufacturing.mo.state_changed` |
| `sales.order.confirmed` | WMS: reserve stock | `wms.stock.reserved` |
| `wms.shipment.completed` | Finance: create AR + JE | `finance.ar.created` → `finance.journal.posted` |
| `purchase.goods_receipt.completed` | Finance: create AP + JE | `finance.ap.created` |
| `purchase.goods_receipt.completed` | WMS: increase stock | `wms.stock.adjusted` |
| `pos.transaction.completed` | WMS: deduct stock | `wms.stock.adjusted` |
| `pos.transaction.completed` | Finance: create AR | `finance.ar.created` |
| `pos.transaction.completed` | CRM: update loyalty points | — |
| `hr.expense.approved` | Finance: create JE | `finance.journal.posted` |
| `hr.salary.calculated` | Finance: payroll JE | `finance.journal.posted` |
| `hr.employee.onboarded` | HR: create leave entitlements | — |
| `crm.opportunity.won` | Sales: create SO draft | `sales.order.created` |
| `manufacturing.inspection.completed` | Manufacturing: update MO | `manufacturing.mo.state_changed` |
| `manufacturing.mo.state_changed` (完成) | WMS: receive finished goods | `wms.stock.adjusted` |

### Kafka Migration Checklist

When the system needs to scale beyond in-memory:

1. `npm install kafkajs`
2. Uncomment KafkaTransport client code in `transports/KafkaTransport.js`
3. In `EventBus.js`, swap: `new InMemoryTransport()` → `new KafkaTransport({ brokers: [...] })`
4. Create Kafka topics per `KAFKA_TOPIC_CONFIG` in KafkaTransport.js
5. Add retry middleware to the chain: `bus.use(retryMiddleware)` before DLQ
6. Deploy consumer instances (same handler code, Kafka consumer groups handle distribution)

**Zero handler code changes. Zero middleware changes. Zero event catalog changes.**

---

## Cross-Module Workflows to Complete

These are end-to-end workflows that span multiple modules. Completing them is a measure of true ERP maturity.

| # | Workflow | Current Gaps |
|---|----------|-------------|
| 1 | **Procure-to-Pay** (PR → PO → GR → 3-way Match → AP → Payment → Bank Rec) | RFQ, QC, payment, bank rec steps |
| 2 | **Order-to-Cash** (Quote → SO → Credit Check → Pick → Pack → Ship → AR → Payment → Bank Rec) | Credit check, pick/pack, payment receipt, bank rec |
| 3 | **Plan-to-Produce** (Demand → MRP → MO → Shop Floor → QC → FG Receipt → Cost Variance) | MO lifecycle, shop floor, QC, cost variance |
| 4 | **Hire-to-Retire** (Recruit → Onboard → Probation → Reviews → Salary Rev → Offboard → Final Pay) | Onboarding, probation tracking, salary revision, offboarding |
| 5 | **Record-to-Report** (JE → Post → Period Close → TB → Adjustments → Financials → Audit) | Period close, adjusting entries, audit trail |
| 6 | **Lead-to-Cash** (Lead → Qualify → Opportunity → Quote → SO → Deliver → Invoice → Collect) | Lead qualification, opportunity-to-quote conversion |

---

## Testing Priorities

See [ERP_GAP_ANALYSIS.md](ERP_GAP_ANALYSIS.md) Section 11 for detailed test additions. Key priorities:

1. **Payroll calculation accuracy** — bracket boundaries, all deduction types
2. **Three-way match boundaries** — at tolerance, just over tolerance
3. **Cost layer consumption** — FIFO vs LIFO ordering
4. **MRP with multi-level BOM** — scrap rate + lead time offset
5. **POS full transaction** — scan → cart → payment → receipt → inventory deduction
6. **Cross-module flows** — Quote → SO → Ship → AR → Payment

---

## Enterprise Infrastructure (Implemented)

All recommendations have been built and wired into the system:

### 1. Observability
| Component | Status | Description |
|-----------|--------|-------------|
| Structured Logger | Done | `src/lib/logger.js` — JSON in prod, pretty in dev, module-scoped |
| Distributed Tracing | Done | `events/middleware/tracing.js` — OTel-compatible spans with p95/p99 |
| Health Check | Done | `src/lib/healthCheck.js` — DB/auth/memory/SW for containers |
| DLQ Monitor | Done | `src/lib/dlqMonitor.js` — error budgets, alert hooks |

### 2. Database Performance
| Component | Status | Description |
|-----------|--------|-------------|
| Composite Indexes | Done | 40+ indexes on hot query patterns (migration SQL) |
| RLS Policies | Done | Immutable audit trail, tenant isolation |
| Materialized Views | Done | `mv_daily_sales`, `mv_customer_revenue`, `mv_inventory_summary` |
| CQRS Read Models | Done | `src/lib/cqrs/ReadModelService.js` — cached read models |

### 3. Event Pipeline (8-Layer Middleware)
| Layer | Middleware | Description |
|-------|-----------|-------------|
| 1 | Tenant Context | Inject tenant_id for multi-tenant partitioning |
| 2 | Sanitizer | XSS/SQL injection protection, input validation |
| 3 | Rate Limiter | Per-tenant burst throttling (configurable per domain) |
| 4 | Idempotency | LRU cache + DB dedup (Kafka at-least-once safe) |
| 5 | Validator | Schema validation against EVENT_CATALOG |
| 6 | Tracing | OpenTelemetry-compatible spans, slow event detection |
| 7 | Audit Logger | Persist to `business_events` (immutable) |
| 8 | Dead Letter Queue | Capture handler errors to `dead_letter_queue` |

### 4. Scalability
| Component | Status | Description |
|-----------|--------|-------------|
| Outbox Pattern | Done | `events/middleware/outbox.js` — atomic DB+event publishing |
| Background Jobs | Done | `src/lib/jobQueue.js` — retry, DLQ retry, MV refresh |
| Service Worker | Done | `public/sw.js` — offline-first, POS queue, asset caching |
| Virtual Scrolling | Done | `src/lib/useVirtualList.js` — windowed rendering for 1000+ rows |

### 5. Frontend Performance
| Component | Status | Description |
|-----------|--------|-------------|
| Performance Hooks | Done | `src/lib/performanceUtils.js` — debounce, throttle, lazy load |
| Stable Callbacks | Done | `useStableCallback` — no child re-renders |
| Intersection Observer | Done | `useIntersectionObserver` — lazy-load below-fold charts |
| Number Formatters | Done | Pre-compiled Intl formatters for zh-TW |

### 6. Testing
| Component | Status | Description |
|-----------|--------|-------------|
| Contract Tests | Done | `events/__tests__/contract.test.js` — schema validation |
| Resilience Tests | Done | `events/__tests__/resilience.test.js` — idempotency, retry, concurrency |

---

## Technical Debt

| Item | Description |
|------|-------------|
| TypeScript migration | Currently all JSX; no type safety |
| Test coverage gaps | Many lib engines lack unit tests |
| i18n completeness | UI is zh-TW; no English fallback |
| Accessibility | No a11y audit done |
| Secret management | API keys in Dockerfile ENV — should use secret manager |
