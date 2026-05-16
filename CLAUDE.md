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

## Color & Theme Rules

All color tokens are defined in `src/index.css` with `[data-theme="light"]` overrides. Dark is the default. Never introduce a new color family — reuse existing tokens.

1. **No hardcoded colors in JSX or CSS.** Use `var(--accent-*)`, `var(--bg-*)`, `var(--text-*)`, `var(--border-*)`. Exception: JS values passed to canvas-based libraries (Chart.js, SVG attributes) that can't parse `var(...)` — for these, import resolvers from `src/lib/theme/tokens.js`.
2. **Semantic → color mapping is fixed.** Do not invent new pairings:
   - success → `--accent-green` · warning → `--accent-orange` · error → `--accent-red` · info → `--accent-blue`
   - primary/brand CTA → `--accent-cyan` · highlight/special → `--accent-purple`
3. **Status-bearing UI must pair color with icon or text.** No color-only meaning. Use `src/components/ui/Badge.jsx` rather than rolling a custom badge.
4. **Tinted backgrounds use `-dim` variants.** For a colored pill/chip, use `background: var(--accent-X-dim)` + `color: var(--accent-X)`. Do not write raw rgba approximations.
5. **Muted text is for hints/captions only.** `--text-muted` sits near the 5:1 contrast edge on `--bg-secondary`. Body copy uses `--text-secondary` or stronger.
6. **Inverse text on accent backgrounds may use `#fff` literal.** This is the one allowed hex — e.g., button text on `var(--accent-cyan)`, toggle knob on a colored track. Document with a comment if non-obvious.
7. **No Tailwind palette utilities.** Never add `text-gray-*`, `bg-slate-*`, `bg-zinc-*`, `border-neutral-*`, etc. If you need gray, it's already a `--text-*` or `--bg-*` token.

Chart colors: import `chartPalette()` and `chartTextTokens()` from `src/lib/theme/tokens.js` inside the component (wrap in `useMemo`) so values re-resolve when the theme changes.

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
- `src/lib/theme/tokens.js` — Resolves CSS theme vars to concrete strings for canvas/chart libs
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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **sme-ops-system** (17331 symbols, 23529 relationships, 68 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/sme-ops-system/context` | Codebase overview, check index freshness |
| `gitnexus://repo/sme-ops-system/clusters` | All functional areas |
| `gitnexus://repo/sme-ops-system/processes` | All execution flows |
| `gitnexus://repo/sme-ops-system/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
