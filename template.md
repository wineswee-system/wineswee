# Templates Section — Design, Features & Process Plan

## What Already Exists

| Component | Status | Notes |
|-----------|--------|-------|
| `src/pages/process/TemplateLibrary.jsx` | ✅ Good foundation | Card grid, type toggle (workflow/project), category tabs, search, usage count, DeployWizard |
| `src/pages/process/TemplateStudio.jsx` | ✅ Two-panel builder | Left: step list, Right: StepEditor. Version history in DB |
| `src/pages/process/components/StepEditor.jsx` | ✅ Per-step config | Checklist, approval chain, forms, trigger, branch routing per step |
| `src/pages/process/components/StepCard.jsx` | ✅ Left-rail summary | Badge icons for checklist/approval/forms/trigger |
| `src/pages/process/components/DeployWizard.jsx` | ✅ Multi-step wizard | Smart role→employee matching, reminders, HR target detection |

**Core gaps:** no version diff UI, no template preview before deploy, no import/export, no List/Form/Approval Chain template types, no AI→template save flow, no duplication, no sharing, no per-template permissions, no dry-run, no analytics beyond usage count.

---

## Template Type Taxonomy

Expand from the current 2 types to a full taxonomy:

```
Templates
├── Workflow Templates   ← SOP processes (CURRENT — most mature)
├── Project Templates    ← full project skeleton (CURRENT — type exists, editor incomplete)
├── List Templates       ← reusable task lists (MISSING)
├── Form Templates       ← reusable form schemas (MISSING)
└── Approval Chains      ← reusable sign-off chains (SEPARATE — link from here)
```

Each type shares the same Library UI shell but has its own Studio/builder.

---

## Template Library UI — Enhanced Design

```
┌────────────────────────────────────────────────────────────────┐
│  範本庫                              [+ 新增範本 ▼] [匯入]     │
├────────────────────────────────────────────────────────────────┤
│  ┌─────────┬─────────┬──────────┬──────────┬───────────────┐  │
│  │ 工作流程 │  專案   │   清單   │   表單   │   簽核鏈      │  │
│  └─────────┴─────────┴──────────┴──────────┴───────────────┘  │
│                                                                │
│  [搜尋範本...]    分類: [全部▼]    排序: [使用次數▼]           │
│                                                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│  │ 展店 SOP │ │ 採購申請 │ │ 新人到職 │ │ 月結對帳 │         │
│  │ 展店事業部│ │  採購部  │ │   HR    │ │  財務部  │         │
│  │ ─────── │ │ ─────── │ │ ─────── │ │ ─────── │         │
│  │ 12 步驟  │ │  8 步驟  │ │ 15 步驟  │ │  5 步驟  │         │
│  │ 已部署43次│ │ 已部署18次│ │ 已部署67次│ │ 已部署9次│         │
│  │ ● ○ ● ○  │ │ ● ● ○ ○  │ │ ● ● ● ○  │ │ ● ○ ○ ○  │         │
│  │          │ │          │ │          │ │          │         │
│  │[預覽][部署]│ │[預覽][部署]│ │[預覽][部署]│ │[預覽][部署]│         │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘         │
└────────────────────────────────────────────────────────────────┘
```

**Card shows:**
- Name + category badge
- Step/item count
- Deploy count + last deployed date
- Visual step preview dots (first 5 steps, colored by type)
- Tags (searchable labels beyond category)
- Lock icon if template is locked/published (read-only)
- Primary: [預覽] → Preview Modal; Secondary: [部署] → DeployWizard

**Sorting options:** Usage count, Recently updated, Name A–Z, Created date, Step count

**Filter panel (collapsible):**
- Category multi-select
- Tags
- Created by
- Last modified date range
- Has approval chain (Y/N)
- Has forms (Y/N)

---

## Template Preview Modal (New)

Before deploying, users should be able to see a full read-only preview. This is the #1 missing piece — currently you must open the editor to understand the template.

