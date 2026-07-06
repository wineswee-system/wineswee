# 財會 / 稅務 / 進銷存 — 完整建置計畫（功能 + 測試）

> 計畫日期：2026-07-04
> 基準文件：`docs/gap_v3-erp-tw.md`（文中/鼎新/正航差距分析）
> 現況盤點：本日以三路並行掃描 codebase 完成（財會、稅務、進銷存），下列「現況」欄皆為實際程式碼狀態
> 圖例：✅ 已有 · ⚠️ 部分 · ❌ 缺

---

## 零、現況盤點摘要（先知道站在哪裡）

### 財會（`src/pages/finance/` 25 頁、`src/lib/accounting/`、`src/lib/db/finance.js`）
- ✅ 會計科目（4 碼、45+ 科目種子）、傳票/分錄（草稿→已過帳、借貸平衡驗證、secure RPC）、試算表、資產負債表、損益表、AR/AP + FIFO 收款分配 + 帳齡、銀行調節（自動比對）、固定資產（直線/定率遞減/年數合計 3 法）、預算、迴轉分錄、循環分錄、關帳期間
- ⚠️ 拋轉傳票：僅 3 條事件路徑（出貨→AR、進貨驗收→AP、費用→JE），無規則表、無涵蓋收付款/盤盈虧/薪資/折舊
- ⚠️ cost_center 已在 journal_lines，但無部門/門市損益報表
- ❌ 日記帳/總分類帳/明細帳報表、營業成本表、票據、立沖帳、稅法耐用年數表

### 稅務（`src/lib/einvoice.js`、`taxReport.js`、`withholdingCertificate.js`、edge functions）
- ✅ 統編驗證、字軌配號表 `invoice_number_sequences`（原子配號 RPC、雙月期）、發票開立冪等流程（`issue-invoice`）、同日作廢/跨日折讓判斷（`void-invoice`）、401 計算 + 媒體檔 + CSV/PDF、扣繳憑單（50/52/54 格式 HTML 列印）+ 所得類別分組
- ⚠️ 電子發票仍為 **MIG 3.2**、provider 只有 mock（ECPay/文中 adapter 為佔位，缺憑證/金鑰）；折讓/作廢未打 provider API；`generate403Report` 實為**各類所得扣繳彙總**，並非營業稅 403（兼營）——命名誤導
- ⚠️ 401 資料來源取自 AR/AP 表，非正式進銷項憑證檔；媒體檔為自訂 pipe 格式，未對齊財政部規範
- ❌ 字軌配號管理 UI（期別/起迄/餘量警示）、B2B 交換、二代健保計算未完全掛入薪資、`invoices`（legacy）與 `pos_invoices` 兩套並存

### 進銷存（`src/pages/purchase|sales|wms/`、`src/lib/inventoryCosting.js` 等）
- ✅ 報價→訂單→出貨→發票→AR、請購→採購→驗收→三單勾稽→AP 全流程；多倉/儲區/儲位、批號/效期（FEFO 索引）、盤點 + 盤差調整、四種成本法 + 成本層（cost layers）、進貨費用分攤（landed_costs 表 by 金額/數量/重量）、價格表/折扣規則、原子 RPC（出貨扣帳、調撥）
- ⚠️ 安全存量僅在 app 層計算無持久欄位；多幣別有 currencies 表但單據無匯率欄；銷貨折讓無獨立單據（只有退貨）；單據編號散在 app 層無規則表
- ❌ 月加權平均「月結批次重算」模式（現為即時層計算）、盤盈虧自動拋轉傳票、條碼主檔（GTIN/店內碼）、電商訂單整合

**結論**：進銷存底子最好（補 4 件事）；財會補「報表 + 拋轉引擎 + 票據 + 立沖」；稅務是最大工程（MIG 4.1 + 加值中心實接 + 401 媒體檔正規化）。

---

## 一、Track A — 財會

### F-A1 [法定] 商業會計法格式報表（補齊 3 張 + 對齊 2 張）

