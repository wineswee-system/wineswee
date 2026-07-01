-- ════════════════════════════════════════════════════════════════════════════
-- Communications Suite — Phase 1 Schema
--
-- Creates all tables for: Email, Calendar, Booking Links, Contacts,
-- AI Skills, Notification Dispatcher, and shared Audit Log.
--
-- Design notes:
--   • organization_id INT references organizations(id) — consistent with post-tenants schema
--   • employees.id / departments.id / organizations.id are INT (serial PK)
--   • email_threads.first_message_id / last_message_id are plain UUID columns (no FK)
--     to avoid circular dependency with email_messages
--   • calendar_event_attendees uses surrogate UUID PK + unique constraints
--   • holidays table NOT created here — it already exists (init schema) and is
--     populated by the refresh-holidays edge function; the calendar holiday
--     overlay reads that table directly
--   • tsvector uses 'simple' config — UI/data is zh-TW; 'english' stemming
--     breaks CJK tokens. Trigram indexes cover fuzzy name search
--   • RLS: basic org-scoped policies; hardened policies added in Phase 15 migration
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Trigram fuzzy search (contacts name search, subject search)
create extension if not exists pg_trgm;

-- ─────────────────────────────────────────────────────────
-- SHARED MAILBOXES (must precede email_accounts)
-- ─────────────────────────────────────────────────────────

create table email_mailboxes (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     int not null references organizations(id),
  address             text not null,
  display_name        text not null,
  default_assignee_id int references employees(id),
  sla_hours           int default 24,
  created_at          timestamptz default now()
);

create index email_mailboxes_org_idx on email_mailboxes(organization_id);

create table email_mailbox_members (
  mailbox_id  uuid not null references email_mailboxes(id) on delete cascade,
  employee_id int  not null references employees(id),
  role        text not null check (role in ('read','reply','admin')),
  primary key (mailbox_id, employee_id)
);

-- ─────────────────────────────────────────────────────────
-- ACCOUNT CONNECTIONS
-- ─────────────────────────────────────────────────────────

create table email_accounts (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       int  not null references organizations(id),
  employee_id           int  references employees(id),
  mailbox_id            uuid references email_mailboxes(id),
  provider              text not null check (provider in ('gmail','outlook','icloud','generic')),
  email_address         text not null,
  display_name          text,
  credentials_encrypted jsonb not null default '{}',
  imap_host             text,
  imap_port             int,
  smtp_host             text,
  smtp_port             int,
  sync_interval_minutes int default 15,
  last_synced_at        timestamptz,
  sync_error            text,
  is_active             boolean default true,
  created_at            timestamptz default now()
);

create index email_accounts_org_idx      on email_accounts(organization_id);
create index email_accounts_employee_idx on email_accounts(employee_id);

-- ─────────────────────────────────────────────────────────
-- FOLDERS
-- ─────────────────────────────────────────────────────────

create table email_folders (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references email_accounts(id) on delete cascade,
  organization_id  int  not null references organizations(id),
  name             text not null,
  folder_type      text not null check (folder_type in ('inbox','sent','drafts','trash','archive','spam','custom')),
  imap_path        text not null,
  parent_folder_id uuid references email_folders(id),
  display_order    int  default 0,
  color            text,
  icon             text,
  is_system        boolean default false,
  unread_count     int default 0,
  total_count      int default 0
);

create index email_folders_account_idx on email_folders(account_id);
create index email_folders_org_idx     on email_folders(organization_id);

-- ─────────────────────────────────────────────────────────
-- THREADS
-- Note: first_message_id / last_message_id are plain UUIDs (no FK —
-- circular dependency with email_messages resolved at app layer)
-- ─────────────────────────────────────────────────────────

