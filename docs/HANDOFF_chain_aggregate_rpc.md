# 交接：費用申請「簽核流程」聚合 RPC（治本優化）

> 給下一個對話接手用。目標是把「簽核流程時間軸」載入從「前端串一堆 query」改成
> 「後端一支聚合 RPC 一次回完整步驟」，解決每次打開費用申請詳情都要等很久的問題。

## 1. 任務目標

費用申請詳情 modal 右側「簽核流程」時間軸載入很慢。要做 **聚合 RPC（方案 B / 治本）**：
寫一支 `get_expense_request_chain_full(p_id, p_applicant_emp_id)`，後端一次組好完整步驟陣列，
前端只發一個 round-trip 拿到，不再前端串多個 query。

## 2. 為什麼現在慢（診斷已完成）

`openDetail`（`src/pages/workflow/ExpenseRequests.jsx` 約 380–586 行）是一長串**序列 await**：
1. 抓 `approval_chain_steps`（建 approverMap）
2. 抓 `employees`（名字）
3. **`buildChainBasedSteps`**（`src/lib/buildChainSteps.js:122`）— 內部又跑：`get_request_chain_display_names`（快照）/ `get_chain_step_display_names`（live）+ `mergeExtraSteps`（加簽，再抓 approval_extra_steps + employees）
4. `get_approval_timeline`（每關停留時間）
5. 核銷階段再來一輪：`request_chain_snapshots` → `employees` → `get_approval_timeline` + snapshot
- 而且 step 1–2 抓的東西，`buildChainBasedSteps` 內部**又抓一次（重複）**。

全部序列疊起來 → 慢。

## 3. 要搬進 RPC 的組裝邏輯（逐項）

| 邏輯 | 現在位置 | 備註 |
|---|---|---|
| 主鏈解析（快照優先、live fallback、解動態主管/督導） | `buildChainBasedSteps` 161–203；DB 已有 `get_request_chain_display_names` / `get_chain_step_display_names` 可**直接複用** | 解析不用重寫，RPC 內呼叫即可 |
| 每關**狀態判斷**（completed/current/pending/rejected，依 `current_step` + `status`） | `buildChainBasedSteps` 216–238 | 要在 RPC 重寫；current_step 慣例：0=未進任何關、N+1=全完成；step_order 0-based |
| **加簽 merge**（`approval_extra_steps` 插在 `insert_before_step` 前，狀態對映 pending→current/approved→completed/rejected） | `mergeExtraSteps` 267–約330 | 要重寫；跳過 `cancelled` |
| **timeline merge**（每關停留時間 duration_text） | `openDetail` 433–455；DB 已有 `get_approval_timeline(p_request_type, p_request_id)` | 複用 RPC |
| **核銷鏈**（snapshot/live + 申請人 step + 「核准後 N 天送核銷」間隔文字） | `openDetail` 457–581 | 要重寫；request_type 用 `'expense_settle'` |

主鏈 request_type = `'expense_request'`、核銷 = `'expense_settle'`。

## 4. 前端 steps 陣列的輸出結構（RPC 要回這個，逐欄對齊）

每個 step 物件可能含：
`{ label, name, target_emp_id, role_name, status('completed'|'current'|'pending'|'rejected'),
   completedAt, completedBy, durationText, rejectReason, noteText,
   isApplicant(bool), isSettle(bool), kind('extra'|'settle_divider'), archival(bool) }`

渲染在 `src/components/ApprovalDetailModal.jsx` 的 ChainTimeline（看它吃哪些欄位，RPC 要供齊）。
PDF 簽呈也吃這個結構（`chainSteps` 傳給 `exportExpenseRequestPdf`，見 ExpenseRequests 1003–1014）—— **RPC 改動要確保 PDF 簽呈也照常**。

## 5. DB 現有可複用的 building blocks（不用從零寫解析）

- `get_request_chain_display_names(p_request_type, p_request_id, p_applicant_emp_id)` — 快照解析（含動態 target 名字）
- `get_chain_step_display_names(p_chain_id, p_applicant_emp_id)` — live chain 解析
- `get_approval_timeline(p_request_type, p_request_id)` — 每關 entered/exited/duration_text
- `_employee_matches_chain_step` / `resolve_chain_step_approvers` — 解動態 target（applicant_dept_manager / applicant_store_supervisor 要傳申請人 id）

**這些函式的 live 定義可直接讀** `supabase/snapshots/critical-functions.sql`（db:drift baseline，反映 live DB，最準），不用猜 migration 哪版最新。

## 6. 安全實作計畫（鐵則：不能寫完直接換）

1. 寫 `get_expense_request_chain_full(p_id, p_applicant_emp_id)` RETURNS json（步驟陣列）
2. 前端 `openDetail` **兩套並跑**：新 RPC 結果 vs 舊 `buildChainBasedSteps`+merge，`console.log` 逐欄 diff
3. 找多張單（含：純申請中 / 已核准 / 待核銷 / 已核銷 / 有加簽 / 動態主管關 / 駁回）比對**完全一致**
4. 全一致 → 前端切換用新 RPC，舊邏輯先留著
5. 觀察一段時間沒問題 → 才拔舊的 `buildChainBasedSteps` 呼叫
6. 改完跑 `npm run db:drift`，新 RPC 會被偵測（記得它不在 CRITICAL 清單，可加進 `scripts/db-drift.mjs`）

## 7. 注意事項（高風險區）

- **簽核組裝是「漏一個 case 就顯示錯/卡死」的高風險區**（見記憶 `feedback_resolve_snapshot_rewrite_disaster`、`feedback_signoff_advance_applicant_id`）。動態 target 解析**一定要傳 applicant_emp_id**。
- migration 寫成 idempotent；高風險函式**不要整支憑記憶重 paste**，以 baseline live 定義為基準改。
- 老闆會在 Studio 直接 hotfix → 動 DB 前先 `npm run db:drift` 確認 live=migration。
- 做之前先看記憶：`project_engineering_hardening_2026_06_15`（大收斂脈絡）、`feedback_signoff_must_use_db_trigger`、`feedback_workflow_chain_independent`（chain 推進的 source of truth 是 expense_requests.status，不是 wi/task）。

## 8. 過渡選項（如果想先快一點）

也可先做**方案 A（純前端並行化 + 去重複抓取）**當過渡：把 openDetail 裡獨立的 query
（timeline / 核銷 snapshot+timeline）跟 buildChainBasedSteps 並行發、拿掉重複抓的 chain_steps/employees。
低風險、立刻快約一半，B 治本之後再慢慢上。（用戶傾向直接做 B，此為備案。）

## 關鍵檔案

- `src/pages/workflow/ExpenseRequests.jsx`（openDetail 380–586；PDF 1003–1014）
- `src/lib/buildChainSteps.js`（buildChainBasedSteps 122–248、mergeExtraSteps 267–）
- `src/components/ApprovalDetailModal.jsx`（ChainTimeline 渲染，確認吃哪些欄位）
- `supabase/snapshots/critical-functions.sql`（building block RPC 的 live 定義）
- `scripts/db-drift.mjs`（改完把新 RPC 加進 CRITICAL 監控）
