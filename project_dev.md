# Project Management Tool — Comprehensive UI/UX & Feature Plan

## What Already Exists (Foundation to Build On)

The sme-ops system has strong bones:
- ✅ Projects with sections, attached workflows, direct tasks, budget tracking
- ✅ Workflows (SOP templates + live instances) with step management + DAG
- ✅ Tasks with 4 views: list, kanban, calendar, Gantt/timeline
- ✅ Approval chains (multi-step, role/dept/person targeting, parallel/sequential)
- ✅ Form bindings to tasks
- ✅ Cascade triggers (task completion → new workflow)
- ✅ Real-time sync, audit log, AI assistant for workflow generation
- ✅ Burndown chart, workload view

**Core gaps:** no unified project hub, no swimlane board, no "Lists" concept distinct from workflow steps, no inline editing, no milestone grouping, no time tracking, no portfolio view.

---

## Information Architecture

The canonical hierarchy should be:

```
Project
  ├── Overview (health dashboard, members, budget)
  ├── Workflows[]           ← named processes / SOPs
  │     ├── Tasks[]         ← ordered or unordered work items
  │     │     ├── Subtasks
  │     │     ├── Forms (linked — fill before completing task)
  │     │     ├── Approval (chain required to close task)
  │     │     └── Trigger (what happens when this task finishes)
  │     ├── Lists[]         ← custom groupings within a workflow
  │     ├── Settings
  │     │     ├── Workflow-level triggers
  │     │     ├── Workflow-level forms (preconditions)
  │     │     └── Workflow-level approval (sign-off to start/close)
  │     └── History / Audit
  ├── Lists[]               ← standalone task lists not tied to a workflow
  │     └── Tasks[]
  └── Settings (members, custom fields, integrations)
```

---

## UI Layout: Three-Pane Project Hub

```
┌──────────────────────────────────────────────────────────────────┐
│  [← Back]  [Project Name]                    [Share] [⋯ More]    │
├──────────────┬───────────────────────────────┬───────────────────┤
│              │                               │                   │
│  PROJECT     │     MAIN CONTENT AREA         │   DETAIL PANEL    │
│  SIDEBAR     │                               │   (slide-in)      │
│              │                               │                   │
│  ▸ Overview  │  [View toggle: List/Board/    │  Task / Workflow   │
│              │   Calendar/Gantt/DAG/Table]   │  detail context   │
│  ▸ Board     │                               │                   │
│  ▸ Timeline  │  [Filter bar: assignee /      │  Tabs:            │
│              │   status / priority / due]    │  - Detail         │
│  ── 工作流程 │                               │  - Subtasks       │
│  ▾ 展店流程  │  [main list / board / gantt]  │  - Comments       │
│    ▾ 採購    │                               │  - Forms          │
│      申請    │                               │  - Approvals      │
│  + 新增流程  │                               │  - Triggers       │
│              │                               │  - History        │
│  ── 清單     │                               │                   │
│    ▸ Backlog │                               │                   │
│    ▸ 問題追蹤│                               │                   │
│  + 新增清單  │                               │                   │
│              │                               │                   │
│  ── 成員     │                               │                   │
│  ── 設定     │                               │                   │
└──────────────┴───────────────────────────────┴───────────────────┘
```

**Key UX principles:**
- Sidebar collapses to icon-only mode (saves space on smaller screens)
- Right panel slides in when you click any item — no navigation away
- Breadcrumb always visible: `專案 › 展店流程 › 簽核採購申請`
- Inline editing: click any field to edit directly, no modal required

---

## Views to Support (per level)

### Project Level
| View | Purpose | Status |
|------|---------|--------|
| Overview Dashboard | KPIs, progress ring, activity feed, budget burn | ⚠️ Partial |
| Portfolio Gantt | Cross-project timeline | ❌ Missing |
| Board (all workflows) | Kanban of every task in project grouped by workflow | ❌ Missing |
| Members + Workload | Capacity per person across all workflows | ⚠️ Partial |
| Table/Spreadsheet | Editable flat table of all tasks | ❌ Missing |

### Workflow Level
| View | Purpose | Status |
|------|---------|--------|
| Step List | Ordered step view with progress (current default) | ✅ Exists |
| Board | Kanban by status for tasks in this workflow | ❌ Missing |
| Calendar | Task due dates | ✅ Exists (via Tasks page) |
| DAG | Dependency graph | ✅ Exists |
| Timeline | Gantt scoped to this workflow | ⚠️ Partial |
| Forms Tab | All forms bound to this workflow | ⚠️ Partial |
| Triggers Tab | All automation rules | ⚠️ Partial |
| Approvals Tab | Chain assignment + progress | ✅ Exists |

