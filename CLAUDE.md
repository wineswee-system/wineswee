# CLAUDE.md

This file provides context for Claude Code when working in this repository.

## Project Overview

SME Ops System — a React-based ERP platform for small/medium enterprises. Covers HR, CRM, Finance, POS, WMS, Manufacturing, Purchasing, Sales, Analytics, and more.

## Commands

- `npm run dev` — Start dev server (port 5173)
- `npm run build` — Production build
- `npm test` — Run unit tests (Vitest)
- `npm run test:e2e` — Run e2e tests (Playwright)
- `npm run test:coverage` — Coverage report

## Architecture

- **React 19** with React Router 7 (SPA)
- **Tailwind CSS 4** via Vite plugin
- **Supabase** for database (PostgreSQL), auth, and storage
- **Module-based lazy loading**: each module in `src/modules/` bundles its pages into a single chunk
- **Multi-tenant**: `TenantContext` scopes data by store/organization
- **RBAC**: role-based access in Supabase (`roles`, `permissions`, `role_permissions` tables)
- **Event-driven (Kafka-ready)**: pluggable EventBus in `src/lib/events/` with 8-domain catalog, **8-layer middleware pipeline** (tenant → sanitizer → rateLimit → idempotency → validator → tracing → auditLog → DLQ), 7 domain handlers, and KafkaTransport placeholder. All cross-module side effects flow through events.
- **Enterprise infrastructure**: structured logger, CQRS read models, background job queue, DLQ monitoring with error budgets, Service Worker for offline-first, virtual scrolling for large tables

## Code Conventions

- Language: JSX (not TypeScript)
- Components are in `src/pages/<domain>/` organized by business module
- Shared components live in `src/components/`
- Business logic / utilities live in `src/lib/`
- Module route bundles live in `src/modules/`
- Commit messages are in English or Chinese (mixed is OK)
- UI text is primarily in Traditional Chinese (zh-TW)

## Key Files

- `src/App.jsx` — Root routing
- `src/lib/db.js` — Database operations layer
- `src/lib/supabase.js` — Supabase client initialization
- `src/lib/events/EventBus.js` — Core event bus (pluggable transport, Kafka-ready)
- `src/lib/events/handlers/` — Cross-module event handlers (7 domains)
- `src/lib/events/catalog/` — Event schema definitions (8 domains)
- `src/lib/events/transports/KafkaTransport.js` — Kafka migration placeholder
- `src/lib/events/middleware/` — 8 middleware layers (sanitizer, rateLimit, idempotency, validator, tracing, auditLogger, DLQ, outbox)
- `src/lib/logger.js` — Structured logger (JSON prod / pretty dev)
- `src/lib/cqrs/ReadModelService.js` — CQRS read models with MV fallback
- `src/lib/jobQueue.js` — Background job queue with retry
- `src/lib/dlqMonitor.js` — DLQ monitoring + error budgets
- `src/lib/healthCheck.js` — Health check for container orchestration
- `src/lib/performanceUtils.js` — React perf hooks (debounce, throttle, lazy load)
- `src/lib/useVirtualList.js` — Virtual scrolling for large tables
- `src/lib/automation.js` — Cross-module orchestration functions
- `src/contexts/AuthContext.jsx` — Authentication provider
- `src/contexts/TenantContext.jsx` — Multi-tenant provider
- `supabase-schema.sql` — Full database schema

## Testing

- Unit tests: Vitest + Testing Library, files in `src/__tests__/` and `src/**/__tests__/`
- E2E tests: Playwright, files in `e2e/`
- MSW for API mocking in unit tests
- Contract tests: `src/lib/events/__tests__/contract.test.js` — validates event catalog schemas
- Resilience tests: `src/lib/events/__tests__/resilience.test.js` — idempotency, retry, error isolation, concurrency

## Environment Variables

All prefixed with `VITE_`:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_LIFF_ID` (LINE LIFF integration)
- `VITE_GEMINI_API_KEY` (Google Gemini AI)
