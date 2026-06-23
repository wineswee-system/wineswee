# POS Development Plan — Floor Panel

**Device:** Sunmi D2 (Android, built-in 80mm thermal printer, built-in 2D barcode scanner)
**ERP:** 文中資訊 CERP (winton.com.tw) — handles accounting + e-invoice relay to e首發票 EIPP → MoF
**Scope:** Floor panel app (`apps/floor`) + sme-ops ops panel (`src/`)
**Status:** Planning — no ordering or payment code exists yet

---

## Architecture

```
Floor Panel POS (apps/floor — Supabase)
        │
        ▼
Edge Function: complete-order
   ├─► orders / order_items / payments       ← floor panel UI source of truth
   ├─► pos_transactions                      ← sme-ops POS module
   ├─► sales_orders + sales_order_lines      ← sme-ops Sales module
   ├─► invoices + invoice_lines              ← sme-ops Finance module
   ├─► journal_entries + journal_lines       ← sme-ops accounting
   ├─► inventory_transactions (OUT)          ← sme-ops WMS
   └─► POST to 文中 CERP API                ← mirrors above; 文中 relays to e首發票 → MoF

Table QR Code (Guest self-ordering)
        │
        ▼
 /menu/:storeId/:tableId?token=xxx  (booking subdomain)
        │
        └─► Supabase writes order_items (source = 'guest')
        └─► Supabase Realtime → floor panel staff sees instantly
        └─► Staff confirms → kitchen / product pull ticket printed
```

---

## Multi-Tenant Rule

**Every table must carry both `organization_id` and `store_id`.**

- `organization_id` — tenant scope (matches `employees.organization_id`)
- `store_id` — location scope (matches `stores.id`)
- All RLS policies filter `organization_id` first, then `store_id`
- All `db.js` queries must pass both; never fetch cross-org

---

## Payment Processing

No payment gateway needed.

| Method | Handling | Notes |
|--------|---------|-------|
| 現金 | In-app change calc + cash drawer | Full integration |
| 信用卡 | Bank EDC machine (separate hardware) | App records confirmation only; no card data |
| LINE Pay | Static merchant QR | MVP: manual confirm; post-launch: LINE Pay API for auto-confirm |
| 街口 / Taiwan Pay | Static QR | Same as LINE Pay |

---

## Phase 1 — Database Schema

All new tables include `organization_id uuid NOT NULL` and `store_id uuid REFERENCES stores(id) NOT NULL`.