create table email_threads (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         int  not null references organizations(id),
  account_id              uuid not null references email_accounts(id),
  mailbox_id              uuid references email_mailboxes(id),
  subject_normalized      text,
  first_message_id        uuid,
  last_message_id         uuid,
  last_activity_at        timestamptz,
  message_count           int default 0,
  unread_count            int default 0,
  participant_addresses   jsonb,
  thread_status           text default 'open' check (thread_status in ('open','assigned','waiting','resolved')),
  assigned_to_employee_id int references employees(id),
  sla_due_at              timestamptz,
  created_at              timestamptz default now()
);

create index email_threads_org_idx      on email_threads(organization_id);
create index email_threads_account_idx  on email_threads(account_id);
create index email_threads_mailbox_idx  on email_threads(mailbox_id);
create index email_threads_status_idx   on email_threads(thread_status);
create index email_threads_activity_idx on email_threads(last_activity_at desc);

-- ─────────────────────────────────────────────────────────
-- MESSAGES
-- ─────────────────────────────────────────────────────────

create table email_messages (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         int  not null references organizations(id),
  account_id              uuid not null references email_accounts(id),
  mailbox_id              uuid references email_mailboxes(id),
  thread_id               uuid references email_threads(id) on delete cascade,
  folder_id               uuid references email_folders(id),
  imap_uid                bigint,
  -- unique per account, not globally: the same message delivered to two
  -- connected accounts must not collide
  message_id_header       text,
  in_reply_to_header      text,
  -- flags
  is_read                 boolean default false,
  is_starred              boolean default false,
  is_flagged              boolean default false,
  is_important            boolean default false,
  is_draft                boolean default false,
  is_sent                 boolean default false,
  is_deleted              boolean default false,
  is_spam                 boolean default false,
  snoozed_until           timestamptz,
  -- addressing
  from_address            text not null,
  from_name               text,
  to_addresses            jsonb,
  cc_addresses            jsonb,
  bcc_addresses           jsonb,
  reply_to_address        text,
  -- content
  subject                 text,
  body_html_storage_path  text,
  body_text_cache         text,
  raw_headers             jsonb,
  -- identity (staff who sent via shared mailbox)
  sent_by_employee_id     int references employees(id),
  -- dates
  received_at             timestamptz,
  sent_at                 timestamptz,
  draft_saved_at          timestamptz,
  -- metadata
  has_attachments         boolean default false,
  attachment_count        int default 0,
  size_bytes              bigint,
  -- delivery
  delivery_status         text check (delivery_status in ('delivered','bounced','pending')),
  read_receipt_at         timestamptz,
  -- full-text search ('simple' config: zh-TW content, no english stemming)
  body_search_vector      tsvector generated always as (
    to_tsvector('simple',
      coalesce(subject, '') || ' ' || coalesce(body_text_cache, ''))
  ) stored
);

create unique index email_messages_acct_msgid_uidx
  on email_messages(account_id, message_id_header)
  where message_id_header is not null;
create index email_messages_search_idx  on email_messages using gin(body_search_vector);
create index email_messages_subject_trgm on email_messages using gin(subject gin_trgm_ops);
create index email_messages_thread_idx  on email_messages(thread_id);
create index email_messages_folder_idx  on email_messages(folder_id);
create index email_messages_org_idx     on email_messages(organization_id);
create index email_messages_recv_idx    on email_messages(received_at desc);

-- ─────────────────────────────────────────────────────────
-- DRAFTS
-- ─────────────────────────────────────────────────────────

create table email_drafts (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       int  not null references organizations(id),
  account_id            uuid not null references email_accounts(id),
  employee_id           int  not null references employees(id),
  mailbox_id            uuid references email_mailboxes(id),
  in_reply_to_thread_id uuid references email_threads(id),
  to_addresses          jsonb,
  cc_addresses          jsonb,
  bcc_addresses         jsonb,
  subject               text,
  body_html             text,
  body_text             text,
  attachments_staged    jsonb,
  imap_draft_uid        bigint,
  last_saved_at         timestamptz default now(),
  session_token         text,
  is_discarded          boolean default false,
  created_at            timestamptz default now()
);

create index email_drafts_org_idx      on email_drafts(organization_id);
create index email_drafts_employee_idx on email_drafts(employee_id);