### Swimlane Board (high priority gap)
```
Swimlane by: [Workflow ▼] | [Assignee ▼] | [Priority ▼]

          未開始         進行中         待簽核         已完成
── 展店流程 ────────────────────────────────────────────
  [Task A]         [Task B]        [Task C]
  [Task D]

── 採購流程 ────────────────────────────────────────────
  [Task E]                         [Task F]        [Task G]
```

---

## Task Detail Panel — Full Feature Set

```
┌─────────────────────────────────────────────┐
│  [☐] 任務名稱 (click to edit inline)        │
│  Status: [進行中▼]  Priority: [高▼]         │
│  Assignee: [王小明▼]  Due: [2026-07-01]     │
│  Project: [展店計畫] › Workflow: [採購流程] │
├─────────────────────────────────────────────┤
│  [Detail] [Subtasks] [Comments] [Forms]     │
│  [Approvals] [Triggers] [History]           │
├─────────────────────────────────────────────┤
│  (tab content)                              │
└─────────────────────────────────────────────┘
```

**Detail tab:** Description (rich text), custom fields, attachments, labels, watchers, time estimate vs logged

**Subtasks tab:** Inline checklist with drag reorder, each subtask can itself be promoted to a full task

**Comments tab:** Threaded comments, @mentions, emoji reactions, file drops

**Forms tab:** List of required forms to fill before task can close. Show form status (未填 / 已填 / 待審). "Fill now" button opens inline or side-modal form.

**Approvals tab:** Current chain, step progress, approve/reject buttons for eligible users, add signers, rejection reason

**Triggers tab:** "When this task completes → [Action]"
- Create task in [workflow]
- Start workflow [template]
- Send notification to [person/role]
- Update field on [linked record]
- Webhook call

**History tab:** Full audit trail of field changes, status transitions, approvals, form submissions

---

## Lists Concept

**Lists** are flexible task containers that exist alongside workflows. They're useful for things that don't follow a process sequence — backlogs, issue trackers, idea parking lots.

```
Project
  └── Lists
        ├── Backlog          (unscheduled tasks)
        ├── 問題追蹤         (bug/issue log)
        ├── 風險登記         (risk register)
        └── 參考資料         (reference/links only)
```

Each List has its own columns (configurable), filters, and can pull tasks from multiple workflows for a cross-cutting view (like a "smart list").

**List types:**
1. **Standard List** — ordered task list, user-managed columns
2. **Kanban List** — a board view per list
3. **Smart List** — auto-populated by filter rules (e.g., "All overdue tasks assigned to me in any workflow")
4. **Checklist List** — simple checklist UI, no due dates needed

---

## Forms Feature Design

**Form Builder (enhance existing):**
```
Field types:
- Short text / Long text
- Number (with unit)
- Date / Date range
- Single select / Multi select
- File upload (with allowed types)
- Signature (draw or upload)
- Person picker (from org)
- Rating (1–5)
- Table (dynamic rows)
```

**Form binding scopes:**
| Scope | Trigger | Effect |
|-------|---------|--------|
| Task-level | Completing task | Must fill form before status changes to 已完成 |
| Task-level | Starting task | Must fill form before status changes to 進行中 |
| Workflow-level | Starting workflow | Form filled during SOP deployment |
| Workflow-level | Closing workflow | Completion checklist/report |
| Standalone | External link | Public URL, no login needed |

**Form-to-approval bridge:** When a form is submitted, it can automatically create an approval request with the form data attached as context for the approver.

---

## Triggers & Automation Design

Two levels of triggers:

### Task Triggers
```
WHEN  this task [is completed | is approved | status changes to X]
AND   [optional conditions on fields]
THEN  [one or more actions]
```

### Workflow Triggers
```
WHEN  workflow [starts | all steps complete | step N completes | is rejected]
AND   [optional conditions]
THEN  [actions]
```

**Trigger Actions to support:**
| Action | Exists | Priority |
|--------|--------|---------|
| Create task in this workflow | ✅ | — |
| Start a new workflow (SOP) | ✅ | — |
| Assign/reassign task | ❌ | High |
| Update a field value | ❌ | High |
| Send LINE notification | ✅ | — |
| Send email | ❌ | Medium |
| Create approval request | ❌ | High |
| Post to webhook | ❌ | Medium |
| Create form submission task | ❌ | Medium |
| Archive/complete workflow | ❌ | Medium |

**Trigger UI — visual if → then builder:**
```
┌────────────────────────────────────────────┐
│ + 新增觸發規則                             │
│                                            │
│  當 [任務完成    ▼]                        │
│  且 [狀態       ▼] [等於 ▼] [已完成   ▼] │
│  ─────────────────────────────────────     │
│  則 執行以下動作:                          │
│   ▸ [啟動工作流程 ▼] › [採購申請 SOP  ▼]  │
│   + 新增動作                               │
│                                            │
│  [取消]                        [儲存規則]  │
└────────────────────────────────────────────┘
```

---

## Approvals Design

**Current:** approval chains exist as separate config, attached to tasks individually.

