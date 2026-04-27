# 中小企業營運管理系統 — 介紹總覽

> 適合當 PPT 大綱 / 銷售簡介 / 新人教育用。每個 `##` 可當一頁投影片。

---

## 一、三大組成

```
┌─────────────────────────┐    ┌─────────────────────────┐    ┌─────────────────────────┐
│   主系統 (Web App)       │    │   LIFF (手機行動端)      │    │   LINE BOT              │
│   桌面完整功能           │    │   LINE 內嵌 Web         │    │   快速指令+推播通知      │
│   老闆/主管/行政          │    │   全體員工              │    │   全體員工              │
└─────────────────────────┘    └─────────────────────────┘    └─────────────────────────┘
           ↓                              ↓                              ↓
        ┌──────────────────────────────────────────────────────────────────────┐
        │             Supabase (PostgreSQL + Auth + Storage + Edge)            │
        │             RLS + RBAC + 審計日誌 + Event-Driven                     │
        └──────────────────────────────────────────────────────────────────────┘
```

- **主系統**：web.domain（Vercel / 自架），給需要完整資料操作的角色用
- **LIFF**：`https://sme-ops-liff.vercel.app/`，手機 LINE 內打開
- **LINE BOT**：LINE 官方帳號，直接對話即可

---

## 二、主系統 (Web App) 功能模組

| 模組 | 功能 |
|---|---|
| 📊 **儀表板** | 營運 KPI、銷售趨勢、員工出勤、待辦事項 |
| 👥 **人資 HR** | 員工檔案、組織/部門/門市、排班（月/週/希望休）、薪資、請假、加班、出差、補卡、報帳、勞健保、假單設定、福利政策、LINE 綁定管理 |
| 🛒 **CRM** | 客戶、會員、業務機會、商機追蹤、客服單、行銷活動、新增客戶 |
| 💰 **財務** | 科目、傳票、應收/應付、總帳、試算表、報表、費用申請審批 |
| 🏪 **POS** | 門市收銀、交班、折扣、退貨、會員折抵 |
| 📦 **WMS** | 庫存、入庫、出庫、盤點、調撥、SKU/供應商、安全庫存警示 |
| 🏭 **製造** | BOM、工單、品管、產能排程 |
| 🧾 **採購** | 請購、採購單、供應商、驗收 |
| 📊 **分析** | 業績報表、員工績效、流程分析、庫存週轉、AI 庫存分析 |
| ⚙️ **流程管理** | 工作流程樣板、任務中心、checklist、簽核鏈、審批設定 |
| 🔐 **系統管理** | 組織/部門/門市、角色權限、稽核日誌、事件監控、通知中心 |
| 🚚 **物流/電商** | 電商整合（Shopee API）、訂單同步 |

---

## 三、RBAC 5 角色制

| 角色 | 說明 | 典型權限 |
|---|---|---|
| `super_admin` | 超級管理員（製作團隊） | 全部 15 項權限 |
| `admin` | 公司管理員 | HR 全套、系統設定、稽核 |
| `manager` | 主管 | 查員工、核假單、看薪資、管理部門 |
| `office_staff` | 行政員工 | 查員工、看自己薪資、申請單據 |
| `store_staff` | 門市員工 | 看自己薪資、打卡、申請單據（主走 LIFF） |

- DB 層 RLS 防止跨 org 資料外洩
- UI 層用 `role` 顯示/隱藏選單
- RPC 層 `check_permission(emp_id, perm_code)` 做最終把關


---

## 四、LIFF 行動端功能

進入方式：
1. LINE 傳文字指令（如「打卡」、「班表」、「儀表板」）→ BOT 回 flex card → 按按鈕
2. LINE 主選單 `/說明` → flex card 按按鈕
3. 圖文選單按鈕（rich menu）