-- ─────────────────────────────────────────────────────────
-- ATTACHMENTS
-- ─────────────────────────────────────────────────────────

create table email_attachments (
  id              uuid primary key default gen_random_uuid(),
  organization_id int  not null references organizations(id),
  message_id      uuid references email_messages(id) on delete cascade,
  filename        text not null,
  content_type    text,
  size_bytes      bigint,
  storage_path    text not null,
  sha256_hash     text,
  is_inline       boolean default false,
  erp_entity_type text,
  erp_entity_id   int,
  created_at      timestamptz default now()
);

create index email_attachments_message_idx on email_attachments(message_id);
create index email_attachments_hash_idx    on email_attachments(sha256_hash) where sha256_hash is not null;

-- ─────────────────────────────────────────────────────────
-- LABELS
-- ─────────────────────────────────────────────────────────

create table email_labels (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      int  not null references organizations(id),
  name                 text not null,
  color                text,
  icon                 text,
  label_type           text not null check (label_type in ('system','smart','custom')),
  scope                text not null check (scope in ('personal','dept','org')),
  owner_id             int  references employees(id),
  department_id        int  references departments(id),
  smart_label_prompt   text,
  confidence_threshold numeric default 0.85,
  created_at           timestamptz default now()
);

create index email_labels_org_idx on email_labels(organization_id);

create table email_thread_labels (
  thread_id  uuid not null references email_threads(id) on delete cascade,
  label_id   uuid not null references email_labels(id)  on delete cascade,
  applied_by int  references employees(id),
  applied_at timestamptz default now(),
  source     text check (source in ('manual','ai','rule')),
  primary key (thread_id, label_id)
);

-- ─────────────────────────────────────────────────────────
-- CATEGORIES
-- ─────────────────────────────────────────────────────────

create table email_categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id int  not null references organizations(id),
  name            text not null,
  color           text,
  icon            text,
  description     text,
  display_order   int  default 0
);

create index email_categories_org_idx on email_categories(organization_id);

create table email_thread_categories (
  thread_id   uuid not null references email_threads(id) on delete cascade primary key,
  category_id uuid not null references email_categories(id) on delete cascade,
  set_by      int  references employees(id),
  set_at      timestamptz default now()
);

-- ─────────────────────────────────────────────────────────
-- LABEL RULES
-- ─────────────────────────────────────────────────────────

create table email_label_rules (
  id              uuid primary key default gen_random_uuid(),
  organization_id int  not null references organizations(id),
  name            text not null,
  priority        int  default 10,
  is_active       boolean default true,
  conditions      jsonb not null,
  actions         jsonb not null,
  created_by      int  references employees(id),
  created_at      timestamptz default now()
);

create index email_label_rules_org_idx on email_label_rules(organization_id);

-- ─────────────────────────────────────────────────────────
-- EMAIL → ERP LINKS
-- ─────────────────────────────────────────────────────────

create table email_entity_links (
  id              uuid primary key default gen_random_uuid(),
  organization_id int  not null references organizations(id),
  thread_id       uuid not null references email_threads(id) on delete cascade,
  entity_type     text not null,
  entity_id       int  not null,
  linked_by       int  references employees(id),
  linked_at       timestamptz default now()
);

create index email_entity_links_thread_idx on email_entity_links(thread_id);
create index email_entity_links_entity_idx on email_entity_links(entity_type, entity_id);

-- ─────────────────────────────────────────────────────────
-- AI SKILLS
-- ─────────────────────────────────────────────────────────

create table email_skills (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    int  not null references organizations(id),
  name               text not null,
  description        text,
  version            int  default 1,
  trigger_source     text check (trigger_source in ('email','calendar','contact')),
  trigger_conditions jsonb not null default '[]',
  prompt_template    text not null,
  actions            jsonb not null default '[]',
  human_in_loop      boolean default false,
  is_active          boolean default false,
  approved_by        int  references employees(id),
  approved_at        timestamptz,
  created_by         int  references employees(id),
  created_at         timestamptz default now()
);

