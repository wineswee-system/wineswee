# Communications Suite — Email Development Plan

> Full feature specification and development roadmap for the Email + Calendar + Contacts + AI Skills module.
> Part of the SME Ops ERP platform (React 19 + Supabase + Tailwind CSS 4).

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Decisions](#architecture-decisions)
3. [Implementation Corrections (Gap Review 2026-07-02)](#implementation-corrections-gap-review-2026-07-02)
4. [Phase Roadmap](#phase-roadmap)
4. [Email Storage](#email-storage)
5. [Folders](#folders)
6. [Drafts](#drafts)
7. [Sent Items](#sent-items)
8. [Labels](#labels)
9. [Categories](#categories)
10. [Label Rules & Filters](#label-rules--filters)
11. [Shared / Team Mailboxes](#shared--team-mailboxes)
12. [Staff Identity Markers](#staff-identity-markers)
13. [Email Linking — Tasks / Workflows / Projects](#email-linking--tasks--workflows--projects)
14. [AI Skill Engine](#ai-skill-engine)
15. [Email Templates & Signatures](#email-templates--signatures)
16. [Attachment Management](#attachment-management)
17. [Notification Dispatcher](#notification-dispatcher)
18. [Unified Search](#unified-search)
19. [Out of Office & Delegation](#out-of-office--delegation)
20. [Multi-Account Per User](#multi-account-per-user)
21. [Privacy & Data Retention](#privacy--data-retention)
22. [Calendar](#calendar)
23. [Booking Links (Calendly-style)](#booking-links-calendly-style)
24. [Contacts](#contacts)
25. [ERP Integration Points](#erp-integration-points)
26. [Database Schema](#database-schema)
27. [File Structure](#file-structure)
28. [Gap Checklist](#gap-checklist)

---

## Overview

The Communications Suite adds a full-featured email client, calendar, and contact manager natively embedded in the ERP. It is not a standalone app — every email, event, and contact is linkable to ERP entities (suppliers, invoices, tasks, workflows, employees).

Key design principles:
- **Local-first storage**: email content cached in Supabase, not fetched live from IMAP on every view
- **ERP-native**: email threads link to tasks, workflows, invoices, suppliers, candidates
- **AI-enabled**: custom "skills" process incoming emails and trigger ERP actions automatically
- **Role-scoped**: all data respects existing RBAC (store_staff / store_manager / office_staff / hr_admin / super_admin)
- **Protocol-agnostic**: supports Gmail, Outlook, iCloud, and any IMAP/SMTP/CalDAV/CardDAV provider

---

## Architecture Decisions

| Decision | Choice | Reason |
|---|---|---|
| Email read | `imapflow` in **edge function** | Node-only lib — cannot run in browser; runs in `comms-email-sync` |
| Email send | SMTP/API in **edge function** | Runs in `comms-email-send`; provider = org SMTP or Resend/SES |
| CalDAV + CardDAV | `tsdav` in **edge function** | Node-only lib; sync runs server-side on cron |
| Email composer | **Maily** (open source) | React-native, Notion-style, Tiptap under hood |
| Calendar UI | **FullCalendar** (OSS) | Best React calendar, handles all views |
| Contact sync | `tsdav` + `vcard-parser` (edge) | Unified, handles Google / iCloud / Nextcloud |
| AI processing | **Gemini** (via existing `gemini-proxy` edge function) | Already wired in project |
| Search | Supabase `pg_trgm` + `tsvector` (`'simple'` config) | zh-TW content — `english` stemming breaks CJK |
| Storage | Supabase Storage | Email HTML bodies, attachments |
| Module bundle | `src/modules/CommsModule.jsx` | Lazy-loaded, registered in `src/modules/index.js` |

---

## Implementation Corrections (Gap Review 2026-07-02)

Verified against the live codebase before Phase 1 implementation. These
override the corresponding sections below where they conflict.

1. **No `tenants` table.** Dropped 2026-04-20 (Phase 1.1 migration). All comms
   tables use `organization_id INT references organizations(id)`. Employees /
   departments / organizations PKs are `INT` (serial), not UUID.
2. **`holidays` table already exists** (init schema; populated by the
   `refresh-holidays` edge function on cron; used by payroll + overtime).
   The comms migration does NOT create it — the calendar holiday overlay
   reads the existing table.
3. **IMAP/SMTP/CalDAV cannot run in the browser.** All protocol adapters move
   from `src/lib/comms/` to Supabase Edge Functions (`comms-email-send`,
   `comms-email-sync`, `comms-account-test`, `comms-notify`, `comms-booking`).
   Browser side is a thin client: `src/lib/comms/commsClient.js`.
4. **IMAP IDLE push is not achievable** on edge functions (no long-lived
   connections). Design is cron-triggered delta sync every N minutes (same
   pattern as `refresh-holidays`). Real-time-ish UX comes from Supabase
   Realtime on `email_messages` inserts.
5. **Public booking pages** are unauthenticated → routed at top level in
   `App.jsx` (`/book/:slug`, `/book/confirm/:id`), following the GuestMenu
   pattern — NOT inside the authenticated comms module. Writes go through the
   `create_booking_appointment` SECURITY DEFINER RPC; anon has SELECT on
   active pages only. Slugs are single URL segments (`jane-wang-30min`).
6. **No outbound email infrastructure exists today** — only Supabase Auth
   magic links. An SMTP/API provider must be provisioned before Phase 11
   (Notification Dispatcher email fallback).
7. **Credential encryption happens server-side only** (edge function with a
   server secret / pgsodium). Anything `VITE_*` is public — the browser never
   sees or stores credentials.
8. **`message_id_header` unique per account**, not globally — the same
   message delivered to two connected accounts must not collide.
9. **Full-text search uses `'simple'` tsvector config + `pg_trgm`** (enabled
   in the comms migration) — `'english'` stemming breaks zh-TW tokens.
10. **Added tables missing from the original schema:** `email_ooo_settings`
    (auto-reply, delegate, period) and `notification_preferences` (per
    employee × event type channel priority). Storage buckets `email-bodies` /
    `email-attachments` still need creating before Phase 2.
11. **Junction-table RLS is permissive placeholder** (`using (true)`) —
    acceptable single-org today; must be parent-scoped in Phase 15 hardening
    before any multi-org rollout.

---

## Phase Roadmap

| Phase | Feature | Priority | Depends On |
|---|---|---|---|
| 1 | Account connection (IMAP + CalDAV + CardDAV, OAuth) | Foundation | — |
| 2 | Personal inbox, thread view, Maily composer | Core | Phase 1 |
| 3 | Email storage: folders, drafts, sent items, flags | Core | Phase 2 |
| 4 | Labels, categories, label rules/filters | High | Phase 3 |
| 5 | Shared / team mailboxes + staff identity markers | Critical | Phase 3 |
| 6 | Email → Task / Workflow / Project linking | High | Phase 2 |
| 7 | Personal + Department + Group calendars | Core | Phase 1 |
| 8 | Holiday calendar + OOO + meeting blocks + time off overlays | High | Phase 7 |
| 9 | Booking links (Calendly-style) | High | Phase 7 |
| 10 | Contacts (scoped) + ERP entity sync + import wizard | High | Phase 1 |
| 11 | Notification Dispatcher (email fallback for LINE-only) | Critical | Phase 2 |
| 12 | Email templates + signatures + attachment management | High | Phase 2 |
| 13 | AI Skill Engine + skill builder UI | High | Phase 2 |
| 14 | Meeting scheduling assistant + unified search | Medium | Phase 7 |
| 15 | Privacy / retention / audit log / PDPA | Medium | Phase 3 |
| 16 | Multi-account per user + video call + OCR + custom fields | Enhancement | Phase 10 |

---

## Email Storage

All email content is stored locally in Supabase — not fetched live from IMAP on every read.

**What is stored:**
- `body_html` → Supabase Storage (large, avoids DB bloat)
- `body_text_cache` → PostgreSQL column (plain text for `tsvector` full-text search)
- `raw_headers` → JSON column
- Attachments → Supabase Storage with metadata in `email_attachments` table

**Sync strategy:**
- IMAP IDLE connection for real-time push on new messages
- ETags-based delta sync for CalDAV / CardDAV
- `imap_uid` stored per message as sync key — used for update and delete operations
- Sync status visible per account in settings (last synced, error state, message count)

**Offline access:**
- Service Worker (already in project) caches recently read threads
- Draft auto-save works offline; syncs on reconnect
- Calendar events cached for 7 days offline

---

## Folders

### System Folders (per account, mapped to IMAP paths)

| Folder | IMAP Path (Gmail) | IMAP Path (Outlook) |
|---|---|---|
| Inbox | `INBOX` | `Inbox` |
| Sent | `[Gmail]/Sent Mail` | `Sent Items` |
| Drafts | `[Gmail]/Drafts` | `Drafts` |
| Trash | `[Gmail]/Trash` | `Deleted Items` |
| Archive | `[Gmail]/All Mail` | `Archive` |
| Spam | `[Gmail]/Spam` | `Junk Email` |

System folders cannot be renamed or deleted.

### Custom Folders
- User-created, unlimited nesting
- Example: `Suppliers > Invoices > 2026`
- Synced bidirectionally with IMAP custom folders
- Color and icon configurable per folder

### Shared Mailbox Folders
Each shared mailbox (`hr@`, `finance@`, etc.) has its own parallel folder tree:
- Shared Inbox, Shared Sent, Shared Drafts
- Staff identity marker attached to every message in Sent and Drafts

### Folder Sidebar UI
```
Accounts
  ├─ work@company.com
  │    ├─ Inbox (12)
  │    ├─ Starred
  │    ├─ Snoozed
  │    ├─ Sent
  │    ├─ Drafts (3)
  │    ├─ Archive
  │    ├─ Spam
  │    └─ Suppliers
  │         └─ Invoices
  └─ hr@ (shared)
       ├─ Inbox (5)
       ├─ Sent
       └─ Drafts (1)

Labels
  ├─ [Invoice]  [Contract]  [Meeting Request]   ← smart
  ├─ [Supplier]  [Q3]  [Follow Up]              ← custom
  └─ + New Label

Categories
  ├─ Finance · HR · Operations · Legal · Urgent
  └─ + New Category
```

---

## Drafts

- **Auto-save**: every 20 seconds while composing (debounced)
- **Session recovery**: draft persists on browser close or crash, restored on next login via `session_token`
- **IMAP sync**: on manual save, draft pushed to IMAP Drafts folder; `imap_draft_uid` stored for future update/delete
- **Multiple concurrent drafts**: staff can have many in-progress drafts simultaneously
- **Shared mailbox drafts**: draft composed from `hr@` visible to all mailbox members; shown with "Draft by [Staff Name]" badge
- **Discard**: soft-delete, recoverable from Trash for 30 days
- **Attachment staging**: attachments uploaded to Supabase Storage on attach, referenced by `attachments_staged` JSON; only committed to `email_attachments` on send

---

## Sent Items

- On send: message stored locally in `email_messages` (`folder_type: sent`) with `sent_by_employee_id`
- Also appended to IMAP Sent folder (standard SMTP behaviour — prevents duplicates via dedup on `message_id_header`)
- **Shared mailbox sent**: appears in both the shared Sent folder AND the sending staff member's personal Sent view
- **Delivery status**: stored per recipient (delivered / bounced / pending)
- **Read receipt**: optional flag on compose; updates `read_receipt_at` when remote client loads tracking pixel
- **Bounce handling**: bounced messages flagged on contact record; surfaced in Purchasing/CRM module for that supplier/contact

---

## Labels

Multi-select, Gmail-style. A single thread can carry multiple labels simultaneously.

```
Thread: "INV-2026-088 from Supplier Co."
Labels:  [Supplier]  [Invoice]  [Q3]  [Pending Payment]  [Urgent]
```

### Three Label Tiers

| Tier | Created by | Scope | Examples |
|---|---|---|---|
| System | Built-in | All | Inbox, Sent, Drafts, Starred, Snoozed, Spam |
| Smart | AI (Gemini) | Tenant-configured | Invoice, Contract, Meeting Request, PO, Offer Letter, Complaint, Payment Reminder |
| Custom | Staff / Admin | Personal / Dept / Org | Q3, VIP Client, Follow Up, Legal Review |

### Smart Label Detection

| Detected Pattern | Auto-label |
|---|---|
| PDF attachment + amount + invoice number in body | `Invoice` |
| Subject contains "Purchase Order" / "PO#" | `Purchase Order` |
| Body is a job offer / salary terms present | `Offer Letter` |
| Sender requests meeting / `.ics` attached | `Meeting Request` |
| Body expresses complaint or dissatisfaction | `Complaint` |
| Contains NDA / contract / legal language | `Contract` |
| Payment terms / overdue language present | `Payment Reminder` |

- Confidence threshold configurable per smart label (default 85%)
- User can reject an AI-applied label → feeds back to skill tuning
- Labels apply to **threads** by default; per-message override supported

### Label Scoping
- `personal` labels: visible only to the creating employee
- `dept` labels: visible to department members + manager
- `org` labels: visible to all staff; created by admin only

---

## Categories

Single-select classification per thread. Separate from labels — categories answer "what type is this?" while labels answer "how is this organized?"

### Default Category Set (tenant-configurable)

| Category | Color | Use |
|---|---|---|
| Finance | Blue | Invoices, payments, billing |
| HR | Green | Employee matters, recruitment |
| Operations | Orange | Logistics, suppliers, ops |
| Legal | Purple | Contracts, compliance |
| Sales / CRM | Cyan | Customer comms, leads |
| Internal | Gray | Staff-to-staff comms |
| Urgent | Red | Time-sensitive, escalation |

- Tenant can rename, recolor, add, or remove categories
- Categories power inbox filter tabs: view all Finance emails across all accounts at once

---

## Label Rules & Filters

Auto-apply labels, categories, and actions on message arrival before inbox display.

### Rule Structure
```
Rule: "Supplier Invoices"
  Priority: 10
  IF  from_domain IN [supplier domains from Purchasing module]
  AND has_attachment = true
  AND subject matches /INV-\d+/
  THEN
    apply_label:    [Invoice] [Supplier]
    set_category:   Finance
    move_to_folder: Suppliers/Invoices
    assign_to:      finance@ (shared mailbox)
    trigger_skill:  "Supplier Invoice Parser"
```

### Available Conditions
- `from_address` / `from_domain` (exact, contains, regex)
- `to_address` / `cc_address`
- `subject` (contains, matches regex)
- `has_attachment` (true/false)
- `attachment_type` (pdf, image, xlsx, etc.)
- `body_contains` (keyword or regex)
- `size_bytes` (greater/less than)
- `received_on_account` (which connected account)

### Available Actions
- Apply / remove label(s)
- Set category
- Move to folder
- Mark as read / unread
- Star / flag
- Skip inbox (archive immediately)
- Assign to staff member or shared mailbox
- Trigger AI skill

---

## Shared / Team Mailboxes

### Setup
- Create shared mailbox addresses: `hr@`, `finance@`, `support@`, `purchasing@`
- Per mailbox: assign which roles/employees can read and reply
- Per mailbox: set default assignee or round-robin assignment
- Connected via IMAP + SMTP with shared credentials (encrypted in Supabase)

### Thread Management
- **Assign**: assign a thread to a specific staff member → they own it, get in-app notification
- **Reassign**: hand off to another staff member with a handoff note
- **Status**: `open` | `assigned` | `waiting` (pending external reply) | `resolved`
- **SLA timer**: shows how long a thread has been unassigned or unanswered
- **Coverage warning**: if assignee is on OOO, reassignment prompt shown

### Permissions Per Mailbox
- `read`: can view threads
- `reply`: can read + reply + compose new
- `admin`: full control including mailbox settings

---

## Staff Identity Markers

When staff reply from a shared mailbox, the external sender sees only the shared address. Internal staff see exactly who acted.

### Thread View Example
```
┌─────────────────────────────────────────────────┐
│ From: supplier@vendor.com                        │
│ "Please confirm PO #4421 receipt"                │
└─────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────┐
│ ← hr@company.com              [Jane Wang · HR]  │  ← internal badge
│ "Confirmed, PO received on June 28"              │
└─────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────┐
│ ← hr@company.com           [Tom Liu · Finance]  │  ← different staff
│ "Invoice forwarded to accounts payable"          │
└─────────────────────────────────────────────────┘
```

- Badge shows: staff name + department
- Never visible to external recipients
- Stored in `email_messages.sent_by_employee_id`
- Searchable and filterable internally: "show all replies by Jane Wang"
- Audit log preserves full identity trail

---

## Email Linking — Tasks / Workflows / Projects

### Link Panel
From any email thread, a **Link** sidebar panel:
```
[ + Link to... ]
  ├─ Task         → search open tasks or create new from email
  ├─ Workflow     → search active workflow instances
  ├─ Project      → search projects
  └─ ERP Record   → Supplier / Invoice / Candidate / Employee / etc.
```

Multiple links allowed per thread. One-click from thread to linked record.

### Reverse Display

**In email thread:** link badges at top
```
Linked to:  [Task] Onboarding — John Lin  ·  [Workflow] Supplier Onboarding #W-0042
```

**In task / workflow / project detail:** new Emails tab
```
[ Info ] [ Subtasks ] [ Emails ] [ Files ] [ Activity ]
```
- Shows all linked threads inline, expandable
- Reply directly from within the task detail — no need to navigate to inbox

### AI Auto-Linking
- Subject matches task name → suggest link
- Sender domain matches supplier → auto-link to supplier + open PO
- Email contains invoice number pattern → auto-link to purchasing bill
- Recruiter email with candidate name → auto-link to recruitment record

---

## AI Skill Engine

### Skill Structure
```js
{
  id, name, description,
  trigger: {
    source: "email" | "calendar" | "contact",
    conditions: [
      { field: "label",        operator: "includes", value: "Invoice" },
      { field: "from_domain",  operator: "in",       value: "@supplier.com" },
      { field: "attachment_type", operator: "equals", value: "pdf" }
    ]
  },
  prompt_template: "Extract invoice details from: {{email_body}}. Return JSON: {vendor, amount, line_items, due_date}",
  actions: [
    { type: "create_record",        module: "purchasing", entity: "supplier_invoice" },
    { type: "link_thread",          module: "purchasing", entity: "supplier_communication" },
    { type: "create_calendar_event", title: "Payment due: {{vendor}}", date: "{{due_date}}" },
    { type: "notify_user",          channel: "email" },
    { type: "create_task",          assignee_role: "finance" },
    { type: "apply_label",          label: "Processed" },
    { type: "move_to_folder",       folder: "Suppliers/Invoices/Processed" }
  ],
  human_in_loop: true,
  is_active: true,
  version: 1
}
```

### Skill Chaining
Output of one skill feeds into the next:
```
Skill 1: "Invoice Parser"   → extracts vendor + amount + due date
Skill 2: "Bill Creator"     → receives output, creates draft bill in Purchasing
Skill 3: "Payment Reminder" → schedules calendar event on due date
```

### Built-in Skill Examples

| Skill | Trigger | Actions |
|---|---|---|
| Supplier Invoice Parser | Label: Invoice + PDF attachment | Extract fields → create bill → link thread → calendar payment date |
| Interview Scheduler | Label: Meeting Request + from candidate | Parse datetime → create calendar event → assign to interviewer |
| Offer Letter Handler | Label: Offer Letter | Link to recruitment record → update candidate stage |
| Contact Extractor | Any email with signature block | Parse name/email/phone → propose add/merge to contacts |
| Support Triage | Received on support@ | Categorize → create task → assign to support staff |
| Payment Reminder Creator | Label: Payment Reminder | Extract due date → create calendar event → notify finance |

### Skill Engine Features
- **Skill versioning**: edit without breaking active instances; old version runs until instances complete
- **Human-in-the-loop**: shows preview card for staff approval before executing high-stakes actions
- **Skill analytics**: fired count, success rate, avg processing time, rejection rate
- **Error handling**: failed Gemini calls → retry queue (3 attempts, exponential backoff) → alert skill owner
- **Skill approval**: admin must activate before skill goes live
- **Testing sandbox**: run any skill against a sample email without executing real actions
- **Skill Builder UI**: visual creator — configure trigger conditions + action chain

---

## Email Templates & Signatures

### Signatures
- Per-tenant default HTML signature (logo, company name, address) — set by admin
- Per-user signature override
- Signatures stored as HTML in Supabase Storage
- Shared mailbox signatures: `hr@` has its own signature separate from personal

### Template Library

| Template | Module | Variables |
|---|---|---|
| Offer Letter | Recruitment | `{{candidate_name}}`, `{{role}}`, `{{salary}}`, `{{start_date}}` |
| Resignation Acknowledgement | HR | `{{employee_name}}`, `{{last_day}}` |
| Onboarding Welcome | HR | `{{employee_name}}`, `{{start_date}}`, `{{manager_name}}` |
| Invoice Payment Reminder | Finance | `{{supplier_name}}`, `{{invoice_no}}`, `{{amount}}`, `{{due_date}}` |
| PO Confirmation | Purchasing | `{{supplier_name}}`, `{{po_number}}`, `{{items}}` |
| Interview Invitation | Recruitment | `{{candidate_name}}`, `{{date}}`, `{{time}}`, `{{location}}` |
| Training Enrollment | HR | `{{employee_name}}`, `{{course_name}}`, `{{date}}` |
| Leave Approval | HR | `{{employee_name}}`, `{{leave_type}}`, `{{dates}}` |
| Booking Link Invite | Calendar | `{{recipient_name}}`, `{{booking_url}}`, `{{event_type}}` |

- Templates use `{{variable}}` placeholders filled by AI skills or manually before send
- AI skill action can select template + fill variables automatically
- Template editor: rich HTML editing via Maily

---

## Attachment Management

- Attachments stored in Supabase Storage on receipt (not re-fetched from IMAP on each view)
- **Inline viewer**: PDF, image, Office docs rendered in browser without download
- **ERP linking**: attachment linked to ERP record directly (invoice PDF → purchasing bill)
- **Deduplication**: same file sent across multiple threads stored once (SHA-256 hash)
- **Per-tenant storage quota**: configurable, usage indicator in settings
- **Staged uploads**: attachments uploaded to temp path on attach; moved to permanent path on send
- **Virus scan hook**: file scanned before committing to permanent storage
- **Attachment search**: search by filename, type, or date range in unified search

---

## Notification Dispatcher

Replaces the current LINE-only notification system. Routes all ERP notifications through a priority fallback chain.

### Delivery Order
```
NotificationDispatcher.route(event) →
  1. Check user notification preferences (per event type)
  2. Try LINE (if user has LINE binding)
  3. Fallback → Email (via SMTP)
  4. Fallback → In-app notification (bell icon)
  5. Log delivery result + channel used
```

### ERP Modules Currently Missing Email Fallback

| Module | Event | Gap |
|---|---|---|
| Leave | Approval final decision | Employee gets nothing if no LINE |
| Resignation | Final approval / rejection | Employee gets nothing if no LINE |
| Salary | Payslip delivery | LINE only — no email fallback |
| Schedule | Publish notification | LINE only — no email fallback |
| BusinessTravel | Approval decision | Implied notify, no email |
| TransferRequest | Approval + effective date | LINE per step only |
| Probation | 14-day end warning | In-page only, no push |
| Overtime | Comp-time expiry warning | In-page only, no push |
| Workflows | `reminder_at` field | Written to DB, never delivered |
| Tasks | Deadline approaching | LINE on create only |

The Notification Dispatcher resolves all 10 gaps — modules fire events, dispatcher routes delivery.

---

## Unified Search

Full-text search across all surfaces + ERP:

```
Search: "Supplier Co invoice June"
Results:
  Emails (12)    → matching threads
  Calendar (2)   → meetings with supplier
  Contacts (1)   → entity contact record
  ERP (5)        → invoices, POs
```

### Backend
- `pg_tsvector` on `email_messages.body_text_cache`
- `pg_trgm` on subject, contact names, calendar event titles
- Single RPC endpoint, result-type tabs in UI
- Attachment filename search via metadata table
- Filters: date range, account, folder, label, category, sender, has attachment

---

## Out of Office & Delegation

- Set OOO period → creates `out_of_office` event type on personal calendar
- Auto-reply activated: custom message, optional delegate contact displayed
- OOO visible in department calendar and shared mailbox assignment panel
- **Delegation**: incoming assignments routed to designated staff member during OOO
- Mirrors existing `effective_from`/`effective_to` approval delegation in `org.employees`
- LINE notification sent to team on OOO start

---

## Multi-Account Per User

- One employee connects multiple accounts (work Gmail + personal Gmail + Outlook)
- Unified inbox with account filter pill tabs
- Personal account contacts stay `personal` scope by default
- Calendar events show source account color badge
- Composer: choose which account / shared mailbox to send from

---

## Privacy & Data Retention

- **Email retention policy**: auto-archive after N days, configurable per tenant (default 365 days)
- **Contact data consent**: PDPA-compliant opt-in tracking flag for external contacts
- **Right to deletion**: cascade check on contact delete → warns if linked to open tasks, emails, ERP records
- **Audit log** (`comms_access_log`): records who opened which thread, exported contacts, applied labels
- **Encryption**: email HTML body encrypted at rest in Supabase Storage
- **Data residency**: all content stored in tenant's Supabase project — no third-party email parsing

---

## Calendar

### Calendar Types

| Calendar | Scope | Visibility |
|---|---|---|
| Personal | Per employee | Owner only |
| Department | Per department | All dept members + manager |
| Group | Custom group | Group members |
| Org-wide | Tenant | All staff (view-only) |
| Shared mailbox | Per mailbox | Mailbox members |
| Holidays | Tenant (by country) | All staff (overlay) |
| ERP overlays | Auto-generated | Role-scoped |

Toggle each layer on/off independently in the sidebar.

### ERP Calendar Feeds (Auto-populated)

| ERP Source | Calendar Event |
|---|---|
| `hr.leave` (approved) | Leave blocks per employee |
| `hr.attendance` schedules | Shift schedule |
| `hr.business_travel` | Travel itinerary blocks |
| `hr.recruitment` | Interview `scheduled_at` per interviewer |
| `hr.recruitment` | Onboarding start date |
| `hr.probation_tracker` | Probation end + 14-day warning |
| `hr.training` | Course start/end dates |
| `hr.leave_of_absence` | Return date anchor |
| `hr.transfer_request` | Effective transfer date |
| `process.tasks` | Due dates |
| `process.approvals` | Approval expiry deadlines |
| `process.workflows` | SOP deadline cascade (up to 5 levels) |

### Department Calendar — Time Off Integration

- Aggregates all approved leave for department members
- **Coverage indicator**: staff available count per day
- **Coverage warning**: flag if >30% of dept on leave same day (configurable threshold)
- Leave approval validation: block approval if coverage drops below threshold
- Manager sees density: "2/5 staff on leave Jul 7–8"

### Public Holidays Calendar

- Built-in holiday packs by country (Thailand, Taiwan, configurable)
- Shown as full-day shaded band — informational, non-blocking overlay
- Company custom holidays addable by admin
- Feeds into: leave calculation (exclude holidays), overtime rate detection, task due date warnings, meeting scheduler (skip holidays when suggesting slots)

### Event Types / Blocks

| Type | Visibility to Others | Behaviour |
|---|---|---|
| `meeting` | Busy | Standard calendar event |
| `focus_time` | Busy | Meeting scheduler skips; title hidden from others |
| `out_of_office` | Out of Office | Auto-reply activates; assignments rerouted |
| `travel` | Busy | Linked to BusinessTravel ERP record |
| `tentative` | Tentative | Striped display; pending confirmation |
| `private` | Busy (no details) | Others see "Busy" only — no title/description |
| `leave` | Out of Office | Auto-generated from approved leave |
| `holiday` | Holiday | Tenant holiday overlay |

Meeting scheduler never suggests a slot where any attendee has `focus_time`, `out_of_office`, `meeting`, or `leave`.

### Meeting Scheduling Assistant
- Natural language: "Schedule 1-hour meeting with finance team this week"
- Checks free/busy across all attendees' calendars
- Respects: OOO, focus time, working hours, holidays, timezone per user
- Proposes 3 best slots → attendee picks → event created + invites sent
- Video call link auto-generated (Google Meet / Teams via OAuth scope)

### Calendar Permissions

| Calendar | Members | Manager / Owner | Admin |
|---|---|---|---|
| Department | View all, create own | Full control | — |
| Group | View all, create own | Full control | — |
| Org | View only | — | Full control |

---

## Booking Links (Calendly-style)

Staff generate a personal booking link and share it externally or internally. Recipients see the staff member's available slots and book directly — no back-and-forth emails.

### How It Works

1. Staff creates a **booking page** — defines event type, duration, buffer times, and availability window
2. System generates a unique public URL: `app.company.com/book/jane-wang/30min`
3. Staff pastes link into email, LINE message, or email signature
4. Recipient opens link → sees available slots → picks one → books
5. Calendar event auto-created on staff's calendar + confirmation email sent to both parties

### Booking Page Configuration

Per booking page, staff configures:

| Setting | Options |
|---|---|
| Event name | "30-min Intro Call", "Interview", "Supplier Meeting" |
| Duration | 15 / 30 / 45 / 60 / 90 minutes |
| Buffer time | Before / after each booking (e.g., 10 min buffer between meetings) |
| Availability window | Working hours pulled from employee schedule; custom override per page |
| Advance notice | Minimum time before a slot can be booked (e.g., 24 hours) |
| Booking window | How far ahead slots are offered (e.g., next 30 days) |
| Max bookings per day | Cap daily meetings from this link |
| Location | Video call (auto-link) / In-person (address field) / Phone |
| Questions | Custom fields shown to booker: name, company, purpose, phone |
| Confirmation message | Custom thank-you text after booking |
| Cancellation / reschedule | Allow or block; deadline before event |

### Multiple Booking Pages Per Staff

One staff member can have multiple pages for different purposes:
```
jane-wang/interview      → 45 min, interview questions form, no video
jane-wang/30min          → 30 min general, video auto-link
jane-wang/supplier-call  → 60 min, company + PO number questions
```

### Internal Booking (Staff-to-Staff)

- Staff can also send booking links to internal colleagues
- Internal recipient is authenticated → no name/email form needed
- Booked event auto-creates on both calendars with internal flag

### Team / Round-Robin Booking

- Team booking page: `app.company.com/book/hr-team/interview`
- Assigns to next available HR staff member (round-robin or load-balanced)
- Useful for: interview scheduling, support intake, sales calls

### Availability Logic

Availability is computed in real-time from:
1. Staff's working hours (from `hr.attendance` schedule)
2. Existing calendar events (all types: meetings, OOO, focus time, leave)
3. Public holidays (excluded from available slots)
4. Buffer times between bookings
5. Max bookings per day cap

Slots shown to external booker are only the genuinely free windows — no manual maintenance required.

### Notifications

| Event | Notified Parties | Channel |
|---|---|---|
| New booking | Staff + Booker | Email + LINE (staff) |
| Cancellation | Staff + Booker | Email |
| Reschedule | Staff + Booker | Email |
| 24h reminder | Booker | Email |
| 1h reminder | Staff | LINE + in-app |

### ERP Integration

- Booking from a supplier domain → auto-link event to supplier contact record
- Booking with "PO Number" custom question answered → auto-link to that PO
- Interview booking page → auto-link event to recruitment candidate record
- Booking confirmation email uses the **Email Templates** system (`Booking Link Invite` template)

### Booking Data Model (additions to calendar schema)

```sql
booking_pages
  id, tenant_id, employee_id
  slug                   -- URL path segment: "jane-wang/30min"
  name, description
  duration_minutes
  buffer_before_minutes, buffer_after_minutes
  advance_notice_hours
  booking_window_days
  max_bookings_per_day
  location_type          -- 'video' | 'in_person' | 'phone'
  location_value         -- address or auto for video
  questions              -- JSON: [{label, type, required}]
  confirmation_message
  allow_cancellation     boolean
  allow_reschedule       boolean
  cancellation_deadline_hours
  is_active              boolean
  is_team_page           boolean
  team_assignment        -- 'round_robin' | 'load_balanced'
  created_at             timestamptz

booking_page_team_members
  page_id, employee_id

booking_appointments
  id, page_id, tenant_id
  assigned_to_employee_id
  calendar_event_id      -- FK to calendar_events
  booker_name, booker_email, booker_phone
  booker_answers         -- JSON: question responses
  status                 -- 'confirmed' | 'cancelled' | 'rescheduled' | 'completed'
  booked_at              timestamptz
  cancelled_at           timestamptz
  cancellation_reason    text
  erp_entity_type        -- auto-linked ERP entity
  erp_entity_id
  created_at             timestamptz
```

---

## Contacts

### Contact Scopes

```
org-wide          ← visible to all staff in tenant
  └─ departmental ← visible to dept members + manager
       └─ personal ← visible only to individual employee
```

### Contact Types

| Type | Description |
|---|---|
| `person` | Individual contact |
| `group` | Named list with members |
| `distribution_list` | Group with email address; expands on compose |
| `entity` | Company / org record (parent of person contacts) |

### ERP Entity Linking (Auto-created on entity creation)

| ERP Module | Entity | Auto-created contact type |
|---|---|---|
| Purchasing | Suppliers | `entity` |
| Purchasing | Vendors | `entity` |
| CRM | Companies | `entity` |
| CRM | Contacts | `person` |
| Org | Employees | `person` (read-only) |
| Org | Departments | `group` (auto-membership) |
| HR | Recruitment candidates | `person` (external) |
| HR | Emergency contacts | `person` (from employee record) |

### Contact Detail — Relationship Panel
```
Supplier Co. Ltd.
  ├─ ERP Links:  [Supplier #S-0012]  [3 Open POs]  [12 Invoices]
  ├─ People:     Jane Wang (Account Mgr)  ·  Tom Liu (Finance)
  ├─ Emails:     47 threads  (last: 3 days ago)
  ├─ Calendar:   Next meeting: Jul 8
  └─ Activity:   Last PO sent Jun 28  ·  Invoice #INV-088 overdue
```

### Contact Import Sources

| Source | Format | Method |
|---|---|---|
| Google Contacts | CardDAV / People API | OAuth sync |
| Microsoft / Outlook | CardDAV / MS Graph | OAuth sync |
| iCloud | CardDAV | App-specific password |
| Nextcloud / any CardDAV | CardDAV | Username + password |
| vCard file | `.vcf` | File upload |
| CSV / Excel | `.csv`, `.xlsx` | Upload + field mapping UI |

### Import Wizard (3 steps)
1. **Upload & Preview** — drag-drop file, preview first 5 rows
2. **Field Mapping** — auto-detect headers, manual override, target namespace selector
3. **Dedup & Import** — show new / duplicate / conflict counts; resolve before commit

### Sync & Import Features
- ETags-based delta sync — only fetch changed records
- Conflict strategy per account: `remote_wins` | `local_wins` | `ask_user`
- Sync log visible per contact (last synced, source, field changes)
- Saved CSV column mappings per tenant for repeat imports (`contact_field_maps`)

### Deduplication
```
Match priority:
  1. email (exact)
  2. phone (normalized E.164)
  3. name + company (fuzzy, >85% similarity)

On match:
  - Side-by-side field diff
  - Options: Merge (per-field winner) | Keep Both | Skip
```

### Additional Contact Features
- **Custom fields**: per-tenant, types: text / number / date / select
- **Tags**: freeform, multi-select, usable in AI skill triggers
- **Business card / signature OCR**: Gemini Vision extracts fields from image or email footer
- **Contact timeline**: all emails, meetings, invoices, tasks with that contact in one chronological view
- **Bulk operations**: tag, export, reassign scope, merge duplicates
- **Employee offboarding**: prompt to transfer personal contacts to dept scope

---

## ERP Integration Points

### Missing ERP Hooks (to add alongside comms module)

| Module | Missing Integration |
|---|---|
| Leave | Final approval email to employee; leave block in dept calendar |
| BusinessTravel | Approval email; travel itinerary in calendar |
| Resignation | Final decision email; offboarding calendar anchors |
| Recruitment | Candidate contact records; interview calendar events; stage-change emails |
| ProbationTracker | 14-day warning email; probation review in calendar; mentor as linked contact |
| Training | Enrollment email; course dates in calendar |
| Schedule | Email fallback for employees without LINE binding |
| Overtime | Comp-time expiry warning email |
| TransferRequest | Approval email; effective date in calendar |
| LeaveOfAbsence | Return date in HR calendar; return confirmation email |
| Salary | Payslip email fallback for non-LINE users |
| Workflows | `reminder_at` → email delivery (currently written to DB only) |
| Tasks | Calendar event on create; email reminder before due date |
| Approvals | Email to applicant on final decision at every chain |

---

## Database Schema

```sql
-- ─────────────────────────────────────────────────────────
-- ACCOUNT CONNECTIONS
-- ─────────────────────────────────────────────────────────

create table email_accounts (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  employee_id           uuid references employees(id),
  mailbox_id            uuid references email_mailboxes(id),
  provider              text not null,  -- 'gmail'|'outlook'|'icloud'|'generic'
  email_address         text not null,
  display_name          text,
  credentials_encrypted jsonb not null,
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

-- ─────────────────────────────────────────────────────────
-- SHARED / TEAM MAILBOXES
-- ─────────────────────────────────────────────────────────

create table email_mailboxes (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  address             text not null,
  display_name        text not null,
  default_assignee_id uuid references employees(id),
  sla_hours           int default 24,
  created_at          timestamptz default now()
);

create table email_mailbox_members (
  mailbox_id  uuid not null references email_mailboxes(id),
  employee_id uuid not null references employees(id),
  role        text not null check (role in ('read','reply','admin')),
  primary key (mailbox_id, employee_id)
);

-- ─────────────────────────────────────────────────────────
-- FOLDERS
-- ─────────────────────────────────────────────────────────

create table email_folders (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references email_accounts(id),
  tenant_id        uuid not null references tenants(id),
  name             text not null,
  folder_type      text not null check (folder_type in ('inbox','sent','drafts','trash','archive','spam','custom')),
  imap_path        text not null,
  parent_folder_id uuid references email_folders(id),
  display_order    int default 0,
  color            text,
  icon             text,
  is_system        boolean default false,
  unread_count     int default 0,
  total_count      int default 0
);

-- ─────────────────────────────────────────────────────────
-- THREADS
-- ─────────────────────────────────────────────────────────

create table email_threads (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id),
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
  assigned_to_employee_id uuid references employees(id),
  sla_due_at              timestamptz,
  created_at              timestamptz default now()
);

-- ─────────────────────────────────────────────────────────
-- MESSAGES
-- ─────────────────────────────────────────────────────────

create table email_messages (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id),
  account_id              uuid not null references email_accounts(id),
  mailbox_id              uuid references email_mailboxes(id),
  thread_id               uuid references email_threads(id),
  folder_id               uuid references email_folders(id),
  imap_uid                bigint,
  message_id_header       text unique,
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
  -- identity
  sent_by_employee_id     uuid references employees(id),
  -- dates
  received_at             timestamptz,
  sent_at                 timestamptz,
  draft_saved_at          timestamptz,
  -- attachments
  has_attachments         boolean default false,
  attachment_count        int default 0,
  size_bytes              bigint,
  -- search
  body_search_vector      tsvector generated always as (
    to_tsvector('english', coalesce(subject,'') || ' ' || coalesce(body_text_cache,''))
  ) stored
);

create index email_messages_search_idx on email_messages using gin(body_search_vector);
create index email_messages_thread_idx on email_messages(thread_id);
create index email_messages_folder_idx on email_messages(folder_id);

-- ─────────────────────────────────────────────────────────
-- DRAFTS
-- ─────────────────────────────────────────────────────────

create table email_drafts (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  account_id            uuid not null references email_accounts(id),
  employee_id           uuid not null references employees(id),
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

-- ─────────────────────────────────────────────────────────
-- ATTACHMENTS
-- ─────────────────────────────────────────────────────────

create table email_attachments (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  message_id      uuid references email_messages(id),
  filename        text not null,
  content_type    text,
  size_bytes      bigint,
  storage_path    text not null,
  sha256_hash     text,
  is_inline       boolean default false,
  erp_entity_type text,
  erp_entity_id   uuid,
  created_at      timestamptz default now()
);

-- ─────────────────────────────────────────────────────────
-- LABELS
-- ─────────────────────────────────────────────────────────

create table email_labels (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id),
  name                 text not null,
  color                text,
  icon                 text,
  label_type           text not null check (label_type in ('system','smart','custom')),
  scope                text not null check (scope in ('personal','dept','org')),
  owner_id             uuid references employees(id),
  department_id        uuid references departments(id),
  smart_label_prompt   text,
  confidence_threshold numeric default 0.85,
  created_at           timestamptz default now()
);

create table email_thread_labels (
  thread_id  uuid not null references email_threads(id),
  label_id   uuid not null references email_labels(id),
  applied_by uuid references employees(id),
  applied_at timestamptz default now(),
  source     text check (source in ('manual','ai','rule')),
  primary key (thread_id, label_id)
);

-- ─────────────────────────────────────────────────────────
-- CATEGORIES
-- ─────────────────────────────────────────────────────────

create table email_categories (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  name          text not null,
  color         text,
  icon          text,
  description   text,
  display_order int default 0
);

create table email_thread_categories (
  thread_id   uuid not null references email_threads(id) primary key,
  category_id uuid not null references email_categories(id),
  set_by      uuid references employees(id),
  set_at      timestamptz default now()
);

-- ─────────────────────────────────────────────────────────
-- LABEL RULES
-- ─────────────────────────────────────────────────────────

create table email_label_rules (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id),
  name       text not null,
  priority   int default 10,
  is_active  boolean default true,
  conditions jsonb not null,
  actions    jsonb not null,
  created_by uuid references employees(id),
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────────
-- EMAIL → ERP LINKS
-- ─────────────────────────────────────────────────────────

create table email_entity_links (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  thread_id   uuid not null references email_threads(id),
  entity_type text not null,
  entity_id   uuid not null,
  linked_by   uuid references employees(id),
  linked_at   timestamptz default now()
);

-- ─────────────────────────────────────────────────────────
-- AI SKILLS
-- ─────────────────────────────────────────────────────────

create table email_skills (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  name               text not null,
  description        text,
  version            int default 1,
  trigger_source     text check (trigger_source in ('email','calendar','contact')),
  trigger_conditions jsonb not null,
  prompt_template    text not null,
  actions            jsonb not null,
  human_in_loop      boolean default false,
  is_active          boolean default false,
  approved_by        uuid references employees(id),
  approved_at        timestamptz,
  created_by         uuid references employees(id),
  created_at         timestamptz default now()
);

create table email_skill_runs (
  id             uuid primary key default gen_random_uuid(),
  skill_id       uuid not null references email_skills(id),
  thread_id      uuid references email_threads(id),
  status         text check (status in ('pending_approval','running','completed','failed','rejected')),
  input_snapshot jsonb,
  gemini_output  jsonb,
  actions_taken  jsonb,
  error_message  text,
  executed_by    uuid references employees(id),
  approved_by    uuid references employees(id),
  started_at     timestamptz default now(),
  completed_at   timestamptz
);

-- ─────────────────────────────────────────────────────────
-- CALENDAR
-- ─────────────────────────────────────────────────────────

create table calendar_accounts (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  employee_id           uuid references employees(id),
  provider              text not null,
  caldav_url            text,
  credentials_encrypted jsonb,
  last_synced_at        timestamptz,
  is_active             boolean default true
);

create table calendar_calendars (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  account_id    uuid references calendar_accounts(id),
  name          text not null,
  calendar_type text check (calendar_type in ('personal','department','group','org','mailbox','holiday','erp')),
  color         text,
  owner_id      uuid references employees(id),
  department_id uuid references departments(id),
  is_visible    boolean default true,
  caldav_path   text
);

create table calendar_events (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  calendar_id     uuid not null references calendar_calendars(id),
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
  erp_entity_id   uuid,
  created_by      uuid references employees(id),
  created_at      timestamptz default now()
);

create table calendar_event_attendees (
  event_id    uuid not null references calendar_events(id),
  employee_id uuid references employees(id),
  email       text,
  rsvp_status text check (rsvp_status in ('pending','accepted','declined','tentative')),
  primary key (event_id, coalesce(employee_id::text, email))
);

create table holidays (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  country_code text,
  date         date not null,
  name         text not null,
  holiday_type text check (holiday_type in ('national','regional','company')),
  is_work_day  boolean default false
);

-- ─────────────────────────────────────────────────────────
-- BOOKING LINKS (CALENDLY-STYLE)
-- ─────────────────────────────────────────────────────────

create table booking_pages (
  id                         uuid primary key default gen_random_uuid(),
  tenant_id                  uuid not null references tenants(id),
  employee_id                uuid references employees(id),
  slug                       text not null unique,
  name                       text not null,
  description                text,
  duration_minutes           int not null default 30,
  buffer_before_minutes      int default 0,
  buffer_after_minutes       int default 10,
  advance_notice_hours       int default 24,
  booking_window_days        int default 30,
  max_bookings_per_day       int,
  location_type              text check (location_type in ('video','in_person','phone')),
  location_value             text,
  questions                  jsonb,
  confirmation_message       text,
  allow_cancellation         boolean default true,
  allow_reschedule           boolean default true,
  cancellation_deadline_hours int default 24,
  is_active                  boolean default true,
  is_team_page               boolean default false,
  team_assignment            text check (team_assignment in ('round_robin','load_balanced')),
  created_at                 timestamptz default now()
);

create table booking_page_team_members (
  page_id     uuid not null references booking_pages(id),
  employee_id uuid not null references employees(id),
  primary key (page_id, employee_id)
);

create table booking_appointments (
  id                      uuid primary key default gen_random_uuid(),
  page_id                 uuid not null references booking_pages(id),
  tenant_id               uuid not null references tenants(id),
  assigned_to_employee_id uuid references employees(id),
  calendar_event_id       uuid references calendar_events(id),
  booker_name             text not null,
  booker_email            text not null,
  booker_phone            text,
  booker_answers          jsonb,
  status                  text default 'confirmed' check (status in ('confirmed','cancelled','rescheduled','completed')),
  booked_at               timestamptz default now(),
  cancelled_at            timestamptz,
  cancellation_reason     text,
  erp_entity_type         text,
  erp_entity_id           uuid,
  created_at              timestamptz default now()
);

-- ─────────────────────────────────────────────────────────
-- CONTACTS
-- ─────────────────────────────────────────────────────────

create table contact_accounts (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  employee_id           uuid references employees(id),
  provider              text,
  carddav_url           text,
  credentials_encrypted jsonb,
  sync_interval_minutes int default 60,
  conflict_strategy     text default 'ask_user' check (conflict_strategy in ('remote_wins','local_wins','ask_user')),
  last_synced_at        timestamptz
);

create table contacts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  contact_type    text check (contact_type in ('person','group','distribution_list','entity')),
  scope           text check (scope in ('personal','dept','org')),
  owner_id        uuid references employees(id),
  department_id   uuid references departments(id),
  display_name    text not null,
  email           text,
  phone           text,
  company         text,
  title           text,
  notes           text,
  avatar_url      text,
  erp_entity_type text,
  erp_entity_id   uuid,
  source          text check (source in ('manual','carddav','csv','erp_sync')),
  is_erp_managed  boolean default false,
  carddav_etag    text,
  tags            text[],
  custom_fields   jsonb,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create table contact_group_members (
  group_id   uuid not null references contacts(id),
  contact_id uuid not null references contacts(id),
  added_by   uuid references employees(id),
  added_at   timestamptz default now(),
  primary key (group_id, contact_id)
);

create table contacts_staging (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  account_id  uuid references contact_accounts(id),
  raw_vcard   text,
  parsed_json jsonb,
  status      text check (status in ('pending','merged','skipped','imported')),
  created_at  timestamptz default now()
);

create table contact_merge_log (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid references contacts(id),
  source_id   uuid references contacts(id),
  action      text check (action in ('merged','kept_both','skipped')),
  field_diffs jsonb,
  resolved_by uuid references employees(id),
  resolved_at timestamptz default now()
);

create table contact_field_maps (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  name         text not null,
  mapping_json jsonb not null,
  created_by   uuid references employees(id),
  created_at   timestamptz default now()
);

-- ─────────────────────────────────────────────────────────
-- AUDIT & NOTIFICATIONS
-- ─────────────────────────────────────────────────────────

create table comms_access_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  employee_id uuid not null references employees(id),
  action      text not null,
  entity_type text,
  entity_id   uuid,
  metadata    jsonb,
  accessed_at timestamptz default now()
);

create table notification_deliveries (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  employee_id     uuid not null references employees(id),
  event_type      text not null,
  event_payload   jsonb,
  channel_tried   text[],
  channel_success text,
  delivered_at    timestamptz,
  error_log       jsonb,
  created_at      timestamptz default now()
);
```

---

## File Structure

```
src/
  lib/
    comms/
      ImapAdapter.js            ← imapflow wrapper: connect, sync, IDLE push
      SmtpAdapter.js            ← nodemailer: send, OAuth2
      CalDavAdapter.js          ← tsdav CalDAV: sync events, free/busy
      CardDavAdapter.js         ← tsdav CardDAV: sync contacts
      EmailParser.js            ← parse MIME, extract body + attachments
      VCardParser.js            ← vcard-parser wrapper
      ContactImporter.js        ← CSV/vCard import, field mapping, dedup
      ContactDeduplicator.js    ← matching logic, merge resolution
      ContactSyncEngine.js      ← polling, delta sync, ETag tracking
      SkillEngine.js            ← evaluate triggers, call Gemini, fire actions
      SkillRegistry.js          ← CRUD skills from DB
      NotificationDispatcher.js ← LINE → email → in-app fallback
      SearchService.js          ← unified full-text search
      AttachmentManager.js      ← upload, dedup, virus scan, viewer links
      BookingService.js         ← availability computation, slot generation

  pages/
    comms/
      Inbox.jsx                 ← unified inbox, folder + account sidebar
      EmailDetail.jsx           ← thread view with staff identity badges
      EmailComposer.jsx         ← Maily composer, template picker, signature
      DraftList.jsx             ← drafts with auto-save indicator
      SentItems.jsx             ← sent view with staff identity filter
      Calendar.jsx              ← FullCalendar with layer toggles
      CalendarEventDetail.jsx   ← event view with ERP links + video link
      BookingPageList.jsx       ← staff's booking pages list
      BookingPageEditor.jsx     ← create / edit booking page config
      BookingPublicPage.jsx     ← public-facing slot picker (unauthenticated)
      BookingConfirmation.jsx   ← post-booking confirmation page
      Contacts.jsx              ← contact list with scope tabs
      ContactDetail.jsx         ← contact + relationship panel + timeline
      ContactImportWizard.jsx   ← 3-step upload → map → dedup UI
      ContactMergeReview.jsx    ← side-by-side conflict resolver
      ContactSyncSettings.jsx   ← per-account sync config
      SkillBuilder.jsx          ← visual skill trigger + action chain creator
      SkillList.jsx             ← skill library with analytics
      LabelManager.jsx          ← label CRUD with scope selector
      CategoryManager.jsx       ← category CRUD
      RuleBuilder.jsx           ← label rule builder
      SharedMailboxSettings.jsx ← mailbox setup, member roles, SLA
      MailboxAssignQueue.jsx    ← thread assignment queue
      AccountSettings.jsx       ← connect / disconnect accounts
      OOOSettings.jsx           ← out-of-office + delegate config

  modules/
    comms.jsx                   ← single lazy bundle for all comms pages
```

---

## Gap Checklist

- [x] Email storage (local Supabase cache, not live IMAP fetch every view)
- [x] Drafts (auto-save 20s, session recovery, IMAP sync, shared mailbox drafts)
- [x] Sent items (local + IMAP copy, staff identity marker, delivery status)
- [x] Folders (system + custom + nested, shared mailbox folders, color + icon)
- [x] Labels — multi-select: system / smart AI / custom, scoped, thread-level
- [x] Categories — single-select, color-coded, tenant-configurable
- [x] Label rules / filters — conditions + actions, auto-apply on arrival
- [x] Shared / team mailboxes (hr@, finance@, support@, purchasing@)
- [x] Staff identity markers — internal badge, never visible to external recipients
- [x] Thread assignment + SLA timer + reassignment in shared mailboxes
- [x] Email → Task / Workflow / Project / ERP linking
- [x] Reverse display — emails tab in task/workflow/project detail
- [x] AI Skill Engine — trigger, Gemini prompt, action chain
- [x] Skill chaining — output of one feeds next
- [x] Human-in-the-loop for high-stakes skill actions
- [x] Skill versioning, analytics, error handling, approval workflow, test sandbox
- [x] Skill Builder UI — visual creator
- [x] Email templates with variable placeholders
- [x] Per-tenant and per-user email signatures
- [x] Booking Link template for calendar invites
- [x] Attachment management — storage, inline viewer, ERP linking, dedup, virus scan
- [x] Notification Dispatcher — LINE → email → in-app fallback chain
- [x] 10 ERP modules missing email/push delivery all covered
- [x] Unified search — email + calendar + contacts + ERP, single endpoint
- [x] Calendar: personal + department + group + org + holiday + ERP overlays
- [x] Department calendar with time-off integration + coverage warnings
- [x] Public holidays — by country + company custom holidays
- [x] Event types: meeting / focus_time / out_of_office / travel / tentative / private / leave / holiday
- [x] Out-of-office — auto-reply, delegation, dept calendar visibility, LINE notify
- [x] Meeting scheduling assistant — free/busy, natural language
- [x] Video call link auto-generation (Meet / Teams)
- [x] Booking links (Calendly-style) — public pages, multi-duration, team/round-robin
- [x] Booking availability — computed from schedule + existing events + OOO + holidays
- [x] Booking ERP auto-linking — supplier domain, PO number, candidate
- [x] Contacts: scoped (personal / dept / org) with permissions
- [x] Contact types: person / group / distribution_list / entity
- [x] ERP entity auto-linking on entity creation
- [x] Contact import: CardDAV / vCard / CSV / Excel with field mapping wizard
- [x] Deduplication with side-by-side conflict resolver and merge log
- [x] Contact timeline — emails + meetings + invoices + tasks per contact
- [x] Business card / email signature OCR (Gemini Vision)
- [x] Custom fields + tags per contact, usable in skill triggers
- [x] Contact sync — ETags delta, conflict strategy per account, sync log
- [x] Multi-account per user — unified inbox, scope rules
- [x] Privacy / PDPA compliance — consent flag, right to deletion cascade
- [x] Data retention policy — configurable auto-archive
- [x] Audit log — who accessed what, when
- [x] Full database schema — all tables, indexes, relationships
- [x] 14 ERP module integration hooks listed and ready to wire