### HR 區（員工自服務）
- ⏰ **打卡**：GPS + WiFi SSID 驗證、遲到/早退自動計算
- 📅 **我的班表**：月曆檢視、希望休標記
- 🗓️ **希望休**：月制希望休日曆
- 📋 **請假**：病/事/特/公假，附件上傳，半天/小時假
- 🕐 **加班申請**
- ✈️ **出差申請**
- 🧾 **報帳**（各類費用）
- 📝 **費用申請**（預算型，含科目選擇）
- 🔧 **補打卡申請**（上班/下班擇一）
- 💰 **查薪水**：歷月薪資單
- 🛡️ **簽核狀態**：我送出的單據審批進度

### 主管專區（super_admin / admin / manager）
- 🔐 **審核中心**：請假 / 加班 / 出差 / 報帳 / 補卡五類單據統一審批；權限閘依 `leave.approve` / `finance.edit` 分桶
- 📊 **營運儀表板**：整體完成率、進行中流程、任務逾期、活動時間軸、門市過濾
- 📋 **代辦項目**：任務 / 簽核雙 tab，顯示待辦件數

### 任務中心
- **我的任務**：三 tab（進行中 / 已完成 / 全部）
- **任務展開**：checklist 勾選、inline 任務項目、留言、回報完成
- **新增任務**：指派給自己或同 org 同事；title / description / due_date / priority / workflow
- **Deep-link 支援**：BOT 訊息「更新任務」按鈕可直接展開指定任務

### CRM / WMS / Sales hub
- 客戶查詢、會員查詢、客服單、新增客戶
- 庫存、入庫、出庫、盤點、調撥
- 行動 POS、訂單、報價、退貨、業績

---

## 五、LINE BOT 功能

### 主選單（傳 `/說明`）

```
📋 營運管理助理
┌──────────────────────────┐
│ ■ 📊 儀表板 (primary)     │ ← LIFF deep-link
│ ➕ 新增任務               │ ← LIFF deep-link
│ ⚙️ 更新任務               │ ← LIFF deep-link
│ 📋 代辦項目               │ ← LIFF deep-link
│                          │
│ [進行中任務] [所有任務]   │ ← BOT 內 flex 回覆
│ 📝 備註查詢               │ ← BOT 文字回覆
│ 🔑 管理員選單（主管）      │ ← BOT 子選單
│ 👤 帳號連結說明           │ ← 說明
└──────────────────────────┘
```

### 文字指令速查（全開到 LIFF）

| 打字輸入 | 開啟 LIFF 頁面 |
|---|---|
| `打卡` / `上班` / `下班` | `/clock` |
| `補打卡` / `補登` | `/clock-correction` |
| `班表` / `我的班表` | `/my-schedule` |
| `請假` / `請假申請` | `/leave` |
| `希望休` / `休假申請` | `/off-request` |
| `加班` | `/overtime` |
| `出差` | `/business-trip` |
| `費用` / `報銷` | `/expense-request` |
| `費用紀錄` | `/expenses` |
| `簽核` / `待簽核` / `審核` | `/approve` |
| `簽核狀態` / `我的申請` | `/approval-status` |
| `儀表板` / `儀錶板` | `/dashboard` |
| `薪水` / `查薪水` | `/salary` |
| `代辦` / `代辦項目` / `待辦` | `/todo` |
| `出勤` | 回四按鈕卡片（打卡/班表/請假/加班） |

### 文字指令（BOT 內部回覆，不跳 LIFF）

| 打字輸入 | BOT 行為 |
|---|---|
| `/任務 列表` / `任務` | 回 flex carousel，我的待辦任務 |
| `/任務 全部` | 回 flex carousel，全部任務（含已完成） |
| `/任務 新增 <標題>` | 啟動多步驟新增任務流程（選流程→截止日→提醒→指派） |
| `/任務 #<shortId> 完成` | 標記任務完成 |
| `/任務 #<shortId> 更新 <備註>` | 加任務備註 |
| `/任務 #<shortId> 請求確認` | 發送多方確認請求 |
| `/流程 狀態` | 進行中工作流程列表 |
| `/流程 任務 #<shortId>` | 展開特定流程的步驟 |
| `/備註` | 個人近期留言 |
| `/管理 全覽` | 團隊全部任務（主管） |
| `/管理 指派 <員工> <標題>` | 指派任務 |
| `/註冊 <姓名>` | 綁定 LINE 帳號到員工 |