| 報表 | 現況 | 作法 |
|------|------|------|
| 資產負債表 | ✅ | 對齊商業會計法/EAS 分類層級（流動/非流動、科目排序依 parent_code 階層），現有 parent_code 欄位未用 → 啟用 |
| 綜合損益表 | ⚠️ 有損益表 | 加「本期其他綜合損益」段落（SME 多為 0，格式先留）；銷貨退回與折讓列為收入減項 |
| 試算表 | ✅ | 加「級次選擇」（總帳科目/明細科目）與期間別（月/累計） |
| **日記帳** | ❌ | 新報表頁：依 entry_date + entry_number 排序列示全部傳票分錄，日合計/月合計，PDF/CSV 匯出 |
| **總分類帳/明細帳** | ❌ | 新報表頁：選科目（可多選/區間）→ 期初餘額 + 逐筆借貸 + 逐筆餘額 + 期末餘額；明細帳支援 cost_center / 往來對象維度 |
| **營業成本表** | ❌ | 期初存貨 + 本期進貨(−進貨退出折讓) − 期末存貨 = 銷貨成本；存貨數字取 `inventory_valuations` 月結快照（連動 F-C1 月加權平均）|

- 檔案：`src/lib/accounting/reports.js` 加 `generateJournalBook()`、`generateGeneralLedger()`、`generateCostOfGoodsSold()`；頁面 `src/pages/finance/JournalBook.jsx`、`GeneralLedger.jsx`、`CostOfGoodsStatement.jsx`；路由掛 `FinanceModule.jsx`
- **免過帳即時報表**［標配］：所有報表加 `includeDraft` 參數（預設含草稿傳票、UI 顯示「含未過帳」徽章）— 一次改在 reports.js 的取數層

### F-A2 [標配] 傳票自動拋轉引擎（單據→傳票）— 本 Track 核心

現有 3 條硬寫的事件路徑改為**規則表驅動**：

- 新表 `posting_rules`：`id, organization_id, doc_type, template_name, lines(JSONB: [{account_code, side, amount_expr, cost_center_from}]), is_active`
- 新 lib `src/lib/accounting/postingEngine.js`：`postFromDocument(docType, docId, payload)` → 讀規則 → 產生傳票（含 `source_type + source_id` UNIQUE 冪等鍵）→ 走既有 `secure_create_journal_entry` RPC
- 觸發：掛既有 EventBus（沿用 `financeHandlers.js` 註冊模式），涵蓋單據：

| 單據 | 傳票模板（預設） |
|------|----------------|
| 銷貨/出貨完成 | 借 應收帳款 / 貸 銷貨收入、銷項稅額 |
| 銷貨退回/折讓 | 借 銷貨退回及折讓、銷項稅額 / 貸 應收帳款 |
| 進貨驗收 | 借 存貨、進項稅額 / 貸 應付帳款 |
| 進貨退出/折讓 | 借 應付帳款 / 貸 存貨、進項稅額 |
| 收款/付款 | 借 現金(銀行存款) / 貸 應收 …（含票據科目，連動 F-A4）|
| 盤點盈虧（連動 F-C2）| 盤虧：借 存貨盤損 / 貸 存貨 |
| 薪資月結 | 借 薪資費用 / 貸 應付薪資、代扣款項 |
| 折舊月提（連動 F-A5）| 借 折舊費用 / 貸 累計折舊 |
| 立沖立帳/沖銷（連動 F-A3）| 依科目方向自動 |

- 管理 UI：`src/pages/finance/PostingRules.jsx`（模板 CRUD、試算預覽、啟停）
- 事件 catalog 補 `finance.voucher.auto_posted`，走既有 8 層 middleware（冪等層天然防重複拋轉）

### F-A3 [標配] 立沖帳（預收付/暫收付）

- 新表 `open_items`：`id, organization_id, item_type(預收|預付|暫收|暫付), account_code, party_type/party_id(客戶|供應商|員工), source_type/source_id, amount, settled_amount, status(未沖|部分沖|已沖), created_at`
- 新表 `open_item_settlements`：`open_item_id, settle_doc_type/doc_id, amount, journal_entry_id, settled_at, settled_by`
- lib `src/lib/accounting/openItems.js`：`createOpenItem()`、`settleOpenItem()`（部分沖銷、多對一沖銷）、`getOpenItemBalance()`；沖銷即透過 F-A2 引擎產傳票
- UI：`src/pages/finance/OpenItems.jsx`（立帳清單、沖銷操作、帳齡）
- 場景：訂金（預收）→ 出貨時沖轉銷貨收入；預付供應商 → 驗收時沖應付