```sql
-- ─────────────────────────────────
-- MENU
-- ─────────────────────────────────

CREATE TABLE menu_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  store_id        uuid REFERENCES stores(id) NOT NULL,
  name            text NOT NULL,
  sort_order      int DEFAULT 0,
  is_active       boolean DEFAULT true
);

CREATE TABLE menu_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  store_id        uuid REFERENCES stores(id) NOT NULL,
  category_id     uuid REFERENCES menu_categories(id),
  name            text NOT NULL,
  price           numeric(10,2) NOT NULL,
  tax_rate        numeric(4,3) DEFAULT 0.05,
  description     text,
  image_url       text,
  is_available    boolean DEFAULT true,
  sort_order      int DEFAULT 0
);

CREATE TABLE menu_item_ingredients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id uuid REFERENCES menu_items(id) ON DELETE CASCADE,
  sku_id       uuid REFERENCES skus(id),
  quantity     numeric NOT NULL,
  unit         text
  -- org/store inherited from parent menu_item
);

-- ─────────────────────────────────
-- PHYSICAL PRODUCTS
-- ─────────────────────────────────

CREATE TABLE pos_products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  store_id        uuid REFERENCES stores(id) NOT NULL,
  sku_id          uuid REFERENCES skus(id) NOT NULL,
  name            text NOT NULL,
  retail_price    numeric(10,2) NOT NULL,    -- never use skus.unit_cost for selling price
  tax_rate        numeric(4,3) DEFAULT 0.05,
  image_url       text,
  is_available    boolean DEFAULT true,
  show_in_qr_menu boolean DEFAULT false,
  sort_order      int DEFAULT 0
);

-- ─────────────────────────────────
-- ORDERS
-- ─────────────────────────────────

CREATE TABLE orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  store_id        uuid REFERENCES stores(id) NOT NULL,
  reservation_id  uuid REFERENCES reservations(id),  -- nullable: walk-in
  table_id        uuid REFERENCES res_tables(id),
  order_number    text,           -- e.g. #042 — sequential per shift, for easy staff reference
  status          text DEFAULT 'open',   -- open | submitted | paid | voided
  source          text DEFAULT 'staff',  -- staff | qr_self_order
  note            text,
  created_by      uuid REFERENCES employees(id),  -- null if QR self-order
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE TABLE order_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid REFERENCES orders(id) ON DELETE CASCADE,
  item_type       text NOT NULL DEFAULT 'menu',  -- menu | product | custom
  menu_item_id    uuid REFERENCES menu_items(id),    -- set when item_type = 'menu'
  pos_product_id  uuid REFERENCES pos_products(id),  -- set when item_type = 'product'
  name            text NOT NULL,       -- snapshot (or custom name)
  unit_price      numeric(10,2) NOT NULL,
  tax_rate        numeric(4,3) NOT NULL DEFAULT 0.05,
  quantity        int NOT NULL DEFAULT 1,
  note            text,
  status          text DEFAULT 'pending',  -- pending | preparing | served | cancelled
  source          text DEFAULT 'staff'     -- staff | guest
  -- exactly one of menu_item_id / pos_product_id is non-null; both null for item_type='custom'
);

-- ─────────────────────────────────
-- PAYMENTS (supports split bill)
-- ─────────────────────────────────

CREATE TABLE payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL,
  store_id          uuid REFERENCES stores(id) NOT NULL,
  order_id          uuid REFERENCES orders(id),
  split_index       int DEFAULT 1,     -- which split payment (1 of N)
  split_total       int DEFAULT 1,     -- total number of splits (1 = not split)
  split_item_ids    uuid[],            -- which order_item ids this payment covers (null = all)
  subtotal          numeric(10,2) NOT NULL,
  tax_amount        numeric(10,2) NOT NULL,
  discount_amount   numeric(10,2) DEFAULT 0,
  total             numeric(10,2) NOT NULL,
  method            text NOT NULL,     -- cash | card | linepay | jko | other
  received_amount   numeric(10,2),     -- cash only
  change_amount     numeric(10,2),     -- cash only
  paid_at           timestamptz DEFAULT now(),
  paid_by           uuid REFERENCES employees(id)
);

-- ─────────────────────────────────
-- E-INVOICES
-- ─────────────────────────────────

CREATE TABLE pos_invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL,
  store_id          uuid REFERENCES stores(id) NOT NULL,
  payment_id        uuid REFERENCES payments(id),
  invoice_number    text,
  invoice_date      date NOT NULL,
  carrier_type      text,        -- 3J0002 | CQ0001 | ECA0001 | null
  carrier_id        text,
  buyer_tax_id      text,
  buyer_name        text,
  seller_tax_id     text NOT NULL,
  amount_excl_tax   numeric(10,2),
  tax_amount        numeric(10,2),
  total             numeric(10,2),
  random_code       text,
  barcode_left      text,
  barcode_right     text,
  qr_code_l         text,
  qr_code_r         text,
  wenzhong_response jsonb,
  status            text DEFAULT 'issued'  -- issued | voided | credit_note | error | pending_sync
);

-- ─────────────────────────────────
-- RETURNS
-- ─────────────────────────────────

CREATE TABLE pos_returns (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  store_id            uuid REFERENCES stores(id) NOT NULL,
  original_order_id   uuid REFERENCES orders(id),
  original_payment_id uuid REFERENCES payments(id),
  returned_items      jsonb NOT NULL,  -- [{order_item_id, name, qty, unit_price, sku_id}]
  refund_amount       numeric(10,2) NOT NULL,
  refund_method       text NOT NULL,  -- cash | card | store_credit
  reason              text,
  wenzhong_credit_ref text,           -- 折讓 invoice number from 文中
  processed_by        uuid REFERENCES employees(id),
  created_at          timestamptz DEFAULT now()
);

-- ─────────────────────────────────
-- SHIFT
-- ─────────────────────────────────

CREATE TABLE pos_shifts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  store_id        uuid REFERENCES stores(id) NOT NULL,
  opened_by       uuid REFERENCES employees(id),
  closed_by       uuid REFERENCES employees(id),
  opening_float   numeric(10,2),
  closing_count   numeric(10,2),
  order_counter   int DEFAULT 0,  -- incremented per order to generate order_number
  opened_at       timestamptz DEFAULT now(),
  closed_at       timestamptz,
  status          text DEFAULT 'open'
);

-- ─────────────────────────────────
-- QR SESSIONS
-- ─────────────────────────────────

CREATE TABLE qr_order_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  store_id        uuid REFERENCES stores(id) NOT NULL,
  table_id        uuid REFERENCES res_tables(id),
  order_id        uuid REFERENCES orders(id),
  token           text UNIQUE NOT NULL,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz DEFAULT now()
);
```