create index email_skills_org_idx on email_skills(organization_id);

create table email_skill_runs (
  id              uuid primary key default gen_random_uuid(),
  skill_id        uuid not null references email_skills(id),
  thread_id       uuid references email_threads(id),
  status          text check (status in ('pending_approval','running','completed','failed','rejected')),
  input_snapshot  jsonb,
  gemini_output   jsonb,
  actions_taken   jsonb,
  error_message   text,
  executed_by     int  references employees(id),
  approved_by     int  references employees(id),
  started_at      timestamptz default now(),
  completed_at    timestamptz
);

create index email_skill_runs_skill_idx  on email_skill_runs(skill_id);
create index email_skill_runs_thread_idx on email_skill_runs(thread_id);

-- ─────────────────────────────────────────────────────────
-- EMAIL TEMPLATES & SIGNATURES
-- ─────────────────────────────────────────────────────────

create table email_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id int  not null references organizations(id),
  name            text not null,
  subject         text,
  body_html       text not null,
  variables       jsonb default '[]',
  module          text,
  created_by      int  references employees(id),
  created_at      timestamptz default now()
);

create index email_templates_org_idx on email_templates(organization_id);

create table email_signatures (
  id              uuid primary key default gen_random_uuid(),
  organization_id int  not null references organizations(id),
  employee_id     int  references employees(id),
  mailbox_id      uuid references email_mailboxes(id),
  name            text not null,
  body_html       text not null,
  is_default      boolean default false,
  created_at      timestamptz default now(),
  -- owner is employee XOR mailbox XOR neither (both null = org-wide default
  -- signature set by admin)
  constraint sig_owner_check check (
    not (employee_id is not null and mailbox_id is not null)
  )
);

create index email_signatures_org_idx on email_signatures(organization_id);

-- ─────────────────────────────────────────────────────────
-- CALENDAR ACCOUNTS
-- ─────────────────────────────────────────────────────────

create table calendar_accounts (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       int  not null references organizations(id),
  employee_id           int  references employees(id),
  provider              text not null,
  caldav_url            text,
  credentials_encrypted jsonb default '{}',
  last_synced_at        timestamptz,
  sync_error            text,
  is_active             boolean default true,
  created_at            timestamptz default now()
);

create index calendar_accounts_org_idx      on calendar_accounts(organization_id);
create index calendar_accounts_employee_idx on calendar_accounts(employee_id);

-- ─────────────────────────────────────────────────────────
-- CALENDARS
-- ─────────────────────────────────────────────────────────

create table calendar_calendars (
  id              uuid primary key default gen_random_uuid(),
  organization_id int  not null references organizations(id),
  account_id      uuid references calendar_accounts(id),
  name            text not null,
  calendar_type   text check (calendar_type in ('personal','department','group','org','mailbox','holiday','erp')),
  color           text,
  owner_id        int  references employees(id),
  department_id   int  references departments(id),
  is_visible      boolean default true,
  caldav_path     text
);

create index calendar_calendars_org_idx   on calendar_calendars(organization_id);
create index calendar_calendars_owner_idx on calendar_calendars(owner_id);
create index calendar_calendars_dept_idx  on calendar_calendars(department_id);

-- ─────────────────────────────────────────────────────────
-- CALENDAR EVENTS
-- ─────────────────────────────────────────────────────────

create table calendar_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id int  not null references organizations(id),
  calendar_id     uuid not null references calendar_calendars(id) on delete cascade,
  caldav_uid      text,
  title           text not null,
  description     text,
  location        text,
  video_link      text,
  event_type      text check (event_type in ('meeting','focus_time','out_of_office','travel','tentative','private','leave','holiday')),
  start_at        timestamptz not null,
  end_at          timestamptz not null,
  is_all_day      boolean default false,
  is_recurring    boolean default false,
  recurrence_rule text,
  erp_entity_type text,
  erp_entity_id   int,
  created_by      int  references employees(id),
  created_at      timestamptz default now()
);

