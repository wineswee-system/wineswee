# Dispatch Service — Full Development Plan

> **Status:** Planning  
> **Priority:** High  
> **Builds on:** `shipments` table, `commit_outbound_shipment()`, `carrier_configs`, `Shipments.jsx`

---

## What Already Exists

| Asset | Location | State |
|---|---|---|
| `shipments` table | `supabase-schema.sql` | Basic CRUD, 5 status stages |
| `Shipments.jsx` | `src/pages/sales/` | Manual status UI |
| `commit_outbound_shipment()` | DB migration | Atomic stock decrement |
| `carrier_configs` table | DB | Carrier master, no routing logic |
| `outbound_orders` / `outbound_items` | DB | Fulfillment records |
| `createARFromShipment()` | `src/lib/automation/finance.js` | Finance trigger on ship |

**Gap:** No routing intelligence, no driver/fleet layer, no scheduling engine, no real-time tracking, no warehouse pick-pack-ship workflow, no dispatch assignment.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        DISPATCH SERVICE                         │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │  Orders  │→ │ Dispatch │→ │  Route   │→ │   Delivery   │   │
│  │  Queue   │  │  Engine  │  │Optimizer │  │   Tracking   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │
│        ↓             ↓             ↓               ↓           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │Warehouse │  │  Driver  │  │ Schedule │  │Notifications │   │
│  │  WMS     │  │  Fleet   │  │Calendar  │  │LINE / Email  │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Module 1 — Smart Routing Engine

### Goal
Auto-assign orders to the right carrier or internal driver based on zone, weight, SLA, cost, and capacity.

### Features

#### 1.1 Routing Rules Engine
- Zone-based routing: map postal code ranges → carrier / driver
- Weight/volume thresholds: courier vs. freight vs. own fleet
- SLA-priority routing: urgent = express carrier; standard = economy
- Cost optimization: choose cheapest carrier that meets SLA
- Fallback chain: if primary carrier unavailable → fallback carrier
- Blackout rules: carrier not available on certain days / zones

#### 1.2 Multi-Stop Route Optimization (Own Fleet)
- Cluster delivery addresses by zone (geospatial grouping)
- Nearest-neighbor TSP heuristic first; upgradeable to Google OR-Tools
- Capacity constraints: max weight, max volume, max stops per run
- Time-window delivery slots per stop
- Return-to-warehouse logic built in

#### 1.3 Carrier API Integration Layer
- Abstract `CarrierAdapter` interface: create label, get tracking, cancel
- Built-in adapters:
  - 黑貓宅急便 (T-Cat) — REST API
  - 新竹物流 — REST API
  - 台灣郵政 (Post) — REST API
  - 順豐速運 (SF Express) — REST API
  - 超商取貨 (CVS: 7-11 / FamilyMart) — barcode generation
  - 自行配送 (Own Fleet) — internal driver assignment
- Webhook receivers: carrier pushes status updates back
- Label printing: PDF / ZPL thermal label generation

### DB Schema (New)

```sql
-- Routing rules
CREATE TABLE dispatch_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations,
  name text NOT NULL,
  priority integer DEFAULT 0,
  conditions jsonb NOT NULL,   -- {zone, weight_max, weight_min, sla_hours, order_value_max}
  action jsonb NOT NULL,       -- {carrier_id, driver_group, service_level}
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Carrier adapter configs (extends existing carrier_configs)
ALTER TABLE carrier_configs ADD COLUMN IF NOT EXISTS adapter_type text;
ALTER TABLE carrier_configs ADD COLUMN IF NOT EXISTS api_credentials jsonb;  -- encrypted
ALTER TABLE carrier_configs ADD COLUMN IF NOT EXISTS webhook_secret text;
ALTER TABLE carrier_configs ADD COLUMN IF NOT EXISTS service_levels jsonb;   -- [{code, name, sla_hours, rate}]
ALTER TABLE carrier_configs ADD COLUMN IF NOT EXISTS supported_zones text[];

-- Route plans (own fleet)
CREATE TABLE dispatch_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations,
  route_number text UNIQUE NOT NULL,
  driver_id uuid REFERENCES employees,
  vehicle_id uuid REFERENCES dispatch_vehicles,
  date date NOT NULL,
  status text DEFAULT 'planned',  -- planned/active/completed/cancelled
  stops jsonb NOT NULL,           -- ordered [{shipment_id, address, time_window, sequence}]
  total_distance_km numeric,
  estimated_duration_minutes integer,
  actual_start timestamptz,
  actual_end timestamptz,
  created_at timestamptz DEFAULT now()
);
```