### Existing sme-ops tables written by `complete-order`

| Table | Written |
|-------|---------|
| `pos_transactions` | One row per payment |
| `sales_orders` + `sales_order_lines` | One order per check |
| `invoices` + `invoice_lines` | E-invoice with 文中 response |
| `journal_entries` + `journal_lines` | Debit cash/card, credit revenue |
| `inventory_transactions` | OUT per ingredient + per product sold |
| `skus.stock_qty` | Decremented |

---

## Phase 2 — Menu Management (sme-ops)

New sidebar section under **POS**.

**菜單類別** — drag-to-reorder, active toggle.

**菜單品項** — item editor:

```
┌──────────────────────────────────────────┐
│ 品項: 牛肉麵      價格: $180  稅率: 5%   │
│ 類別: 主食        圖片: [上傳]            │
│ ☑ 上架                                   │
├──────────────────────────────────────────┤
│ 食材用量                                  │
│ ┌──────────────────┬────────┬─────────┐  │
│ │ SKU              │ 用量   │ 單位    │  │
│ │ 牛肉             │ 200    │ g       │  │
│ │ 麵條             │ 100    │ g       │  │
│ │ [+ 新增食材]     │        │         │  │
│ └──────────────────┴────────┴─────────┘  │
│ ☑ 庫存不足時自動下架                       │
└──────────────────────────────────────────┘
```

**自動下架:** DB trigger — when any linked `skus.stock_qty` drops below one serving's requirement, set `menu_items.is_available = false`. Applies to floor panel and guest QR menu.

---

## Phase 3 — Physical Product Catalog (sme-ops)

**零售商品** tab under POS — links WMS SKUs to POS retail with separate selling price.

```
┌──────────────────────────────────────────┐
│ 商品: 招牌醬料    條碼: 1234567           │
│ SKU: [搜尋 / 掃描]                       │
│ 零售價: $ 250     稅率: 5%               │
│ 圖片: [上傳]                              │
│ ☑ 上架    ☑ 顯示於QR點餐菜單             │
└──────────────────────────────────────────┘
```

`retail_price` is never derived from `skus.unit_cost` — the procurement cost and selling price are completely separate fields.

**自動下架:** `skus.stock_qty = 0` → product greyed out in floor panel, hidden from QR menu.

### Barcode scan flow (floor panel — staff)

```
Scan barcode
    │
    ├─ Found in pos_products?
    │   ├─ available + stock > 0  →  add to order ✓
    │   ├─ out of stock           →  "庫存不足" ✗
    │   └─ SKU exists but no pos_products entry
    │       →  "尚未設定零售價" + [自訂金額] button
    │
    └─ Not found in any SKU
        →  "找不到條碼" + [自訂品項] button
```

**Unknown barcode / custom item escape hatch:**

When a barcode is not registered, staff can tap [自訂品項] and enter name + price manually. This creates an `order_items` row with `item_type = 'custom'`. Custom items:
- Have no inventory tracking (no SKU link)
- Still appear on invoice with the manual name and price
- Are flagged in sme-ops 訂單記錄 with a "自訂" badge for review

**Scanner mode:** The Sunmi has one hardware scanner. The app tracks `scan_mode`:
- `'product'` — active on order page 商品 tab
- `'carrier'` — active on payment page 載具 field

Only one listener active at a time; switching clears the previous.

---

## Phase 4 — Ordering Flow (floor panel)

### Entry points

**Reserved (已入座):** "點餐" on seated table tile → `reservation_id` linked automatically.
**Walk-in / any table:** "新增點餐" on any tile → `reservation_id = null`.

On order creation: increment `pos_shifts.order_counter` and assign `orders.order_number` (e.g. `#042`) for easy cross-staff reference during service.

### Order page `/order/:tableId`