create index calendar_events_org_idx      on calendar_events(organization_id);
create index calendar_events_calendar_idx on calendar_events(calendar_id);
create index calendar_events_start_idx    on calendar_events(start_at);
create index calendar_events_erp_idx      on calendar_events(erp_entity_type, erp_entity_id)
  where erp_entity_id is not null;

-- ─────────────────────────────────────────────────────────
-- CALENDAR EVENT ATTENDEES
-- Surrogate PK to avoid expression-based primary key limitation
-- ─────────────────────────────────────────────────────────

create table calendar_event_attendees (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references calendar_events(id) on delete cascade,
  employee_id int  references employees(id),
  email       text,
  rsvp_status text check (rsvp_status in ('pending','accepted','declined','tentative')),
  constraint attendee_has_identity    check (employee_id is not null or email is not null),
  constraint attendee_internal_unique unique (event_id, employee_id),
  constraint attendee_external_unique unique (event_id, email)
);

create index calendar_event_attendees_event_idx    on calendar_event_attendees(event_id);
create index calendar_event_attendees_employee_idx on calendar_event_attendees(employee_id);

-- NOTE: no holidays table here — public.holidays already exists (init schema,
-- populated by refresh-holidays edge function, used by payroll/overtime).
-- The calendar holiday overlay reads it directly.

-- ─────────────────────────────────────────────────────────
-- OUT OF OFFICE SETTINGS
-- Auto-reply + delegation config per employee
-- ─────────────────────────────────────────────────────────

create table email_ooo_settings (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      int  not null references organizations(id),
  employee_id          int  not null references employees(id) unique,
  is_active            boolean default false,
  starts_at            timestamptz,
  ends_at              timestamptz,
  auto_reply_subject   text,
  auto_reply_body_html text,
  delegate_employee_id int references employees(id),
  calendar_event_id    uuid references calendar_events(id),
  updated_at           timestamptz default now()
);

create index email_ooo_settings_org_idx on email_ooo_settings(organization_id);

-- ─────────────────────────────────────────────────────────
-- NOTIFICATION PREFERENCES
-- Per employee × event type channel priority (dispatcher step 1)
-- ─────────────────────────────────────────────────────────

create table notification_preferences (
  id              uuid primary key default gen_random_uuid(),
  organization_id int  not null references organizations(id),
  employee_id     int  not null references employees(id),
  event_type      text not null,
  channels        text[] not null default '{line,email,in_app}',
  is_enabled      boolean default true,
  unique (employee_id, event_type)
);

create index notification_preferences_org_idx on notification_preferences(organization_id);

-- ─────────────────────────────────────────────────────────
-- BOOKING LINKS (CALENDLY-STYLE)
-- slug is a single URL segment (e.g. 'jane-wang-30min') — no slashes
-- ─────────────────────────────────────────────────────────

create table booking_pages (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             int  not null references organizations(id),
  employee_id                 int  references employees(id),
  slug                        text not null unique,
  name                        text not null,
  description                 text,
  duration_minutes            int  not null default 30,
  buffer_before_minutes       int  default 0,
  buffer_after_minutes        int  default 10,
  advance_notice_hours        int  default 24,
  booking_window_days         int  default 30,
  max_bookings_per_day        int,
  location_type               text check (location_type in ('video','in_person','phone')),
  location_value              text,
  questions                   jsonb default '[]',
  confirmation_message        text,
  allow_cancellation          boolean default true,
  allow_reschedule            boolean default true,
  cancellation_deadline_hours int  default 24,
  is_active                   boolean default true,
  is_team_page                boolean default false,
  team_assignment             text check (team_assignment in ('round_robin','load_balanced')),
  created_at                  timestamptz default now()
);

create index booking_pages_org_idx  on booking_pages(organization_id);
create index booking_pages_slug_idx on booking_pages(slug);

create table booking_page_team_members (
  page_id     uuid not null references booking_pages(id) on delete cascade,
  employee_id int  not null references employees(id),
  primary key (page_id, employee_id)
);