---

## Module 2 — Fleet & Driver Management

### Goal
Manage own-fleet drivers, vehicles, and capacity for internal deliveries.

### Features

#### 2.1 Driver Management
- Driver profiles: license type, zones covered, vehicle assigned
- Availability calendar: working hours, leave, day-off
- Workload cap: max deliveries per day per driver
- Performance metrics: on-time %, delivery success %, average stop time
- Driver app (PWA): route view, GPS update, proof-of-delivery capture

#### 2.2 Vehicle Management
- Vehicle register: plate, type (van/truck/motorcycle), capacity (kg, m³)
- Maintenance schedule: service due alerts
- Utilization tracking: km per day, load factor

#### 2.3 Auto-Assignment Logic
- Match driver availability + zone coverage + vehicle capacity to route
- Manual override: dispatcher can drag-and-drop reassign
- Notification to driver: LINE push when route assigned

### DB Schema (New)

```sql
CREATE TABLE dispatch_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations,
  plate_number text NOT NULL,
  type text NOT NULL,           -- van/truck/motorcycle/bicycle
  max_weight_kg numeric,
  max_volume_m3 numeric,
  status text DEFAULT 'active', -- active/maintenance/retired
  notes text
);

CREATE TABLE dispatch_driver_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees UNIQUE,
  license_type text,
  zones_covered text[],
  max_deliveries_per_day integer DEFAULT 30,
  vehicle_id uuid REFERENCES dispatch_vehicles,
  is_active boolean DEFAULT true
);

CREATE TABLE dispatch_driver_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid REFERENCES dispatch_driver_profiles,
  date date NOT NULL,
  available_from time,
  available_until time,
  is_available boolean DEFAULT true,
  reason text,
  UNIQUE(driver_id, date)
);
```

---

## Module 3 — Scheduling & Dispatch Workflows

### Goal
Structured workflow from order-ready → dispatched → delivered, with scheduling, SLA monitoring, and escalations.

### Features

#### 3.1 Dispatch Queue
- Pending orders surface automatically when `outbound_order` status = `ready_to_ship`
- Batch dispatch: select multiple orders → auto-route and assign
- Priority queue: VIP orders, express SLA flagged at top
- Hold / release: dispatcher can hold problematic orders
- Cut-off time rules: orders received after 14:00 dispatch next day

#### 3.2 Dispatch Calendar
- Day / week view of all planned routes and carrier pickups
- Carrier pickup slot booking (time windows per carrier)
- Driver schedule overlay
- Click-to-create manual dispatch slot
- Dock door scheduling for warehouse pickups

#### 3.3 Workflow States

```
[Order Ready] → [Dispatch Queued] → [Assigned to Carrier/Driver]
     → [Label Printed / Route Confirmed] → [Picked Up / Departed]
         → [In Transit] → [Out for Delivery] → [Delivered / Failed]
             → [POD Captured] → [Closed]
                                    ↘ [Exception] → [Re-dispatch]
```

#### 3.4 SLA Monitoring & Escalations
- Per-order SLA deadline tracking
- Amber alert: 2h before SLA breach
- Red alert: SLA breached → auto-notify manager + customer
- Auto-escalation: failed delivery → re-schedule within 24h
- Daily SLA dashboard: on-time delivery rate by carrier / zone / driver

#### 3.5 Batch Operations
- Print all labels for today's dispatch in one action
- Generate pick lists for warehouse (grouped by carrier / route)
- Bulk status update via carrier webhook processing
- End-of-day reconciliation: unscanned vs. dispatched

### DB Schema (New)