### F-A4 [標配] 票據管理

- 新表 `notes_receivable` / `notes_payable`：`id, organization_id, note_number, bank, due_date, amount, party_id, source_type/source_id, status, holder_location, journal_entry_id, created_at`
- 狀態機（lib `src/lib/accounting/notes.js`）：
  - 應收票據：`在庫 → 託收 → 兌現 ✅ | 退票 ↩（退票可重新提示或轉回應收帳款）`
  - 應付票據：`開立 → 兌現 | 作廢`
- 每次狀態轉換經 F-A2 產傳票（收票：借 應收票據/貸 應收帳款；託收：借 託收票據/貸 應收票據；兌現：借 銀行存款/貸 託收票據；退票：反向 + 轉列催收）
- UI：`src/pages/finance/NotesManagement.jsx` — 票據登錄、狀態操作、**到期日曆**（30 日內到期提示，掛既有通知機制）
- 科目種子補：1131 應收票據、1132 託收票據、2131 應付票據

### F-A5 [法定] 固定資產對齊稅法 + 折舊自動化

- 新表 `asset_useful_life_table`（行政院固定資產耐用年數表種子資料：類別/細目/耐用年數），`fixed_assets` 加 `useful_life_ref_id`、`residual_method` 欄
- 資產建檔時依類別帶入法定年數（可手動覆寫但標記差異）；預設平均法（直線法）— 台灣稅務主流
- **月結自動提列**：`runMonthlyDepreciation(period)` 批次 → 逐資產計提 → 經 F-A2 產「借 折舊費用（帶部門 cost_center）/ 貸 累計折舊」傳票，冪等（同資產同期唯一）
- 處分（出售/報廢）：沖銷成本與累計折舊、認列處分損益，自動傳票
- 掛入既有 `automation/finance.js` 月結 workflow DAG（放在 ledger.lock 之前）

### F-A6 (加分) 部門/門市/專案損益 + 多帳本

- 部門損益表：`generateProfitLossByCostCenter()` — journal_lines.cost_center 既有，F-A2 各模板強制帶入 store_id/部門即可出報表；UI `ProfitLossByDept.jsx`（可切門市/部門/月份，含共同費用分攤規則：按營收比/人數比）
- 多帳本（財務帳 vs 稅務帳）：`journal_entries` 加 `ledger_type(財務|稅務)` 欄，預設財務帳雙寫；報表加帳本篩選。IFRS 個體財報格式列為後續（先保留欄位不做報表）

---

## 二、Track B — 稅務（護城河，最大工程）

### F-B1 [法定] 電子發票 MIG 4.1 升版（**已逾期，最急**）

現況 `einvoice.js` 為 MIG 3.2。2026-01-01 起大平台僅收 MIG 4.0+，直接升 **4.1**：

1. **XML 產生器升版**（`src/lib/einvoice.js` 重構為 `src/lib/einvoice/` 目錄）
   - B2C 存證：`F0401`（開立）、`F0501`（作廢）、`F0701`（註銷）
   - 折讓：`D0401`（開立折讓）、`D0501`（作廢折讓）
   - B2B 交換/存證：`A0101/A0201`（交換開立/作廢）、`B0101/B0201`（交換折讓）、`C0401/C0501/C0701`（存證）——B2B 列 4.1 第二階段（B2C 先行）
   - 新 namespace/XSD、欄位異動（CarrierId 規則、金額欄位精度）；**以官方 XSD 驗證產出**
2. **統編驗證更新**：112 年 4 月起新制檢查碼（總和可被 5 整除亦合法）→ 修 `validateTaxId()`（現行只驗 10 的倍數，會拒絕新統編 — 潛在 bug）
3. **傳輸決策（已定案）**：加值中心採 **e首發票** API，自建 Turnkey 3.2 留二期。`issue-invoice` edge function 的 provider adapter 架構已在，補實作：
   - `providers/efirst.ts`：B2C 開立/作廢/折讓 API（簽章/加密依 e首發票 API 文件實作；env：`EFIRST_API_KEY / EFIRST_SELLER_ID / EFIRST_ENDPOINT`），`INVOICE_PROVIDER=efirst`
   - 既有 ecpay/wenchung provider 佔位保留不擴充（ECPay 僅用於金流，與發票脫鉤，見 Track D）
   - 折讓/作廢實接：`void-invoice` 現只改 DB 狀態 → 補 e首發票 API 呼叫 + 回壓 `provider_response`