create table booking_appointments (
  id                      uuid primary key default gen_random_uuid(),
  page_id                 uuid not null references booking_pages(id),
  organization_id         int  not null references organizations(id),
  assigned_to_employee_id int  references employees(id),
  calendar_event_id       uuid references calendar_events(id),
  booker_name             text not null,
  booker_email            text not null,
  booker_phone            text,
  booker_answers          jsonb default '{}',
  status                  text default 'confirmed' check (status in ('confirmed','cancelled','rescheduled','completed')),
  booked_at               timestamptz default now(),
  cancelled_at            timestamptz,
  cancellation_reason     text,
  erp_entity_type         text,
  erp_entity_id           int,
  created_at              timestamptz default now()
);

create index booking_appointments_page_idx  on booking_appointments(page_id);
create index booking_appointments_org_idx   on booking_appointments(organization_id);
create index booking_appointments_email_idx on booking_appointments(booker_email);

-- ─────────────────────────────────────────────────────────
-- CONTACT ACCOUNTS (CardDAV sync sources)
-- ─────────────────────────────────────────────────────────

create table contact_accounts (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       int  not null references organizations(id),
  employee_id           int  references employees(id),
  provider              text,
  carddav_url           text,
  credentials_encrypted jsonb default '{}',
  sync_interval_minutes int  default 60,
  conflict_strategy     text default 'ask_user' check (conflict_strategy in ('remote_wins','local_wins','ask_user')),
  last_synced_at        timestamptz,
  sync_error            text
);

create index contact_accounts_org_idx on contact_accounts(organization_id);

-- ─────────────────────────────────────────────────────────
-- CONTACTS
-- ─────────────────────────────────────────────────────────

