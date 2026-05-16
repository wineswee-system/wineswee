# SME Ops — HRM & Workflow System Features

**System:** SME Ops ERP  
**Version scope:** Current codebase (as of 2026-05-14)  
**Audience:** Product, operations, onboarding

---

## Table of Contents

1. [Human Resource Management (HRM)](#1-human-resource-management)
   - 1.1 [Attendance & Scheduling](#11-attendance--scheduling)
   - 1.2 [Leave & Time-Off](#12-leave--time-off)
   - 1.3 [Payroll & Compensation](#13-payroll--compensation)
   - 1.4 [Recruitment & Onboarding](#14-recruitment--onboarding)
   - 1.5 [Performance & Development](#15-performance--development)
   - 1.6 [Employee Relations & Benefits](#16-employee-relations--benefits)
   - 1.7 [Documents & Forms](#17-documents--forms)
   - 1.8 [Employee Self-Service](#18-employee-self-service)
   - 1.9 [HR Analytics & AI](#19-hr-analytics--ai)
2. [Workflow & Process Management](#2-workflow--process-management)
   - 2.1 [Workflow Templates & Instances](#21-workflow-templates--instances)
   - 2.2 [Task Management](#22-task-management)
   - 2.3 [Approval Engine](#23-approval-engine)
   - 2.4 [Project Management](#24-project-management)
   - 2.5 [Checklists & SOPs](#25-checklists--sops)
   - 2.6 [Process Settings](#26-process-settings)
3. [Cross-cutting Features](#3-cross-cutting-features)
4. [Database Reference](#4-database-reference)
5. [Integration Points](#5-integration-points)

---

## 1. Human Resource Management

### 1.1 Attendance & Scheduling

#### Attendance (`/hr/attendance`)
Records employee clock-in/clock-out events with geo-location and IP logging. Managers can perform manual corrections when needed.

| Feature | Detail |
|---|---|
| Clock-in / Clock-out | Server-side validation via Supabase Edge Function `clock-in` |
| Geo-location | GPS lat/lng captured on each punch |
| IP Logging | Client IP stored for audit |
| Missed Clockout Detection | Edge function `check-missed-clockout` auto-flags unpunched employees |
| Admin Correction | `PunchCorrection` page for retroactive time adjustments |
| PDF Export | Attendance report export |

**Key tables:** `attendance_records`, `employees`

---

#### Schedule Management (`/hr/schedule`)
Multi-store shift scheduling with labor law compliance checking, AI-assisted optimization, and a full self-service portal for employees.

**Schedule Builder (Manager)**
- Monthly and weekly calendar grid with color-coded shift types
- One-click AI scheduling (Supabase Edge Function) or rule-based algorithm
- Minimum staffing enforcement (configurable per weekday / weekend)
- Labor law validator: enforces max daily/weekly/monthly hours, mandatory rest days, fatigue score
- Shift swap request queue with manager approval
- Cross-store assignment tab for multi-location operations
- Holiday blocking — auto-clears shifts on public holidays
- Schedule PDF export for printing

**My Schedule (Employee)**
- Personal weekly/monthly view of assigned shifts
- Request shift swap directly from the view

**Schedule Rules (`/hr/schedule-rules`)**
- Configure scheduling rules per labor law category
- Effective year management for historical rule versions

**Shift Types**
- Custom shift definitions: name, start/end time, color
- Referenced across all scheduling views

**Key tables:** `schedule_data`, `shift_types`, `holidays`, `scheduling_rules_snapshot`

---

### 1.2 Leave & Time-Off

#### Leave Requests (`/hr/leave`)
End-to-end leave processing from employee request to manager approval with attachment support.

| Feature | Detail |
|---|---|
| Leave types | Annual, sick, personal, maternity, paternity, and custom-configured types |
| Application unit | Days, half-days, or hours (configured per type per store) |
| Attachment upload | Up to 5 files per request stored in `leave-attachments` bucket |
| Approval routing | Routed through configurable approval chains |
| Approval actions | Approve / Reject with rejection reason |
| Status tracking | Pending → Approved / Rejected / Cancelled |
| Print | Leave sign-off PDF for paper filing |

**Key tables:** `leave_requests`, `leave_entitlements`, `leave_step_settings`

---

#### Leave Balances (`/hr/leave-balances`)
Year-by-year view of each employee's entitlements showing allocated vs. used days per leave type.

#### Leave Calendar (`/hr/leave-calendar`)
Team calendar showing all approved leaves, useful for capacity planning.

#### Overtime (`/hr/overtime`)
Request, track, and approve overtime. Supports hour-based and day-based overtime with four statutory categories per Taiwan Labor Standards Act:
- §32 Weekday overtime
- §24 Rest day overtime
- §39 Holiday overtime
- §40 National holiday overtime

**Key tables:** `overtime_requests`

#### Holidays (`/hr/holidays`)
Manage national and company-specific holidays. One-click import by year from public calendar API via `refresh-holidays` Edge Function.

---

### 1.3 Payroll & Compensation

#### Payroll Runs (`/hr/payroll`)
Batch payroll generation with full decomposition of earnings, deductions, and employer costs.

**Earnings components**
- Base salary (regular) + insurable base (dual-base system)
- Allowances: meal, transport, supervisor, night shift, cross-store, attendance bonus, role
- Four statutory overtime categories (§32 / §24 / §39 / §40)
- Bonuses

**Deduction components**
- Labor insurance (employee share)
- Health insurance (employee share)
- Pension contribution (employee share)
- Occupational injury insurance
- National Health Insurance supplementary premium
- Income tax withholding

**Employer costs**
- Auto-calculated `employer_total_cost` field aggregating employer-side insurance/pension contributions

**Key operations**
- `generate_payroll()` RPC — generates all records for a pay period in one call
- Batch modal for bulk adjustments
- Bank export (CSV for bank upload)
- Year-end processing modal
- Import from external CSV

**Key tables:** `payroll_runs`, `payroll_records`, `salary_structures`, `salary_records`

---

#### Salary Structures (`/hr/salary-structures`)
Define the salary template for each employee or role: base salary, allowances, insurable base, and insurance grade. Applied when generating payroll runs.

#### Salary Records (`/hr/salary`)
Browse monthly salary breakdowns per employee with drill-down into all components.

#### Bonus (`/hr/bonus`)
Configure bonus rules (festival, performance, commission) and record individual bonus disbursements.

#### Legal Deductions (`/hr/legal-deductions`)
Manage statutory insurance settings and grade tables. Links to `insurance_grades` for bracket-based contribution calculation.

#### Tax Forms (`/hr/tax-forms`)
Generate annual tax withholding documents per employee for compliance filing.

#### Insurance Grade Monitor (`/hr/insurance-grade-monitor`)
Track each employee's current insurance grade classification and alert on out-of-range grades.

#### Compensation Benchmark (`/hr/compensation-benchmark`)
Define salary bands (min/max) by department and role for market comparison and pay equity analysis.

#### Labor Law Rates (`/hr/labor-law-rates`)
Configure overtime multipliers, holiday pay rates, and minimum wage thresholds referenced by payroll calculation.

---

### 1.4 Recruitment & Onboarding

#### Recruitment (`/hr/recruitment`)
Lightweight Applicant Tracking System (ATS) for posting jobs and tracking applications.

| Feature | Detail |
|---|---|
| Job postings | Title, department, location, employment type (full-time / part-time / contract) |
| Applicant count | Running tally of applications per posting |
| Status flow | Open → Closed |
| Department filter | Organize open roles by department |

**Key table:** `recruitment_jobs`

#### Probation Tracker (`/hr/probation`)
Track new-hire probation periods: start/end dates, status (ongoing/passed/extended/failed), and reviewer notes.

#### Transfer (`/hr/transfer`)
Initiate and approve internal employee transfers between departments or stores.

#### Resignation (`/hr/resignation`)
Process employee resignations: notice date, last working day, reason, exit interview scheduling.

#### Severance (`/hr/severance`)
Calculate and record final separation payments based on service length and company policy.

---

### 1.5 Performance & Development

#### Performance Reviews (`/hr/performance`)
Structured quarterly performance evaluation system.

| Feature | Detail |
|---|---|
| Review period | Q1–Q4 (quarterly) |
| Rating scale | S / A+ / A / B+ / B / C |
| Goal categories | Sales, Learning, Project, Quality, Collaboration, Other |
| Goal tracking | Current vs target value with custom units |
| Self-evaluation | Employee self-assessment mode before manager review |
| Reviewer assignment | Explicit reviewer field per review record |

**Key tables:** `performance_reviews`, `performance_goals`

#### Training (`/hr/training`)
Create training courses and manage employee enrollment and completion tracking.

| Feature | Detail |
|---|---|
| Course definition | Name, description, dates, instructor |
| Enrollment | Link employees to courses |
| Completion status | In progress / Completed / Dropped |

**Key tables:** `training_courses`, `training_enrollments`

#### Attrition Prediction (`/hr/attrition`)
ML-based employee turnover risk scoring. Stores periodic snapshots per employee for trend tracking.

**Key table:** `attrition_risk_snapshots`

---

### 1.6 Employee Relations & Benefits

#### Engagement Surveys (`/hr/engagement`)
Build and distribute employee engagement surveys. Collect and analyze responses.

**Key tables:** `engagement_surveys`, `engagement_responses`

#### Benefit Settings (`/hr/benefits`)
Define benefit policies (medical, meal subsidy, transport, etc.) scoped to store, department, or company-wide.

**Key table:** `benefit_policies`

#### Business Travel (`/hr/business-travel`)
Submit and approve business trip requests including destination, dates, purpose, and budget.

**Key table:** `business_trips`

#### Expenses (`/hr/expenses`)
Employee expense claims with receipt tracking, category classification, and reimbursement approval.

**Key table:** `expenses`

#### Labor Inspection (`/hr/labor-inspection`)
Record labor inspection visits, findings, and remediation status for compliance audit trail.

---

### 1.7 Documents & Forms

#### Documents (`/hr/documents`)
Central document repository for HR policies, templates, and employee agreements with category organization.

#### Form Builder (`/hr/form-builder`)
Visual builder for creating custom HR forms with dynamic field types (text, dropdown, date, checkbox, etc.).

**Key tables:** `custom_forms`, `custom_form_fields`

#### HR Forms (`/hr/forms`)
Browse available forms. Employees can navigate to forms assigned to them.

#### Form Submissions (`/hr/form-submissions`)
Admin view of all submitted form responses with employee and timestamp metadata.

#### Custom Form Fill (`/hr/form/:id/fill`)
Employee-facing form completion interface for any published custom form.

**Key table:** `form_submissions`

---

### 1.8 Employee Self-Service

#### Self-Service Portal (`/hr/self-service`)
All-in-one employee portal providing read access to personal HR data and action capabilities.

| Available Data | Action |
|---|---|
| Attendance records | Download own records |
| Leave history & balances | Submit new leave requests |
| Salary records | View monthly breakdowns |
| Performance reviews | Complete self-evaluations |
| Assigned forms | Fill and submit forms |
| Digital signature | Upload/replace signature for HR documents |

---

### 1.9 HR Analytics & AI

#### HR Reports (`/hr/reports`)
Dashboard with key HR metrics:
- Active headcount
- Late arrival rate
- Pending approvals
- Monthly payroll total
- Attrition trends

#### HR Assistant (`/hr/assistant`)
AI-powered chatbot for HR policy queries and guided request processing, powered by integrated LLM.

#### Work Unit Settings (`/hr/work-unit-settings`)
Configure store-level HR parameters: operating hours, staffing minimums, store-specific policy overrides.

---

## 2. Workflow & Process Management

### 2.1 Workflow Templates & Instances

#### Workflows (`/process/workflows`)
The core SOP and workflow orchestration hub. Supports template libraries and live instance tracking.

**Templates**
- Create from scratch or via AI-assisted generation
- Versioned with step definitions: title, description, assigned role/department/employee, expected store
- Categorized with tags
- Deploy button to instantiate a template into a running workflow

**Active Instances**
- Each instance inherits steps from its template at deploy time
- Step-by-step progress tracking: Not Started → In Progress → Completed / Blocked
- Instance-level assignee and store context
- Notes and confirmation fields per step
- Due date tracking

**Archived Instances**
- View completed or cancelled workflow runs with full step history

**AI Assistant Tab**
- Describe a process in natural language and get a draft workflow template with steps auto-generated

**Identifiers**
- Each workflow template and instance carries a formatted identifier badge (e.g. `WF-000001`) displayed in lists and detail views for unambiguous reference

**Key tables:** `workflows`, `workflow_instances`, `workflow_steps`, `workflow_categories`, `tags`

---

### 2.2 Task Management

#### Tasks (`/process/tasks`)
Full-featured task tracker integrated with workflows and projects.

**Task fields**
- Title, description, status, priority (Low / Medium / High / Urgent)
- Assignee (employee), due date, bucket/category
- Linked workflow instance, linked project
- Formatted identifier badge (e.g. `TK-0000001`) for unique reference

**Views**

| View | Description |
|---|---|
| List | Flat filterable list with inline status changes |
| Kanban | Cards grouped by status columns (drag-and-drop) |
| Calendar | Tasks plotted by due date |
| Timeline | Gantt-style bar chart for duration and dependency visualization |

**Rich task features**

| Feature | Detail |
|---|---|
| Dependencies | Task can block/be blocked by other tasks; visualized in Timeline view |
| Checklists | Attach reusable checklists or add inline checklist items |
| Confirmations | Require named sign-off with timestamp and optional notes |
| Attachments | File uploads stored in `task-attachments` bucket |
| Comments | Threaded discussion on each task |
| Watchers | Subscribe employees to receive updates |
| @Mentions | Notify specific employees within comments |

**Filters:** Assignee, store, bucket, project, workflow instance

**Key tables:** `tasks`, `task_dependencies`, `task_comments`, `task_attachments`, `task_checklists`, `task_checklist_items`, `task_confirmations`, `task_watchers`, `task_mentions`

---

### 2.3 Approval Engine

#### Approvals (`/process/approvals`)
Configurable multi-step approval system used across HR requests, expenses, and custom documents.

**Approval Chains**
- Define named chains with ordered steps
- Each step targets: a fixed employee, a role, a department, or a hybrid combination
- Chains are reusable across modules

**Approval Forms**
- Create approval documents linked to tasks or standalone
- Attach chain to define required sign-off sequence
- Each step: Pending → Approved or Rejected (with reason)
- Priority level (Normal / High / Urgent)

**Approval Rules**
- Auto-route to specific chains based on module, document type, or conditions (e.g. expense amount > threshold)
- Configured per organization

**Approval Delegation**
- Temporary delegation of approval authority from one employee to another
- Date-bound: delegator, delegate, start date, end date

**Integrated with:** Leave requests, overtime, business trips, expenses, transfer requests, resignations, custom forms

**Key tables:** `approval_chains`, `approval_chain_steps`, `approval_forms`, `approval_form_steps`, `approval_rules`, `approval_requests`, `approval_delegations`

---

### 2.4 Project Management

#### Projects (`/process/projects`)
Lightweight project tracker with native integration into the task and workflow systems.

**Project fields**
- Name, description, status (Planning / In Progress / Complete / Paused / Cancelled)
- Owner, priority, department, store
- Start date, end date, budget

**Project sections**
- Organize work into phases or functional areas
- Each section has its own tasks

**Within a project**

| Tab | Content |
|---|---|
| Overview | Summary, status, key dates |
| Tasks | All tasks in this project, filterable |
| Workflows | Workflow instances attached to this project |
| Members | Team roster with roles |
| Changelog | Audit log of project changes |
| Custom Fields | Project-specific custom data fields |

**Key tables:** `projects`, `project_sections`, `project_custom_fields`

---

### 2.5 Checklists & SOPs

#### Checklists (`/process/checklists`)
Reusable checklists that can be attached to tasks or workflow steps.

- Define a checklist once; attach to any task
- Track item-level completion (checked/unchecked)
- Completed vs total item counter on the checklist card

**Key tables:** `checklists`, `task_checklists`, `task_checklist_items`

#### SOP Templates (`/process/sop-templates`)
Standard Operating Procedure templates — step-by-step reference documents for recurring processes. Deploy to create a workflow instance.

---

### 2.6 Process Settings

| Page | Purpose |
|---|---|
| Categories (`/process/settings/categories`) | Manage workflow and task categories with color coding |
| Approval Chains (`/process/settings/chains`) | Create and edit approval chain definitions |
| Chain Editor (`/process/settings/chains/:id`) | Step-level editing: order, role/dept/employee targeting, label |
| Expense Chains (`/process/settings/expense-chains`) | Approval rules specific to expense module (amount-based routing) |
| Tags (`/process/settings/tags`) | Manage tag definitions (name, color) for categorizing workflows and tasks |

---

## 3. Cross-cutting Features

### Formatted Identifiers
Every workflow template, workflow instance, and task carries a formatted identifier displayed as a badge in lists and detail views.

| Entity | Format | Example |
|---|---|---|
| Task | `TK-#######` | `TK-0000042` |
| Workflow / Instance | `WF-######` | `WF-000007` |

These identifiers are unique, stored in the database, and displayed prominently in UI for easy reference in communication and audit.

---

### LINE Notify Integration
Automated push notifications via LINE for:
- Task assignment (`notifyTaskAssignee`)
- Task start (`notifyTaskStarted`)
- Confirmation result (`notifyTaskConfirmationResult`)
- Approval decisions (`notifyApproval`)
- Schedule publication (`notifySchedulePublished`)
- Shift cover requests (`notifyCoverInvitationFromWeb`)

---

### Multi-Tenant Scoping
All data is scoped by `organization_id` (and often `store_id`) via `TenantContext`. No cross-tenant data leakage.

---

### Role-Based Access Control
HR and process operations are governed by Supabase RBAC (`roles`, `permissions`, `role_permissions` tables). Sensitive payroll and approval operations use RPC functions (`secure_*`) that enforce server-side authorization.

---

### Attachment Storage

| Bucket | Used by |
|---|---|
| `leave-attachments` | Leave request supporting documents |
| `task-attachments` | Task file uploads |
| Employee signatures | HR document digital signing |

---

## 4. Database Reference

### Core HR Tables

| Table | Description |
|---|---|
| `employees` | Master employee records (profile, department, store, role) |
| `attendance_records` | Clock-in/out logs with geo data |
| `leave_requests` | Leave applications and approval state |
| `leave_entitlements` | Annual leave quotas per employee per year |
| `leave_step_settings` | Leave policy config per store (unit, step) |
| `overtime_requests` | Overtime requests and approval state |
| `holidays` | National and custom company holidays |
| `schedule_data` | Weekly shift assignments |
| `shift_types` | Shift definitions (name, time, color) |
| `scheduling_rules_snapshot` | Labor law rule sets by effective year |
| `salary_structures` | Employee salary templates |
| `salary_records` | Monthly salary records |
| `payroll_runs` | Payroll batch runs |
| `payroll_records` | Individual payroll items per run |
| `bonus_settings` | Bonus rule configurations |
| `bonus_records` | Bonus disbursement records |
| `tax_withholding_records` | Annual tax withholding per employee |
| `insurance_settings` | Insurance type rates |
| `insurance_grades` | Insurance grade salary brackets |
| `compensation_bands` | Salary band definitions by role/dept |
| `recruitment_jobs` | Job postings |
| `training_courses` | Course library |
| `training_enrollments` | Employee-course enrollment |
| `probation_records` | Probation period tracking |
| `performance_reviews` | Quarterly review records |
| `performance_goals` | Employee goals with progress |
| `attrition_risk_snapshots` | Turnover risk scores |
| `engagement_surveys` | Survey templates |
| `engagement_responses` | Survey responses |
| `benefit_policies` | Benefit definitions |
| `business_trips` | Travel requests |
| `expenses` | Expense claims |
| `transfer_requests` | Dept/store transfers |
| `resignation_requests` | Resignation submissions |
| `severance_records` | Separation payment records |
| `documents` | HR document storage |
| `custom_forms` | Dynamic form templates |
| `form_submissions` | Form responses |

### Workflow & Process Tables

| Table | Description |
|---|---|
| `workflows` | Workflow templates |
| `workflow_instances` | Active/completed workflow runs |
| `workflow_steps` | Steps within a workflow instance |
| `workflow_categories` | Category definitions |
| `tasks` | Individual task records |
| `task_dependencies` | Task dependency edges |
| `task_comments` | Task discussion threads |
| `task_attachments` | Task file references |
| `task_checklists` | Task-checklist links |
| `task_checklist_items` | Checklist item records |
| `task_confirmations` | Sign-off records |
| `task_watchers` | Observer subscriptions |
| `task_mentions` | @mention records |
| `checklists` | Reusable checklist templates |
| `tags` | Tag definitions |
| `approval_chains` | Approval chain definitions |
| `approval_chain_steps` | Steps within a chain |
| `approval_forms` | Approval form submissions |
| `approval_form_steps` | Form signing step state |
| `approval_rules` | Auto-routing rules |
| `approval_requests` | Approval request records |
| `approval_delegations` | Temporary authority delegations |
| `projects` | Project records |
| `project_sections` | Project phase/section definitions |
| `project_custom_fields` | Project-specific custom fields |

---

## 5. Integration Points

### Supabase Edge Functions

| Function | Trigger |
|---|---|
| `clock-in` | Server-side validation on attendance punch |
| `check-missed-clockout` | Scheduled: auto-flag unpunched employees |
| `refresh-holidays` | On-demand: import national holidays by year |
| `invite-employee` | On employee creation: send onboarding email |

### Supabase RPC Functions

| RPC | Purpose |
|---|---|
| `generate_payroll()` | Batch generate payroll records for a pay period |
| `secure_upsert_salary()` | Authorized salary record write |
| `secure_update_leave_status()` | Authorized leave approval/rejection |
| `secure_update_overtime_status()` | Authorized overtime approval |
| `secure_create_approval_request()` | Route a new approval through engine |
| `secure_update_approval()` | Record approval/rejection decision |
| `secure_update_employee()` | Authorized employee record update |

### Export Formats

| Export | Format |
|---|---|
| Payroll | CSV (bank upload format) |
| Attendance | PDF |
| Leave sign-off | PDF |
| Schedule | PDF calendar |

---

*Generated from codebase analysis — 43 HR pages, 9 process/workflow pages, 7 database modules.*
