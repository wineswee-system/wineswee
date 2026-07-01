# UHF RFID 讀取器設定 UI — Design Doc

> Companion to `CRM_ODOO_GAP_PLAN_2026-06-21.md` §17.3 (rfid_tags / rfid_scans) and Sprint P4 (RFID Manager `/wms/rfid`).
> That plan covers **tag lifecycle**; this doc covers **reader hardware configuration** — the missing piece.

---

## 1. Scope & Assumptions

- **Hardware**: vendor-agnostic UHF (EPC Gen2 / ISO 18000-6C) readers. Two classes:
  - **固定式讀取器 (fixed)** — dock door / POS gate / smart shelf, 1–4 external antennas
  - **手持機 (handheld)** — inventory count, batch upload
- **Region**: Taiwan NCC band **922–928 MHz** (default, locked per org; supports US 902–928 / EU 865–868 for imported units)
- **Connectivity**: browsers can't open TCP to a reader. Two supported modes:
  1. **Edge Agent 推送** — a small bridge program on the store PC/gateway talks LLRP/vendor SDK to the reader and POSTs scan batches to a Supabase Edge Function, authenticated by a per-reader **device token**
  2. **檔案上傳** — handheld exports CSV/TXT → staff uploads on the RFID Manager page (already in Sprint P4)
- UI text zh-TW; all colors via theme tokens; status uses `Badge.jsx` (color + text, never color-only)

## 2. Routes & Navigation

| Route | Page | Permission |
|---|---|---|
| `/wms/rfid` | RFID Manager（標籤 / 掃描紀錄 / 盤點）— Sprint P4 | `wms.rfid.view` |
| `/wms/rfid-config` | **讀取器設定** (this doc) | `wms.rfid.manage` (admin/warehouse lead) |

Sidebar: WMS section → 「RFID 管理」/「RFID 讀取器設定」. Config page also linked from a gear icon on the RFID Manager header.

## 3. Page Layout — `/wms/rfid-config`

Master list + detail drawer (same pattern as DockManagement / QRSettings).

```
┌──────────────────────────────────────────────────────────────────────┐
│ ⚙ RFID 讀取器設定           [門市: 大安店 ▾]        [+ 新增讀取器]     │
│ 管理 UHF 讀取器連線、天線功率與掃描行為                                  │
├──────────────────────────────────────────────────────────────────────┤
│ 摘要列:  ● 在線 3   ○ 離線 1   ⏸ 停用 1      今日掃描 12,408 筆        │
├──────────────────────────────────────────────────────────────────────┤
│ 名稱          類型      位置對應       模式        狀態      最後心跳    │
│ 倉庫收貨門    固定式    收貨碼頭 D1    入庫收貨    ●在線     32 秒前     │
│ POS 出口閘門  固定式    前場出口       結帳/EAS    ●在線     8 秒前      │
│ 酒窖層架 A    固定式    酒窖 Zone A    盤點        ○離線     2 小時前 ⚠  │
│ 手持機 #1     手持      (盤點時指定)   盤點        —上傳制   昨天        │
└──────────────────────────────────────────────────────────────────────┘
```

- 離線 = no heartbeat > 3× heartbeat interval → row shows `--accent-orange` Badge「離線」+ warning icon
- Click row → right-side drawer (560px) with 4 sections

## 4. Reader Detail Drawer

### 4.1 基本資料
| Field | Control | Notes |
|---|---|---|
| 名稱 | text | e.g. 倉庫收貨門 |
| 類型 | segmented: 固定式 / 手持 | handheld hides RF/antenna sections (configured on device) |
| 廠牌/型號 | text ×2 | free text — Impinj R700, Chainway C72, Zebra FX9600… |
| 序號 | text | |
| 門市/倉庫 | select (stores) | tenant-scoped |
| 啟用 | Toggle | disabled reader → Edge Function rejects its token |

### 4.2 連線（固定式 only）
| Field | Control | Notes |
|---|---|---|
| 連線模式 | radio card: Edge Agent 推送 / 檔案上傳 | same radio-card style as QRSettings 確認模式 |
| 裝置金鑰 | read-only + [重新產生] [複製] | shown once on generate; stored hashed |
| 上報端點 | read-only copy field | `…/functions/v1/rfid-ingest` |
| 心跳間隔 | number, 10–300 秒, default 30 | drives online/offline badge |
| 批次上報 | number, 100–5000 筆, default 500 | agent flush size |

### 4.3 RF 參數（固定式 only）
| Field | Control | Notes |
|---|---|---|
| 頻段 | select, default 台灣 NCC 922–928 MHz | warning icon + tooltip: 頻段須符合當地法規 |
| Session | select S0/S1/S2/S3, default S1 | helper text: S0=重複讀取快, S2/S3=大量盤點 |
| 搜尋模式 | select: Dual Target / Single Target | |
| 標籤數量預估 (Q) | select: 自動 / 手動 Q 0–15 | |
| 去重視窗 | number ms, default 2000 | same EPC within window = 1 scan |
| RSSI 過濾 | slider −80 → −30 dBm, default 關閉 | ignore weak reads (neighboring zone bleed) |

**天線 (1–4)** — table, one row per port:

```
埠  啟用   功率 (dBm)          位置對應           用途
1   [✓]   ▓▓▓▓▓▓░░ 27        收貨碼頭 D1 ▾      主要
2   [✓]   ▓▓▓▓░░░░ 20        收貨碼頭 D2 ▾      主要
3   [ ]   —                  — ▾                —
4   [ ]   —                  — ▾                —
```

- 功率: slider 5–30 dBm (integer), live label
- 位置對應: select of WMS bins/zones (`bins` table) — this becomes `rfid_scans.scan_location`

### 4.4 掃描行為（事件對應）
The most important business setting — what a read **means** at this reader:

| 模式 | Emits | Side effect |
|---|---|---|
| 入庫收貨 | `wms.rfid.scan_detected` (context: inbound) | match open GR → assign tag → in_stock |
| 結帳確認 / EAS | scan_detected (context: pos_exit) | tag not sold → alert; sold → pass |
| 盤點 | `wms.rfid.inventory_counted` batch | reconcile vs inventory_lots |
| 調撥門 | scan_detected (context: portal) | auto-create transfer movement |
| 僅記錄 | scan_detected only | log, no side effects (試運轉) |

Radio-card list with desc per option (QRSettings pattern). Plus:
- 觸發方式: 持續讀取 / GPIO 觸發 / 手動觸發
- 未知標籤處理: 忽略 / 記錄為未註冊 / 通知

### 4.5 測試面板 (drawer footer)
`[測試讀取 30 秒]` → live tail (Supabase realtime on `rfid_scans` filtered by reader): EPC、天線埠、RSSI、次數。Empty state:「請將標籤靠近天線…」. This is how staff verify power/antenna mapping without leaving the page.

## 5. Data Model

```sql
CREATE TABLE rfid_readers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  store_id        UUID REFERENCES stores(id),
  name            TEXT NOT NULL,
  reader_type     TEXT NOT NULL CHECK (reader_type IN ('fixed','handheld')),
  vendor          TEXT, model TEXT, serial_no TEXT,
  enabled         BOOLEAN DEFAULT TRUE,
  connection_mode TEXT DEFAULT 'push' CHECK (connection_mode IN ('push','upload')),
  device_token_hash TEXT,                -- per-reader ingest auth
  heartbeat_sec   INT DEFAULT 30,
  batch_size      INT DEFAULT 500,
  region          TEXT DEFAULT 'TW_922_928',
  rf_session      TEXT DEFAULT 'S1',
  search_mode     TEXT DEFAULT 'dual',
  q_mode          TEXT DEFAULT 'auto', q_value INT,
  dedup_window_ms INT DEFAULT 2000,
  rssi_min        INT,                   -- null = off
  scan_mode       TEXT NOT NULL DEFAULT 'log_only'
    CHECK (scan_mode IN ('inbound','pos_exit','count','portal','log_only')),
  trigger_mode    TEXT DEFAULT 'continuous',
  unknown_tag_policy TEXT DEFAULT 'log',
  antennas        JSONB DEFAULT '[]',    -- [{port:1,enabled:true,power_dbm:27,location_id:'…',role:'primary'}]
  last_seen_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
-- RLS: org member read; wms.rfid.manage for write. Writes via RPC per project convention.
ALTER TABLE rfid_scans ADD COLUMN IF NOT EXISTS reader_id UUID REFERENCES rfid_readers(id);
```

Antennas as JSONB (not child table): max 4 rows, always read/written with the reader — no join value.

## 6. Ingestion (Edge Function `rfid-ingest`)

```
POST /functions/v1/rfid-ingest   Authorization: Bearer <device_token>
{ "reader_serial": "...", "scans": [{ "epc": "...", "antenna": 1, "rssi": -54, "ts": "..." }], "heartbeat": true }
```
- Validate token → reader row; reject if `enabled=false`
- Server-side dedup by `dedup_window_ms`; map antenna→location; insert `rfid_scans`; update `last_seen_at`
- Emit event per `scan_mode` through EventBus outbox

## 7. Files (new sprint: P4b — Reader Config)

- `+ src/pages/wms/RFIDConfig.jsx` — list + summary bar
- `+ src/pages/wms/components/ReaderDrawer.jsx` — 4-section drawer + test panel
- `+ src/lib/db/rfid.js` — `listReaders() / upsertReader() / regenerateToken() (RPC)`
- `+ supabase/functions/rfid-ingest/index.ts`
- `+ supabase/migrations/*_rfid_readers.sql`
- `~ src/modules/WMSModule.jsx` — lazy route `rfid-config`
- `~ src/components/sidebar/sidebarConfig.js` — WMS section entry, gated by `wms.rfid.manage`
- `~ src/lib/events/catalog/wms.events.js` — reuse Sprint P4 events

## 8. Open Questions

1. 實際採購的讀取器型號？(Impinj / Zebra / Chainway / 國產) — 影響 Edge Agent 要支援 LLRP 還是廠商 SDK
2. POS 出口閘門 (EAS 防盜) 是 v1 需求還是先只做倉庫收貨 + 盤點？
3. Edge Agent 由誰維運？若短期只用手持機，可先只出貨「檔案上傳」模式，整個 4.2/4.3 區塊可延後