create table contacts (
  id              uuid primary key default gen_random_uuid(),
  organization_id int  not null references organizations(id),
  contact_type    text check (contact_type in ('person','group','distribution_list','entity')),
  scope           text check (scope in ('personal','dept','org')),
  owner_id        int  references employees(id),
  department_id   int  references departments(id),
  display_name    text not null,
  email           text,
  phone           text,
  company         text,
  title           text,
  notes           text,
  avatar_url      text,
  erp_entity_type text,
  erp_entity_id   int,
  source          text check (source in ('manual','carddav','csv','erp_sync')),
  is_erp_managed  boolean default false,
  carddav_etag    text,
  tags            text[],
  custom_fields   jsonb default '{}',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index contacts_org_idx   on contacts(organization_id);
create index contacts_owner_idx on contacts(owner_id);
create index contacts_email_idx on contacts(email) where email is not null;
create index contacts_erp_idx   on contacts(erp_entity_type, erp_entity_id) where erp_entity_id is not null;
create index contacts_name_trgm on contacts using gin(display_name gin_trgm_ops);

create table contact_group_members (
  group_id   uuid not null references contacts(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  added_by   int  references employees(id),
  added_at   timestamptz default now(),
  primary key (group_id, contact_id)
);

-- ─────────────────────────────────────────────────────────
-- CONTACTS IMPORT STAGING
-- ─────────────────────────────────────────────────────────

create table contacts_staging (
  id              uuid primary key default gen_random_uuid(),
  organization_id int  not null references organizations(id),
  account_id      uuid references contact_accounts(id),
  raw_vcard       text,
  parsed_json     jsonb,
  status          text check (status in ('pending','merged','skipped','imported')),
  created_at      timestamptz default now()
);

create index contacts_staging_org_idx on contacts_staging(organization_id);

create table contact_merge_log (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid references contacts(id),
  source_id   uuid references contacts(id),
  action      text check (action in ('merged','kept_both','skipped')),
  field_diffs jsonb,
  resolved_by int  references employees(id),
  resolved_at timestamptz default now()
);

create table contact_field_maps (
  id              uuid primary key default gen_random_uuid(),
  organization_id int  not null references organizations(id),
  name            text not null,
  mapping_json    jsonb not null,
  created_by      int  references employees(id),
  created_at      timestamptz default now()
);

-- ─────────────────────────────────────────────────────────
-- AUDIT & NOTIFICATIONS
-- ─────────────────────────────────────────────────────────

create table comms_access_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id int  not null references organizations(id),
  employee_id     int  not null references employees(id),
  action          text not null,
  entity_type     text,
  entity_id       uuid,
  metadata        jsonb,
  accessed_at     timestamptz default now()
);

create index comms_access_log_org_idx      on comms_access_log(organization_id);
create index comms_access_log_employee_idx on comms_access_log(employee_id);
create index comms_access_log_at_idx       on comms_access_log(accessed_at desc);

create table notification_deliveries (
  id              uuid primary key default gen_random_uuid(),
  organization_id int  not null references organizations(id),
  employee_id     int  not null references employees(id),
  event_type      text not null,
  event_payload   jsonb,
  channel_tried   text[],
  channel_success text,
  delivered_at    timestamptz,
  error_log       jsonb,
  created_at      timestamptz default now()
);

create index notification_deliveries_org_idx      on notification_deliveries(organization_id);
create index notification_deliveries_employee_idx on notification_deliveries(employee_id);
create index notification_deliveries_type_idx     on notification_deliveries(event_type);

-- ─────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Simple org-scoped policies. Full hardening added in Phase 15.
-- ─────────────────────────────────────────────────────────

do $rls$
declare
  t text;
begin
  foreach t in array array[
    'email_mailboxes','email_mailbox_members','email_accounts',
    'email_folders','email_threads','email_messages','email_drafts',
    'email_attachments','email_labels','email_thread_labels',
    'email_categories','email_thread_categories','email_label_rules',
    'email_entity_links','email_skills','email_skill_runs',
    'email_templates','email_signatures','email_ooo_settings',
    'calendar_accounts','calendar_calendars','calendar_events',
    'calendar_event_attendees',
    'booking_pages','booking_page_team_members','booking_appointments',
    'contact_accounts','contacts','contact_group_members',
    'contacts_staging','contact_merge_log','contact_field_maps',
    'comms_access_log','notification_deliveries','notification_preferences'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $rls$;

-- Org-scoped tables: authenticated sees own org, service_role unrestricted
do $org_policies$
declare
  t text;
begin
  foreach t in array array[
    'email_mailboxes','email_accounts','email_folders','email_threads',
    'email_messages','email_drafts','email_attachments','email_labels',
    'email_categories','email_label_rules','email_entity_links',
    'email_skills','email_skill_runs','email_templates','email_signatures',
    'email_ooo_settings','calendar_accounts','calendar_calendars','calendar_events',
    'booking_pages','booking_appointments','contact_accounts','contacts',
    'contacts_staging','contact_field_maps','comms_access_log',
    'notification_deliveries','notification_preferences'
  ] loop
    execute format(
      'create policy "comms_%s_org" on %I for all to authenticated
       using (organization_id = public.current_user_org_id() or public.is_admin())',
      t, t
    );
    execute format(
      'create policy "comms_%s_service" on %I for all to service_role using (true)',
      t, t
    );
  end loop;
end $org_policies$;

-- Junction tables without organization_id: allow authenticated
do $junction_policies$
declare
  t text;
begin
  foreach t in array array[
    'email_mailbox_members','email_thread_labels','email_thread_categories',
    'calendar_event_attendees','booking_page_team_members',
    'contact_group_members','contact_merge_log'
  ] loop
    execute format(
      'create policy "comms_%s_auth" on %I for all to authenticated using (true)',
      t, t
    );
    execute format(
      'create policy "comms_%s_service" on %I for all to service_role using (true)',
      t, t
    );
  end loop;
end $junction_policies$;

-- ─────────────────────────────────────────────────────────
-- PUBLIC BOOKING ACCESS (unauthenticated external bookers)
-- Read: anon may see active booking pages only.
-- Write: via security-definer RPC — no direct anon INSERT.
-- ─────────────────────────────────────────────────────────

create policy "booking_pages_public_read" on booking_pages
  for select to anon
  using (is_active = true);

-- Book a slot on a public page. SECURITY DEFINER: bypasses RLS to insert the
-- appointment. Full availability validation (working hours, buffers, holidays)
-- happens in the comms-booking edge function in Phase 9 — this RPC enforces
-- the invariants that must never break: active page, future slot, no
-- double-booking of the same slot.
create or replace function public.create_booking_appointment(
  p_slug          text,
  p_start_at      timestamptz,
  p_booker_name   text,
  p_booker_email  text,
  p_booker_phone  text default null,
  p_answers       jsonb default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_page booking_pages%rowtype;
  v_end_at timestamptz;
  v_appointment_id uuid;
begin
  select * into v_page from booking_pages
   where slug = p_slug and is_active = true;
  if not found then
    raise exception 'booking page not found or inactive';
  end if;

  if p_start_at < now() + make_interval(hours => coalesce(v_page.advance_notice_hours, 0)) then
    raise exception 'slot violates advance notice requirement';
  end if;

  if p_booker_name is null or btrim(p_booker_name) = ''
     or p_booker_email is null or p_booker_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid booker name or email';
  end if;

  v_end_at := p_start_at + make_interval(mins => v_page.duration_minutes);

  -- reject double-booking: overlapping confirmed appointment on same page
  if exists (
    select 1 from booking_appointments a
     where a.page_id = v_page.id
       and a.status = 'confirmed'
       and a.calendar_event_id is not null
       and exists (
         select 1 from calendar_events e
          where e.id = a.calendar_event_id
            and e.start_at < v_end_at
            and e.end_at   > p_start_at
       )
  ) then
    raise exception 'slot no longer available';
  end if;

  insert into booking_appointments (
    page_id, organization_id, assigned_to_employee_id,
    booker_name, booker_email, booker_phone, booker_answers, status
  ) values (
    v_page.id, v_page.organization_id, v_page.employee_id,
    btrim(p_booker_name), lower(btrim(p_booker_email)), p_booker_phone, p_answers, 'confirmed'
  ) returning id into v_appointment_id;

  return v_appointment_id;
end;
$$;

revoke all on function public.create_booking_appointment from public;
grant execute on function public.create_booking_appointment to anon, authenticated;

-- ─────────────────────────────────────────────────────────
-- SEED: default categories & labels per org
-- ─────────────────────────────────────────────────────────

insert into email_categories (organization_id, name, color, display_order)
select o.id, cat.name, cat.color, cat.ord
from organizations o
cross join (values
  ('Finance',    'var(--accent-blue)',   1),
  ('HR',         'var(--accent-green)',  2),
  ('Operations', 'var(--accent-orange)', 3),
  ('Legal',      'var(--accent-purple)', 4),
  ('Sales / CRM','var(--accent-cyan)',   5),
  ('Internal',   'var(--text-muted)',    6),
  ('Urgent',     'var(--accent-red)',    7)
) as cat(name, color, ord);

insert into email_labels (organization_id, name, label_type, scope, color)
select o.id, lbl.name, 'system', 'org', lbl.color
from organizations o
cross join (values
  ('Starred', 'var(--accent-orange)'),
  ('Snoozed', 'var(--text-muted)')
) as lbl(name, color);

insert into email_labels (organization_id, name, label_type, scope, color, confidence_threshold)
select o.id, lbl.name, 'smart', 'org', lbl.color, 0.85
from organizations o
cross join (values
  ('Invoice',          'var(--accent-orange)'),
  ('Purchase Order',   'var(--accent-blue)'),
  ('Offer Letter',     'var(--accent-green)'),
  ('Meeting Request',  'var(--accent-cyan)'),
  ('Complaint',        'var(--accent-red)'),
  ('Contract',         'var(--accent-purple)'),
  ('Payment Reminder', 'var(--accent-orange)')
) as lbl(name, color);

COMMIT;

NOTIFY pgrst, 'reload schema';
