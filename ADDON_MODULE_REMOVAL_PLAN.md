# Add-on Module Removal Plan

> Status: **Executed 2026-09-15.** Manufacturing, Integration, the `/ai` module, and Finance's pages/module/event-handlers have been removed from source. `ModuleConfig.jsx`/`OrgManagement.jsx` trimmed to 8 modules (on/off UI kept, per revised §5). Shared library code (`lib/db/finance.js`, `lib/einvoice/`, `lib/accounting/`) was kept in place rather than deleted — see §3b. Build and test suite verified clean (only pre-existing, unrelated failures remain — `renderModule.test.jsx`, `approval.test.js`, `auditLogger.test.js`, confirmed via git-stash comparison against the pre-session baseline). Remaining/deferred: full rewrite of `gap_v1.md` and `ERP_GAP_ANALYSIS.md` (only `PLAN.md` was updated); a deeper trim of Finance-exclusive-only functions still sitting unused inside `lib/accounting/*` and `lib/einvoice/*` (left in place for safety, not wired to any route anymore).
> Scope confirmed with owner: sme-ops-system is an **internal tool for wineswee only** (not sold to outside SME tenants). "Organizations" = wineswee's own branches/stores, not paying customers.

---

## 1. Where "add-on modules" currently live

The system defines **12 toggleable modules** in `ALL_MODULES` ([src/pages/super-admin/ModuleConfig.jsx:11](src/pages/super-admin/ModuleConfig.jsx#L11)), each mapped to a plan tier (免費/標準/專業/企業) and stored per-org in `tenant.features`:

`HR · Finance · CRM · Sales · POS · WMS · Purchase · Manufacturing · Analytics · Process · Integration · AI`

**Important finding:** this toggle is cosmetic. Nothing in the actual routing layer ([src/modules/index.js](src/modules/index.js)) or `Sidebar.jsx` reads `tenant.features` — real access control runs on a separate RBAC permission system (`nav.group.*`, `finance.view`, `system.admin`, etc.). So "removing an add-on" today means deleting the module's code/routes/nav entries, not flipping a flag — the flag does nothing on its own. This is addressed in §5.

Separately, `Comms`, `Dispatch`, and `SuperAdmin` are **already** hardcoded `superAdminOnly: true` in `modules/index.js` — this is the existing precedent for "feature exists but only the owner/admin can reach it," and it's the pattern reused below.

---

## 2. Classification decisions

| Module | Decision | Basis |
|---|---|---|
| **Manufacturing** | **Remove entirely — except 3 functions in `lib/db/manufacturing.js`** | Owner-confirmed. BOM/MRP/shop-floor has no application to wine retail/ops. **Correction (graphify impact analysis):** `lib/db/manufacturing.js` also contains `getInventoryLots()`, `getStockCounts()`, `createStockCount()` — actually WMS lot-tracking/stock-count functions (misfiled), used by `pages/wms/Lots.jsx` and `pages/wms/StockCount.jsx`. These 3 exports must move to a WMS-owned db file (e.g. `lib/db/inventory.js`) before the rest of `manufacturing.js` (BOM, MRP, work orders, routings, quality inspection) is deleted. |
| **Integration** | **Remove entirely — no carve-out** | Owner-confirmed ("remove all"). Includes `WenzhongImport.jsx`, the 文中 CERP import bridge — see §3 risk callout. |
| **Finance / Accounting** | **Remove entirely** | Owner-confirmed. Real accounting + e-invoice relay already runs through the external certified ERP (文中 CERP), per [pos_dev.md](pos_dev.md) — the in-app Finance module (30 pages: GL, BS/P&L, AR/AP, tax reports) duplicates that system. |
| HR | Keep — core | Staff scheduling, attendance, payroll, Taiwan labor law compliance (95% complete) — actively needed for running stores. |
| POS | Keep — core | Floor panel / ordering is the primary day-to-day tool. |
| Sales | Keep — core | Quote/order flow feeding POS and WMS. |
| WMS | Keep — core | Wine inventory, lot/expiry tracking, costing — essential for a wine business. |
| Purchase | Keep — core | Supplier ordering, three-way match for stock replenishment. |
| Process | Keep — core | Workflow/SOP/task engine — actively invested in (see `project_dev.md`), used for cross-store operations. |
| CRM | Keep — as-is | Member/pipeline features overlap with reservations/loyalty; low removal ROI, not flagged by owner. |
| Analytics | Keep — as-is | Cross-module dashboards; mostly read-only, cheap to keep. Will need rework once Finance/Manufacturing data sources are removed (see §4). |
| **AI** | **Remove `/ai` module entirely — except AI Scheduling, which is a separate feature and stays** | Owner-confirmed: "only keep AI schedule." See §3b — the `/ai` module (Agent Console, Help Center, Tutorial, Nav Assistant) is unrelated code to the AI shift-scheduling feature embedded in HR, which is kept as-is. |

---

## 3. Integration removal — no carve-out (owner-confirmed: "remove all")

Owner has confirmed removing **all** of Integration, with no exception for the 文中 bridge:

- `src/pages/integration/WenzhongImport.jsx` — the 文中 CERP import/sync bridge. Per `pos_dev.md`'s architecture diagram, this was the link between POS/order data and the certified accounting relay to 財政部 (MoF) e-invoicing.
- `src/pages/integration/Ecommerce.jsx`, `CarrierIntegration.jsx`, `APIDocumentation.jsx` — generic e-commerce/logistics/API-docs scaffolding with no evidence of use for wineswee.

**⚠ Risk callout (read before executing):** removing `WenzhongImport.jsx` deletes the only code path this app has for syncing to the external 文中 CERP system — i.e. after this change, sme-ops-system has **no accounting bridge at all**, in-app or external. If 文中 CERP sync is still happening today through this file (rather than manually, or through a mechanism outside this repo), confirm that's genuinely fine before this step runs, since it's harder to reconstruct than to keep. If accounting sync should continue in some form, say so now — otherwise this plan proceeds with full removal, no exceptions, per your instruction.

---

## 3b. AI: two unrelated things sharing one label

Owner-confirmed: **only keep AI Scheduling; remove the rest of AI.**

- **`/ai` module** ([src/modules/AIModule.jsx](src/modules/AIModule.jsx), `perm: 'nav.project.admin'`) — 4 pages: `AgentConsole.jsx`, `HelpCenter.jsx` (duplicates `system/HelpCenter.jsx`), `Tutorial.jsx`, `NavAssistant.jsx`. This is the one listed in `ALL_MODULES` as the toggleable "AI 助手" add-on. **→ Remove entirely**: delete `src/pages/ai/`, the `/ai` entry in `src/modules/index.js`, its sidebar entries, and its `ALL_MODULES`/`planModuleDefaults` rows.
- **AI Scheduling** (`src/lib/schedulingAi.js`, `src/lib/schedulingAi/{aiCaller,promptBuilder,dataGathering}.js`, `src/pages/hr/components/AiDraftReviewPanel.jsx`) — generates AI-drafted staff shift schedules, invoked from `src/pages/hr/Schedule.jsx`. This is **not** part of the `/ai` module or its route tree; it's an HR feature that happens to call an AI model internally. **→ Keep as-is**, no change — it lives under HR (`perm: null`, i.e. same access as the rest of HR), not superadmin-restricted unless you want that too (not stated — flagged as open in §6).

---

## 4. Technical impact of removing Finance (the largest cut)

Finance is wired into cross-module event chains, not just its own 30 pages. Deleting it cleanly requires also touching:

- **Event handlers**: `src/lib/events/handlers/financeHandlers.js`, `postingHandlers.js`, `vatHandlers.js` — triggered by `pos.transaction.completed` (POS→AR), `purchase.goods_receipt.completed` (→AP), `hr.salary.calculated` (→payroll JE), `wms.shipment.completed` (→AR+JE). These publishers stay; the Finance-side subscribers need to be removed or turned into no-ops so publishing doesn't error against a missing handler.
- **Routing**: `/finance` entry in `src/modules/index.js` (`FinanceModule.jsx`, `perm: 'finance.view'`).
- **Nav**: the entire `財務會計` top-level tab in `src/components/sidebar/sidebarConfig.js` (`majorGroups` key `finance`).
- **Cross-references**: `Analytics` pulls AR/AP/journal data into dashboards (`/analytics/*`) — those widgets will need to be removed or repointed, not just left broken.
- **Module-config scaffolding**: `Finance` entries in `ALL_MODULES`/`planModuleDefaults` (ModuleConfig.jsx) and default feature arrays in `TenantAdmin.jsx`/`OrgManagement.jsx`.
- **Docs**: `PLAN.md`, `gap_v1.md`, `ERP_GAP_ANALYSIS.md` all describe Finance completion % and roadmap items — should be updated to avoid stale docs.
- **Tests**: `events/__tests__/contract.test.js` and `resilience.test.js` validate the finance event schemas/flows — will need updating alongside the handler removal.

This is meaningfully more invasive than Manufacturing or Integration, which are self-contained.

**Correction from graphify-based impact analysis (2026-09-15):** `lib/db/finance.js`, `lib/einvoice.js`/`lib/einvoice/`, `lib/accounting.js`/`lib/accounting/` are **not** Finance-page-exclusive. Kept modules call directly into them:
- `pages/pos/POSTerminal.jsx`, `pages/pos/WaiterMode.jsx` — `calculateInvoiceTax()`, `buildQRPair()`, `code39Svg()` (tax calc + QR/barcode receipt generation, core POS checkout, not accounting reporting)
- `pages/sales/Quotations.jsx`, `SalesOrders.jsx` — `calculateInvoiceTax()` for order totals
- `pages/sales/Commission.jsx` — `getCommissionRules()` / `createCommissionRule()` / `updateCommissionRule()`
- `pages/crm/Customer360.jsx` — `getAccountsReceivable()` (AR balance on the customer view)
- `pages/purchase/GoodsReceipts.jsx`, `PurchaseOrders.jsx` — `getAccountsPayable()`
- `pages/workflow/ExpenseRequests.jsx`, `Expenses.jsx`, `ExpenseFormDraft.jsx`, `ExpenseSimpleDraft.jsx` — `getAccounts()`, `getCurrencies()` (chart-of-accounts / currency pickers on expense forms)

**Revised approach:** do not delete `lib/db/finance.js` / `lib/einvoice/` / `lib/accounting*` wholesale. Remove only the exports exclusively used by `pages/finance/*` (GL posting, balance sheet, trial balance, tax filing, AR/AP aging reports, etc.); keep the functions listed above in place. `src/pages/finance/`, `FinanceModule.jsx`, and the three event-handler files are still fully removed as planned — only the shared library layer underneath them gets trimmed, not deleted.

---

## 5. What happens to `tenant.features` / ModuleConfig.jsx

Since scope is now confirmed as internal-only (not multi-tenant SaaS), the entire plan-tier/add-on-toggle system (`ModuleConfig.jsx`, `planModuleDefaults`, the `features` column) has no real purpose going forward — it never actually gated anything, and there's no external customer to sell tiers to.

**Decision (revised — owner wants to keep a simple on/off UI):** Not deleted. `ModuleConfig.jsx` and the `features` toggle UI in `TenantAdmin.jsx`/`OrgManagement.jsx` are **kept**, trimmed to the 8 remaining modules only: `HR, CRM, Sales, POS, WMS, Purchase, Analytics, Process`. Remove the `Manufacturing`, `Integration`, `Finance`, `AI` rows from `ALL_MODULES` and from every `planModuleDefaults` array (and the matching default arrays in `TenantAdmin.jsx`/`OrgManagement.jsx`). Still display-only/cosmetic as it is today (§1) — no new enforcement wiring added, since that would be new feature work beyond a removal pass, not requested.

No DB migration is proposed, per instruction not to touch the database — stale `features` values on existing org rows referencing removed modules (e.g. `"Manufacturing"`, `"Finance"`) simply become unused labels; the UI itself will no longer offer them.

---

## 6. Remaining open item

1. **AI Scheduling visibility** — kept as a normal HR feature at its current access level (not superadmin-restricted), since "remove all" answered the removal-scope questions (Integration/Wenzhong, ModuleConfig, Analytics) and AI Scheduling itself was explicitly the one thing to *keep* from the AI decision. Say so if you also want it locked to superadmin/owner only.

Everything else previously open (Wenzhong carve-out, ModuleConfig fate, Analytics cleanup) is now resolved to "remove/delete" per your instruction — see the risk callout in §3 specifically before executing that step.

---

## 7. Suggested execution order

1. Remove **Manufacturing** (fully isolated — lowest risk, good first cut to validate the process).
2. Remove **Integration** in full, including `WenzhongImport.jsx` (§3 risk callout applies).
3. Remove the **`/ai` module** (Agent Console, Help Center, Tutorial, Nav Assistant) — routing/nav/ALL_MODULES cleanup only; do not touch `schedulingAi.js`, `schedulingAi/`, or `AiDraftReviewPanel.jsx`, which are unrelated HR code and stay.
4. Remove **Finance**: delete pages/module/nav, neutralize the four event-handler files, strip Finance widgets from Analytics, update tests.
5. Trim **ModuleConfig.jsx** / `TenantAdmin.jsx` / `OrgManagement.jsx` to the 8 remaining modules per §5 (keep the on/off UI, drop the 4 removed-module rows).
6. Update `PLAN.md`, `README.md`, `gap_v1.md`, `ERP_GAP_ANALYSIS.md` to drop references to removed modules.
7. Full regression pass: `npm test`, `npm run test:e2e`, manual smoke test of POS→WMS→Purchase flows (which no longer emit into Finance) and HR Schedule (confirm AI draft generation still works).