```sql
CREATE TABLE dispatch_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations,
  shipment_id uuid REFERENCES shipments,
  outbound_order_id uuid REFERENCES outbound_orders,
  job_number text UNIQUE NOT NULL,
  status text DEFAULT 'queued',
  -- queued/assigned/label_printed/picked_up/in_transit/
  -- out_for_delivery/delivered/failed/exception/closed
  priority text DEFAULT 'normal',     -- urgent/high/normal/low
  carrier_id uuid REFERENCES carrier_configs,
  route_id uuid REFERENCES dispatch_routes,
  driver_id uuid REFERENCES dispatch_driver_profiles,
  carrier_label_url text,
  tracking_number text,
  sla_deadline timestamptz,
  sla_status text DEFAULT 'on_track', -- on_track/at_risk/breached
  assigned_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  failed_attempts integer DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE dispatch_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations,
  date date NOT NULL,
  carrier_id uuid REFERENCES carrier_configs,
  pickup_time_from time,
  pickup_time_until time,
  dock_door text,
  expected_parcel_count integer,
  actual_parcel_count integer,
  status text DEFAULT 'planned',
  notes text
);

CREATE TABLE dispatch_sla_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES dispatch_jobs,
  event_type text,   -- at_risk/breached/resolved/escalated
  triggered_at timestamptz DEFAULT now(),
  notified_to text[],
  notes text
);
```

---

## Module 4 — Real-time Delivery Tracking

### Goal
Full visibility into every shipment from warehouse departure to recipient signature.

### Features

#### 4.1 Internal Fleet GPS Tracking
- Driver PWA reports GPS position every 30s while route active
- Live map: dispatcher sees all active drivers
- ETA: remaining stops × avg stop time + travel
- Geofence: auto-trigger "arrived at stop" when driver within 100m
- Breadcrumb trail stored per route for audit

#### 4.2 Third-Party Carrier Tracking
- Carrier webhook receivers: auto-update status on push
- Polling fallback: cron job polls carrier API every 15 min for non-webhook carriers
- Status normalization: map each carrier's status codes to unified system statuses
- Exception detection: carrier reports failed delivery → flag job

#### 4.3 Customer-Facing Tracking Page
- Public URL: `/track/{tracking_number}` — no login required
- Shows: order summary, current status, milestone timeline, estimated date
- Map embed: driver location (own fleet only)
- CVS pickup: show barcode / pickup code prominently
- OG tags for LINE / social link preview

#### 4.4 Proof of Delivery
- Immutable timeline: every status change appended with timestamp + actor
- Driver PWA: photo capture + recipient name / signature at delivery
- POD stored in Supabase Storage, linked to `dispatch_jobs`
- Failed delivery: driver records reason (no-one home / refused / wrong address)

### DB Schema (New)

```sql
CREATE TABLE dispatch_tracking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES dispatch_jobs,
  shipment_id uuid REFERENCES shipments,
  event_code text NOT NULL,        -- unified status code
  carrier_raw_code text,           -- original carrier status code
  description text,
  location text,
  lat numeric,
  lng numeric,
  actor text,   -- carrier_webhook / driver_app / manual / system
  actor_id uuid,
  created_at timestamptz DEFAULT now()
);

-- Driver GPS breadcrumb (high-frequency — separate table for performance)
CREATE TABLE dispatch_driver_locations (
  id bigserial PRIMARY KEY,
  route_id uuid REFERENCES dispatch_routes,
  driver_id uuid REFERENCES dispatch_driver_profiles,
  lat numeric NOT NULL,
  lng numeric NOT NULL,
  speed_kmh numeric,
  recorded_at timestamptz DEFAULT now()
);

CREATE TABLE dispatch_proof_of_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES dispatch_jobs UNIQUE,
  recipient_name text,
  recipient_signature_url text,
  photo_urls text[],
  notes text,
  captured_at timestamptz DEFAULT now(),
  captured_by uuid REFERENCES employees
);
```

---

## Module 5 — Warehouse Integration (Pick-Pack-Ship)

### Goal
Connect dispatch engine to WMS so the warehouse floor knows exactly what to pick, pack, and hand off — extending the existing `/wms` module.

### Features

#### 5.1 Pick List Generation
- Auto-generate pick lists when dispatch job batch is confirmed
- Grouping: by aisle, by carrier, or by route
- Picker self-assigns via handheld / tablet
- Scan-to-pick: scan SKU barcode → confirm pick
- Short pick: record insufficient stock → trigger purchase alert

