-- ════════════════════════════════════════════════════════════════════════════
-- Reservation module tables
-- Idempotent: safe to re-run
-- ════════════════════════════════════════════════════════════════════════════

-- ── reservation_rules ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reservation_rules (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id              UUID         NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  day_of_week           SMALLINT     CHECK (day_of_week BETWEEN 0 AND 6),
  date_override         DATE,
  open_time             TIME         NOT NULL DEFAULT '10:00',
  close_time            TIME         NOT NULL DEFAULT '22:00',
  slot_interval_minutes INT          NOT NULL DEFAULT 60,
  buffer_minutes        INT          NOT NULL DEFAULT 30,
  end_buffer_minutes    INT          NOT NULL DEFAULT 30,
  min_booking_hours     INT          NOT NULL DEFAULT 1,
  max_booking_hours     INT          NOT NULL DEFAULT 3,
  min_notice_minutes    INT          NOT NULL DEFAULT 60,
  max_advance_days      INT          NOT NULL DEFAULT 14,
  max_party_size        INT          NOT NULL DEFAULT 10,
  is_closed             BOOLEAN      NOT NULL DEFAULT FALSE,
  label                 TEXT,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reservation_rules_store ON reservation_rules(store_id);
CREATE INDEX IF NOT EXISTS idx_reservation_rules_org   ON reservation_rules(organization_id);

-- ── res_tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS res_tables (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id        UUID        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  table_number    TEXT        NOT NULL,
  capacity        INT         NOT NULL DEFAULT 4,
  shape           TEXT        NOT NULL DEFAULT 'rect' CHECK (shape IN ('rect','round','booth')),
  x_pos           INT         NOT NULL DEFAULT 0,
  y_pos           INT         NOT NULL DEFAULT 0,
  is_combinable   BOOLEAN     NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_res_tables_store ON res_tables(store_id);
CREATE INDEX IF NOT EXISTS idx_res_tables_org   ON res_tables(organization_id);

-- ── table_combinations ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS table_combinations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id          UUID        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name              TEXT        NOT NULL,
  table_ids         JSONB       NOT NULL DEFAULT '[]',
  combined_capacity INT         NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_table_combinations_store ON table_combinations(store_id);

-- ── reservations ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reservations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id          UUID        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  guest_name        TEXT        NOT NULL,
  guest_phone       TEXT        NOT NULL,
  guest_email       TEXT,
  guest_count       INT         NOT NULL,
  reserved_date     DATE        NOT NULL,
  slot_time         TIME        NOT NULL,
  duration_hours    INT         NOT NULL DEFAULT 1,
  extended_hours    INT         NOT NULL DEFAULT 0,
  status            TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','confirmed','seated','completed','cancelled','no_show')),
  table_id          UUID        REFERENCES res_tables(id) ON DELETE SET NULL,
  combination_id    UUID        REFERENCES table_combinations(id) ON DELETE SET NULL,
  original_table_id UUID        REFERENCES res_tables(id) ON DELETE SET NULL,
  source            TEXT        NOT NULL DEFAULT 'web'
                                CHECK (source IN ('web','walk_in','phone','pos')),
  notes             TEXT,
  special_requests  TEXT,
  confirmation_code TEXT        NOT NULL DEFAULT substring(gen_random_uuid()::TEXT FROM 1 FOR 8),
  checked_in_at     TIMESTAMPTZ,
  confirmed_at      TIMESTAMPTZ,
  seated_at         TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        INT         REFERENCES employees(id) ON DELETE SET NULL  -- INT, employees.id is SERIAL
);
CREATE INDEX IF NOT EXISTS idx_reservations_store  ON reservations(store_id);
CREATE INDEX IF NOT EXISTS idx_reservations_org    ON reservations(organization_id);
CREATE INDEX IF NOT EXISTS idx_reservations_date   ON reservations(reserved_date);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_code   ON reservations(confirmation_code);
CREATE INDEX IF NOT EXISTS idx_reservations_phone  ON reservations(guest_phone);

-- ── reservation_changelogs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reservation_changelogs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID        NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  employee_id    INT         REFERENCES employees(id) ON DELETE SET NULL,  -- INT, not UUID
  action         TEXT        NOT NULL,
  changes        JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_res_changelog_rsv ON reservation_changelogs(reservation_id, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE reservation_rules       ENABLE ROW LEVEL SECURITY;
ALTER TABLE res_tables              ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_combinations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_changelogs  ENABLE ROW LEVEL SECURITY;

-- Drop then recreate (idempotent)
DROP POLICY IF EXISTS "org members manage reservation_rules"    ON reservation_rules;
DROP POLICY IF EXISTS "org members manage res_tables"           ON res_tables;
DROP POLICY IF EXISTS "org members manage table_combinations"   ON table_combinations;
DROP POLICY IF EXISTS "org members manage reservations"         ON reservations;
DROP POLICY IF EXISTS "anon create reservations"                ON reservations;
DROP POLICY IF EXISTS "anon view reservations"                  ON reservations;
DROP POLICY IF EXISTS "anon cancel reservation"                 ON reservations;
DROP POLICY IF EXISTS "anon read res_tables"                    ON res_tables;
DROP POLICY IF EXISTS "anon read reservation_rules"             ON reservation_rules;
DROP POLICY IF EXISTS "org members read changelogs"             ON reservation_changelogs;
DROP POLICY IF EXISTS "authenticated insert changelogs"         ON reservation_changelogs;

-- Staff policies
CREATE POLICY "org members manage reservation_rules" ON reservation_rules
  FOR ALL TO authenticated
  USING (organization_id IN (SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "org members manage res_tables" ON res_tables
  FOR ALL TO authenticated
  USING (organization_id IN (SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "org members manage table_combinations" ON table_combinations
  FOR ALL TO authenticated
  USING (organization_id IN (SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "org members manage reservations" ON reservations
  FOR ALL TO authenticated
  USING (organization_id IN (SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()));

-- Anon guest (public booking app) — 客人訂位不需登入
CREATE POLICY "anon create reservations" ON reservations
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon view reservations" ON reservations
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon cancel reservation" ON reservations
  FOR UPDATE TO anon USING (true) WITH CHECK (status = 'cancelled');

CREATE POLICY "anon read res_tables" ON res_tables
  FOR SELECT TO anon USING (is_active = true);

CREATE POLICY "anon read reservation_rules" ON reservation_rules
  FOR SELECT TO anon USING (true);

CREATE POLICY "org members read changelogs" ON reservation_changelogs
  FOR SELECT TO authenticated
  USING (
    reservation_id IN (
      SELECT id FROM reservations WHERE store_id IN (
        SELECT store_id FROM employees WHERE auth_user_id = auth.uid()
      )
    )
  );

CREATE POLICY "authenticated insert changelogs" ON reservation_changelogs
  FOR INSERT TO authenticated WITH CHECK (true);

-- ── Availability RPC ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_available_slots(
  p_store_id       UUID,
  p_date           DATE,
  p_party_size     INT,
  p_duration_hours INT
)
RETURNS TABLE (slot_time TIME, available_table_count INT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_rule        reservation_rules%ROWTYPE;
  v_dow         SMALLINT;
  v_slot        TIME;
  v_slot_end    TIME;
  v_last_allow  TIME;
  v_available   INT;
BEGIN
  v_dow := EXTRACT(DOW FROM p_date)::SMALLINT;
  SELECT * INTO v_rule FROM reservation_rules r
  WHERE r.store_id = p_store_id
  ORDER BY CASE
    WHEN r.date_override = p_date                             THEN 0
    WHEN r.day_of_week = v_dow AND r.date_override IS NULL    THEN 1
    WHEN r.day_of_week IS NULL  AND r.date_override IS NULL   THEN 2
    ELSE 99
  END LIMIT 1;

  IF v_rule IS NULL OR v_rule.is_closed THEN RETURN; END IF;
  IF p_party_size < 1 OR p_party_size > v_rule.max_party_size THEN RETURN; END IF;
  IF p_duration_hours < v_rule.min_booking_hours OR p_duration_hours > v_rule.max_booking_hours THEN RETURN; END IF;

  v_last_allow := v_rule.close_time - make_interval(mins => p_duration_hours * 60 + v_rule.end_buffer_minutes);
  v_slot := v_rule.open_time;

  WHILE v_slot <= v_last_allow LOOP
    v_slot_end := v_slot + make_interval(mins => p_duration_hours * 60);
    SELECT COUNT(*) INTO v_available
    FROM res_tables t
    WHERE t.store_id = p_store_id AND t.is_active = TRUE AND t.capacity >= p_party_size
      AND NOT EXISTS (
        SELECT 1 FROM reservations r2
        WHERE r2.table_id      = t.id
          AND r2.reserved_date = p_date
          AND r2.status        NOT IN ('cancelled','no_show','completed')
          AND r2.slot_time < (v_slot_end + make_interval(mins => v_rule.buffer_minutes))
          AND (r2.slot_time + make_interval(mins => (r2.duration_hours + r2.extended_hours) * 60)) > v_slot
      );
    IF v_available > 0 THEN
      slot_time             := v_slot;
      available_table_count := v_available;
      RETURN NEXT;
    END IF;
    v_slot := v_slot + make_interval(mins => v_rule.slot_interval_minutes);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION get_available_slots TO anon, authenticated;