4. **資料表整併**：legacy `invoices` 與 `pos_invoices` 併為單一 `pos_invoices`（加 `source(pos|sales|manual)` 欄），銷售模組 B2B 發票也走同一張表與同一開立流程

### F-B2 [法定] 字軌配號管理

- `invoice_number_sequences` 已有原子配號，補**管理層**：
  - 新表 `invoice_track_allocations`：`organization_id, period, track, range_start, range_end, source(財政部配號檔|手動), status`
  - 配號檔匯入 UI + 手動建期別；配號 RPC 改為「檢查 range 內才可配」
  - **餘量警示**：剩餘 < 20% 發通知（掛既有通知）；期末未用空白字軌產出上傳檔（視加值中心是否代辦）
- UI：`src/pages/finance/InvoiceTracks.jsx`（期別/字軌/起迄/已用/餘量、警示設定）
- 發票異常狀態頁：開立失敗重試佇列（provider 回錯的單）、上傳狀態追蹤

### F-B3 [法定] 401/403 申報正規化 + 進銷項媒體檔

1. **建立正式進銷項憑證檔**（現行 401 從 AR/AP 湊數 → 不合規）
   - 新表 `vat_input_documents`（進項）/ `vat_output_documents`（銷項）：`organization_id, period, format_code(進項21-29/銷項31-38), doc_number(字軌), doc_date, counterparty_ubn, amount, tax_amount, tax_type(應稅|零稅率|免稅), deduction_code(可扣抵|不可扣抵), source_type/source_id`
   - 來源自動彙入：pos_invoices（銷項）、折讓單、進貨發票、進貨折讓 — 由 F-A2 同款事件驅動彙入
2. **401 申報書**：從憑證檔重算（專營應稅）；**403（兼營）**：實作比例扣抵法（當期不可扣抵比例）— F&B 若無免稅銷售可後置，但把現在誤名為 403 的扣繳報表**改名**（`generate403Report` → `generateWithholdingSummary`，UI 文案同步修正）
3. **媒體申報檔**：改產**財政部規範格式**（固定長度/筆、格式代號、民國年月），輸出後以財政部「申報媒體檔案審核系統」實測通過為驗收標準
4. UI：`TaxFiling.jsx` 擴充 — 期別產生 → 憑證清單核對（缺漏警示：已開發票未入憑證檔）→ 申報書預覽 → 媒體檔下載

### F-B4 [法定] 扣繳憑單 + 二代健保補充保費

1. 扣繳媒體申報檔對齊財政部「各類所得憑單資料電子申報」格式（現為自訂 pipe 格式）→ 用國稅局審核程式實測
2. **二代健保補充保費**（掛入 `payroll.js`，與 HR Track 共用）：
   - 6 類扣費：高額獎金（累計超 4 倍投保薪資）、兼職所得、執行業務、股利、利息、租金
   - 單次給付 ≥ 2 萬門檻與 1,000 萬上限、費率 2.11%（以現行法規參數表建檔，可隨年度調整）
   - 公司負擔：受雇者薪資總額 − 投保薪資總額 × 費率
   - 產出：每月代扣明細 + 繳款書資料 + 年度彙總
3. 憑單批次產生：年度結束 → 全員 50 格式 + 非員工給付 9A/9B/92 等 → 媒體檔 + 列印

### F-B5 (加分) 暫繳/結算申報輔助、憑證管理

- 營所稅暫繳（前一年度稅額 1/2 法）試算單、未分配盈餘加徵提醒 — 純報表輔助，不做申報
- 事務所匯出包：日記帳 + 總分類帳 + 憑證檔 一鍵匯出（CSV/標準媒體格式），對標文中 WSTP 事務所介接

---

## 三、Track C — 進銷存（補強 4 件事）

### F-C1 [標配] 月加權平均月結成本（台灣主流模式）

