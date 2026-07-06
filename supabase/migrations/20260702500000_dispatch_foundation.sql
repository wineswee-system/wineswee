-- Dispatch Service Foundation
-- Modules: smart routing, fleet/driver, scheduling, tracking, WMS pick-pack-ship
--
-- NOTE (2026-07-02 correction): base tables use integer (SERIAL) PKs, so FKs to
-- organizations/carrier_configs/employees/outbound_orders/shipments are `int`,
-- not uuid. RLS policies filter on employees.auth_user_id (the real auth column;
-- `auth_id` does not exist). The prior uuid/auth_id version could not apply —
-- Postgres validates FK types and policy columns at CREATE time.
-- Own dispatch_* PKs are uuid (gen_random_uuid); FKs between dispatch's own
-- tables stay uuid.

-- ── Vehicles ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id int REFERENCES organizations(id) ON DELETE CASCADE,
  plate_number text NOT NULL,
  type text NOT NULL CHECK (type IN ('van','truck','motorcycle','bicycle','other')),
  max_weight_kg numeric DEFAULT 0,
  max_volume_m3 numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','retired')),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ── Driver profiles ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_driver_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id int REFERENCES employees(id) ON DELETE CASCADE UNIQUE,
  license_type text,
  zones_covered text[] DEFAULT '{}',
  max_deliveries_per_day integer DEFAULT 30,
  vehicle_id uuid REFERENCES dispatch_vehicles(id) ON DELETE SET NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- ── Driver availability ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_driver_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid REFERENCES dispatch_driver_profiles(id) ON DELETE CASCADE,
  date date NOT NULL,
  available_from time,
  available_until time,
  is_available boolean DEFAULT true,
  reason text,
  UNIQUE(driver_id, date)
);

-- ── Routing rules ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id int REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  priority integer DEFAULT 0,
  conditions jsonb NOT NULL DEFAULT '{}',
  action jsonb NOT NULL DEFAULT '{}',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- ── Route plans (own fleet) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id int REFERENCES organizations(id) ON DELETE CASCADE,
  route_number text UNIQUE NOT NULL,
  driver_id uuid REFERENCES dispatch_driver_profiles(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES dispatch_vehicles(id) ON DELETE SET NULL,
  date date NOT NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','completed','cancelled')),
  stops jsonb NOT NULL DEFAULT '[]',
  total_distance_km numeric,
  estimated_duration_minutes integer,
  actual_start timestamptz,
  actual_end timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ── Carrier configs (base table + dispatch extension) ─────────────────────────
-- Not created by any prior migration (only lived in the archived schema, with a
-- different shape). Create the shape the dispatch/WMS code actually queries:
-- carrier_configs(name) and .eq('organization_id', ...).
CREATE TABLE IF NOT EXISTS carrier_configs (
  id serial PRIMARY KEY,
  organization_id int REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  carrier_type text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE carrier_configs ADD COLUMN IF NOT EXISTS adapter_type text DEFAULT 'manual';
ALTER TABLE carrier_configs ADD COLUMN IF NOT EXISTS api_credentials jsonb DEFAULT '{}';
ALTER TABLE carrier_configs ADD COLUMN IF NOT EXISTS webhook_secret text;
ALTER TABLE carrier_configs ADD COLUMN IF NOT EXISTS service_levels jsonb DEFAULT '[]';
ALTER TABLE carrier_configs ADD COLUMN IF NOT EXISTS supported_zones text[] DEFAULT '{}';
ALTER TABLE carrier_configs ADD COLUMN IF NOT EXISTS cutoff_time time;
ALTER TABLE carrier_configs ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- carrier_configs holds api_credentials (carrier API keys) — org-scope reads/writes.
ALTER TABLE carrier_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "carrier_configs_org" ON carrier_configs;
CREATE POLICY "carrier_configs_org" ON carrier_configs FOR ALL TO authenticated
  USING (organization_id IN (SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()));

-- ── Dispatch jobs (core workflow entity) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id int REFERENCES organizations(id) ON DELETE CASCADE,
  shipment_id int REFERENCES shipments(id) ON DELETE SET NULL,
  outbound_order_id int REFERENCES outbound_orders(id) ON DELETE SET NULL,
  job_number text UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued','assigned','label_printed','picked_up',
    'in_transit','out_for_delivery','delivered','failed','exception','closed'
  )),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent','high','normal','low')),
  carrier_id int REFERENCES carrier_configs(id) ON DELETE SET NULL,
  route_id uuid REFERENCES dispatch_routes(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES dispatch_driver_profiles(id) ON DELETE SET NULL,
  carrier_label_url text,
  tracking_number text,
  sla_deadline timestamptz,
  sla_status text NOT NULL DEFAULT 'on_track' CHECK (sla_status IN ('on_track','at_risk','breached')),
  assigned_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  failed_attempts integer DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ── Dispatch schedules (carrier pickup slots / dock bookings) ─────────────────
CREATE TABLE IF NOT EXISTS dispatch_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id int REFERENCES organizations(id) ON DELETE CASCADE,
  date date NOT NULL,
  carrier_id int REFERENCES carrier_configs(id) ON DELETE SET NULL,
  pickup_time_from time,
  pickup_time_until time,
  dock_door text,
  expected_parcel_count integer DEFAULT 0,
  actual_parcel_count integer DEFAULT 0,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','confirmed','completed','cancelled')),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ── SLA events ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_sla_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES dispatch_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('at_risk','breached','resolved','escalated')),
  triggered_at timestamptz DEFAULT now(),
  notified_to text[] DEFAULT '{}',
  notes text
);