**Proposed enhancement — conditional routing:**
```
Task approval chain assignment:
  if budget > 50,000  → Chain A (GM + CFO)
  if budget 10–50k    → Chain B (Manager)
  else                → Chain C (direct supervisor)
```

**Approval Dashboard (standalone view):**
```
┌─────────────────────────────────────────┐
│  待我簽核 (7)  │  我已簽核  │  全部申請  │
├─────────────────────────────────────────┤
│  ▸ [高] 採購申請 #1234  展店計畫        │
│     submitted by 王小明 · 2 days ago    │
│     [View] [核准] [退回]                │
│  ─────────────────────────────────────  │
│  ▸ [中] 費用報銷 #5678  廣告部門        │
│     [View] [核准] [退回]                │
└─────────────────────────────────────────┘
```

**Delegation rule:** When approver is on leave → auto-delegate to deputy for N days.

---

## Overview / Dashboard Design (Project Level)

```
┌──────────────────────────────────────────────────────┐
│  展店計畫                                            │
│  進行中 · 2026-06-01 → 2026-09-30 · 王小明          │
├──────────────────┬──────────────────┬────────────────┤
│  完成率          │  逾期任務        │  預算          │
│  ████░░░ 62%     │  ⚠ 3 項          │ $280k / $500k  │
│  48/77 tasks     │                  │  56% 已使用     │
├──────────────────┴──────────────────┴────────────────┤
│  Burndown Chart ─────────────────────────────         │
│                                                       │
│  工作流程狀態                                         │
│  ▸ 場地評估    ████████░ 80%  進行中                  │
│  ▸ 採購申請    ████░░░░░ 40%  待簽核                  │
│  ▸ 裝修施工    ░░░░░░░░░  0%  未開始                  │
│                                                       │
│  近期活動 ────────────────────────────               │
│  王小明 完成 "水電配線" · 2h ago                      │
│  張美玲 退回 "採購申請" · 5h ago                      │
└───────────────────────────────────────────────────────┘
```

---

## Feature Priority Roadmap

### Phase 1 — Navigation & UX (quick wins)
| # | Feature | Effort |
|---|---------|--------|
| 1 | Project Hub with 3-pane layout (sidebar + content + detail panel) | M |
| 2 | Inline field editing (title, status, assignee, due date without modal) | S |
| 3 | Breadcrumb navigation across all levels | S |
| 4 | Workflow Board view (kanban scoped to one workflow) | M |
| 5 | Right-click context menus on task rows | S |

### Phase 2 — Lists & Task Features
| # | Feature | Effort |
|---|---------|--------|
| 6 | Lists concept (standalone task containers) | M |
| 7 | Subtasks (nested tasks with their own status) | M |
| 8 | Task comments with @mentions | M |
| 9 | Task watchers (subscribe to updates) | S |
| 10 | Quick-add (press Enter to add next task inline) | S |

### Phase 3 — Automation & Forms
| # | Feature | Effort |
|---|---------|--------|
| 11 | Visual trigger builder (if → then UI) | L |
| 12 | Form-to-approval bridge | M |
| 13 | Conditional approval chain routing | M |
| 14 | Trigger actions: assign task, update field, call webhook | M |
| 15 | External form links (public URL, no login) | M |

### Phase 4 — Analytics & Advanced Views
| # | Feature | Effort |
|---|---------|--------|
| 16 | Swimlane board (by workflow / assignee / priority) | M |
| 17 | Portfolio Gantt (multi-project timeline) | L |
| 18 | Workload planner (capacity per person) | L |
| 19 | Time tracking (estimate vs logged) | M |
| 20 | Approval delegation rules | M |

---

## What to Reuse vs. Rebuild

| Component | Recommendation |
|-----------|---------------|
| `src/components/tasks/TaskKanban.jsx` | Reuse — add swimlane grouping on top |
| `src/components/tasks/TaskTimeline.jsx` | Reuse — extend to multi-project portfolio |
| `src/components/tasks/WorkflowDagView.jsx` | Reuse as-is |
| `src/components/TaskDetailPanel.jsx` | Extend — add Subtasks, Comments, Triggers tabs |
| `src/pages/process/components/ProjectDetailPanel.jsx` | Refactor → becomes the new Project Hub (sidebar nav + outlet) |
| `src/pages/process/Projects.jsx` | Split: list view stays, detail becomes its own route `/projects/:id` |
| `src/pages/process/components/InstanceDetailView.jsx` | Promote to Workflow Hub tab within Project Hub |
| Approval chains | Reuse data model — build conditional routing on top |
| Form bindings | Reuse — add external link + form-to-approval bridge |

---

## Recommended Starting Point

The single highest-impact change is **promoting the project into its own dedicated route** (`/process/projects/:id`) with a left sidebar navigation that makes workflows, lists, members, and settings first-class navigation items — instead of everything being crammed into a single panel. That one structural change unlocks all other features as independently navigable sections.