#### 5.2 Pack Station Workflow
- After picking: order moves to pack queue
- Pack station scan: scan order → show item list + packaging spec
- Verify: scan each item into box (catches mis-picks)
- Record box dimensions + weight (for freight rate calculation)
- Carrier label auto-attached to packed box record

#### 5.3 Outbound Dock Management
- Dock queue: carrier pickup slot + parcels ready at dock
- Handoff scan: scan parcel at dock → status → "handed to carrier"
- Carrier sign-off: batch manifest generated + carrier acknowledgement
- Cutoff enforcement: parcels not packed by cutoff → flag for re-schedule

#### 5.4 Inbound Integration (Returns / Replenishment)
- Inbound shipment expected → create inbound check-in job
- Driver delivery to warehouse: scan at dock → trigger stock receipt
- Return processing: customer return → inspect → restock or quarantine

### DB Schema (New — extends `/wms` module)

```sql
CREATE TABLE wms_pick_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations,
  list_number text UNIQUE NOT NULL,
  dispatch_batch_id uuid,
  picker_id uuid REFERENCES employees,
  status text DEFAULT 'pending',  -- pending/in_progress/completed/short_picked
  items jsonb NOT NULL,           -- [{sku_id, sku_code, qty_required, qty_picked, location}]
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE wms_pack_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES dispatch_jobs,
  pick_list_id uuid REFERENCES wms_pick_lists,
  packer_id uuid REFERENCES employees,
  box_count integer DEFAULT 1,
  total_weight_kg numeric,
  dimensions jsonb,               -- {l, w, h, unit}
  packed_at timestamptz DEFAULT now()
);

CREATE TABLE wms_dock_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid REFERENCES dispatch_schedules,
  carrier_id uuid REFERENCES carrier_configs,
  handoff_at timestamptz DEFAULT now(),
  parcels jsonb NOT NULL,         -- [{job_id, tracking_number}]
  manifest_url text,
  carrier_agent_name text,
  carrier_sign_off boolean DEFAULT false
);
```

---

## Module 6 — Analytics & Reporting

### Metrics

| Metric | Calculation |
|---|---|
| On-Time Delivery Rate | delivered before SLA / total delivered |
| First Attempt Success Rate | delivered on 1st try / total |
| Average Transit Time | mean(delivered_at − picked_up_at) by carrier |
| Cost per Delivery | carrier charge / delivered count |
| Driver Utilization | active delivery hours / shift hours |
| Exception Rate | exceptions / total dispatched |
| Carrier Performance Score | composite (OTD + success + cost index) |
| Returns Rate | returns / delivered |

### Dashboard Pages

1. **Dispatch Overview** — today's queue, live route map, SLA ticker
2. **Carrier Scoreboard** — compare carriers by KPIs
3. **Driver Performance** — per-driver stats, leaderboard
4. **SLA Report** — breach log, root cause tags, trend
5. **Cost Analysis** — shipping cost by carrier / zone / month
6. **Zone Heatmap** — delivery density map by postal zone (Leaflet.js)

---

## Frontend Pages (New)

| Route | Component | Description |
|---|---|---|
| `/dispatch` | `DispatchDashboard.jsx` | Main ops dashboard: queue + live map |
| `/dispatch/queue` | `DispatchQueue.jsx` | Order queue, batch assign |
| `/dispatch/routes` | `DispatchRoutes.jsx` | Route planner, driver assignment |
| `/dispatch/routes/:id` | `RouteDetail.jsx` | Live route map + stop list |
| `/dispatch/schedule` | `DispatchCalendar.jsx` | Calendar: carrier pickups + routes |
| `/dispatch/fleet` | `FleetManagement.jsx` | Vehicles + driver list |
| `/dispatch/fleet/drivers` | `DriverList.jsx` | Driver profiles + availability |
| `/dispatch/tracking` | `TrackingCenter.jsx` | All active shipments, live board |
| `/track/:number` | `PublicTracking.jsx` | Customer-facing, no auth |
| `/dispatch/analytics` | `DispatchAnalytics.jsx` | KPI dashboards |
| `/wms/picklist` | `PickListManager.jsx` | Warehouse pick lists |
| `/wms/pack` | `PackStation.jsx` | Pack station workflow |
| `/wms/dock` | `DockManagement.jsx` | Dock door + carrier handoff |

