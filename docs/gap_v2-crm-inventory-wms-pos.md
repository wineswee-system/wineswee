# Gap Analysis v2 — CRM / Inventory / WMS+Dispatch / POS

**Date:** 2026-07-02
**Method:** 4 parallel codebase audits (pages, db layer, RPCs, events, migrations) benchmarked against full-featured industry systems (enterprise CRM, tier-1 WMS, full-scale inventory management, modern TW retail/F&B POS).

## TL;DR — Maturity Scores

| Domain | Score | One-line verdict |
|---|---|---|
| POS | ~85% | Feature-complete UI/flows; blocked on payment gateway callbacks + e-invoice issuance + offline auto-sync |
| Inventory | ~85% | Costing engine, lots, counts, atomic RPCs all real; FEFO/multi-UOM/landed-cost are UI-deep only |
| WMS | ~80% | Full inbound→outbound→pick/pack/dock chain; missing wave picking, directed putaway, serials |
| Dispatch | ~55% | Schema + service layer complete; half the UI pages are placeholders, no edge functions deployed |
| CRM | ~75% | B2C loyalty stack is strong; **cannot actually send anything** (LINE/SMS/email all stubs) |

**Cross-cutting theme:** the system's gaps are almost never missing features — they are **last-mile execution stubs**. Schema, events, and service logic exist; the final wire to the real world (payment callback, invoice API, message gateway, cron job, live carrier credential) is the missing piece in every domain.

---

## 1. POS ("pox") — vs full TW retail/F&B POS (iCHEF, 肚肚, Square-class)

### What exists (strong)
Full checkout (cart, variants, combos, hold/recall, barcode), multi-payment + split payments, member lookup/points/coupons/house account, partial refunds & voids, shift management with cash variance + labor-law overtime validation, X/Z reports, QR self-ordering (3 languages, per-table tokens), kitchen display with courses, waiter/table mode, thermal print + cash-drawer kick, offline product cache, event-driven journal entries + AR + inventory deduction + HR attendance.

### Gaps

**P0 — revenue / legal blockers**
| Gap | Current state | Why it matters |
|---|---|---|
| E-invoice issuance (電子發票) | Placeholder numbers `AB-{timestamp}`; ECPay/CERP not wired | Legal requirement in Taiwan; nothing issued today is a valid invoice |
| Payment gateway callbacks | ECPay CheckMacValue + LINE Pay HMAC marked TODO | Card/LINE Pay flows simulate success — cannot take real electronic payments |
| Offline transaction auto-sync | Queue (`pos_tx_queue`) exists; sync-on-reconnect not wired | Offline sales silently pile up unsynced; store data drifts |

