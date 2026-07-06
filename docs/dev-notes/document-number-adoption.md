# 單據編號規則表（F-C3.1）— 待接入清單

> 產出日：2026-07-05
> 新 lib：`src/lib/documentNumber.js` → `allocateDocumentNumber(docType)`（原子取號 RPC `allocate_document_number`）
> 本清單列出所有 **app 層 ad-hoc 取號** 的呼叫點（file:line），供後續整合步驟逐一改走 RPC。
> 已種子規則的 doc_type：`quotation(QT) / sales_order(SO) / purchase_request(PR) / purchase_order(PO) / goods_receipt(GR) / sales_return(SR) / sales_allowance(SA) / purchase_allowance(PA) / journal_entry(JE) / stock_count(SC)`

## A. 程式自動產號（Date.now / random — 有撞號風險，優先接入）

| # | 呼叫點 | 現行格式 | 建議 doc_type |
|---|--------|---------|--------------|
| 1 | `src/pages/sales/Quotations.jsx:150` | `SO-${ISO年}-${Date.now()後3碼}`（報價轉訂單） | `sales_order` |
| 2 | `src/pages/crm/Pipeline.jsx:254` | `QT-${ISO年}-${Date.now()後4碼}`（商機轉報價） | `quotation` |
| 3 | `src/lib/events/handlers/crmHandlers.js:13` | `SO-${ISO年}-${Date.now()後4碼}` | `sales_order` |
| 4 | `src/lib/events/handlers/purchaseHandlers.js:48` | `PR-${ISO年}-${Date.now()後3碼}` | `purchase_request` |
| 5 | `src/lib/automation/stock.js:44` | `PR-${ISO年}-${Date.now()後3碼}` | `purchase_request` |
| 6 | `src/lib/events/handlers/financeHandlers.js:11` | `INV-${ISO年}-${Date.now()後3碼}`（AR 發票） | 需新增規則（`ar_invoice`）或併入 F-B1 發票流程 |
| 7 | `src/lib/events/handlers/financeHandlers.js:42` | `JE-${ISO年}-${Date.now()後3碼}` | `journal_entry` |
| 8 | `src/lib/events/handlers/financeHandlers.js:73` | `BILL-${ISO年}-${Date.now()後3碼}`（AP 帳單） | 需新增規則（`ap_bill`） |
| 9 | `src/lib/events/handlers/financeHandlers.js:119` | `JE-EXP-${ISO年}-${Date.now()後4碼}` | `journal_entry` |
| 10 | `src/lib/automation/finance.js:81` | `INV-${ISO年}-${Date.now()後3碼}` | 同 #6 |
| 11 | `src/lib/automation/finance.js:117` | `BILL-${ISO年}-${Date.now()後3碼}` | 同 #8 |
| 12 | `src/lib/automation/finance.js:204` | `JE-EXP-${ISO年}-${Date.now()後4碼}` | `journal_entry` |
| 13 | `src/lib/events/handlers/hrHandlers.js:39` | `JE-PAY-${month}-${Date.now()後4碼}` | `journal_entry` |
| 14 | `src/lib/events/handlers/manufacturingHandlers.js:34` | `MO-${ISO年}-${Date.now()後4碼}`（工單） | 需新增規則（`manufacturing_order`） |
| 15 | `src/pages/wms/Returns.jsx:62` | `RMA-${YYYYMMDD}-${random 4碼}` | `sales_return`（或新增 `rma`） |
| 16 | `src/pages/wms/Transfers.jsx:35` | `TF-${Date.now() base36}` | 需新增規則（`warehouse_transfer`） |
| 17 | `src/pages/wms/PickPackShip.jsx:78` | `PK-${Date.now() base36}`（揀貨單） | 需新增規則（`pick_list`） |
| 18 | `src/pages/wms/PickPackShip.jsx:103` | `PA-${...}`（由 pick_number 派生，包裝單） | 需新增規則（注意：`PA` 前綴已被 purchase_allowance 種子占用，接入時應改前綴） |
| 19 | `src/pages/purchase/BlanketOrders.jsx:51` | `BO-${Date.now() base36}`（未填時 fallback） | 需新增規則（`blanket_order`） |
| 20 | `src/pages/manufacturing/Subcontracting.jsx:54` | `SC-${Date.now() base36}`（委外單，fallback） | 需新增規則（注意：`SC` 前綴已被 stock_count 種子占用，接入時應改前綴，如 `SUB`） |
| 21 | `src/pages/finance/FixedAssets.jsx:145` | `JE-DEP-${YYYYMM}`（折舊傳票，冪等鍵性質） | `journal_entry`（保留 source 冪等鍵，單號另取） |
| 22 | `src/pages/finance/PeriodClose.jsx:85` | `JE-CLOSE-${year}`（關帳傳票，冪等鍵性質） | 同 #21 |
| 23 | `src/pages/finance/JournalEntries.jsx:226` | `${原單號}-REV`（迴轉傳票派生號） | `journal_entry`（迴轉單建議另取新號 + 備註原單） |