---

## Backend Services (New)

| File | Responsibility |
|---|---|
| `src/lib/dispatch/routingEngine.js` | Routing rule evaluation, carrier selection |
| `src/lib/dispatch/routeOptimizer.js` | Multi-stop TSP optimization |
| `src/lib/dispatch/carrierAdapters/index.js` | Adapter factory |
| `src/lib/dispatch/carrierAdapters/tcat.js` | 黑貓 adapter |
| `src/lib/dispatch/carrierAdapters/xinzhu.js` | 新竹 adapter |
| `src/lib/dispatch/carrierAdapters/sfexpress.js` | 順豐 adapter |
| `src/lib/dispatch/carrierAdapters/cvs.js` | CVS pickup adapter |
| `src/lib/dispatch/carrierAdapters/ownFleet.js` | Internal fleet adapter |
| `src/lib/dispatch/slaMonitor.js` | SLA deadline tracking + escalations |
| `src/lib/dispatch/trackingAggregator.js` | Normalize + merge tracking events |
| `src/lib/dispatch/labelGenerator.js` | PDF / ZPL label generation |
| `src/lib/dispatch/notifications.js` | Driver + customer notifications |
| `src/lib/wms/pickListService.js` | Pick list generation logic |
| `src/lib/wms/packStationService.js` | Pack workflow |
| `src/lib/wms/dockService.js` | Dock handoff + manifest |

---

## Edge Functions (Supabase)

| Endpoint | Purpose |
|---|---|
| `POST /functions/carrier-webhook/:carrier` | Receive carrier status push |
| `POST /functions/driver-location` | Driver GPS heartbeat (own fleet) |
| `POST /functions/dispatch-assign` | Trigger auto-assign for batch |
| `POST /functions/generate-labels` | Batch label generation |
| `GET /functions/public-tracking/:number` | Public tracking (unauthenticated) |
| `POST /functions/sla-monitor` | Cron: check SLA deadlines every 15 min |
| `POST /functions/carrier-poll` | Cron: poll non-webhook carriers |

---

## Event Bus Integration

Extends existing `src/lib/events/` EventBus:

```
dispatch.job.created          order enters queue
dispatch.job.assigned         carrier / driver assigned
dispatch.job.label_printed    label ready
dispatch.job.picked_up        departed warehouse
dispatch.job.delivered        recipient confirmed
dispatch.job.failed           delivery failed
dispatch.job.exception        carrier exception
dispatch.sla.at_risk          SLA amber alert (2h warning)
dispatch.sla.breached         SLA breach
dispatch.route.started        driver departed
dispatch.route.completed      all stops done
wms.picklist.created          warehouse alerted to pick
wms.picklist.completed        picking done → move to pack
wms.pack.completed            packed → ready at dock
wms.dock.handoff              carrier took custody
```

**Cross-module handlers to add:**
- `dispatch.job.delivered` → `createARFromShipment()` (already exists in finance.js)
- `dispatch.sla.breached` → notify manager via LINE + email
- `dispatch.job.failed` → auto-create re-dispatch job
- `wms.picklist.created` → notify picker via LINE

---

## RBAC Permissions (New)

| Permission | Roles |
|---|---|
| `dispatch.view` | store_staff, store_manager, office_staff, admin |
| `dispatch.assign` | store_manager, office_staff, admin |
| `dispatch.manage_routes` | store_manager, admin |
| `dispatch.manage_fleet` | admin |
| `dispatch.analytics` | store_manager, admin |
| `wms.picklist` | store_staff, store_manager, admin |
| `wms.pack` | store_staff, store_manager, admin |
| `wms.dock` | store_manager, admin |

---

## AI Capabilities (via Gemini)

Leverage existing `VITE_GEMINI_API_KEY`:

| Feature | AI Role |
|---|---|
| Smart ETA | ML on historical transit data per carrier/zone/day |
| Anomaly Detection | Flag shipments behaving unusually vs. carrier baseline |
| Route Suggestion | AI suggests optimal multi-stop order based on traffic patterns |
| Customer Communication Draft | Auto-draft delay notifications (LINE / email) |
| Dispatch Volume Forecast | Predict daily parcel count for staffing |
| Exception Root Cause | Classify failed deliveries: address / no-one home / carrier error |