**P1 — competitive table stakes**
- Automatic promotions engine: time-based (happy hour), buy-X-get-Y, member-tier pricing at POS. Today only manual discount + coupons.
- Service charge (10% 服務費) and tips — standard TW dine-in, absent.
- Table transfer / merge / bill-split by item across payers (split payment exists; item-level splitting doesn't).
- Kitchen printer routing by station (hot/cold/bar) — single kitchen output only; kitchen thermal format still placeholder.
- Delivery platform order injection (UberEats / foodpanda) — none.

**P2 — nice to have**
- Reservations / waitlist, deposits & pre-orders, gift cards / stored value (house account partially covers), customer-facing display, scale integration.
- StaffPerformance + MonthlyReport pages show placeholder calculations.

---

## 2. Inventory — vs full inventory management

### What exists (strong)
SKU master with variants + multi-UOM fields, warehouse→zone→bin hierarchy with capacity, real-time stock levels with reserved qty, FIFO/LIFO/weighted/moving-average costing with persistent cost layers, lot + expiry tracking, landed costs, cycle counts with 5% tolerance, returns with QC flow, valuation snapshots, atomic RPCs (`apply_inventory_adjustment_atomic`, `transfer_inventory_atomic`, `commit_outbound_shipment`), auto-PR on shortage (1.5× multiplier), dead-stock/turnover/expiry reports.

### Gaps

**P1 — integrity risks (schema exists, enforcement doesn't)**
| Gap | Current state | Risk |
|---|---|---|
| FEFO enforcement | UI guidance only; `commit_outbound_shipment` doesn't enforce lot order | Expired-first shipping is advisory — wine/food expiry compliance depends on operator discipline |
| Reserved-qty reconciliation | `reserved_qty` set on order confirm; release-after-ship not automated in RPC | Phantom reservations accumulate → false stockouts |
| Multi-UOM conversion | Fields on SKUs + inbound snapshot; conversion not exercised in outbound/POS/counting | Box-vs-bottle mismatches in mixed flows |
| Landed-cost allocation | App-layer math only, not in RPC | Non-atomic; cost layers can be created without allocation applied |

**P2**
- Reorder-point configuration UI missing (min_qty column exists, no threshold management screen).
- No stock-count lock — concurrent counts on the same SKU can collide.
- No bulk import of stock/barcodes (single-scan only).
- Kitting: `kit_definitions` referenced but assembly/explosion logic unclear.
- ABC analysis, dynamic safety stock, cross-store balancing exist only as AI-assistant stubs behind `isAIConfigured()`.

---

## 3. WMS + Dispatch — vs tier-1 WMS + delivery management

### What exists (strong)
Complete inbound (PO receipt, barcode, landed cost, FEFO layers), bins/zones, outbound with pick→pack→dock chain (PickListManager, PackStation, DockManagement all working), cycle counts, returns, transfers, kitting page, AI assistant tabs. Dispatch: full schema (jobs, routes, vehicles, drivers, availability, routing rules, tracking events, GPS breadcrumbs, POD, SLA events), routing rule engine, nearest-neighbor route optimizer with capacity check, 5 carrier adapters (own fleet, 黑貓, 新竹, 順豐, CVS/ECPay), SLA monitor logic, tracking aggregator with status normalization, HTML label generator, FleetManagement UI.

### Gaps

**P0 — the backend never runs**
| Gap | Current state | Why it matters |
|---|---|---|
| Edge functions / cron not deployed | Carrier webhooks, SLA check cron, carrier polling, driver GPS ingest — none deployed | `slaMonitor` never executes; tracking never updates; the entire SLA/tracking system is dormant code |
| Core dispatch UIs are placeholders | DispatchQueue, TrackingCenter, PublicTracking, DispatchAnalytics, Routes builder = stubs | Ops staff cannot assign, monitor, or analyze anything; only Fleet + Calendar(partial) + RouteDetail(read-only) work |
| Carrier adapters untested | All 4 external adapters are stubs without live credentials | First real shipment will hit untested code paths |

**P1**
- Driver PWA (route list, GPS updates, POD photo/signature) — not started; own-fleet delivery has no field tool.
- Scan-to-dock (dock handoff is manual selection, not barcode-driven).
- Short-pick → purchasing escalation event published but no handler wired.
- Cut-off time enforcement per carrier; end-of-day reconciliation report.

**P2 — vs tier-1 WMS**
- Wave / batch / zone picking strategies (single pick lists only).
- Directed putaway rules (bins exist, no putaway suggestions).
- Pick-face replenishment tasks, serial-number tracking (lot-only), labor KPIs per picker, slotting optimization (AI stub), cross-docking, COD, live map/ETA.

---

## 4. CRM — vs full CRM (HubSpot/Salesforce-class + TW loyalty)

### What exists (strong)
22 routed pages. B2C: members with QR tokens, configurable levels with multipliers + welcome bonuses + downgrade grace, points ledger, referral codes, birthday rewards, coupons (5 types, stacking rules, bulk assign, redemption tracking), dynamic/static groups with rule engine + AI NL parsing, post-purchase surveys (NPS/rating/choice/text) with pilot A/B runs and approval workflow, purchase records. B2B: customers with dedup/merge + CSV import, contacts with roles, multi-pipeline kanban with stale-deal detection + forecasting, lead scoring/conversion, activities, service tickets with SLA engine + CSAT, form builder, drip campaign builder with conditional branches. Event-driven POS→loyalty integration (points, tier upgrades) fully wired.

### Gaps

**P0 — the marketing stack can't fire**
| Gap | Current state | Why it matters |
|---|---|---|
| No message delivery at all | LINE Bot API not implemented, no SMS gateway, no email ESP (Sendgrid/Mailgun) | Marketing campaigns, drip sequences, survey invitations, birthday rewards — all compose messages that **never send**. This single gap neutralizes ~6 built features |
| Campaign persistence | Campaigns live in React state, not persisted to DB | No audit trail, no history, metrics lost on refresh |

**P1**
- Customer360 — 20% (skeleton; the unified view that justifies the CRM isn't aggregated).
- Member-app (LIFF) binding — separate member-app exists; auth_uid/qr_token columns present, end-to-end binding flow unverified.
- Workflow builder ~50% (approval chains defined, builder UI incomplete).
- SLA escalation alerts incomplete (policy engine exists, detection unfinished).
- Quotation line items are demo-only (not persisted).

**P2**
- Churn/health scoring & RFM segmentation (only CLV exists).
- Unified interaction timeline (activities scattered across 3 tables).
- Referral bonus automation (codes exist, rewards manual).
- Cohort/funnel analytics beyond dashboard KPIs (~60%).
- Company-level (pooled) loyalty UI (`company_memberships` table has no dedicated screen).

---

## Recommended Sequence (F&B retail, multi-store, Taiwan)

**Phase A — unblock revenue & legal (P0)**
1. E-invoice issuance via ECPay B2C API (legal exposure today)
2. ECPay CheckMacValue + LINE Pay HMAC (real electronic payments)
3. POS offline auto-sync on reconnect
4. LINE Messaging API channel (unlocks surveys, birthday rewards, campaigns, drip — all already built)

**Phase B — turn dispatch on (P0/P1)**
5. Deploy edge functions: SLA cron, carrier webhook receiver, tracking polling
6. Build the 4 stub dispatch UIs (Queue → TrackingCenter → PublicTracking → Analytics)
7. Test one real carrier adapter end-to-end (黑貓 first)

**Phase C — inventory integrity (P1)**
8. FEFO enforcement inside `commit_outbound_shipment`
9. Reserved-qty auto-release after shipment
10. Reorder-point config UI + multi-UOM conversion in outbound

**Phase D — CRM depth (P1/P2)**
11. Customer360 aggregation, campaign persistence, member-app LIFF binding verification
12. POS promotions engine + service charge

**Phase E — scale-up (P2)**
13. Driver PWA, wave picking, serials, RFM/churn scoring, delivery-platform integration