- 現況為即時成本層計算 → 增加**月結批次模式**（org 層級設定 `costing_mode: 即時移動平均 | 月加權平均月結`）
- 新 lib `src/lib/inventoryMonthlyClose.js`：`runMonthlyCostClose(period)`：
  1. 鎖定期間異動 → 逐 SKU：月加權單價 =（期初金額 + 本期進貨金額含分攤費用）/（期初量 + 進貨量）
  2. 重算本期全部出庫成本（銷貨/調撥/盤虧）→ 差額產「銷貨成本調整」傳票（經 F-A2）
  3. 寫 `inventory_valuations` 月結快照（營業成本表取數來源）
  4. 月結後鎖定該期異動回寫（連動 accounting_periods）
- 進貨費用分攤已有 `landed_costs` → 確保月結重算含分攤後單價
- UI：`Valuation.jsx` 加「月結」頁籤（試算 → 確認 → 產傳票 → 鎖定）

### F-C2 [標配] 盤點盈虧自動轉傳票（文中招牌流程）

- `stock_counts` 狀態機補一段：`盤點中 → 已核對 → 已調帳` 的「已調帳」動作改為：產生 `inventory_adjustments` + 觸發事件 → F-A2 拋轉「存貨盤損/盤盈」傳票（帶倉別 cost_center、成本取當時成本層/月加權單價）
- 盤盈虧單報表（數量差 × 單價 = 金額差，依原因分類）

### F-C3 [標配] 補完基礎缺口

1. **單據編號規則表**：新表 `document_number_rules`（`doc_type, prefix, date_format, sequence_digits, reset_cycle(年|月|不重置)`）+ 原子取號 RPC `allocate_document_number()` — 全部單據（PO/SO/GR/報價/退貨/折讓/傳票）改走此 RPC，杜絕 app 層取號撞號
2. **銷貨/進貨折讓單**：新表 `sales_allowances` / `purchase_allowances`（獨立單據，非退貨）：連動原單、金額/稅額 → 觸發電子發票折讓（D0401，F-B1）+ 傳票（F-A2）+ 進銷項憑證檔（F-B3）——**這張單是三個 Track 的交會點**
3. **安全存量持久化**：`skus` 加 `safety_stock, reorder_point, reorder_qty` 欄；`ReorderTab` 改讀寫欄位（保留 demandForecast 建議值一鍵套用）；低於安全存量通知
4. **多幣別單據**：`purchase_orders/quotations/sales_orders` 加 `currency_code, exchange_rate, base_amount` 欄；`exchange_rates` 表補齊（date, from, to, rate）+ 匯率維護 UI（頁面骨架已有）；入帳一律以本位幣（TWD）、傳票帶原幣備註。匯兌損益科目後置

### F-C4 (加分) 條碼主檔 / 電商 / 物流

- 條碼主檔：新表 `sku_barcodes`（sku_id, barcode, type(GTIN-13|店內碼|秤重碼), is_primary）— 一品多碼；秤重碼（2 開頭 13 碼：品號 + 價格/重量 + 檢查碼）解析器給 POS/WMS 共用；出貨檢核（Outbound 掃碼比對揀貨明細）
- 電商訂單整合：定義 `external_orders` 中繼表 + 匯入 adapter 介面（蝦皮/momo CSV 先行，API 後置）→ 轉既有 sales_orders
- 物流串接：既有承運商 adapter 佔位不動，列為獨立後續專案

---

## 三之二、Track D — 金流（本次定案：信用卡收單 = 中國信託）

### F-D1 [標配] 信用卡收單 = 中國信託（與 ECPay 脫鉤）

現況：`src/lib/paymentGateway.js` 的 `credit_card` 走 ECPay AioCheckOut（表單導頁）。定案改為**中國信託（CTBC）收單**：

1. **店內刷卡（主場景，F&B POS）— 中信 EDC 端末機**
   - POS 端 `credit_card` 改為「端末機記錄模式」：金額顯示 → 店員於中信刷卡機過卡 → POS 登錄 卡別/末四碼/授權碼 → 寫入 `pos_payments`（`gateway=ctbc_edc`，不經線上 gateway）
   - `pos_payments` 加欄：`card_brand, card_last4, auth_code, acquirer（預設 'CTBC'）, settlement_batch`
   - 中信端末機若支援半整合（serial/TCP/藍牙指令介面，依承作機型確認），留 adapter 介面 `edcAdapter.js` — 先做手動登錄，半整合二期（金額直送刷卡機、授權碼自動回填，杜絕登錄錯誤）