```
┌────────────────────────────────────────────────────────────────┐
│  展店 SOP — 預覽                                    [×]        │
│  展店事業部 · 12 步驟 · 已部署 43 次                            │
├──────────────────────────────────────────────────────────────  │
│  說明: 新開幕門市完整流程，含場地評估到首日開幕               │
│                                                                │
│  ① 場地評估            角色: 展店督導    優先: 高             │
│     說明: 評估商圈、面積、租金...                              │
│     ● 掛清單: 場地評估查核清單 (8 項)                         │
│     ● 表單: 場地評估報告                                      │
│     ↓                                                          │
│  ② 簽訂租約            角色: 法務主管    優先: 高             │
│     ● 簽核: 法務 + GM                                         │
│     ↓                                                          │
│  ③ 採購申請            角色: 採購部      優先: 中             │
│     ● 表單: 採購申請單                                        │
│     ● 簽核: 採購主管 → 財務                                   │
│     ↓ 觸發: 啟動倉管備料流程                                  │
│  ...                                                           │
├──────────────────────────────────────────────────────────────  │
│  [編輯]    [複製此範本]              [部署此流程 →]            │
└────────────────────────────────────────────────────────────────┘
```

The preview renders each step as a visual flow card with its attached features visible at a glance. No editing — purely read-only with CTA buttons at the bottom.

---

## Template Studio — Layout Upgrade

Current layout is good; proposed enhancements:

```
┌─────────────────────────────────────────────────────────────────┐
│  [← 返回]  [展店 SOP]  [● 未儲存]     [版本記錄] [預覽] [儲存]  │
├──────────────┬──────────────────────────────────────────────────┤
│              │                                                   │
│  METADATA    │   STEP DETAIL EDITOR                             │
│  (280px)     │                                                   │
│              │   Step 3: 採購申請                               │
│  名稱 ─────  │   ─────────────────────────────────────────      │
│  分類 ─────  │   基本資訊                                       │
│  說明 ─────  │     名稱 [採購申請          ]                    │
│  標籤 ─────  │     角色 [採購部            ]  優先 [高 ▼]       │
│  流程簽核 ─  │     說明 [textarea          ]                    │
│              │                                                   │
│  ── 步驟 ──  │   ▸ 查核清單 (綠)                                │
│  ① 場地評估  │   ▾ 簽核設定 (紫)  ←─── expanded                 │
│     ●●       │       鏈: [採購主管 → 財務 ▼]                    │
│  ② 簽訂租約  │       觸發條件: [核准後 ▼]                       │
│     ●        │   ▸ 表單綁定 (青)                                │
│  ③ 採購申請  │   ▾ 觸發動作 (橙)  ←─── expanded                 │
│     ●●●      │       完成後啟動: [倉管備料 SOP ▼]               │
│  ④ 裝修施工  │       條件: [無條件觸發 ▼]                       │
│     ●        │   ▸ 條件分支 (紅) — 核准/退回不同走向            │
│              │   ▸ 通知設定 (藍)  ← NEW                        │
│  [+ 新增步驟]│                                                   │
│              │   [↑ 上移]  [↓ 下移]  [複製步驟]  [刪除步驟]    │
└──────────────┴──────────────────────────────────────────────────┘
```

**New sections in StepEditor:**
- **通知設定** — define who gets notified when this step starts, completes, is approved/rejected (currently managed only at deployment time)
- **時間設定** — set a relative due date (e.g., "3 days after previous step completes") as a template default
- **前置條件** — define conditions that must be true before this step can start (beyond just "previous step done")

---

## Project Template Builder (Dedicated Studio)

Currently `type='project'` exists in the DB schema but the TemplateStudio editor only handles workflow steps. A project template needs a different structure:

```
Project Template: 新店開幕計畫
├── 基本設定 (duration estimate, budget placeholder, required roles)
├── 工作流程[]
│   ├── 流程 1: 場地取得 (8 steps)
│   ├── 流程 2: 採購備料 (5 steps)
│   ├── 流程 3: 裝修施工 (7 steps)
│   └── 流程 4: 人員到位 (6 steps, depends on 流程 1)
├── 清單[]
│   ├── 開幕查核清單
│   └── 風險登記冊
└── 里程碑[]
    ├── M1: 簽約完成 → day 0
    ├── M2: 裝修完成 → day 30
    └── M3: 首日開幕 → day 45
```

**Project Template Studio layout:**

```
┌──────────────┬──────────────────────────────────────────────────┐
│  專案設定     │  [工作流程] [清單] [里程碑] [成員角色]            │
│  名稱 ──────  │                                                   │
│  分類 ──────  │  工作流程列表:                                   │
│  預計天數 ──  │  ① 場地取得   8步  [設定] [詳細 >]              │
│  預算範本 ──  │  ② 採購備料   5步  [設定] [詳細 >]              │
│  必要角色 ──  │     └── 依賴: ① 完成後啟動                      │
│              │  ③ 裝修施工   7步  可同時進行                    │
│  ── 流程 ──  │  ④ 人員到位   6步  [設定] [詳細 >]              │
│  ① 場地取得  │                                                   │
│  ② 採購備料  │  [+ 新增工作流程]  [從範本庫選入]                 │
│  ③ 裝修施工  │                                                   │
│  ④ 人員到位  │  依賴關係:                                       │
│  [+ 新增流程]│  流程① → 流程②③④ (並行)                         │
└──────────────┴──────────────────────────────────────────────────┘
```

---

## List Template Builder (New)

A list template is a named set of task rows with configurable columns:

```
List Template: 風險登記冊
Columns: [風險描述][類別][影響程度][機率][對策][負責人][狀態]

Rows (optional pre-filled):
  □  [填入風險描述]  [技術/商業/法規▼]  [高/中/低▼]  ...
  □  [填入風險描述]
  + 新增項目
```

When deployed into a project, this becomes a real List with the same columns and any pre-filled rows.

---

## Form Template Builder (Enhancement of existing FormBuilder)

The existing `FormBuilder.jsx` in CRM/HR should be promoted to a shareable template:

```
Form Template: 採購申請單
Fields:
  ① 採購品項 (Table — product name / qty / unit price)
  ② 供應商名稱 (Short text)
  ③ 預計到貨日 (Date)
  ④ 採購理由 (Long text, required)
  ⑤ 附件 (File upload, max 3 files, PDF/image)

After submit: → 建立簽核申請
```

Form templates are stored in a `form_templates` table and can be:
- Attached to workflow steps (existing `required_forms` field)
- Deployed as standalone public forms
- Converted to approval forms

---

## Deploy Wizard — Enhanced Flow

The existing DeployWizard is a 3-step wizard. Propose expanding to handle all template types with better UX:

```
步驟 1: 基本資訊
  ─────────────────────────────────────────────────────
  流程名稱:  [展店 SOP — 南港店開幕    ]
  門市:      [南港展店            ▼]
  負責人:    [王小明              ▼]
  開始日:    [2026-07-01]  預估完成: [2026-09-30] (auto)
  掛靠專案:  [南港展店計畫        ▼]  (optional)

步驟 2: 人員分配
  ─────────────────────────────────────────────────────
  [自動匹配 ✓]  (pre-fills by role → dept mapping, existing)

  Step 1 場地評估    → 展店督導   [李大明 ▼]  ✓ 推薦
  Step 2 簽訂租約    → 法務主管   [張法務 ▼]
  Step 3 採購申請    → 採購部     [未指派 ▼]  ⚠
  ...

  [批次指派同一人給所有未指派步驟]

步驟 3: 時間設定
  ─────────────────────────────────────────────────────
  ○ 依模板預設天數自動計算截止日
  ● 手動設定各步驟截止日

  Step 1  [2026-07-01] → [2026-07-07]  (7天)
  Step 2  [2026-07-08] → [2026-07-15]  (7天)
  Step 3  [2026-07-08] → [2026-07-20]  (12天)  ← parallel allowed

步驟 4: 提醒與通知
  ─────────────────────────────────────────────────────
  提醒方式: [LINE ✓] [Email ✓]
  提醒時機: [到期前1天 ▼]
  抄送主管:  [✓ 自動抄送各步驟負責人的直屬主管]

步驟 5: 確認部署
  ─────────────────────────────────────────────────────
  [完整摘要：12個任務，指派給4位人員，首個任務2026-07-01]
              [取消]                     [立即部署 →]
```

