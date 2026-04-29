# 專案流程 (Project Workflow) 使用與架構說明

本文件說明 SME Ops 系統中 **專案流程模組** 的設計理念、資料結構、操作流程與典型使用情境，供產品、業務、客服與技術人員共同參考。

---

## 1. 模組定位

專案流程模組負責把「一件要做的事」拆成可追蹤、可簽核、可協作的任務單位，涵蓋三個層級：

| 層級 | 中文名稱 | 角色 |
|------|---------|------|
| Project | 專案 | 最上層的目標容器（例：展店、新品上市、年度預算） |
| Workflow Instance | 流程實例 | 專案下的一段標準作業流程（SOP 套用後產生） |
| Task | 任務 / 工作 | 最小執行單位，指派給個人並可簽核 |

核心檔案位置：
- 頁面：[src/pages/process/](src/pages/process/)
- 模組路由：[src/modules/ProcessModule.jsx](src/modules/ProcessModule.jsx)
- 業務邏輯：[src/lib/workflowIntegration.js](src/lib/workflowIntegration.js)
- 任務到期檢查：[src/lib/taskDueChecker.js](src/lib/taskDueChecker.js)
- 任務詳情面板：[src/components/TaskDetailPanel.jsx](src/components/TaskDetailPanel.jsx)
- 資料庫定義：[supabase/migrations/20260416000003_task_centric_hybrid_model.sql](supabase/migrations/20260416000003_task_centric_hybrid_model.sql)

---

## 2. 頁面地圖

| 頁面 | 路徑 | 功能摘要 |
|------|------|---------|
| 流程總覽 | [Overview.jsx](src/pages/process/Overview.jsx) | 所有流程實例與步驟狀態；支援點擊任務開啟右側詳情面板並核准／退回 |
| 專案管理 | [Projects.jsx](src/pages/process/Projects.jsx) | 建立／編輯專案、指派負責人、設定預算與時程、自訂欄位 |
| 流程管理 | [Workflows.jsx](src/pages/process/Workflows.jsx) | 建立 SOP 模板、啟動流程實例、指派群組與到期日 |
| 任務列表 | [Tasks.jsx](src/pages/process/Tasks.jsx) | Kanban / Calendar / Timeline 三種檢視切換 |
| 檢核清單 | [Checklists.jsx](src/pages/process/Checklists.jsx) | 可重複套用的子項目清單 |
| SOP 模板庫 | [SOPTemplates.jsx](src/pages/process/SOPTemplates.jsx) | 標準作業流程範本 |
| 設定精靈 | [SetupAssistant.jsx](src/pages/process/SetupAssistant.jsx) | 首次導入引導 |

---

## 3. 資料模型

```
projects ──┐
           ├── workflow_instances ──┐
           │                         ├── tasks (step_order)
           │                         │     ├── task_comments
           │                         │     ├── task_attachments
           │                         │     ├── task_checklist_items
           │                         │     ├── task_confirmations (多方會簽)
           │                         │     └── task_dependencies (前置任務)
           │                         └── approval_chain_id
           └── project_comments

approval_chains ── approval_chain_steps
```

### 關鍵欄位

- `workflow_instances.status`：`進行中` / `已完成` / `已退回`
- `tasks.status`：同上三值；另有 `completed_at`, `confirmation_required`, `approval_chain_id`
- `tasks.step_order`：控制同一流程內的任務執行順序
- `task_dependencies.dep_type`：`prerequisite`（需先完成）或 `trigger`（觸發連動）

狀態顏色定義（語意色，不可硬寫）：
- 進行中 → `var(--accent-cyan)`
- 已完成 → `var(--accent-green)`
- 已退回 → `var(--accent-red)`