2. **線上收單（外送/預購連結付款）— 中信網路收單 gateway**
   - `paymentGateway.js` 新 method routing：`credit_card` → `ctbc-card-checkout` edge function（依中信網路收單 API 文件實作；商店代號/金鑰只存 edge secrets：`CTBC_MERCHANT_ID / CTBC_TERMINAL_ID / CTBC_MAC_KEY`，沿用 ecpay-checkout 的 server-to-server callback 寫回模式）
   - ECPay 路徑保留為既有備援 method（`ecpay`），不再是 credit_card 的預設
3. **請款/入帳對帳**
   - `settlement_batches` 表：中信每日請款批次（批次號、總額、手續費、入帳日）；acquirer 欄留通用（未來多收單行）
   - 中信入帳 vs POS 卡收明細自動比對（掛既有 `BankReconciliation` 自動比對）；手續費認列走 F-A2 拋轉（借 手續費支出 / 貸 應收卡款）
4. **與發票脫鉤驗證**：付款方式（ctbc_edc / linepay / cash）不影響 `issue-invoice`（e首發票）流程 — 發票掛在 `pos_payments` 冪等鍵上，本就 provider 無關，加測試鎖住

外部依賴（第 1 天連同 e首發票申請一起要，向中信收單業務窗口索取）：特店合約與商店代號、承作 EDC 機型 + 是否支援半整合/介接規格、網路收單 API 技術文件與測試環境

沿用現有慣例：Vitest 單元（`src/lib/__tests__/`）、整合（`src/__tests__/integration/`）、Playwright e2e（`e2e/`）、事件 contract test。既有 ID 系列（EI-、TR-、INT-）續編。

### 4.1 單元測試

| 檔案 | 測試 ID 與重點 |
|------|--------------|
| `accounting/__tests__/reports.test.js`（擴充） | RPT-01 日記帳分錄排序與日/月合計；RPT-02 總分類帳期初+逐筆餘額+期末連續性；RPT-03 明細帳 cost_center 過濾；RPT-04 營業成本表（期初+進貨−期末）與 valuation 快照一致；RPT-05 `includeDraft` 含/不含草稿差異；RPT-06 綜合損益表銷貨退回折讓為收入減項 |
| `accounting/__tests__/postingEngine.test.js`（新） | PE-01 每種 doc_type 模板產出借貸平衡傳票；PE-02 冪等：同 source 重複觸發只產一張；PE-03 規則停用時不拋轉；PE-04 金額表達式（含稅拆分 5%）正確；PE-05 cost_center 正確帶入；PE-06 規則缺科目時進 DLQ 不靜默失敗 |
| `accounting/__tests__/openItems.test.js`（新） | OI-01 立帳→全額沖銷 status=已沖；OI-02 部分沖銷累計；OI-03 超沖拒絕；OI-04 沖銷傳票借貸方向依 item_type（預收 vs 預付相反）；OI-05 多單一次沖銷 |
| `accounting/__tests__/notes.test.js`（新） | NT-01 應收票據合法狀態轉移（在庫→託收→兌現）；NT-02 非法轉移拒絕（在庫→兌現）；NT-03 退票轉回應收帳款 + 傳票；NT-04 每次轉移產對應傳票且平衡；NT-05 到期 30 日內清單 |
| `accounting/__tests__/depreciation.test.js`（擴充） | FA-01 依耐用年數表帶入年限；FA-02 月提列金額（平均法、稅法殘值式）；FA-03 同資產同期重跑冪等；FA-04 期中取得按月比例；FA-05 處分損益（售價 vs 帳面價值）傳票 |
| `einvoice/__tests__/mig41.test.js`（新） | MIG-01 F0401 XML 對 4.1 XSD 驗證通過；MIG-02 F0501 作廢、F0701 註銷欄位；MIG-03 D0401/D0501 折讓含原發票號；MIG-04 新制統編（%5==0）通過、舊制不受影響、9 碼拒絕；MIG-05 載具格式（手機條碼 `/`+7 碼、自然人憑證）；MIG-06 金額稅額四捨五入與總額一致；MIG-07 B2C/B2B 訊息別選擇正確 |
| `__tests__/taxReport.test.js`（擴充） | VAT-01 401 從憑證檔（非 AR/AP）彙總；VAT-02 進項不可扣抵代號不入扣抵稅額；VAT-03 零稅率/免稅分欄；VAT-04 媒體檔固定長度與格式代號正確；VAT-05 民國年期別（115年05-06月）；VAT-06 403 兼營比例扣抵計算；VAT-07 溢付留抵 vs 應納 |
| `__tests__/withholding.test.js`（新，自 taxReport 拆出） | WH-01 各所得類別分組（50/9A/92…）；WH-02 媒體檔對齊國稅局格式；WH-03 二代健保：獎金累計超 4 倍投保薪資起扣；WH-04 單次給付門檻與上限；WH-05 兼職所得扣費；WH-06 公司負擔差額計算 |
| `__tests__/inventoryMonthlyClose.test.js`（新） | MC-01 月加權單價 =（期初+進貨含費用分攤）/（期初量+進貨量）；MC-02 出庫成本重算差額 = 調整傳票金額；MC-03 月結後該期異動被鎖；MC-04 重跑冪等；MC-05 快照寫入 inventory_valuations；MC-06 零庫存/除零防護 |
| `__tests__/documentNumber.test.js`（新） | DN-01 各單據前綴/日期格式；DN-02 併發取號不重複（RPC 原子性）；DN-03 年/月重置循環；DN-04 規則不存在時明確報錯 |
| `__tests__/allowance.test.js`（新） | AL-01 銷貨折讓金額/稅額計算；AL-02 折讓不動庫存（vs 退貨動庫存）；AL-03 折讓上限 ≤ 原單餘額；AL-04 觸發 D0401 + 傳票 + 銷項憑證三路事件 |
| `__tests__/barcode.test.js`（新） | BC-01 GTIN-13 檢查碼；BC-02 秤重碼解析（品號/價格/檢查碼）；BC-03 一品多碼主碼唯一 |
| `__tests__/paymentGateway.test.js`（擴充既有） | PG-01 `credit_card` 路由改走 ctbc_edc 登錄（不再導 ECPay 表單）；PG-02 EDC 登錄必填卡別/末四碼/授權碼驗證；PG-03 線上收單走 `ctbc-card-checkout`、金鑰不出現於前端 payload；PG-04 付款方式與發票開立解耦（任一 method 皆能觸發 issue-invoice） |
| `__tests__/settlement.test.js`（新） | ST-01 請款批次總額 = 明細卡收合計；ST-02 手續費傳票（借 手續費支出/貸 應收卡款）平衡；ST-03 入帳金額 = 批次總額 − 手續費，銀行調節自動比對命中 |

