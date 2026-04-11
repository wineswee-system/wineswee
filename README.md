# SME Ops System

A comprehensive **SME (Small & Medium Enterprise) operations management platform** built with React. It provides an all-in-one ERP-style dashboard covering HR, CRM, Finance, POS, WMS, Manufacturing, Purchasing, Sales, and more.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, React Router 7 |
| Styling | Tailwind CSS 4 |
| Build | Vite 6 |
| Backend / DB | Supabase (PostgreSQL + Auth + Storage) |
| AI | Google Gemini API |
| Charts | Chart.js + react-chartjs-2 |
| PDF Export | jsPDF + jspdf-autotable |
| Icons | Lucide React |
| Testing | Vitest + Testing Library (unit), Playwright (e2e) |
| Deployment | Vercel (static) / Docker + Nginx (Cloud Run) |

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Installation

```bash
git clone <repo-url>
cd sme-ops
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=<your-supabase-url>
VITE_SUPABASE_ANON_KEY=<your-supabase-anon-key>
VITE_LIFF_ID=<your-line-liff-id>
VITE_GEMINI_API_KEY=<your-gemini-api-key>
```

### Development

```bash
npm run dev          # Start dev server at http://localhost:5173
```

### Build & Preview

```bash
npm run build        # Production build → dist/
npm run preview      # Preview production build locally
```

### Docker

```bash
docker build -t sme-ops .
docker run -p 8080:8080 sme-ops
```

## Project Structure

```
src/
├── components/        # Shared UI components (Sidebar, Modal, etc.)
├── contexts/          # React context providers (Auth, Tenant)
├── data/              # Static data / seed data
├── lib/               # Business logic & utilities
│   ├── db.js          # Database operations
│   ├── supabase.js    # Supabase client
│   ├── logger.js      # Structured logger (JSON in prod, pretty in dev)
│   ├── healthCheck.js # Health check endpoint for containers
│   ├── jobQueue.js    # Background job queue with retry
│   ├── dlqMonitor.js  # DLQ monitoring + error budgets
│   ├── performanceUtils.js # React perf hooks (debounce, throttle, lazy load)
│   ├── useVirtualList.js   # Virtual scrolling for large tables
│   ├── cqrs/          # CQRS read model service (dashboard KPIs, analytics)
│   ├── events/        # Event bus system (Kafka-ready, 8-layer middleware)
│   ├── payroll.js     # Payroll engine
│   ├── posEngine.js   # POS engine
│   ├── crmEngine.js   # CRM engine
│   ├── salesEngine.js # Sales engine
│   ├── laborLaw.js    # Labor law compliance
│   ├── gemini.js      # AI integration
│   └── ...            # Many more domain utilities
├── modules/           # Module-level route bundles (lazy loaded)
│   ├── HRModule.jsx
│   ├── CRMModule.jsx
│   ├── FinanceModule.jsx
│   ├── POSModule.jsx
│   ├── WMSModule.jsx
│   └── ...
├── pages/             # Page components organized by domain
│   ├── hr/            # HR: attendance, payroll, schedule, expenses
│   ├── crm/           # CRM: customers, pipeline, campaigns, marketing
│   ├── finance/       # Finance: invoices, tax, e-invoice
│   ├── pos/           # Point of Sale terminal
│   ├── wms/           # Warehouse: inventory, inbound/outbound
│   ├── purchase/      # Purchasing & goods receipts
│   ├── sales/         # Sales orders & quotations
│   ├── manufacturing/ # MRP, BOM, work orders
│   ├── analytics/     # Cross-system analytics dashboards
│   ├── process/       # Workflow automation
│   ├── super-admin/   # System logs, error logs, user activity
│   └── ...
├── App.jsx            # Root app with routing
└── main.jsx           # Entry point
```

## Modules

| Module | Path | Description |
|--------|------|-------------|
| Dashboard | `/` | Overview with KPIs and quick actions |
| HR | `/hr/*` | Attendance, payroll, scheduling, leave, expenses |
| CRM | `/crm/*` | Customers, pipeline, drip campaigns, marketing, members |
| Finance | `/finance/*` | Invoices, tax reports, e-invoicing |
| POS | `/pos/*` | Point of sale terminal |
| WMS | `/wms/*` | Inventory, inbound/outbound logistics |
| Purchase | `/purchase/*` | Purchase orders, goods receipts, 3-way match |
| Sales | `/sales/*` | Sales orders, quotations |
| Manufacturing | `/manufacturing/*` | MRP, BOM, work orders |
| Analytics | `/analytics/*` | Cross-system analytics & reporting |
| Process | `/process/*` | Workflow automation |
| Organization | `/org/*` | Organization structure |
| System | `/system/*` | System settings |
| Integration | `/integration/*` | Third-party integrations |
| AI | `/ai/*` | AI-powered features |
| Super Admin | `/super-admin/*` | System logs, error logs, user activity |

## Architecture