```
┌──────────────────────────────────────────────────┐
│  桌 A3  #042  │  3人  │  [送廚房 ▶]  [結帳 💳]   │
├──────────────────────────────────────────────────┤
│  [菜單]  [商品]                                   │
├──────────┬───────────────────────────────────────┤
│ 主食  ▶  │  牛肉麵 $180   排骨飯 $150             │
│ 飲料     │                                        │
├──────────┴───────────────────────────────────────┤
│  [📷 掃描條碼]  [或從清單]                         │  ← 商品 tab
│  招牌醬料 $250   紀念T恤 $350                      │
├──────────────────────────────────────────────────┤
│  目前訂單 #042                    小計: $610      │
│  牛肉麵 x1   $180  [備註][－][＋][✕]              │
│  招牌醬料 x1 $250  [備註][－][＋][✕]  🛒          │
│  🔔 客人新增: 可樂 x1  [✓][✕]                    │
│  ──────────────────────────────────────────────  │
│  [🔁 合併桌] [🖨 重印] [送廚房]                  │
└──────────────────────────────────────────────────┘
```

UX rules for Sunmi D2:
- Min touch target 56px
- Physical products: 🛒 badge; custom items: "自訂" badge
- "送廚房" sends only food/drink items — products go to `served` immediately
- Multiple rounds supported throughout the session

### Order statuses

```
open → submitted (kitchen items sent) → paid
                                      └→ voided
```

Product items: `pending` → `served` immediately on add (no kitchen step).
Cancelled items already submitted to kitchen: print a **取消單** (cancellation slip) on kitchen printer so kitchen staff know to discard.

### Table merge (G4)

When two groups are seated together, staff taps [🔁 合併桌]:
1. Select source table (the one being merged away)
2. All `order_items` from source `order` are moved to the current `order`
3. Source `order.status` set to `voided`, `table_id` freed
4. `qr_order_sessions` for source table invalidated

Manager role required.

### Reprint from order page (G5, G12)

[🖨 重印] button on any order (open or closed) reprints the last receipt on Sunmi printer. Available to all staff; no manager gate.

### Walk-in QR generation (G7)

For walk-in orders (no check-in event), a [生成QR] button appears on the order page header after the order is created. Tapping it:
1. Creates `qr_order_sessions` row with token + expiry
2. Prints QR on Sunmi or displays on screen for guest to scan

---

## Phase 5 — Table QR Code Self-Ordering (guest-facing)

### Flow

1. Table seated → QR printed/displayed
2. Guest scans → `/menu/:storeId/:tableId?token=xxx`
3. Browses food + retail products with `show_in_qr_menu = true`
4. Submits → Edge fn `submit-guest-order` validates token → writes `order_items`
5. Supabase Realtime pushes to floor panel
6. Staff confirms (or auto-confirms) → ticket printed
7. Guest can submit additional rounds

### QR URL

```
https://book.yourdomain.com/menu/{storeId}/{tableId}?token={sessionToken}
```

Token in `qr_order_sessions`, scoped to org + store. Invalidated on payment or table reset.

### Guest menu page

```
┌─────────────────────────────────────┐
│  [店名] — 桌 A3                     │
│  [菜單]  [商品]                      │
├─────────────────────────────────────┤
│  牛肉麵 $180  [+]                   │
│  排骨飯 $150  [+]                   │
│  招牌醬料 $250  [+]    ← 商品 tab   │
├─────────────────────────────────────┤
│  購物車  2項          $330          │
│  [備註]  [送出點餐]                  │
└─────────────────────────────────────┘
```

- No login required
- Food: `menu_items` where `is_available = true` and `store_id` match
- Products: `pos_products` where `is_available = true AND show_in_qr_menu = true`
- Token validated server-side in `submit-guest-order` Edge fn
- Rate limit: 3 submissions per token per 5 min

### Staff approval modes

| Mode | Behaviour |
|------|-----------|
| 自動確認 | Items → `submitted`, kitchen ticket prints immediately |
| 需確認 | Items appear with 🔔 badge; staff taps confirm |

---

## Phase 6 — Payment Flow (floor panel)

### Step 1: Review & discount

```
  牛肉麵 x1              $180  🍜
  招牌醬料 x1             $250  🛒
  ────────────────────────────────
  小計                   $430
  折扣  [0]%  或 $[   ]        ← manager role only
  稅 (5% 含稅)             $21
  合計                   $430
```

### Step 2: Split bill (G3)

Optional before choosing payment method:

```
  [單筆結帳]   [分帳結帳]
```

**分帳結帳 modal:**
```
  分帳方式:
  ○ 均分  [2] 人  → 每人 $215
  ○ 依品項  → 勾選每人付哪些品項
  ○ 自訂金額  → 自行輸入各份金額

  [下一步 →]
```