---

## Tech Decisions

| Decision | Choice | Reason |
|---|---|---|
| Route optimization | Nearest-neighbor heuristic (JS) | No external dep; sufficient for <50 stops |
| GPS / realtime | Supabase Realtime subscription | Already in stack |
| Map rendering | Leaflet.js | No Google Maps billing |
| Label generation | `pdf-lib` (client-side) | No server dep for basic labels |
| Carrier API calls | Supabase Edge Functions | Credentials stay server-side |
| POD storage | Supabase Storage | Already in stack |
| Public tracking | Unauthenticated Edge Function | No auth overhead |

---

## Build Phases

### Phase 1 — Foundation (Week 1–2)
- [ ] DB migrations: `dispatch_routing_rules`, `dispatch_jobs`, `dispatch_vehicles`, `dispatch_driver_profiles`, `dispatch_tracking_events`
- [ ] `routingEngine.js`: rule evaluation + carrier selection
- [ ] Extend shipments workflow → `dispatch_jobs` lifecycle
- [ ] `DispatchQueue.jsx`: order queue with batch assign UI
- [ ] SLA deadline calculation on job creation
- [ ] EventBus: `dispatch.job.*` events + catalog entries

### Phase 2 — Carrier Integration (Week 3–4)
- [ ] `CarrierAdapter` abstract interface
- [ ] Own-fleet adapter (no external API)
- [ ] Webhook receiver Edge Function for carrier status push
- [ ] Tracking event normalization + timeline append
- [ ] `TrackingCenter.jsx`: all-shipments live board
- [ ] `PublicTracking.jsx`: customer-facing tracking page

### Phase 3 — Fleet & Routes (Week 5–6)
- [ ] Driver + vehicle DB + UI (`FleetManagement.jsx`)
- [ ] Driver availability calendar
- [ ] `routeOptimizer.js`: nearest-neighbor TSP clustering
- [ ] `DispatchRoutes.jsx`: route builder + drag-to-reorder stops
- [ ] Driver PWA: route view + GPS reporting + POD capture
- [ ] Live route map in `RouteDetail.jsx`

### Phase 4 — Warehouse Pick-Pack-Ship (Week 7–8)
- [ ] Pick list auto-generation on dispatch batch confirm
- [ ] `PickListManager.jsx`: picker assignment + scan-to-confirm
- [ ] `PackStation.jsx`: verification scan + weight / dim capture
- [ ] `DockManagement.jsx`: dock queue + carrier handoff + manifest PDF
- [ ] Short-pick alert → EventBus → purchase module

### Phase 5 — Scheduling & Calendar (Week 9–10)
- [ ] `DispatchCalendar.jsx`: day/week calendar with carrier pickups + routes
- [ ] Cut-off time rules per carrier (config in `carrier_configs`)
- [ ] Dock door scheduling
- [ ] Batch end-of-day reconciliation report
- [ ] `slaMonitor.js` cron + escalation notifications

### Phase 6 — Analytics (Week 11–12)
- [ ] `DispatchAnalytics.jsx`: KPI dashboard
- [ ] Carrier scoreboard
- [ ] Driver performance report
- [ ] SLA breach trend chart
- [ ] Cost-per-delivery breakdown
- [ ] Zone heatmap (Leaflet.js)

---

## Open Questions

1. **Own fleet vs. 3PL only?** — If own fleet is primary, Phase 3 becomes critical path
2. **Which carrier APIs first?** — Prioritize by current shipping volume
3. **CVS pickup flow** — Customer receives barcode via LINE or SMS?
4. **GPS tracking consent** — Driver location tracking requires staff consent documentation
5. **Label printing hardware** — Thermal printer brand? (Affects ZPL vs. PDF format)
6. **Return logistics** — Include reverse logistics (customer → warehouse) in scope?
7. **COD (Cash on Delivery)** — Driver collects payment on delivery? Needs finance integration
8. **International shipping** — Local TW only, or cross-border (CN/HK/SEA)?