## B. 使用者手動輸入單號的表單（接入時改為「留空自動取號」）

| # | 呼叫點 | 欄位 | 建議 doc_type |
|---|--------|------|--------------|
| 24 | `src/pages/sales/Quotations.jsx:57` | `quote_number`（表單手填） | `quotation` |
| 25 | `src/pages/sales/SalesOrders.jsx:64` | `order_number`（表單手填） | `sales_order` |
| 26 | `src/pages/sales/Returns.jsx:19` | `return_number`（表單手填） | `sales_return` |
| 27 | `src/pages/purchase/PurchaseOrders.jsx:25` | `po_number`（表單手填） | `purchase_order` |
| 28 | `src/pages/purchase/PurchaseRequests.jsx:16` | `pr_number`（表單手填） | `purchase_request` |
| 29 | `src/pages/finance/JournalEntries.jsx:18,116` | `entry_number`（表單手填） | `journal_entry` |
| 30 | `src/pages/wms/Inbound.jsx:28` | `po_number`（表單手填，入庫參照） | 參照既有 PO，不取新號 |
| 31 | `src/pages/wms/Outbound.jsx:26` | `order_number`（表單手填，出庫參照） | 參照既有 SO，不取新號 |
| 32 | `src/pages/wms/StockCount.jsx:60` | 盤點單（`createStockCount`，無單號欄位） | `stock_count`（接入時新增 count_number） |

## C. 顯示用派生編號（非取號，不需接入）

- `src/pages/purchase/GoodsReceipts.jsx:127,260-261`、`src/pages/purchase/PurchaseOrders.jsx:164,171`、`src/pages/purchase/ThreeWayMatch.jsx:313` — `GR-/PO-/AP-{id padStart}` 僅為畫面顯示 id 的格式化，非持久單號。
- `src/pages/sales/Overview.jsx:47,65` — demo 假資料產生器。
- `src/lib/events/handlers/posHandlers.js:15` — `POS-${transaction_number}` 派生自 POS 交易號（另有 POS 自己的取號機制）。

## 接入寫法範例

```js
import { allocateDocumentNumber } from '../../lib/documentNumber'

// 建單時：
const orderNumber = await allocateDocumentNumber('sales_order')
// → 'SO-202607-0001'（org 自動取自當前 session tenant）
```

注意事項：
1. 事件 handler / automation 內接入時，事件 metadata 已帶 `organization_id`，可用 `allocateDocumentNumber(docType, { orgId })` 顯式傳入。
2. 取號即消耗（單據取消不回收號碼）— 台灣單據慣例可接受跳號，傳票若要求連號需在過帳時二次檢核。
3. `PA` / `SC` 前綴衝突見 A#18、A#20。