Each split creates a separate `payments` row with `split_index` and `split_total` set. Each payment triggers its own invoice through `complete-order`. Guests can use different payment methods per split.

### Step 3: Payment method

```
  [ 現金 ]  [ 信用卡 ]  [ LINE Pay ]  [ 街口 ]  [ 其他 ]
```

**Cash:**
```
  合計: $430    收到: [500]    找零: $70
  [確認收款 → 開發票]    ← opens cash drawer
```

**Card / QR:**
```
  合計: $430
  請於刷卡機或掃描QR完成付款
  [確認已完成付款]
```

### Step 4: Invoice

```
  ○ 雲端發票    條碼 [        ] [📷 掃描]   ← 手機條碼 /XXXXXXX
  ○ 公司戶      統編 [      ]  抬頭 [     ]
  ○ 不需要發票

  [開立發票 & 列印收據]
```

**載具 types:**

| 類型 | 格式 | CarrierType |
|------|------|-------------|
| 手機條碼 | `/XXXXXXX` | `3J0002` |
| 自然人憑證 | 16 chars | `CQ0001` |
| 悠遊卡/一卡通 | card number | `ECA0001` |

Validation: 手機條碼 `/^\/[A-Z0-9+\-.]{7}$/`, 自然人憑證 `/^[A-Z]{2}[0-9]{14}$/`.

**After payment completes:**
- Table status resets to `available` in SeatingMap automatically
- `qr_order_sessions` token invalidated
- Reservation (if linked) status set to `completed`

---

## Phase 7 — Physical Product Returns (G1)

After payment, customer wants to return a product. Food/drink void is handled differently (invoice void only); product return also restores physical stock.

### Return flow (floor panel)

From 訂單記錄 in floor panel (or sme-ops), staff opens a closed order and taps [退貨]:

```
┌───────────────────────────────────┐
│  退貨  訂單 #042                  │
│  選擇退回品項:                     │
│  ☑ 招牌醬料 x1  $250              │
│  ☐ 牛肉麵  x1  $180  (不可退食品) │
│                                   │
│  退款方式: [現金] [信用卡] [店鋪金] │
│  退款金額: $250                   │
│  退貨原因: [___________________]  │
│                                   │
│  [確認退貨]                        │
└───────────────────────────────────┘
```

Note: food/drink items can be marked non-returnable in `menu_items` if desired (add `is_returnable boolean DEFAULT false`).

### What happens on confirm

Edge Function `process-return`:

1. Write `pos_returns` row
2. Write reverse `inventory_transactions` (IN, ref: `RETURN-{return_id}`)
3. Increment `skus.stock_qty` for each returned product
4. POST to 文中 API — issue `折讓` (credit note) against original invoice
5. Update `pos_invoices` with credit note reference
6. If cash refund: staff opens cash drawer manually (no auto-open — verify refund first)
7. Print return receipt on Sunmi

### Return receipt format

```
  ──── 退貨收據 ────
  原訂單: #042  2026/06/24
  退回: 招牌醬料 x1  $250
  退款方式: 現金
  折讓發票: AA-00000123
  ──────────────────
  [店名]  謝謝惠顧
```

---

## Phase 8 — 文中 ERP + e首發票 Integration

### Edge Function: `complete-order`

Server-side only — credentials never in browser.

**Sequence:**
1. Write `orders`, `order_items`, `payments`, `pos_invoices`
2. Write `pos_transactions`, `sales_orders`, `sales_order_lines`
3. Write `invoices`, `invoice_lines`
4. Write `journal_entries` (debit cash/card, credit revenue)
5. Food items → `inventory_transactions OUT` per recipe ingredient
6. Product items → `inventory_transactions OUT` directly per SKU
7. Custom items → no inventory write
8. Decrement `skus.stock_qty`
9. POST to 文中 CERP API
10. Update `pos_invoices` with 文中 response (invoice number, QR codes)

**Payload to 文中:**
```json
{
  "store_tax_id": "12345678",
  "invoice_date": "20260624",
  "invoice_series": "AA",
  "items": [
    { "name": "牛肉麵",  "qty": 1, "unit_price": 171.43, "tax": 8.57, "tax_rate": 0.05 },
    { "name": "招牌醬料","qty": 1, "unit_price": 238.10, "tax": 11.90,"tax_rate": 0.05 },
    { "name": "手工皂",  "qty": 1, "unit_price": 100.00, "tax": 0,   "tax_rate": 0 }
  ],
  "payment_method": "cash",
  "carrier_type": "3J0002",
  "carrier_id": "/ABC1234",
  "buyer_tax_id": "",
  "buyer_name": ""
}
```