### 4.2 整合測試（`src/__tests__/integration/`，續編 INT-）

| 檔案 | 情境 |
|------|------|
| `voucher-autoposting.test.js`（新） | INT-11 銷貨出貨→AR+傳票+銷項憑證檔三者金額一致；INT-12 進貨驗收→AP+存貨傳票+進項憑證；INT-13 收款（含票據）→ 沖 AR + 票據在庫；INT-14 票據託收→兌現全程傳票鏈；INT-15 盤點已調帳→盤損傳票→試算表反映 |
| `open-item-flow.test.js`（新） | INT-16 預收訂金→出貨沖轉收入→餘額歸零→AR 僅剩差額 |
| `monthly-close.test.js`（新） | INT-17 完整月結 DAG：折舊提列→成本月結→關帳→期間鎖定後拒絕過帳；INT-18 營業成本表 = 月結快照推導值 |
| `einvoice-lifecycle.test.js`（新） | INT-19 開立(F0401)→跨日折讓(D0401)→401 憑證檔銷項淨額正確；INT-20 同日作廢(F0501)→字軌狀態、憑證檔不計入；INT-21 配號用罄→開立失敗→補配號→重試佇列成功；INT-22 provider（e首發票）冪等（重試不重號） |
| `card-settlement.test.js`（新） | INT-24 POS 卡付（bank_edc）→ 發票照常開立（e首發票 mock）→ 日終請款批次 → 手續費傳票 → 銀行調節比對入帳 |
| `order-to-cash.test.js`（擴充） | INT-23 全流程延伸：…→收款→月結→部門損益表含該門市毛利 |

### 4.3 E2E（Playwright，關鍵路徑各一條）