### 推播通知（主動發送）

| 事件 | 觸發 | 對象 |
|---|---|---|
| 📅 排班公告 | 每週五下午 | 全員 |
| 💰 薪資單發送 | 每月 5 號 | 個人 |
| ⏰ 漏打卡提醒 | 隔日早上 | 當事人 |
| 📋 任務指派 | 即時 | 被指派人 |
| ✅ 審批請求 | 即時 | 審批人 |
| ⚠️ 任務到期 | 到期前一天 | 負責人 |
| 🚨 流程逾期 | 過截止日 | 負責人 + 主管 |

---

## 六、安全與擴展性

- 🔒 **RLS (Row Level Security)**：DB 層 org-scoped 強制隔離
- 🛡️ **RBAC**：5 角色 × 20+ 權限
- 🔐 **LIFF RPC Suite**：anon key 無法直接 query 敏感資料，必經 `SECURITY DEFINER` RPC
- 📋 **審計日誌**：`audit_logs` + `event_outbox`
- 🚀 **Event-driven**：8 層 middleware（sanitizer/rateLimit/idempotency/validator/tracing/auditLog/DLQ/outbox），Kafka-ready
- 🔄 **CQRS read models**：materialized view fallback
- 📊 **DLQ monitoring**：dead letter queue + error budget

---

## 七、技術堆疊

| 層 | 技術 |
|---|---|
| 前端（主系統 + LIFF） | React 19, React Router 7, Tailwind 4, Vite |
| 圖表 | Chart.js, Recharts |
| LINE 整合 | LIFF SDK 2, Messaging API |
| 後端 | Supabase (PostgreSQL 15), Edge Functions (Deno) |
| Auth | Supabase Auth (email + password) |
| Storage | Supabase Storage (附件、頭貼、合約) |
| AI | Google Gemini (排班演算法、庫存分析) |
| 部署 | Vercel (主系統 + LIFF), Supabase (DB + Edge) |

---

## 八、介紹清單（給客戶/銷售用）

### 為什麼用這套

1. ✅ **一套搞定 10+ 模組**：HR、CRM、財務、POS、WMS、製造、採購、分析、流程、系統
2. ✅ **LINE 原生整合**：員工不用下載 App，LINE 內就能打卡 / 請假 / 看班表 / 查薪水
3. ✅ **主管儀表板**：流程卡關、任務逾期一目了然
4. ✅ **多店多組織**：天生 multi-tenant，一套系統管好幾間分店
5. ✅ **審計合規**：每個操作都有 log，可追溯
6. ✅ **AI 加持**：排班自動化、庫存智能分析

### 典型客戶使用流程

```
店員 (store_staff)
  手機 LINE → 打卡 / 查班 / 請假 / 報帳

行政 (office_staff)
  LIFF 做日常 → Web 做進階操作（傳票、報表）

主管 (manager)
  LINE 收審批通知 → LIFF 審核
  Web 看儀表板 / 排班 / 管理部門

老闆 (admin)
  Web 全域儀表板 + 所有模組
  LINE 收異常推播

製作團隊 (super_admin)
  Web 系統設定 / 角色權限 / 稽核
```

---

## 九、未來可延伸

- 📱 Native App（iOS/Android）
- 🌐 多語系（目前繁中）
- 🤝 ERP 整合（SAP / Oracle / 鼎新）
- 📊 BI 看板（自訂儀表板建構器已有雛型）
- 🔗 供應鏈串接（金流 / 物流 / 發票）

---

**製作團隊**：aska911023 + astrops111
**Repository**：
- 主系統 + LINE BOT：[github.com/aska911023/sme-ops-system](https://github.com/aska911023/sme-ops-system)
- LIFF：[github.com/aska911023/sme-ops-liff](https://github.com/aska911023/sme-ops-liff)