**Mixed tax rates (G9):** Each `order_item` carries its own `tax_rate` snapshot. The payload groups items by tax rate. For zero-rated items (`tax_rate = 0`), `tax` field is 0. Confirm with 文中 that their API accepts multi-rate line items before implementation — if not, require all items in one order to share the same rate.

### Edge Function: `void-invoice`

- Same day → 作廢 (void)
- After midnight → 折讓 (credit note)
- Updates `pos_invoices.status`

### Edge Function: `process-return`

- Issues 折讓 against original invoice number
- Restores inventory

### Offline failure handling

1. Payment + local writes complete → receipt prints with `pending_sync` placeholder
2. `pos_invoices.status = 'pending_sync'`
3. Service Worker queues 文中 POST with exponential backoff (1s → 2s → 4s → 30s → 5min)
4. On reconnect: flush queue, patch `pos_invoices` with real invoice number
5. sme-ops 發票查詢: "待同步" badge on affected rows

### Environment variables (Supabase Edge Function secrets)

```
WENZHONG_API_URL
WENZHONG_API_KEY
WENZHONG_SELLER_TAX_ID
WENZHONG_INVOICE_SERIES
```

---

## Phase 9 — Sunmi D2 Printing

| Ticket | Trigger | Content |
|--------|---------|---------|
| 廚房單 | 送廚房 | Table + order#, food items, notes, time |
| 取消單 | Item cancelled after 送廚 | "取消" + item name + qty — kitchen discards |
| 商品提取單 | Physical product added | Table + order#, product name + qty |
| QR廚房單 | Guest submit + staff confirm | Same as 廚房單, labelled "客人點餐" |
| 收據 | Payment + invoice complete | Full itemized bill + invoice barcode + QR codes |
| 退貨單 | Return processed | Return items + refund + 折讓 invoice number |

Kitchen printer: optional per store. If off → all tickets print on Sunmi built-in.

### Sunmi JS bridge

```js
window.SUNMI?.innerPrinter.printText(text)
window.SUNMI?.innerPrinter.printQRCode(content, moduleSize, errorLevel)
window.SUNMI?.innerPrinter.printBarCode(content, symbology, height, width, textPos)
window.SUNMI?.innerPrinter.cutPaper()
window.SUNMI?.innerPrinter.openCashBox()
```

Fallback: POST ESC/POS to `http://127.0.0.1:8080` (Sunmi local print service).

### Kitchen printer HTTPS/LAN conflict (G10)

Browser blocks HTTP LAN requests from an HTTPS page. Solutions in priority order:

1. **Sunmi Launcher WebView (preferred):** If the app runs in Sunmi's own WebView, use `window.SUNMI?.innerPrinter` — bypasses HTTPS entirely. Confirm with IT which mode the D2 is set to.
2. **Local print proxy:** A tiny Node.js HTTP server on `localhost:9100` accepts requests from the app (same-origin, no CORS issue) and relays ESC/POS to the kitchen printer over TCP. Run as an Android service on the Sunmi.
3. **Supabase Edge Function relay:** App calls Edge Function (HTTPS) → Edge fn opens TCP socket to kitchen printer IP. Adds latency but needs no local proxy.

Recommended path: confirm Sunmi mode first (Blocker B6); use Option 1 if WebView, Option 2 otherwise.

### Receipt format

```
        [店名]
  ================================
  日期: 2026/06/24  時間: 19:30
  訂單: #042   桌號: A3   人數: 3
  --------------------------------
  牛肉麵 x1              $180
  排骨飯 x1              $150
  招牌醬料 x1            $250
  --------------------------------
  小計                   $580
  稅額 (含稅 5%)          $28
  合計                   $580
  現金                   $600
  找零                    $20
  ================================
  電子發票  AA-12345678
  隨機碼: 1234
  ================================
  [BARCODE]
  [QR LEFT]        [QR RIGHT]
  ================================
       感謝您的光臨！
```

---

## Phase 10 — sme-ops Panel Integration

### POS module views

**今日總覽**
- Revenue by hour (bar chart, food vs product breakdown)
- Top 10 items by revenue
- Payment method breakdown
- Active tables + pending QR orders
- Low stock alert: products where `skus.stock_qty < threshold` (configurable per store)