- E2E-F1 傳票：建立→過帳→日記帳/總分類帳可見→關帳後禁編輯
- E2E-F2 票據：登錄應收票據→託收→兌現，到期日曆顯示
- E2E-B1 發票：POS 結帳→開立（mock provider）→列表→折讓，字軌餘量遞減
- E2E-B2 申報：選期別→401 預覽→下載媒體檔（檔名/大小斷言）
- E2E-C1 盤點：建立盤點→輸入差異→已調帳→財務端看到盤損傳票

### 4.4 外部驗收（無法自動化，列入 Definition of Done）

1. MIG 4.1 XML 通過官方 XSD + e首發票測試環境開立成功（含折讓、作廢）
2. 401 媒體檔通過財政部「申報媒體檔案審核系統」
3. 扣繳媒體檔通過國稅局憑單申報審核程式
4. 事務所試閱：日記帳/總分類帳/營業成本表交會計師確認格式可用

---

## 五、時程與依賴

```
Phase 1（週 1–4）法遵最急件
  F-B1 MIG 4.1 + e首發票實接（需老闆提供：e首發票合約/金鑰 ← 外部依賴，第 1 天就要申請）
  F-B2 字軌管理 UI
  F-D1.1 中信 EDC 卡付登錄模式（POS 端小改，可並行；線上收單 D1.2 待中信 API 文件）
  F-A5 固定資產耐用年數表（獨立，可並行）

Phase 2（週 4–8）財會核心
  F-A2 拋轉引擎（★ 最多功能依賴它，先做）
  F-A1 報表補齊（日記帳/總帳先做，營業成本表等 F-C1）
  F-C3.1 單據編號規則、F-C3.2 折讓單（依賴 F-A2 + F-B1）

Phase 3（週 8–12）月結閉環
  F-C1 月加權平均月結 → F-A1 營業成本表 → F-C2 盤盈虧拋轉
  F-A3 立沖帳、F-A4 票據（依賴 F-A2）
  F-B3 401 正規化 + 媒體檔（依賴 F-C3.2 折讓單資料源）

Phase 4（週 12–16）
  F-B4 扣繳/二代健保（與 HR 薪資引擎協同）
  F-A6 部門損益、F-C3.3/3.4 安全存量+多幣別
  F-B5、F-C4 加分項視餘裕

Phase 3 追加：F-D1.3 請款批次/手續費傳票/銀行調節（依賴 F-A2）

關鍵依賴鏈：F-A2 拋轉引擎 → {A3 立沖, A4 票據, A5 折舊傳票, C1 成本調整, C2 盤盈虧, B3 憑證檔, D1.3 手續費傳票}
外部阻塞：e首發票金鑰（B1）、中信 EDC/網路收單規格（D1）、財政部審核軟體實測環境（B3/B4）
```

## 六、決策點（需要拍板）

1. ~~加值中心選誰~~ **已定案（2026-07-04）**：發票加值中心 = **e首發票**；信用卡收單 = **中國信託**（店內 EDC + 中信網路收單，見 Track D）。ECPay 僅保留為既有備援金流 method，與發票完全脫鉤
   - 待補資訊：中信承作 EDC 機型是否支援半整合、網路收單 API 文件與測試商店
2. **成本模式預設**：建議 org 預設「月加權平均月結」（台灣事務所習慣），即時移動平均留作看板參考值
3. **B2B 交換**（A 系列訊息）做不做：F&B 零售 B2B 佔比低 → 建議先做 B2C 存證 + B2B 存證（開給有統編的公司戶），「交換」延後
4. **403 兼營**：目前無免稅銷售則後置，僅先改掉誤名的扣繳報表
5. legacy `invoices` 表整併時機：建議 F-B1 一起做（同一 migration 週期）

## 七、施工守則（沿用專案慣例）

- 寫入一律走 RPC（`secure_*` 模式）、org RLS 全表；migration 檔一表一檔、不改舊 migration
- 傳票/發票/配號等關鍵寫入全部帶冪等鍵（UNIQUE 約束 + upsert 判斷）
- 事件走既有 EventBus 8 層 middleware；新事件先補 catalog schema + contract test
- 顏色/UI 遵守 CLAUDE.md 色彩規則；金額顯示統一千分位、負數用 `--accent-red` + 括號
- 每個 F-item 完成定義 = 功能 + 對應測試綠 + `gitnexus_detect_changes` 確認影響範圍