- **Module-based code splitting**: Each module is lazy-loaded as a single chunk. Navigating within a module after initial load is instant.
- **Vendor chunking**: React, Chart.js, jsPDF, Supabase, and Lucide are split into separate vendor chunks for optimal caching.
- **Multi-tenant**: Tenant context provides store/organization scoping.
- **RBAC**: Role-based access control with roles, permissions, and role-permission mapping in Supabase.
- **Supabase backend**: PostgreSQL for data, Supabase Auth for authentication, Edge Functions for server-side logic.
- **Event-driven architecture (Kafka future-ready)**: Pluggable event bus with 8-domain event catalog, 5-layer middleware chain, and cross-module event handlers. Designed for zero-code-change migration to Kafka. See [PLAN.md](PLAN.md) for architecture details.

### Event System

The system uses a publish/subscribe event bus (`src/lib/events/`) that decouples all cross-module communication:

```
src/lib/events/
├── EventBus.js                    # Core bus with middleware chain
├── catalog/                       # 8 domain event schemas (sales, purchase, wms, finance, hr, crm, pos, manufacturing)
├── middleware/                    # 5 middleware layers (tenant, idempotency, validation, audit, DLQ)
├── handlers/                      # 7 domain handlers (finance, purchase, wms, crm, pos, hr, manufacturing)
├── store/EventStore.js            # Event persistence + replay
└── transports/
    ├── TransportInterface.js      # Abstract base class
    ├── InMemoryTransport.js       # Current production transport
    └── KafkaTransport.js          # Drop-in Kafka replacement (placeholder)
```

Key design decisions for Kafka readiness:
- **Pluggable transport**: Swap `InMemoryTransport` → `KafkaTransport` with zero handler changes
- **Idempotent processing**: Deduplication middleware prevents duplicate side effects from Kafka redelivery
- **Event envelope**: Every event carries `correlation_id`, `causation_id`, `tenant_id` for distributed tracing
- **Dead letter queue**: Failed handler events are persisted for retry/investigation
- **Event store**: All events persisted to `business_events` table with full replay capability

## Database

The full schema is defined in [supabase-schema.sql](supabase-schema.sql). Key tables include:

- `roles`, `permissions`, `role_permissions` — RBAC
- `employees` — Employee directory
- `attendance_records` — Clock in/out
- `invoices`, `invoice_items` — Finance
- `customers`, `pipeline_deals` — CRM
- `inventory_items`, `stock_movements` — WMS
- And many more domain tables

To set up the database, run the schema SQL in the Supabase Dashboard SQL Editor.
For enterprise indexes, RLS policies, and materialized views, also run `supabase/migrations/20260410_enterprise_indexes_rls.sql`.

## Enterprise Infrastructure

| Component | File | Description |
|-----------|------|-------------|
| Structured Logger | `src/lib/logger.js` | JSON logging in prod, pretty in dev, module-scoped loggers |
| Health Check | `src/lib/healthCheck.js` | DB/auth/memory/SW checks for container orchestration |
| Job Queue | `src/lib/jobQueue.js` | Background jobs with retry, DLQ retry, MV refresh |
| DLQ Monitor | `src/lib/dlqMonitor.js` | Error budget tracking, alerting hooks |
| CQRS Read Models | `src/lib/cqrs/ReadModelService.js` | Cached read models, materialized view fallback |
| Virtual Scrolling | `src/lib/useVirtualList.js` | Windowed rendering for 1000+ row tables |
| Performance Utils | `src/lib/performanceUtils.js` | Debounce, throttle, lazy load, stable callbacks |
| Service Worker | `public/sw.js` | Offline-first, asset caching, POS offline queue |
| Outbox Pattern | `src/lib/events/middleware/outbox.js` | Transactional event publishing with worker |
| Rate Limiting | `src/lib/events/middleware/rateLimit.js` | Per-tenant event throttling |
| Input Sanitization | `src/lib/events/middleware/sanitizer.js` | XSS/SQL injection protection |
| Distributed Tracing | `src/lib/events/middleware/tracing.js` | OpenTelemetry-compatible spans |
| Idempotency | `src/lib/events/middleware/idempotency.js` | Kafka at-least-once deduplication |
| Retry | `src/lib/events/middleware/retry.js` | Exponential backoff for transient failures |

## Testing

```bash
npm test              # Run unit tests (Vitest)
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
npm run test:e2e      # End-to-end tests (Playwright)
```

### E2E Tests

Located in `e2e/`:
- `auth.spec.js` — Authentication flows
- `critical-pages.spec.js` — Page load smoke tests
- `finance-flow.spec.js` — Finance workflows
- `hr-payroll.spec.js` — HR & payroll workflows

## Deployment

### Vercel

The project includes [vercel.json](vercel.json) with SPA rewrites and asset caching headers. Push to the connected branch to deploy.

### Docker / Cloud Run

```bash
docker build -t sme-ops .
# Deploy the image to Google Cloud Run or any container platform
# The container listens on port 8080
```

## License

Private — All rights reserved.