**New in Step 3:** relative date calculation — template defines "step N starts N days after step N-1 completes", wizard auto-calculates based on the start date. User can override.

---

## Version History & Governance (UI for existing DB feature)

The DB already stores versions in `sop_templates.versions` JSONB. Currently no UI exposes this. Proposed:

```
版本記錄  [TemplateStudio header button]
──────────────────────────────────────────
  v4  (目前)  ← current
    修改人: 王小明  2026-06-20
    變更: 新增步驟 "裝修驗收"，修改步驟 3 簽核鏈
    [預覽此版本]

  v3
    修改人: 張美玲  2026-05-15
    變更: 修改步驟順序
    [預覽此版本]  [還原至此版本]

  v2
    修改人: 王小明  2026-03-01
    [預覽此版本]  [還原至此版本]

  v1  (初始版本)
    修改人: 系統  2026-01-10
    [預覽此版本]
──────────────────────────────────────────
```

**Version diff view:**

```
v3 → v4 差異
─────────────────────────────────────────
  + 新增步驟 12: 裝修驗收 (角色: 工程督導)
  ≠ 步驟 3 簽核鏈: 採購主管 → [財務 + GM] (原: 採購主管)
  ≠ 步驟 7 說明: 更新了文字說明
```

---

## AI Template Generation — Save Flow

The existing `AiAssistantTab.jsx` generates workflow steps via LLM. Currently the AI output goes directly to an instance — it should also be saveable as a template:

**Process:**
```
1. User types: "幫我生成新員工到職 SOP"
2. AI generates 12 steps with roles, descriptions
3. User reviews / edits steps inline
4. Buttons: [直接部署] | [儲存為範本] ← NEW

[儲存為範本]:
  → Opens mini-modal: 名稱 / 分類 / 說明
  → Saves to sop_templates
  → Redirects to TemplateStudio for refinement
```

---

## Template Permissions & Governance

Add a **published / draft / archived** lifecycle to templates:

| State | Who can edit | Who can deploy | Display |
|-------|-------------|----------------|---------|
| Draft | Creator + Admins | Admins only | Yellow dot |
| Published | Admins only | All permitted users | Green dot |
| Archived | Nobody | Nobody | Gray, hidden by default |

**Lock mechanism:** Published templates are read-only. To modify, you must "create a new version" (fork a copy as draft, edit, then re-publish — replacing the published version).

**Per-template permissions (optional):**
- Who can deploy: All / Specific roles / Specific departments
- Who can edit: All admins / Specific persons
- Requires manager approval before deploying: Yes/No

---

## Template Import / Export

| Feature | Format | Notes |
|---------|--------|-------|
| Export single template | JSON | Full schema including steps, form bindings, approval chain refs |
| Export category | ZIP of JSON files | Bulk export |
| Import from JSON | Drag-drop or file picker | Validates schema, warns on missing chains/forms |
| Import from marketplace | URL or code | Future — org-to-org sharing |
| Duplicate template | In-app | Copies to "範本名稱 (副本)", opens in Studio |

---

## Template Analytics Dashboard

Accessible from each template card's "更多" menu or a dedicated Analytics tab in TemplateStudio:

```
展店 SOP — 使用分析
───────────────────────────────────────────
  部署次數: 43    平均完成天數: 38天
  完成率:  79%   準時完成率:  61%

  最常卡關步驟:                        Avg delay
    ① 採購申請 (Step 3)               +5.2 天
    ② 裝修驗收 (Step 10)              +3.8 天

  部署趨勢 (月):  ▂▃▄▄▅▅▃▄▅▆▇▇

  最近部署:
    南港展店  王小明  2026-06-15  進行中
    信義展店  李美玲  2026-05-01  已完成 ✓
    士林展店  陳主管  2026-04-10  逾期 ⚠
```

This closes the feedback loop: template creators can see where their processes consistently break down and refine the template accordingly.

---

## Template Process Flow (End-to-End)

```
CREATION
  │
  ▼
[Draft]
  │ Create via: Studio / AI Generate / Duplicate / Import
  │
  ▼
[Review]
  │ Creator previews, tests with dry-run deploy (creates
  │ shadow instance, no real tasks, lets reviewer walk through)
  │
  ▼
[Publish]
  │ Admin approves, template locked, visible to all deployers
  │
  ▼
[Deploy Wizard]
  │ Deployer fills: name, store, owner, dates, team assignments
  │ Wizard auto-matches roles → employees
  │ Relative dates auto-calculated from start date
  │
  ▼
[Live Workflow Instance]
  │ Runs in Workflows page, linked back to source template
  │ All analytics flow back to template's usage stats
  │
  ▼
[Completion]
  │ Instance marks "已完成", analytics updated
  │ Blocked steps surface as template improvement suggestions
  │
  ▼
[Template Improvement]
  Admin views analytics, creates v5 Draft, re-publishes
  All future deploys use new version
  Existing in-flight instances stay on their original version
```

---

## Feature Priority for Templates

### Quick Wins (Phase 1)
| # | Feature | File to change |
|---|---------|---------------|
| 1 | Template preview modal (read-only step flow) | New `TemplatePreviewModal.jsx` |
| 2 | Duplicate template button | `src/pages/process/TemplateLibrary.jsx` |
| 3 | AI → save as template button | `src/pages/process/components/AiAssistantTab.jsx` |
| 4 | Tags field (multi-label beyond category) | `src/pages/process/TemplateStudio.jsx` |
| 5 | Version diff UI | New `VersionHistoryPanel.jsx` |

### Medium (Phase 2)
| # | Feature | Notes |
|---|---------|-------|
| 6 | Notification settings per step in template | Add to `src/pages/process/components/StepEditor.jsx` |
| 7 | Relative due dates in template (N days after prev step) | New field in step schema |
| 8 | Draft/Published/Archived lifecycle | Requires `status` column in `sop_templates` |
| 9 | Template analytics tab | New DB view + UI component |
| 10 | JSON export/import | `TemplateLibrary` action + import modal |

### Larger (Phase 3)
| # | Feature | Notes |
|---|---------|-------|
| 11 | Project template builder with workflow ordering | New studio variant |
| 12 | List template builder | New studio variant |
| 13 | Dry-run / shadow deploy | Shadow instance concept, no real tasks |
| 14 | Template permissions (who can deploy) | RBAC extension |
| 15 | Per-step relative date calculator in Deploy Wizard | Enhance `src/pages/process/components/DeployWizard.jsx` |

---

## Schema Additions Needed

```sql
-- Add to sop_templates
ALTER TABLE sop_templates
  ADD COLUMN status text NOT NULL DEFAULT 'published',  -- 'draft' | 'published' | 'archived'
  ADD COLUMN tags text[] DEFAULT '{}',
  ADD COLUMN permissions jsonb DEFAULT '{}',            -- { deploy_roles: [], edit_persons: [] }
  ADD COLUMN relative_durations jsonb DEFAULT '{}';     -- { step_0: 3, step_1: 7 } days from prev

-- Each step in the steps JSONB should also gain:
-- notify_on_start: []        (person ids or role strings)
-- notify_on_complete: []
-- relative_due_days: null | integer   (days after previous step completes)
-- preconditions: []          (future — conditions that must be true before step can start)
```