**訂單記錄**
- Searchable: date, table, order#, status, method, source
- Expand: itemized items (🍜/🛒/自訂 badges), payment detail, invoice number
- Actions: Reprint receipt, Initiate return (→ Phase 7 return flow)
- Available in both sme-ops and floor panel

**發票查詢**
- List with status badges (issued / voided / credit_note / pending_sync)
- Filter: date, status, buyer tax ID
- Actions: Void, 折讓 (→ `void-invoice` edge fn), CSV export

**庫存消耗**
- Tab in existing WMS Reports
- POS ingredient usage (recipe deductions) + product sales
- Source: `inventory_transactions WHERE reference LIKE 'POS-%' OR reference LIKE 'RETURN-%'`

**員工業績**
- Per-employee: orders taken, revenue generated, items sold, average order value
- Filtered by date range and store
- Source: `orders.created_by` + `payments.paid_by`

**Z報表 (Shift Close)**
- Opening float
- Cash / card / LINE Pay / other totals
- Expected cash in drawer
- Actual cash counted (input field)
- Variance (flag if > $100)
- PDF export + Sunmi print

### Reservation → order auto-link

On `checkInReservation()`:
1. Create `orders` row with `reservation_id`, assign `order_number`
2. If QR enabled: create `qr_order_sessions` token + print QR
3. Navigate to `/order/:tableId`

---

## Feature Ownership Summary

### sme-ops (desktop — management)

| Feature |
|---------|
| 菜單類別 + 品項管理 (CRUD, ingredient editor, image upload) |
| 零售商品管理 (pos_products: SKU link, retail price, QR flag) |
| QR點餐設定 (enable/disable, approval mode, session duration) |
| 今日總覽 / 訂單記錄 / 發票查詢 / 庫存消耗 / 員工業績 / Z報表 |
| Invoice void / 折讓 / return actions |

### Floor panel (Sunmi D2 — in-restaurant)

| Feature |
|---------|
| 點餐頁: food tab + product tab (barcode scan + browse) |
| Custom item entry (unknown barcode escape hatch) |
| Walk-in order + walk-in manual QR generation |
| Table merge |
| QR guest item approval (🔔 confirm/reject) |
| Payment modal (cash/card/QR + 載具 scanner + split bill) |
| Cash drawer trigger |
| Receipt + kitchen ticket + 取消單 + 商品提取單 printing |
| Return initiation (floor panel 訂單記錄) |
| Reprint (any order, any time) |

### Guest-facing (customer's phone browser)

| Feature |
|---------|
| QR menu: food + retail products (show_in_qr_menu) |
| Cart + note + submit (token-authenticated) |

### Supabase Edge Functions

| Function | Caller |
|----------|--------|
| `complete-order` | Floor panel after payment |
| `void-invoice` | Floor panel or sme-ops |
| `submit-guest-order` | Guest QR page (validates token, writes order_items) |
| `process-return` | Floor panel return flow |

---

## Suggestions

These are not in scope now but worth tracking for after launch:

| # | Suggestion | Value |
|---|-----------|-------|
| S1 | **Member lookup at checkout** — scan member QR or enter phone to earn/redeem points via member-app | High: drives repeat visits |
| S2 | **LINE Pay API dynamic QR** — replace static QR with per-transaction payment request; auto-confirms when guest pays (no manual confirm tap) | Medium: removes friction |
| S3 | **Happy hour pricing** — time-range price overrides per item (e.g. beverages 50% off 15:00–17:00) | Medium: common in F&B |
| S4 | **Set meal / combo** — fixed-price bundle where guest chooses one item from each sub-group | Medium: reduces order time |
| S5 | **Low stock alert push** — notify manager (LINE / email) when any POS product or key ingredient drops below threshold during service | Medium: prevents stockouts |
| S6 | **Seat-level ordering** — assign items to seat numbers; enables exact "pay by seat" split without manual item selection | Low: adds complexity |
| S7 | **Customer-facing display** — second screen on Sunmi showing order being built in real-time; builds trust | Low: hardware cost |
| S8 | **Daily EOD snapshot** — at shift close, compare `inventory_transactions` POS deductions vs `skus.stock_qty` to surface shrinkage | Low: ops discipline |
| S9 | **Table-side QR for product info** — static QR per product links to a product info page (ingredients, origin); no ordering, just info | Low: enhances retail |

---

## Gap Checklist