定義位於 [Overview.jsx:10-14](src/pages/process/Overview.jsx#L10-L14)。

---

## 4. 生命週期與核心動線

### 4.1 啟動流程
1. 使用者在 **流程管理** 選擇 SOP 模板，或由 HR/採購等模組自動呼叫 `createApprovalWorkflow()`。
2. 系統依金額／類別比對 `approval_chains`，挑出符合的簽核鏈。
3. 產生 `workflow_instance`，並根據 `approval_chain_steps` 逐一建立 `tasks`（step_order 1、2、3…），指派對應主管。

程式入口：[workflowIntegration.js:36-130](src/lib/workflowIntegration.js#L36-L130)

### 4.2 推進簽核
- 執行者在 **流程總覽** 展開某筆實例，點選步驟 → 彈出 TaskDetailPanel。
- 可檢視附件、留言、前置任務、會簽人。
- 按「核准」呼叫 `advanceWorkflow(stepId, role, '核准')`；按「退回」時會提示輸入原因。
- 成功後系統透過 `notifyTaskAssignee()` 推送 LINE 通知給下一關。

### 4.3 每日到期檢查
每次進入總覽頁都會呼叫 `checkAndNotifyDueTasks()`，自動推送當日到期與逾期任務（見 [Overview.jsx:52-53](src/pages/process/Overview.jsx#L52-L53)）。

---

## 5. 角色與權限

- Supabase RLS 目前採應用層控管：讀寫皆開放，UI 依 `AuthContext` / `TenantContext` 判斷可見範圍。
- 任務指派人（`tasks.assignee`）才能在 TaskDetailPanel 內做 inline 編輯。
- 會簽（`task_confirmations`）設 `unique(task_id, approver)`，同一人僅能回覆一次。
- 專案負責人（`projects.owner_id`）可重新指派成員、調整預算。

---

## 6. 整合點

| 整合對象 | 說明 |
|---------|------|
| HR 模組 | 請假／加班／報帳／出差自動觸發 `createApprovalWorkflow` |
| 採購模組 | 採購單金額比對 `approval_chains.category='採購'` |
| LINE / LIFF | 被指派人若綁定 LINE，收到待辦通知；手機可直接在 LIFF 頁簽核 |
| EventBus | 任務狀態變更發佈 domain event，供其他模組訂閱（例如完成 → 觸發出貨） |
| 讀模型 (CQRS) | Overview 頁使用 Read Model 快取，避免大量 join |

---

## 7. 典型使用情境

### 情境 A — 展店專案（跨部門協作）
1. 營運經理在 **專案管理** 建立專案「南山店展店」，start_date 2026-05-01，owner = 劉經理。
2. 套用 SOP 模板「展店標準流程」，自動建立 4 個任務：設計店面 → 採購設備 → 安裝驗收 → 開幕。
3. 任務以 `task_dependencies` 建立前置關係：採購設備需「設計店面」完成才能進入進行中。
4. 設計師完成後在 TaskDetailPanel 改狀態為「已完成」，系統推 LINE 給採購。
5. 採購在面板內上傳「設備清單.pdf」附件，建立費用申請（自動啟動另一條簽核鏈）。

### 情境 B — 報帳簽核（HR → Process 自動化）
1. 員工張小姐在 HR 模組送出出差報帳 $5,000。
2. HR 觸發 `createApprovalWorkflow('expense', record, '張小姐')`。
3. 系統以 category=`HR`、amount≤5000 比對 `approval_chains`，取得兩步驟：直屬主管 → 財務。
4. 建立 workflow_instance 及兩筆 tasks；step_order=1 指派給李主管。
5. 李主管收到 LINE 推播 → 點擊深連結打開 LIFF 簽核頁 → 核准。
6. step_order=2 自動激活並通知 CFO；CFO 核准後 instance 狀態 → 已完成，會計系統收到事件，自動產生傳票。

### 情境 C — 新品上市會簽清單
1. 行銷建立專案「Q3 新品上市」，套用 SOP「上市前檢查」。
2. 其中一個任務「商標驗證」設 `confirmation_required=true`，並新增三筆 `task_confirmations`：法務（王律師）、市場（陳總監）、品牌（林經理）。
3. 三人分別於面板按核准；系統累計全部為 approved 才會將任務標記「已完成」。
4. 專案進度條（`projects.progress`）依已完成任務比例即時更新。

---

## 8. 常見疑難

| 問題 | 排查方向 |
|------|---------|
| 任務沒出現在指派人頁面 | 檢查 `tasks.assignee` 是否對應到登入者姓名；LINE 綁定是否完成 |
| 流程停在某關不動 | 該 task.status 仍為「進行中」；查 `approval_chain_steps.target_emp_id` 是否離職 |
| LINE 沒收到通知 | `employee_line_accounts` 是否綁定；`notifyTaskAssignee` 會在無綁定時靜默跳過 |
| 金額落在兩條 chain 之間 | `approval_chains.min_amount/max_amount` 區間設定重疊，系統依 min_amount 由大到小取第一筆符合者 |

---

## 9. 擴充建議

- 新增 SOP 模板時，請同時建立 `checklist_templates`，並於 `tasks.checklist_id` 連動，避免散落的手動清單。
- 如需跨租戶報表，使用 [src/lib/cqrs/ReadModelService.js](src/lib/cqrs/ReadModelService.js) 的 read model，不要直接在頁面做大型 join。
- 新增事件通知時，請透過 EventBus 發佈 `process.task.*` 事件，讓其他模組訂閱而非直接呼叫 API。
