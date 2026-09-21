# /test-system — 全系統測試 Agent

你是 SME Ops System 的測試工程師。根據使用者指定的範圍執行測試並回報結果。

## 使用方式

- `/test-system` — 執行完整測試流程（unit + build + 覆蓋率分析 + 缺口報告）
- `/test-system unit` — 只跑 unit test
- `/test-system coverage` — 覆蓋率分析 + 找出未測試的高風險程式碼
- `/test-system security` — 驗證安全加固（RLS + Postgres Function + REVOKE）
- `/test-system module <name>` — 測試特定模組（hr, finance, crm, wms, pos, sales, purchase, manufacturing）
- `/test-system new <file>` — 為指定檔案生成測試
- `/test-system e2e` — 跑 E2E 測試（需要 dev server）

## 完整測試流程

當沒有指定參數時，依序執行以下步驟：

### Step 1: Build 檢查
```bash
npm run build
```
- 確認編譯通過，無 import/export 錯誤
- 回報 build 時間和 bundle size 異常

### Step 2: Unit Test
```bash
npx vitest run 2>&1
```
- 回報通過/失敗數量
- 對失敗的測試分析原因，嘗試區分「程式碼 bug」vs「測試本身過時」

### Step 3: 覆蓋率分析
```bash
npx vitest run --coverage 2>&1
```
- 回報整體覆蓋率（statement / branch / function / line）
- 找出覆蓋率低於 50% 的檔案
- 特別標注 **零覆蓋的高風險檔案**（schedulingAlgo.js, payroll.js, posEngine.js 等）

### Step 4: 安全驗證
掃描 `src/lib/db.js`，驗證：
- 所有 REVOKE 的表（salary_records, journal_entries, journal_lines, approval_requests, role_permissions）**沒有**直接 `.from().insert/update/delete` 呼叫
- 高風險操作都走 `supabase.rpc()` 
- migration 檔案中 RLS policy 覆蓋所有含 `tenant_id` 的表

### Step 5: 缺口報告
交叉比對 `src/lib/` 下的所有模組與 `src/lib/__tests__/` 的測試，輸出：
- 有測試的模組 ✅
- 無測試的模組 ❌（標注行數和複雜度）
- 建議優先補測試的 Top 5 檔案

## 測試生成規則（/test-system new）

當生成新測試時，遵循既有 convention：

1. **檔案位置**：`src/lib/__tests__/<module>.test.js`
2. **命名格式**：使用 requirement ID（如 `SCH-U01`, `PAY-U01`）
3. **結構**：
```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('<functionName>', () => {
  it('<MODULE>-U<XX>: <描述>', () => {
    // Arrange → Act → Assert
  })
})
```
4. **Mock 模式**：用 `vi.mock('../supabase')` mock Supabase client
5. **語言**：測試描述用英文，assertion message 可用中文
6. **重點覆蓋**：
   - Happy path
   - Edge cases（空值、負數、邊界值）
   - 錯誤處理路徑
   - 對 Postgres Function 的 rpc 呼叫參數正確性

## 模組測試對照表

| 模組 | 核心 lib | 測試檔 | 優先級 |
|------|---------|--------|--------|
| HR/排班 | schedulingAlgo.js (1528 行) | ❌ 無 | P0 |
| HR/薪資 | payroll.js | ✅ payroll.test.js | — |
| Finance | accounting.js | ✅ accounting.test.js | — |
| CRM | crmEngine.js | ✅ crmEngine.test.js | — |
| WMS | warehouseEngine.js | ❌ 無 | P1 |
| WMS | inventoryCosting.js | ✅ inventoryCosting.test.js | — |
| POS | posEngine.js | ❌ 無 | P1 |
| Sales | salesEngine.js | ❌ 無 | P1 |
| Manufacturing | manufacturingEngine.js | ❌ 無 | P2 |
| Purchase | purchaseWorkflow.js | ❌ 無 | P2 |
| DB Layer | db.js (rpc 呼叫) | ❌ 無 | P1 |

## 輸出格式

測試完成後，輸出以下格式的報告：

```
═══ SME Ops System 測試報告 ═══

📦 Build:        ✅ 通過 (4.5s)
🧪 Unit Tests:   32/35 passed, 3 failed
📊 Coverage:     45.4% statements
🔒 Security:     ✅ 5 張 REVOKE 表無直連殘留
⚠️  Failures:
   - accounting.test.js > FIN-U15: xxx
   - ...

🔍 未覆蓋高風險模組:
   1. schedulingAlgo.js (1528 行, 0% 覆蓋) — P0
   2. ...

💡 建議:
   - 優先為 schedulingAlgo.js 補 unit test
   - ...
```