-- ── Tracking events (immutable append-only timeline) ─────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_tracking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES dispatch_jobs(id) ON DELETE CASCADE,
  shipment_id int REFERENCES shipments(id) ON DELETE SET NULL,
  event_code text NOT NULL,
  carrier_raw_code text,
  description text,
  location text,
  lat numeric,
  lng numeric,
  actor text NOT NULL DEFAULT 'system' CHECK (actor IN ('carrier_webhook','driver_app','manual','system')),
  actor_id uuid,
  created_at timestamptz DEFAULT now()
);

-- ── Driver GPS breadcrumbs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_driver_locations (
  id bigserial PRIMARY KEY,
  route_id uuid REFERENCES dispatch_routes(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES dispatch_driver_profiles(id) ON DELETE CASCADE,
  lat numeric NOT NULL,
  lng numeric NOT NULL,
  speed_kmh numeric,
  recorded_at timestamptz DEFAULT now()
);

-- ── Proof of delivery ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatch_proof_of_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES dispatch_jobs(id) ON DELETE CASCADE UNIQUE,
  recipient_name text,
  recipient_signature_url text,
  photo_urls text[] DEFAULT '{}',
  notes text,
  captured_at timestamptz DEFAULT now(),
  captured_by int REFERENCES employees(id) ON DELETE SET NULL
);

-- ── WMS: Pick lists ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wms_pick_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id int REFERENCES organizations(id) ON DELETE CASCADE,
  list_number text UNIQUE NOT NULL,
  dispatch_batch_id text,
  picker_id int REFERENCES employees(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','short_picked')),
  items jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- ── WMS: Pack records ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wms_pack_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES dispatch_jobs(id) ON DELETE CASCADE,
  pick_list_id uuid REFERENCES wms_pick_lists(id) ON DELETE SET NULL,
  packer_id int REFERENCES employees(id) ON DELETE SET NULL,
  box_count integer DEFAULT 1,
  total_weight_kg numeric,
  dimensions jsonb DEFAULT '{}',
  packed_at timestamptz DEFAULT now()
);