### All gaps resolved

- [x] G1 Physical product returns — Phase 7: `pos_returns` table, `process-return` edge fn, inventory re-credit, 折讓 invoice
- [x] G2 Member/loyalty — S1: tracked as post-launch suggestion
- [x] G3 Split bill — Phase 6: `split_index`/`split_total` on payments, split modal, per-split invoice
- [x] G4 Table merge — Phase 4: [🔁 合併桌] button, moves order_items, voids source order
- [x] G5/G12 Reprint receipt — Phase 4: [🖨 重印] on order page; Phase 10: reprint in sme-ops 訂單記錄
- [x] G6 Seat-level ordering — S6: post-launch suggestion
- [x] G7 Walk-in QR generation — Phase 4: [生成QR] button on order page for walk-in orders
- [x] G8 Unknown barcode — Phase 3: [自訂品項] escape hatch; `item_type = 'custom'` in schema
- [x] G9 Mixed tax rates — Phase 8: per-item `tax_rate` in payload; confirm multi-rate support with 文中
- [x] G10 Kitchen printer HTTPS/LAN — Phase 9: three-option resolution; confirm Sunmi mode first
- [x] G11 Inventory double-write — Blocker B4: confirm 文中 does not deduct stock
- [x] G12 Reprint from floor panel — resolved under G5

---

## Outstanding Blockers

| # | Item | Blocked on |
|---|------|-----------|
| B1 | 文中 CERP API URL, credentials, sandbox | 文中 account manager |
| B2 | 文中 request / response schema | 文中 API docs |
| B3 | 字軌 allocation per device | 文中 / MoF |
| B4 | Does 文中 deduct inventory? | 文中 (prevent double-write) |
| B5 | e首發票 via 文中 or separate account? | 文中 account manager |
| B6 | Sunmi D2: Launcher WebView or Chrome? | IT / device setup → determines kitchen printer approach |
| B7 | Network kitchen printer model | Hardware procurement |

---

## Implementation Order

Steps 1–14 can start **now** without 文中 credentials.

| # | What | Where | Est. |
|---|------|--------|------|
| 1 | DB schema: all tables with org_id + store_id | Supabase SQL | 2h |
| 2 | Menu management: categories + items + ingredients | sme-ops | 5h |
| 3 | Physical product catalog (pos_products CRUD, SKU link) | sme-ops | 3h |
| 4 | Auto-suspend on low stock (DB trigger) | Supabase | 1h |
| 5 | QR settings per store + 員工業績 page stub | sme-ops | 2h |
| 6 | Walk-in order entry + `/order/:tableId` food tab | floor panel | 6h |
| 7 | Product tab: browse + barcode scan + custom item fallback | floor panel | 4h |
| 8 | Table merge + reprint button | floor panel | 2h |
| 9 | Item cancel / order void + 取消單 print | floor panel | 2h |
| 10 | QR guest menu page `/menu/:storeId/:tableId` | booking subdomain | 5h |
| 11 | QR: Realtime push to floor panel + staff confirm | floor panel | 3h |
| 12 | QR session generate (check-in auto + walk-in manual) | floor panel | 1h |
| 13 | Payment modal: single + split bill + 載具 + scanner | floor panel | 5h |
| 14 | Sunmi print: receipt + kitchen + 取消 + pull + return tickets | floor panel | 4h |
| 15 | Cash drawer trigger | floor panel | 0.5h |
| 16 | Edge fn: `submit-guest-order` (token + realtime) | Supabase | 2h |
| 17 | Edge fn: `complete-order` (all writes + 文中 POST) | Supabase | 5h |
| 18 | Edge fn: `void-invoice` | Supabase | 2h |
| 19 | Edge fn: `process-return` (inventory restore + 折讓) | Supabase | 3h |
| 20 | Inventory deduction (recipe + product + custom skip) | Edge fn | 1h |
| 21 | Table auto-reset + reservation complete + QR invalidate on payment | floor panel | 1h |
| 22 | Offline queue (SW) + retry for 文中 | floor panel | 3h |
| 23 | Reservation → order auto-link on check-in | floor panel | 1h |
| 24 | sme-ops: 今日總覽 + 訂單記錄 + 發票查詢 | sme-ops | 4h |
| 25 | sme-ops: 員工業績 + Z報表 | sme-ops | 3h |
| 26 | sme-ops: 庫存消耗 tab in WMS Reports | sme-ops | 1h |

**Total estimate: ~71h**
