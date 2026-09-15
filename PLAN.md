# SME Ops System — Project Plan

> Last updated: 2026-09-15 — CRM, Sales, POS, WMS, Purchase, and Dispatch were removed entirely (internal-only tool for wineswee, not sold to other tenants). Manufacturing, Integration, the standalone `/ai` module, and Finance's pages were removed earlier the same day; see [ADDON_MODULE_REMOVAL_PLAN.md](ADDON_MODULE_REMOVAL_PLAN.md). Shared library code that other modules still depend on (`lib/db/finance.js`, `lib/einvoice/`, `lib/accounting/`) was kept — real accounting/e-invoicing runs through the external 文中 CERP system. Payroll, Salary Structures, LMS, SOP/Template creation & deploy, expense-form creation/settle, and project/workflow template management are locked to `super_admin` only (code intact, access-gated — see the block-screen pattern in `PagePermGuard.jsx`).

## Current State

SME-OPS is a cloud-native React app covering HR, Analytics, and Process/workflow management for wineswee's internal operations, plus Org/System administration and Reservations.

### Live Modules

| Module | Route | Notes |
|--------|-------|-------|
| HR / Payroll | `/hr` | 勞保/健保/勞退/所得稅 fully implemented, Taiwan labor law compliant. Payroll + Salary Structures locked to super_admin; rest is open. |
| Process | `/process` | Workflow + Task fully open. Projects (view/edit open, create blocked), SOP/project templates, and approval-chain actions locked to super_admin. |
| Analytics | `/analytics` | Cross-system dashboards, PDF export. Some tabs (Profitability, Supply-Risk, Promo-ROI) reference tables owned by removed modules and will show stale/empty data. |
| Org | `/org` | Organization/department/location management, per-org Gemini API key override. |
| System | `/system` | Settings, users, audit log, approval rules, form builder. |
| Reservations | `/reservations` | Booking/seating/table management. |
| LMS | `/lms` | Locked to super_admin only (entire module). |
| Super Admin / Comms | `/super-admin`, `/comms` | super_admin only, as before. |

### Removed Modules (deleted, not just locked)

| Module | Removed | Reason |
|--------|---------|--------|
| Manufacturing | 2026-09-15 | Unused add-on for this internal tool |
| Integration (incl. WenzhongImport) | 2026-09-15 | Unused add-on |
| Standalone `/ai` module | 2026-09-15 | AI Scheduling inside HR kept (separate code) |
| Finance (pages) | 2026-09-15 | Real accounting moved to external 文中 CERP; shared lib functions kept |
| CRM, Sales, POS, WMS, Purchase | 2026-09-15 | Not needed for this internal tool's actual operations |
| Dispatch | 2026-09-15 | Depended on WMS; removed alongside it |

---

## Testing Priorities

See [ERP_GAP_ANALYSIS.md](ERP_GAP_ANALYSIS.md) for historical gap analysis (written before the above removals — treat module-specific gaps there as stale for anything no longer in the Live Modules table above).

1. **Payroll calculation accuracy** — bracket boundaries, all deduction types
2. **Workflow/Task engine** — approval chains, task-binding forms, SOP deployment
3. **Cross-module flows still live** — HR expense approval → journal entry (via kept `lib/accounting`), org-scoped multi-tenant isolation

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
│  'hr.salary',│     │  │ 2.Idempotent│ │     ┌────────▼─────────┐
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
| **Event catalog** (2 live domains: finance, hr — plus lms/workflow/approval) | `src/lib/events/catalog/` | Done — schema validation per event type |
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
| **Domain handlers** | `handlers/` | HR + LMS wired (CRM/Sales/POS/WMS/Purchase/Dispatch handlers removed with their modules) |

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

## Enterprise Infrastructure (Implemented)

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
| Service Worker | Done | `public/sw.js` — offline-first, asset caching |
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
| `CrossSystemAnalytics.jsx` stale tabs | 4 of 7 tabs (Profitability, Supply-Risk, Promo-ROI, part of Customer360) query tables owned by removed modules (CRM/Sales/POS/Purchase) — won't error, but will show increasingly stale/empty data since nothing writes to those tables anymore |
