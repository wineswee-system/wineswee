-- Migration: list_templates and form_templates
-- Created: 2026-06-23
-- NOTE: Timestamp shifted to 110000 — 100000 is already taken by
--       20260623100000_salary_button_permissions.sql

-- ============================================================
-- 1. list_templates
-- ============================================================
CREATE TABLE IF NOT EXISTS list_templates (
  id               bigint generated always as identity primary key,
  organization_id  bigint references organizations(id) on delete cascade,
  name             text not null,
  category         text,
  description      text,
  status           text not null default 'published'
                     check (status in ('draft', 'published', 'archived')),
  tags             text[] default '{}',
  columns          jsonb default '[]',   -- [{key, label, type:'text'|'select'|'number'|'date', options:[]}]
  default_rows     jsonb default '[]',   -- [{col_key: value, ...}]
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

ALTER TABLE list_templates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'list_templates'
      AND policyname = 'list_templates_org_access'
  ) THEN
    CREATE POLICY list_templates_org_access ON list_templates
      FOR ALL
      TO authenticated
      USING (org_visible(organization_id))
      WITH CHECK (true);
  END IF;
END;
$$;

-- updated_at trigger for list_templates (moddatetime preferred; fallback to _set_updated_at)
DO $$
BEGIN
  CREATE TRIGGER set_list_templates_updated_at
    BEFORE UPDATE ON list_templates
    FOR EACH ROW
    EXECUTE FUNCTION moddatetime(updated_at);
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN duplicate_object   THEN NULL;
END;
$$;

-- Ensure the generic fallback trigger function exists
CREATE OR REPLACE FUNCTION _set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname    = 'set_list_templates_updated_at'
      AND tgrelid   = 'list_templates'::regclass
  ) THEN
    CREATE TRIGGER set_list_templates_updated_at
      BEFORE UPDATE ON list_templates
      FOR EACH ROW
      EXECUTE FUNCTION _set_updated_at();
  END IF;
END;
$$;

-- ============================================================
-- 2. form_templates
-- ============================================================
CREATE TABLE IF NOT EXISTS form_templates (
  id                  bigint generated always as identity primary key,
  organization_id     bigint references organizations(id) on delete cascade,
  name                text not null,
  category            text,
  description         text,
  status              text not null default 'published'
                        check (status in ('draft', 'published', 'archived')),
  tags                text[] default '{}',
  fields              jsonb default '[]',  -- [{key, label, type:'text'|'textarea'|'number'|'date'|'select'|'file', required:bool, options:[]}]
  after_submit_action text,               -- 'approval' | 'notify' | null
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

ALTER TABLE form_templates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'form_templates'
      AND policyname = 'form_templates_org_access'
  ) THEN
    CREATE POLICY form_templates_org_access ON form_templates
      FOR ALL
      TO authenticated
      USING (org_visible(organization_id))
      WITH CHECK (true);
  END IF;
END;
$$;

-- updated_at trigger for form_templates
DO $$
BEGIN
  CREATE TRIGGER set_form_templates_updated_at
    BEFORE UPDATE ON form_templates
    FOR EACH ROW
    EXECUTE FUNCTION moddatetime(updated_at);
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN duplicate_object   THEN NULL;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname    = 'set_form_templates_updated_at'
      AND tgrelid   = 'form_templates'::regclass
  ) THEN
    CREATE TRIGGER set_form_templates_updated_at
      BEFORE UPDATE ON form_templates
      FOR EACH ROW
      EXECUTE FUNCTION _set_updated_at();
  END IF;
END;
$$;