-- ── WMS: Dock handoffs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wms_dock_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid REFERENCES dispatch_schedules(id) ON DELETE SET NULL,
  carrier_id int REFERENCES carrier_configs(id) ON DELETE SET NULL,
  handoff_at timestamptz DEFAULT now(),
  parcels jsonb NOT NULL DEFAULT '[]',
  manifest_url text,
  carrier_agent_name text,
  carrier_sign_off boolean DEFAULT false
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_org_status ON dispatch_jobs(org_id, status);
CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_sla ON dispatch_jobs(sla_deadline) WHERE sla_status != 'breached';
CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_tracking ON dispatch_jobs(tracking_number);
CREATE INDEX IF NOT EXISTS idx_dispatch_tracking_events_job ON dispatch_tracking_events(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_driver_locations_route ON dispatch_driver_locations(route_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_routes_date ON dispatch_routes(org_id, date);
CREATE INDEX IF NOT EXISTS idx_wms_pick_lists_status ON wms_pick_lists(org_id, status);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE dispatch_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_driver_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_driver_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_routing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_sla_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_driver_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_proof_of_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE wms_pick_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE wms_pack_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE wms_dock_handoffs ENABLE ROW LEVEL SECURITY;

-- Org membership of the caller (auth_user_id is the real auth column).
CREATE POLICY "dispatch_vehicles_org" ON dispatch_vehicles FOR ALL TO authenticated
  USING (org_id IN (SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "dispatch_driver_profiles_org" ON dispatch_driver_profiles FOR ALL TO authenticated
  USING (employee_id IN (
    SELECT id FROM employees WHERE organization_id IN (
      SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
    )
  ));

CREATE POLICY "dispatch_driver_availability_org" ON dispatch_driver_availability FOR ALL TO authenticated
  USING (driver_id IN (
    SELECT dp.id FROM dispatch_driver_profiles dp
    JOIN employees e ON e.id = dp.employee_id
    WHERE e.organization_id IN (SELECT organization_id FROM employees WHERE auth_user_id = auth.uid())
  ));

CREATE POLICY "dispatch_routing_rules_org" ON dispatch_routing_rules FOR ALL TO authenticated
  USING (org_id IN (SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "dispatch_routes_org" ON dispatch_routes FOR ALL TO authenticated
  USING (org_id IN (SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "dispatch_jobs_org" ON dispatch_jobs FOR ALL TO authenticated
  USING (org_id IN (SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "dispatch_schedules_org" ON dispatch_schedules FOR ALL TO authenticated
  USING (org_id IN (SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "dispatch_sla_events_org" ON dispatch_sla_events FOR ALL TO authenticated
  USING (job_id IN (SELECT id FROM dispatch_jobs WHERE org_id IN (
    SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
  )));

-- Tracking events: org-scoped read + write for authenticated users.
-- Public tracking page uses get_public_tracking(tracking_number) below,
-- NOT a blanket anon SELECT (which leaked every org's events by job enumeration).
CREATE POLICY "dispatch_tracking_events_read" ON dispatch_tracking_events FOR SELECT TO authenticated
  USING (job_id IN (SELECT id FROM dispatch_jobs WHERE org_id IN (
    SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
  )));
CREATE POLICY "dispatch_tracking_events_write" ON dispatch_tracking_events FOR INSERT TO authenticated
  WITH CHECK (job_id IN (SELECT id FROM dispatch_jobs WHERE org_id IN (
    SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
  )));

CREATE POLICY "dispatch_driver_locations_org" ON dispatch_driver_locations FOR ALL TO authenticated
  USING (route_id IN (SELECT id FROM dispatch_routes WHERE org_id IN (
    SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
  )));

CREATE POLICY "dispatch_pod_org" ON dispatch_proof_of_delivery FOR ALL TO authenticated
  USING (job_id IN (SELECT id FROM dispatch_jobs WHERE org_id IN (
    SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
  )));

CREATE POLICY "wms_pick_lists_org" ON wms_pick_lists FOR ALL TO authenticated
  USING (org_id IN (SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "wms_pack_records_org" ON wms_pack_records FOR ALL TO authenticated
  USING (job_id IN (SELECT id FROM dispatch_jobs WHERE org_id IN (
    SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
  )));

-- Dock handoffs: scope to the caller's org via the linked schedule's org
-- (was USING(true) — any authenticated user across all orgs could read/write manifests).
CREATE POLICY "wms_dock_handoffs_org" ON wms_dock_handoffs FOR ALL TO authenticated
  USING (schedule_id IN (SELECT id FROM dispatch_schedules WHERE org_id IN (
    SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
  )));

-- ── Public tracking RPC (replaces the anon blanket SELECT) ───────────────────
-- Returns only the events for one tracking number; nothing enumerable cross-org.
CREATE OR REPLACE FUNCTION public.get_public_tracking(p_tracking_number text)
RETURNS TABLE (event_code text, description text, location text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT te.event_code, te.description, te.location, te.created_at
  FROM dispatch_tracking_events te
  JOIN dispatch_jobs j ON j.id = te.job_id
  WHERE j.tracking_number = p_tracking_number
  ORDER BY te.created_at ASC
$$;
REVOKE ALL ON FUNCTION public.get_public_tracking(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_tracking(text) TO anon, authenticated;

-- ── Triggers: auto updated_at ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION dispatch_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER dispatch_jobs_updated_at
  BEFORE UPDATE ON dispatch_jobs FOR EACH ROW EXECUTE FUNCTION dispatch_set_updated_at();

CREATE TRIGGER dispatch_routes_updated_at
  BEFORE UPDATE ON dispatch_routes FOR EACH ROW EXECUTE FUNCTION dispatch_set_updated_at();
