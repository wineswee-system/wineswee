# B2C CRM & Membership System Plan
**Date:** 2026-06-21 (revised — pivoted from B2B to B2C)
**Scope:** Consumer-facing CRM + Membership platform, delivered as two surfaces:
- **System** — internal ops/admin web app (sme-ops, React 19 + Supabase)
- **App** — consumer-facing Flutter app (iOS + Android), **separate project/repo**, same Supabase backend

---

## 0. Strategic Pivot: B2B → B2C

The previous plan focused on B2B pipeline features (opportunities, territories, sales quotas). This is **replaced** by a consumer retention platform centered on:

```
Acquisition → First Purchase → Engagement → Loyalty → Advocacy
```

B2B CRM features (pipeline, quotations, territory routing, eSign, VoIP) are **deprioritized** in favor of:
- Consumer profiles with full purchase history
- Configurable membership levels with real benefits
- A rich coupon engine
- A consumer-facing Flutter mobile app (iOS + Android, separate build)
- Behavior-driven marketing automation targeting consumers, not business contacts

---

## 1. What We Already Have

| Area | Status | Notes |
|---|---|---|
| Member list & CRUD | ✅ Done | `members` table + Members page |
| Point earn / redeem / reverse | ✅ Done | atomic RPC, event-driven |
| Membership tiers (Bronze/Silver/Gold) | ⚠️ Partial | Hard-coded, not configurable |
| Customer profiles & contacts | ✅ Done | `customers` table |
| Customer segmentation | ✅ Done | `crm_segments` |
| Drip campaigns (email) | ✅ Done | DripCampaigns.jsx |
| Service tickets & SLA | ✅ Done | `service_tickets` |
| Referral table | ⚠️ Partial | Table exists, no UI/flow |
| LINE integration (LIFF env var) | ✅ Ready | VITE_LIFF_ID configured |
| Marketing campaigns | ✅ Done | `marketing_campaigns` |
| Form builder → lead capture | ✅ Done | FormBuilder.jsx |
| POS transaction → point earn | ✅ Done | event handler wired |

---

## 2. Dual Surface Design

### 2A. System (Internal — sme-ops admin app)

Staff and managers use the existing sme-ops web app. New/enhanced pages:

| Page | Purpose |
|---|---|
| `Members` (enhanced) | Consumer profiles with level, lifetime spend, purchase history |
| `Coupons` (new) | Create, assign, track coupon campaigns |
| `Levels` (new) | Configure tier rules, benefits, thresholds |
| `Purchase Records` (new) | Browse all recorded member purchases, filter by store/date/product |
| `Segments` (enhanced) | RFM segmentation — auto-score Recency, Frequency, Monetary |
| `Marketing` (enhanced) | Campaign targeting consumer segments via LINE / email |
| `Analytics` (enhanced) | Retention, LTV, churn, level distribution, coupon redemption rates |
| `Member 360` | Single member view: level, points, coupons, purchase history, tickets |

### 2B. App (Consumer-facing — Flutter, Separate Build)

**Platform:** Flutter (Dart) — compiles to native iOS + Android. Separate project repo (`member-app/`), not part of sme-ops. Connects to the same Supabase backend via `supabase_flutter`.

**Auth:** Supabase Auth with LINE OAuth provider (consumer logs in with LINE account). Falls back to phone OTP for non-LINE users. LINE is used for **push notifications** (Messaging API) regardless of auth method.

**Builds:** submitted to App Store + Google Play by the merchant under their own developer account.

| Screen | Content |
|---|---|
| **Home** | Hi [Name] · Level badge · Points balance · Active coupon count · Quick actions |
| **Member Card** | QR code for in-store scan · Member number · Level color/icon |
| **Points** | Current balance · Transaction history (earn/redeem/expire) · Expiry warnings |
| **Level** | Current level · Progress bar to next level · All tier benefits comparison |
| **Coupons** | Wallet of available coupons · Each with barcode + expiry + terms · Filter by type |
| **Purchases** | Purchase history list → tap for line items · Total spend counter |
| **Referral** | My referral code + shareable link · Referred friends list · Earned rewards |
| **Challenges** | Active challenges + progress · Completed badges |
| **Profile** | Name, phone, birthday, opt-in preferences |

### 2C. Customer Data & Purchase History Scope

**Yes — both are in scope.** Here is exactly what is included and where it lives:

#### Customer (Member) Data
| Data | Source table | In App? | In System? |
|---|---|---|---|
| Name, phone, email, birthday | `members` | ✅ Profile screen | ✅ Member list + 360 |
| Member type | `members.type` | ✅ Profile screen (read-only) | ✅ Member list filter + 360 |
| Member number, QR token | `members` | ✅ Member card screen | ✅ Member list |
| Level, points balance | `members` | ✅ Home + Level screens | ✅ Member 360 |
| Lifetime spend, visit count | `members` (cached) | ✅ Level + Purchases screen | ✅ Member 360 |
| Referral code | `members` | ✅ Referral screen | ✅ Member 360 |
| Explicit preferences | `member_explicit_prefs` | ✅ Preferences screen | ✅ Member 360 |
| Inferred preferences | `members.inferred_prefs_json` | ✅ "For You" home section | ✅ Member 360 |
| Linked company | `members.company_id` | — (not shown to consumer) | ✅ Member 360 |
| CRM notes / tags / source | `customers` table | ❌ Internal-only | ✅ System only |

> **Note:** The CRM `customers` table (contact roles, account manager, sales notes, tags) is **internal staff data only** and is **not exposed** in the consumer App. The App surfaces the membership profile (`members`), not the CRM profile (`customers`). A staff member can link a `members` record to a `customers` record in Member 360, but the consumer never sees CRM fields.

#### Purchase History
| Data | Source table | In App? | In System? |
|---|---|---|---|
| Purchase list (date, store, total, points, payment method) | `member_purchases` | ✅ Purchase history screen | ✅ Member 360 + Global browser |
| Purchase ID (receipt number) | `member_purchases.id` | ✅ Shown on receipt | ✅ All views |
| Payment method | `member_purchases.payment_method` | ✅ Shown on receipt | ✅ Filter + analytics |
| Line items (product, category, type, qty, price) | `member_purchase_lines` | ✅ Receipt detail view | ✅ Receipt drill-down |
| Product category + type | `member_purchase_lines.product_category`, `.product_type` | ✅ Grouped on receipt | ✅ Purchase analytics |
| Coupon applied on purchase | `member_purchases.coupon_id` | ✅ Shown on receipt | ✅ Shown on receipt |
| Survey triggered for visit | `member_purchases.survey_id` | ❌ | ✅ System — links purchase to survey |
| Survey score for visit | `member_purchases.survey_score` | ❌ (staff metric) | ✅ System analytics |
| Historical purchases (pre-loyalty) | Not captured | ❌ | ❌ unless backfilled via import |

> **Coverage start date:** Purchase history records begin from the date POS integration is wired to the `member_purchase` event handler. Historical transactions before go-live are not automatically imported — a CSV backfill migration can be run optionally to seed initial history.

---

## 3. User Levels (Configurable)

Replace hard-coded tier enum with a fully configurable `member_levels` table.

### 3.1 Level Configuration (System)
- Name, display color, icon (emoji or upload)
- Rank (1 = lowest, N = highest)
- **Upgrade criterion** (choose one per level):
  - Cumulative lifetime spend ≥ threshold (e.g. NT$10,000)
  - Total points earned (lifetime) ≥ threshold
  - Visit count ≥ threshold
- **Benefits per level:**
  - Point earn multiplier (e.g. 1.0× / 1.5× / 2.0×)
  - Birthday bonus multiplier
  - Exclusive coupon category access (e.g. Gold members only)
  - Free upgrade coupon on level-up (configurable)
  - Welcome benefit (points or coupon on first reaching level)
- **Downgrade rules** (optional):
  - Inactivity (no purchase in N months) → drop one level
  - Annual re-qualification threshold

### 3.2 Default Tier Suggestion
| Level | Threshold | Multiplier | Color |
|---|---|---|---|
| 一般會員 (Member) | 0 | 1.0× | Gray |
| 銀級 (Silver) | NT$3,000 spend | 1.2× | Silver |
| 金級 (Gold) | NT$10,000 spend | 1.5× | Gold |
| 鑽石 (Diamond) | NT$30,000 spend | 2.0× | Cyan |

### 3.3 Level Automation
- Nightly job: recalculate each member's qualifying metric → upgrade/downgrade
- On upgrade: fire `crm.member.tier_upgraded` event → send LINE push + issue welcome benefit
- Level history log: every change recorded with reason

### 3.4 New Tables
```sql
member_levels (
  id, name, rank, color, icon,
  criteria_type,      -- 'cumulative_spend' | 'total_points' | 'visit_count'
  criteria_value,     -- numeric threshold
  point_multiplier,   -- decimal, default 1.0
  birthday_multiplier,
  welcome_points,     -- bonus on first reaching level
  welcome_coupon_id,  -- optional coupon template to issue
  downgrade_inactive_months  -- null = never downgrade
)

member_level_history (
  id, member_id, old_level_id, new_level_id, changed_at, reason
)

-- members table: replace hard-coded level with FK
members.level_id → member_levels.id
members.lifetime_spend  -- running total, updated on each purchase
members.lifetime_points -- running total points earned (not balance)
members.visit_count     -- incremented on each qualifying purchase
```

---

## 4. Purchase Recording

Every member purchase is recorded at line-item level. This is the **core data** for loyalty, levels, personalization, and analytics.

### 4.1 What Gets Recorded
- Triggered by POS transaction or online order (event-driven via existing EventBus)
- Header: member, store, timestamp, total, points earned, coupon used
- Lines: product name, category, qty, unit price, line subtotal

### 4.2 System View
- Browse all purchase records with filter: member / store / date range / product / category
- Drill into a purchase: show line items + points earned + coupon applied
- Export to CSV

### 4.3 App View
- Consumer sees their own purchase history (newest first)
- Tap a purchase → see line items
- Total lifetime spend shown on Level screen

### 4.4 New Tables
```sql
member_purchases (
  id,                   -- purchase record ID, shown on App receipt as "#XXXXX"
  member_id,
  organization_id,
  store_id,
  transaction_id,       -- FK to POS transaction (source of truth)
  purchased_at,
  total_amount,
  payment_method,       -- cash | card | line_pay | apple_pay | transfer | voucher | mixed
  points_earned,
  coupon_id,            -- nullable FK to coupon_assignments (coupon applied on this visit)
  survey_id,            -- nullable FK to surveys (which survey template was triggered)
  created_at
)

member_purchase_lines (
  id,
  purchase_id,          -- FK to member_purchases
  product_id,           -- nullable FK to products master (some POS items lack a master record)
  product_name,         -- denormalized — survives product rename / delete
  product_category,     -- top-level: wine | beer | spirits | non_alcoholic | food | accessory
  product_type,         -- sub-type: red_wine | white_wine | sparkling | rose | ipa | lager |
                        --           single_malt | bourbon | gin | vodka | rum | etc.
  qty,
  unit_price,
  subtotal
)
```

### 4.5 Product Master — skus Mapping

`member_purchase_lines.product_id` is a nullable FK to the existing **`skus`** table (org-scoped, created in `20260425220000_audit_phase_b_atomic_ops_and_missing_tables.sql`). `skus` is the single product master shared by WMS, POS, and CRM. Sprint 0 adds the columns needed for membership/preference mapping:

```sql
ALTER TABLE public.skus
  -- Typed categorization — must align with member_purchase_lines enums
  ADD COLUMN IF NOT EXISTS product_category  TEXT
    CHECK (product_category IN ('wine','beer','spirits','non_alcoholic','food','accessory')),
  ADD COLUMN IF NOT EXISTS product_type      TEXT,
    -- wine:    red_wine | white_wine | sparkling | rose | orange_wine
    -- beer:    ipa | lager | stout | craft_ale | wheat_beer | sour
    -- spirits: single_malt | blended_whisky | bourbon | gin | vodka | rum | tequila | brandy | baijiu
    -- other:   sake | soju | craft_cider | juice | water | soft_drink | tea | food | gift_set | accessory

  -- Display / App
  ADD COLUMN IF NOT EXISTS selling_price     NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS image_url         TEXT,
  ADD COLUMN IF NOT EXISTS description       TEXT,
  ADD COLUMN IF NOT EXISTS short_name        TEXT,       -- compact label for receipt + push notification

  -- Wine & beverage domain attributes
  ADD COLUMN IF NOT EXISTS wine_vintage      SMALLINT,   -- e.g. 2019
  ADD COLUMN IF NOT EXISTS wine_region       TEXT,       -- e.g. 'Bordeaux' — aligned with drink_preference_options
  ADD COLUMN IF NOT EXISTS wine_variety      TEXT,       -- e.g. 'Cabernet Sauvignon'
  ADD COLUMN IF NOT EXISTS alcohol_pct       NUMERIC(4,1),  -- 14.5 → 14.5%
  ADD COLUMN IF NOT EXISTS producer          TEXT,       -- winery / brewery / distillery name
  ADD COLUMN IF NOT EXISTS country_of_origin TEXT;
```

**Why keep `product_name` on the line item?**
`member_purchase_lines.product_name` is always denormalized — it captures the name *at time of sale* and survives SKU renames, merges, or deletes. The `product_id → skus` join enriches views with current image / wine attributes but is never the source of truth for what was sold.

**POS event handler responsibility:**
When the POS fires `crm.pos.transaction_completed`, the purchase-recording event handler must copy `skus.product_category` and `skus.product_type` onto each `member_purchase_lines` row — so inferred preference aggregation stays consistent even if a SKU is later recategorised in the master.

**App enrichment flow:**
Receipt line item tap → join `product_id → skus` → show `image_url`, `wine_vintage`, `wine_region`, `wine_variety`, `alcohol_pct`, `short description`. Enables a product-discovery moment inside the consumer's purchase history screen.

**System backfill task (Sprint 1):**
After migration, run a one-time update to populate `product_category` and `product_type` on all existing `skus` rows. A bulk-edit UI in the System Products page (or a CSV import) is the recommended approach.

### 4.6 Derived Metrics (no extra storage)
- Lifetime spend → `SUM(total_amount)` per member (cached in `members.lifetime_spend`)
- Visit count → `COUNT(*)` per member (cached in `members.visit_count`)
- Avg basket size, favorite category → computed on demand for analytics

---

## 5. Coupon Engine

Full coupon lifecycle: create → distribute → redeem → track.

### 5.1 Coupon Types
| Type | Description |
|---|---|
| `pct_off` | % discount on order total (e.g. 20% off) |
| `fixed_off` | Fixed amount off (e.g. NT$100 off) |
| `free_item` | Specific product free (product_id required) |
| `bogo` | Buy X get Y at discount |
| `points_2x` | Double (or Nx) points on this transaction |

### 5.2 Coupon Constraints
- Minimum purchase amount (`min_purchase`)
- Product/category whitelist (`product_filter_json`)
- Level access gate (`min_level_rank` — e.g. Gold+ only)
- Valid date range (`valid_from`, `valid_until`)
- Total usage limit per coupon (`usage_limit_total`)
- Per-member usage limit (`usage_limit_per_member`: 1 = once, null = unlimited)
- Combinable flag (can stack with other coupons or exclusive)

### 5.3 Distribution Methods
| Method | How |
|---|---|
| **Broadcast** | Issue to all members (or a saved segment) in bulk |
| **Segment-targeted** | Assign to RFM segment (e.g. "Lapsed 90+ days") |
| **Individual** | Staff manually issues to a specific member |
| **Milestone auto** | Auto-issued on level upgrade, birthday, referral success, challenge completion |
| **Event-triggered** | Issued by workflow rule (e.g. no purchase in 60 days → issue win-back coupon) |

### 5.4 Redemption Flows
1. **At POS (system):** Staff scans member QR → see available coupons → select to apply → saved on purchase record
2. **App self-show:** Member opens coupon in app → barcode/QR displayed → staff scans or types code
3. **Online checkout:** Member selects coupon from dropdown wallet (future)

### 5.5 System Management (admin)
- Coupon list with status (draft / active / paused / expired)
- Create/edit coupon templates
- Bulk distribution to segment
- Redemption report: redemption rate, by coupon, by store, by level

### 5.6 App View (consumer)
- Coupon wallet: available / used / expired tabs
- Each coupon card: type badge, discount amount, expiry countdown, terms summary
- Tap → full-screen coupon with scannable barcode + "Copy Code" button

### 5.7 New Tables
```sql
coupons (
  id, code (unique), name, description,
  type,               -- pct_off | fixed_off | free_item | bogo | points_2x
  value,              -- % or fixed amount
  free_item_product_id,
  min_purchase,
  product_filter_json,
  min_level_rank,
  valid_from, valid_until,
  usage_limit_total,
  usage_limit_per_member,
  combinable,         -- bool
  status,             -- draft | active | paused | expired
  created_by, created_at
)

coupon_assignments (
  id, coupon_id, member_id,
  assigned_at, assigned_by,
  assignment_reason,  -- 'broadcast' | 'segment' | 'individual' | 'level_up' | 'birthday' | 'referral' | 'challenge'
  used_at,            -- null = not yet used
  used_at_purchase_id -- FK to member_purchases
)
```

---

## 6. B2C CRM Features (Keep & Extend)

These replace the B2B pipeline concepts. B2C CRM is about consumer lifecycle management.

### 6.1 Consumer Profile (enhanced Customer 360)
- Unified view: level badge, points, lifetime spend, visit count, last visit
- Purchase history timeline
- Active/used/expired coupons
- Tickets & service history
- Marketing opt-in status per channel (LINE, email, SMS)
- Notes from staff

### 6.2 RFM Segmentation (replace manual segments)
Auto-score all members nightly:
- **R** — Recency: days since last purchase (lower = better)
- **F** — Frequency: purchase count in last 12 months
- **M** — Monetary: total spend in last 12 months
- Score each 1–5, assign RFM cell label: Champions / Loyal / At Risk / Lapsed / New
- System: segment browser with count per cell, drill to member list
- Use segments as coupon / campaign targets

### 6.3 Marketing Campaigns (B2C focused)
- Target by: RFM segment, level, birthday month, inactive duration, product category bought
- Channels: LINE push message, email drip, SMS (future)
- Goal tracking: redemption rate, purchase conversion within 7 days of send

### 6.4 Win-Back Automation
- If member has no purchase in N days → auto-trigger configurable win-back flow:
  - Day 30: LINE reminder message
  - Day 60: issue win-back coupon
  - Day 90: escalate to segment for manual outreach

### 6.5 Self-Service Member Portal (App)
Covered in section 2B above. Accessible via:
- LINE LIFF (primary — no install required)
- Direct URL + magic token (fallback for non-LINE users)

### 6.6 Push Notifications (LINE)
Events that trigger LINE push:
- Points earned (with new balance)
- Level upgrade (congrats + new benefits)
- Coupon issued (new coupon in wallet)
- Points expiry warning (30 days / 7 days)
- Birthday greeting + reward
- Challenge completion
- Win-back (inactive reminder)

### 6.7 Consumer Support Tickets (enhanced)
- Member can open ticket from App (LINE message or form)
- Ticket auto-links to member record
- Staff sees member profile (level, purchase history) alongside ticket
- CSAT survey after closure, tied to member

### 6.8 Birthday Rewards Automation
- Nightly cron on member birthday: issue points bonus + optional coupon
- Configurable per store: bonus amount, coupon template, valid window
- App shows birthday reward in coupon wallet

### 6.9 Digital Membership Card
- QR code displayed on App home / member card screen
- Contains: member_id encoded + checksum
- POS scanner: scan → look up member → show name + level + points
- Staff no longer needs to type phone number

### 6.10 Points Expiry Rules
- Points expire after N months (configurable)
- `point_transactions.expires_at` column
- Nightly job: expire due points, adjust balance, create reversal transaction
- App shows "Expiring soon" warning on Points screen

### 6.11 Referral Program (complete UI)
- Member gets unique referral code in App
- Share link opens member registration with code pre-filled
- On new member's first purchase → both referee and referrer earn bonus points
- App: referral count, pending/credited status, earned bonus running total

### 6.12 Stamp / Punch Card
- Simpler earn mechanic alongside points
- Configurable card: N stamps (qualifying purchase or product) → earn reward
- Multiple card types can run concurrently
- App: stamp card progress visual (filled stamps)

### 6.13 Gamification (Badges & Challenges)
- **Badges:** Permanent — First Purchase, 5-Visit Club, Birthday Shopper, Big Spender, Referral Star
- **Challenges:** Time-limited — "Buy 3 times in July → 500 bonus points"
- App: challenge list with progress bars; badge collection display

---

## 7. Purchase History

Full purchase history is the backbone of the B2C platform — it drives loyalty calculations, preferences, personalization, and member insights. This section specifies the rich history experience beyond the basic record-keeping in Section 4.

### 7.1 System View — Global Purchase Browser
- Full-table view of all purchase records across all members and stores
- **Filters:** member name/phone, store, date range, product name, category, amount range
- **Columns:** member name + level badge, store, date/time, item count, total amount, points earned, coupon used, survey score
- Sort by any column
- Drill into a purchase → receipt detail: line items, unit prices, subtotals, coupon applied, points earned, survey score link

### 7.2 System View — Member 360 Purchase Tab
- Chronological list for a single member (newest first, infinite scroll)
- **Summary cards at top:** Total lifetime spend · Visits this year · Avg basket size · Last visit date
- **Charts:**
  - Monthly spend bar chart (last 12 months)
  - Category breakdown pie chart (last 6 months)
  - Visit frequency heatmap (day of week × time of day)
- Export single-member history as CSV or PDF receipt

### 7.3 App View — Purchase History Screen
- Chronological list (newest first)
- Each row: store name · date · total amount · points earned badge
- **Header summary:** "Total spent this year: NT$X" · "Visits this month: N"
- Filter controls: by store (dropdown) · by month (picker)
- Tap a row → **Receipt detail view:**
  - Line items with qty × unit price
  - Coupon applied (if any) with discount shown
  - Points earned
  - "Rate this visit" button (if post-visit survey not yet completed)
- Share receipt as image (for warranty or expense records)

### 7.4 App View — Spending Insights (Home card)
- "This month: NT$X across N visits" summary card on App home
- "vs last month: +12%" comparison indicator
- Top category this month with icon

### 7.5 Analytics Derived from Purchase History
All computed nightly, no extra storage beyond cached fields on `members`:

| Metric | Used for |
|---|---|
| Avg basket size (last 90 days) | Level display, analytics |
| Top 3 categories (last 6 months) | Inferred preferences, personalization |
| Favourite products (top 5 by count) | Recommendations |
| Purchase day-of-week distribution | Campaign send-time optimization |
| Month-over-month spend delta | App home card, win-back triggers |

---

## 8. Product Preferences

Member preferences tell us what each consumer cares about — used to personalize coupons, campaigns, recommendations, and survey targeting. Three layers: **inferred** (auto-computed from purchase history), **explicit generic** (consumer-set lifestyle/offer settings), and **explicit domain-specific** (drink type, wine region, variety, taste profile — the core of this business).

### 8.1 Inferred Preferences (Computed Nightly)
Derived automatically from `member_purchase_lines` — no consumer action required.

| Signal | How computed | Stored in `inferred_prefs_json` |
|---|---|---|
| Top drink categories | Frequency × recency weight on `product_category` last 6 months | `.top_categories[]` |
| Top product types | Frequency × recency weight on `product_type` last 6 months | `.top_types[]` |
| Favourite products | Top 5 by purchase count (product_id or product_name) | `.fav_products[]` |
| Price tier | Avg unit price across wine purchases → budget / mid / premium | `.price_tier` |
| Shopping pattern | Most common visit day + hour | `.preferred_day`, `.preferred_hour` |
| Basket behavior | Avg line items per visit | `.basket_type` (solo / regular / large) |
| Inferred wine style | Most purchased wine type (red / white / sparkling / rosé) | `.wine_style` |
| Inferred region affinity | Region appearing most in wine purchase history | `.wine_region` |

- Stored as `members.inferred_prefs_json` (JSONB, refreshed nightly)
- Used in: Group Builder criteria · campaign merge tags · App "For You" section · recommendation engine

### 8.2 Explicit Generic Preferences (Consumer-set in App)

General communication and lifestyle settings — always available regardless of product domain.

- **Offer type:** % discounts · Fixed amount off · Free items · New arrivals · Tasting events · Wine education
- **Notification frequency:** Daily · Weekly · Important only · Never
- **Lifestyle tags** (merchant-configurable): e.g. Collector · Gift buyer · Everyday drinker · Entertaining

### 8.3 Explicit Drink & Wine Preferences (Consumer-set in App — Domain Core)

The primary preference system for this business. Members build their taste profile in the App under "My Taste Profile" (distinct from the generic Preferences screen).

#### Drink Type (multi-select)
`wine` · `beer` · `spirits` · `non_alcoholic` · `sake` · `craft_cider`

#### Wine Preferences (shown when `wine` is selected)

**Color / Style:**
`red` · `white` · `rosé` · `sparkling` · `champagne` · `fortified` · `orange` · `natural`

**Region** (hierarchical, configurable):
- France: Bordeaux · Burgundy · Champagne · Rhône · Loire · Alsace · Provence · Languedoc
- Italy: Tuscany · Piedmont · Veneto · Sicily · Campania
- Spain: Rioja · Ribera del Duero · Priorat · Cava · Sherry
- New World: California · Oregon · Washington · Australia · New Zealand · Chile · Argentina · South Africa
- Germany · Portugal · Austria · Greece · Other

**Grape Variety** (multi-select, configurable):
Reds: Cabernet Sauvignon · Merlot · Pinot Noir · Syrah/Shiraz · Grenache · Tempranillo · Sangiovese · Malbec · Nebbiolo · Zinfandel
Whites: Chardonnay · Sauvignon Blanc · Riesling · Pinot Gris · Viognier · Gewürztraminer · Chenin Blanc · Albariño

**Taste Profile:**
| Dimension | Options |
|---|---|
| Body | Light · Medium · Full · Any |
| Sweetness | Bone dry · Dry · Off-dry · Semi-sweet · Sweet |
| Tannins | Low · Medium · High · Any |
| Acidity | Low · Medium · High · Any |
| Flavor style | Fruity · Earthy · Oaky · Mineral · Floral · Spicy · Herbal · Funky/Natural |
| Oak influence | Unoaked · Light oak · Heavy oak · Any |

**Occasion:**
`everyday` · `special_occasion` · `gifting` · `food_pairing` · `investment` · `discovery`

**Price Range (per bottle):**
`under_500` · `500_1500` · `1500_5000` · `over_5000` · `any`

#### Beer Preferences (shown when `beer` is selected)
**Style:** Lager · Pilsner · Pale Ale · IPA · Double IPA · Stout · Porter · Wheat · Sour/Wild · Belgian · Craft

#### Spirits Preferences (shown when `spirits` is selected)
**Type:** Whisky/Whiskey · Gin · Vodka · Rum · Brandy/Cognac · Tequila/Mezcal · Baijiu · Shochu

### 8.4 System — Where Preferences Appear

| Surface | Usage |
|---|---|
| Member 360 | "Taste Profile" card: inferred wine style, explicit regions, varieties, price tier |
| Group Builder | Filter: "Wine region includes Burgundy" / "Price tier = premium" / "Inferred top type = red_wine" |
| Coupon distribution | Auto-match coupon to member's preferred wine region or variety |
| Campaign merge tags | `{{member_wine_style}}`, `{{member_top_region}}`, `{{member_fav_variety}}` |
| Survey targeting | Send Burgundy-specific survey only to members with Burgundy in top regions |
| Purchase analytics | Cross-reference `product_type` with declared preferences → validation accuracy |

### 8.5 App — "My Taste Profile" Screen
- Drink type selector (icons: wine glass, beer mug, spirits bottle)
- Wine section: color/style chips, region picker (hierarchical), variety multi-select, taste sliders/chips
- Taste profile: body / sweetness / tannin / acidity / flavor style chips (visual, no jargon)
- Occasion multi-select
- Price range picker
- "Based on your purchases, we think you love:" → inferred top 3 categories/types shown above the form
- Save button (updates `member_drink_preferences`)

### 8.6 App — "For You" Home Section
- 2–3 personalized offer/product cards matched to member's taste profile + inferred preferences
- "Recommended because you love [Region] [Variety]" label
- Tap → coupon detail or product page

### 8.7 New Tables
```sql
-- Generic lifestyle/offer preferences (unchanged)
preference_lifestyle_tags (
  id, organization_id, name, display_order, active
)

member_explicit_prefs (
  member_id PRIMARY KEY,
  organization_id,
  lifestyle_tag_ids_json,      -- ['collector', 'gift_buyer', 'everyday_drinker']
  offer_type_prefs_json,       -- ['pct_discount', 'free_item', 'new_arrivals', 'tasting_events']
  notification_frequency,      -- daily | weekly | important_only | never
  updated_at
)

-- Domain-specific drink & wine preferences
member_drink_preferences (
  member_id PRIMARY KEY,
  organization_id,
  -- Drink types
  drink_types_json,            -- ['wine', 'beer', 'spirits']
  -- Wine
  wine_colors_json,            -- ['red', 'white', 'sparkling', 'rose', 'fortified']
  wine_regions_json,           -- ['france_bordeaux', 'france_burgundy', 'italy_tuscany', ...]
  wine_varieties_json,         -- ['cabernet_sauvignon', 'chardonnay', 'pinot_noir', ...]
  -- Taste profile
  body_preference,             -- light | medium | full | any
  sweetness_preference,        -- bone_dry | dry | off_dry | semi_sweet | sweet | any
  tannin_preference,           -- low | medium | high | any
  acidity_preference,          -- low | medium | high | any
  flavor_tags_json,            -- ['fruity', 'earthy', 'oaky', 'mineral', 'floral', 'spicy']
  oak_preference,              -- unoaked | light | heavy | any
  -- Occasion & budget
  occasion_tags_json,          -- ['everyday', 'gifting', 'special_occasion', 'food_pairing']
  price_range_preference,      -- under_500 | 500_1500 | 1500_5000 | over_5000 | any
  -- Beer
  beer_styles_json,            -- ['lager', 'ipa', 'stout', 'wheat', 'sour']
  -- Spirits
  spirits_types_json,          -- ['whisky', 'gin', 'vodka', 'rum', 'brandy', 'tequila']
  updated_at
)

-- Configurable lookup for regions and varieties (merchant can add/edit)
drink_preference_options (
  id, organization_id,
  option_type,                 -- wine_region | wine_variety | beer_style | spirits_type | flavor_tag | occasion
  value,                       -- 'france_bordeaux'
  label,                       -- 'Bordeaux (France)'
  parent_value,                -- 'france' — for hierarchical region display
  display_order, active
)

-- inferred preferences still stored as JSONB on members (no separate table needed)
-- members.inferred_prefs_json refreshed nightly by compute job
```

---

## 9. Post-Visit Surveys

Send automated surveys to members after a store visit or service interaction. Measure experience quality, collect feedback, and close the loop.

### 7.1 Survey Builder (System)
- Create surveys with a drag-and-drop question builder
- **Question types:**
  - Star rating (1–5)
  - NPS (0–10 scale with "How likely are you to recommend us?")
  - Multiple choice (single or multi-select)
  - Short text
  - Yes / No
- Survey metadata: name, internal label, target store(s), active/inactive toggle

### 7.2 Trigger Rules
Each survey has one trigger type:

| Trigger | When it fires |
|---|---|
| `post_purchase` | N hours after a `member_purchase` is recorded |
| `post_ticket_close` | N hours after a service ticket is closed |
| `manual_segment` | Staff fires it manually to a targeted group |
| `scheduled` | Fixed date + time to a saved group |

- Configurable delay (e.g. send 2 hours after purchase, not immediately)
- Cooldown: do not re-send to the same member within N days
- Channel: LINE push (primary), email (secondary)

### 7.3 Survey Delivery (App)
- Member receives LINE message: "How was your visit today? 👇" + link
- Link opens App → Survey screen (inline, no login wall if token in URL)
- Progress indicator (question N of M)
- Submit → thank-you screen + optional bonus points for completing

### 7.4 Survey Results (System)
- Per-survey dashboard: response rate, avg score, NPS distribution
- Filter by store, date range, level, RFM segment
- Question breakdown: answer distribution chart per question
- Free-text responses: full list with member name, date, score
- Export to CSV
- Alert rule: if NPS drops below threshold → notify store manager via LINE

### 7.5 Integration Points
- Completing a survey can trigger: bonus points, issue a coupon (configurable reward)
- Low-score responses (≤2 stars or NPS ≤6) → auto-open service ticket for follow-up
- Survey score stored on `member_purchases` (ties satisfaction to the specific visit)

### 7.6 New Tables
```sql
surveys (
  id, name, description,
  trigger_type,          -- post_purchase | post_ticket_close | manual_segment | scheduled
  trigger_delay_hours,   -- default 2
  cooldown_days,         -- min days between sends per member
  channel,               -- line | email | both
  completion_points,     -- bonus points for completing (0 = none)
  completion_coupon_id,  -- optional coupon to issue on completion
  escalate_below_score,  -- auto-ticket if score <= this (null = off)
  store_ids_json,        -- null = all stores
  status,                -- draft | active | paused
  created_by, created_at
)

survey_questions (
  id, survey_id, position,
  type,                  -- star | nps | choice_single | choice_multi | text | yesno
  label,
  options_json,          -- for choice types
  required
)

survey_invitations (
  id, survey_id, member_id,
  purchase_id,           -- FK to member_purchases (nullable)
  ticket_id,             -- FK to service_tickets (nullable)
  token,                 -- unique URL token
  sent_at, opened_at, completed_at
)

survey_responses (
  id, invitation_id, survey_id, member_id,
  store_id, submitted_at,
  answers_json           -- {question_id: answer_value}
)
```

---

## 10. Targeted Group Builder

Replace the existing static segment list with a powerful, dynamic group builder that drives coupon distribution, campaign sends, survey targeting, and test segments.

### 8.1 Group Types

| Type | Description |
|---|---|
| **Dynamic** | Rule-based — member list recomputed nightly or on-demand |
| **Static** | Manually curated — staff hand-picks members |
| **RFM Auto** | System-generated cells (Champions, Loyal, At Risk, Lapsed, New) |
| **Level Auto** | System-generated per level (Silver members, Gold members, etc.) |

### 8.2 Dynamic Group Criteria (AND / OR Builder)

Criteria categories and operators available:

| Category | Criteria |
|---|---|
| **Level** | Is / Is not [level] |
| **Points** | Balance ≥ / ≤ N |
| **Spend** | Lifetime spend ≥ / ≤ NT$N · Last 30/60/90/180/365 days spend ≥ NT$N |
| **Recency** | Last purchase ≥ / ≤ N days ago · No purchase in last N days |
| **Frequency** | Visit count in last N days ≥ / ≤ N |
| **Product** | Has purchased category [X] · Has purchased product [X] |
| **Coupon** | Has active coupon [type] · Has never redeemed a coupon |
| **Survey** | Gave NPS ≤ 6 in last 90 days · Never completed a survey |
| **Birthday** | Birthday month = [month(s)] · Birthday in next N days |
| **Registration** | Member since ≥ / ≤ date |
| **Store** | Primary store is [store(s)] |
| **Channel** | LINE opt-in = true / false |
| **RFM label** | Is [Champions / Loyal / At Risk / Lapsed / New] |

- Conditions can be combined with AND / OR at group level
- Nested groups: (A AND B) OR (C AND D)

### 8.3 System UI
- Group list: name, type, member count (last computed), last used, created by
- Builder screen: drag-and-drop condition rows, AND/OR toggle between rows
- **Preview panel** (live): shows estimated member count as conditions change, no commit until saved
- Member list drill-down: click group → see full list with level badge, last purchase date
- Actions from group: Send coupon · Launch campaign · Send survey · Export CSV · Create test segment

### 8.4 Group Refresh
- Dynamic groups: recomputed nightly (00:00) + on-demand "Refresh now" button
- Count displayed with "as of [timestamp]" label — no false precision
- System shows delta vs last compute: "+12 new members, -5 removed"

### 8.5 New Tables
```sql
member_groups (
  id, name, description,
  type,                  -- dynamic | static | rfm_auto | level_auto
  criteria_json,         -- AND/OR tree for dynamic groups
  member_count,
  last_computed_at,
  created_by, created_at
)

member_group_members (
  group_id, member_id,
  added_at,
  added_by              -- null for auto-computed entries
)
```

---

## 11. Test Segments & Pilot Execution

Before broadcasting a coupon, campaign, or survey to thousands of members, validate message, incentive, and targeting with a small controlled pilot. Approve, adjust, or abort before full rollout.

### 9.1 Pilot Workflow
```
Select group → Define pilot → Send pilot → Review results → Decision → Full rollout
```

### 9.2 Pilot Configuration
- **Source group:** any saved member group
- **Sample method:**
  - Random N% (e.g. 10% of group)
  - First N members
  - Specific level only (e.g. test on Gold members first)
- **Pilot size cap:** set a hard max (e.g. never more than 200 in pilot)
- Pilot members are locked at send time; full rollout excludes them (no double-send)

### 9.3 What Can Be Piloted

| Action | Pilot support |
|---|---|
| Coupon distribution | ✅ Send coupon to pilot subset of group |
| LINE campaign message | ✅ Send LINE push to pilot subset |
| Survey send | ✅ Send survey to pilot subset |
| Email campaign | ✅ (when email channel added) |

### 9.4 Results Dashboard (after pilot send)
Metrics visible before deciding on full rollout:

| Metric | Coupon | Campaign | Survey |
|---|---|---|---|
| Delivery rate | — | ✅ | ✅ |
| Open / click rate | — | ✅ (LINE) | ✅ |
| Coupon redemption rate | ✅ | — | — |
| Survey completion rate | — | — | ✅ |
| Avg NPS / score | — | — | ✅ |
| Revenue from pilot group (7 days) | ✅ | ✅ | — |
| Unsubscribes / opt-outs | ✅ | ✅ | ✅ |

### 9.5 Decision Actions
After reviewing pilot results:
- **Approve → Full rollout:** send to remaining group members (pilot members excluded)
- **Adjust:** edit message/coupon/survey → run a second pilot
- **Abort:** cancel; no further sends; pilot results archived

### 9.6 System UI
- Pilot runs listed under the parent campaign/coupon/survey with status badge: Draft / Running / Awaiting Decision / Approved / Aborted
- Results card: key metrics side-by-side (pilot vs baseline if available)
- One-click "Roll out to remaining N members" button
- Audit trail: who approved, when

### 9.7 New Tables
```sql
pilot_runs (
  id, name,
  action_type,           -- coupon_distribution | line_campaign | survey | email_campaign
  action_id,             -- FK to coupons / campaigns / surveys
  group_id,              -- source group
  sample_method,         -- random_pct | first_n | level_filter
  sample_value,          -- pct or count or level_id
  pilot_member_ids,      -- jsonb array, locked at send time
  status,                -- draft | running | awaiting_decision | approved | aborted
  sent_at, decided_at, decided_by,
  rollout_sent_at,
  results_snapshot_json  -- cached metrics at decision time
)
```

---

## 12. Delivery Phases

### Phase A — Foundation (≤1 week each)
| # | Feature | Effort |
|---|---|---|
| A1 | `member_levels` table + level configuration UI in System | S |
| A2 | `members.lifetime_spend`, `visit_count`, `inferred_prefs_json` columns + backfill | S |
| A3 | Level auto-upgrade nightly job | S |
| A4 | `member_purchases` + `member_purchase_lines` tables | S |
| A5 | POS → purchase record event handler | S |
| A6 | Purchase history — System global browser (filters, drill to receipt) | M |
| A7 | Purchase history — Member 360 tab (summary cards, monthly spend chart, category pie) | M |
| A8 | Inferred preferences nightly compute job (top categories, fav products, price tier) | S |
| A9 | `point_transactions.expires_at` + points expiry nightly job | S |
| A10 | `members.qr_token` + `members.referral_code` columns | S |
| A11 | `birthday_reward_config` table + nightly birthday job | S |

### Phase B — Coupon Engine + Group Builder (3–4 weeks)
| # | Feature | Effort |
|---|---|---|
| B1 | `coupons` + `coupon_assignments` tables | S |
| B2 | Coupon management UI in System (create, edit, status) | M |
| B3 | Coupon redemption at POS (scan member QR → apply coupon) | M |
| B4 | Coupon redemption report in System | S |
| B5 | Milestone auto-issue (level-up, birthday, referral) | M |
| B6 | `member_groups` + `member_group_members` tables | S |
| B7 | Dynamic group criteria engine (nightly compute) | M |
| B8 | Group builder UI (AND/OR condition rows, live preview count) | M |
| B9 | Static group (manual member pick list) | S |
| B10 | Coupon distribution to group (broadcast, segment, individual) | M |
| B11 | `preference_categories` + `preference_lifestyle_tags` config tables + System UI | S |
| B12 | Group builder criteria: inferred top category + explicit preference filters | S |

### Phase C — Surveys & Test Segments (2–3 weeks)
| # | Feature | Effort |
|---|---|---|
| C1 | Survey tables + survey builder UI (questions, trigger rules) | M |
| C2 | Post-purchase survey send via LINE (configurable delay) | M |
| C3 | Survey results dashboard (response rate, NPS, score breakdown) | M |
| C4 | Low-score auto-ticket escalation | S |
| C5 | `pilot_runs` table + pilot configuration UI | S |
| C6 | Pilot send (coupon / campaign / survey to sampled subset) | M |
| C7 | Pilot results dashboard + approve / abort decision flow | M |
| C8 | Full rollout after pilot approval | S |

### Phase D — Consumer App (3–4 weeks)
| # | Feature | Effort |
|---|---|---|
| D1 | Flutter app shell (Supabase Auth, LINE OAuth, GoRouter, Riverpod, org flavor config) | M |
| D2 | Home screen (balance, level badge, "For You" offers, monthly spend card) | S |
| D3 | Digital membership card (QR display) | S |
| D4 | Points screen (balance + history + expiry warnings) | S |
| D5 | Level screen (current level + progress bar + benefits) | S |
| D6 | Coupon wallet (available / used / expired, barcode display) | M |
| D7 | Purchase history screen (list with filters, receipt detail, share as image) | M |
| D8 | Spending insights: monthly bar chart, top categories, vs last month delta | S |
| D9 | "My Preferences" screen (category toggles, lifestyle tags, offer type, frequency) | S |
| D10 | "For You" home section (2–3 personalized offer cards matched to preferences) | S |
| D11 | Referral screen (code, shareable link, friend list) | S |
| D12 | Profile screen (edit name, birthday, opt-in) | S |
| D13 | Survey screen (answer questions, submit, thank-you + reward) | S |

### Phase E — Engagement (2–3 weeks)
| # | Feature | Effort |
|---|---|---|
| E1 | RFM segmentation nightly scoring + auto-groups | M |
| E2 | LINE push notifications (points, level, coupon, expiry, birthday) | M |
| E3 | Win-back automation flow | M |
| E4 | Stamp / punch card mechanic | S |
| E5 | Gamification: badges + challenges | M |
| E6 | Consumer support ticket from App (LINE message → ticket) | M |

### Phase F — Analytics & Paid Tiers (1–2 months)
| # | Feature | Effort |
|---|---|---|
| F1 | Retention analytics (cohort, churn rate, level distribution) | M |
| F2 | Coupon analytics (issue rate, redemption rate, revenue uplift) | M |
| F3 | Survey analytics (NPS trend, score by store/level) | M |
| F4 | LTV dashboard (avg spend per level, projected annual value) | M |
| F5 | Paid membership subscription tiers (monthly/annual fee) | L |
| F6 | WhatsApp / SMS channel (alongside LINE) | L |
| F7 | Predictive churn scoring (Gemini AI) | L |

---

## 13. Database Schema Summary

### New Tables
| Table | Purpose | Phase |
|---|---|---|
| `member_levels` | Configurable tier definitions | A |
| `member_level_history` | Audit log of level changes | A |
| `member_purchases` | Purchase header per member transaction | A |
| `member_purchase_lines` | Line items per purchase | A |
| `coupons` | Coupon templates | B |
| `coupon_assignments` | Per-member coupon issuance + redemption | B |
| `birthday_reward_config` | Birthday reward settings per store | A |
| `member_groups` | Dynamic + static group definitions | B |
| `member_group_members` | Per-member group membership (static + cached dynamic) | B |
| `surveys` | Survey definitions with trigger rules | C |
| `survey_questions` | Questions per survey | C |
| `survey_invitations` | Per-member send record with token | C |
| `survey_responses` | Submitted answers | C |
| `pilot_runs` | Pilot/test segment execution records | C |
| `stamp_card_types` | Stamp card definitions | E |
| `stamp_cards` | Per-member stamp progress | E |
| `member_sessions` | App token auth | D |
| `badges` | Badge definitions | E |
| `member_badges` | Per-member earned badges | E |
| `challenges` | Time-limited challenge definitions | E |
| `member_challenge_progress` | Per-member challenge tracking | E |
| `membership_plans` | Paid subscription plan definitions | F |
| `member_subscriptions` | Active paid memberships | F |
| `preference_lifestyle_tags` | Lifestyle tags (Collector, Gift buyer, etc.) | B |
| `member_explicit_prefs` | Generic offer/notification preferences per member | D |
| `member_drink_preferences` | Domain-specific drink + wine taste profile per member | D |
| `drink_preference_options` | Configurable lookup: regions, varieties, beer styles, spirits types | B |

### Modified Tables
| Table | Change | Phase |
|---|---|---|
| `members` | Add `organization_id` (NOT NULL FK), `company_id` (nullable FK), `level_id` (FK), `auth_uid` (UUID), `type` (consumer/corporate/vip/staff/trade), `lifetime_spend`, `lifetime_points`, `visit_count`, `qr_token`, `referral_code`, `inferred_prefs_json` | Sprint 0 |
| `point_transactions` | Add `organization_id` (NOT NULL FK), `expires_at` | Sprint 0 |
| `member_purchases` | Add `payment_method`, `survey_id` (nullable FK to surveys) | Sprint 0 |
| `member_purchase_lines` | Add `product_category`, `product_type` (rename `category` → `product_category`) | Sprint 0 |
| `skus` | Add `product_category` (CHECK enum), `product_type`, `selling_price`, `image_url`, `description`, `short_name`, `wine_vintage`, `wine_region`, `wine_variety`, `alcohol_pct`, `producer`, `country_of_origin` | Sprint 0 |
| `promotions` | Add `member_only` (bool), `min_level_rank` | Sprint 2 |
| `member_purchases` | Add `survey_score` (nullable, from post-visit survey response) | Sprint 4 |

### New Tables (Product Lifecycle — §17)
| Table | Purpose | Sprint |
|---|---|---|
| `sku_barcodes` | Multi-barcode per SKU (EAN-13, UPC-A, supplier code, QR) | P0 |
| `rfid_tags` | Per-unit / per-case RFID tag with lifecycle status | P0 |
| `rfid_scans` | RFID reader scan event log | P0 |
| `supplier_quote_requests` | RFQ header sent to multiple suppliers | P0 |
| `supplier_quote_request_lines` | Line items per RFQ | P0 |
| `supplier_quotes` | Supplier response to RFQ (with FX rate) | P0 |
| `supplier_quote_lines` | Priced line items per supplier quote | P0 |
| `purchase_order_lines` | Relational PO lines (replaces JSONB items) | P0 |
| `import_shipments` | Container / vessel tracking with ETD/ETA | P0 |
| `import_shipment_pos` | Junction: one shipment consolidates multiple POs | P0 |
| `customs_declarations` | Customs filing header per shipment | P0 |
| `customs_declaration_lines` | HS code + duty rate per SKU line | P0 |
| `landed_costs` | Total cost components per shipment | P0 |
| `landed_cost_lines` | Allocated cost + new unit cost per SKU | P0 |
| `supplier_payments` | AP payment records with FX, bank ref | P0 |

### Modified Tables (Product Lifecycle — §17)
| Table | Change | Sprint |
|---|---|---|
| `skus` | Add `rfid_enabled`, `hs_code`, `reorder_point`, `reorder_qty`, `primary_supplier_id`, `lead_time_days` | P0 |
| `suppliers` | Add `organization_id` (NOT NULL FK) | P0 |
| `purchase_orders` | Add `supplier_id` (FK to suppliers), `organization_id` | P0 |

### Removed from Plan (B2B concepts)
- `sales_quotas` — B2B only
- `territory_rules` — B2B only
- `opportunity_lines` — B2B only
- `booking_links` / `booking_slots` — B2B sales scheduling
- `subscriptions` (CRM pipeline recurring revenue) — B2B only
- `loss_reasons` — B2B pipeline concept

---

## 14. Architecture Notes

### Event Flow (purchase → everything)
```
POS transaction confirmed
  → crm.pos.transaction_completed (EventBus)
    → earn_member_points_atomic (RPC, existing)
    → insert member_purchases + lines (new)
    → recalculate members.lifetime_spend + visit_count
    → check level upgrade threshold → upgrade if crossed
    → apply coupon_assignment.used_at if coupon was used
    → check challenge progress → complete if threshold met
    → check active post-purchase surveys → queue survey_invitation (delay N hrs)
```

### Survey Send Flow
```
survey_invitation created (status=pending, future send_at)
  → scheduler fires at send_at
    → send LINE message with token URL
    → update invitation.sent_at
  → member clicks link → opens App Survey screen
    → submits answers → insert survey_responses
    → update invitation.completed_at
    → if completion_points > 0 → earn_member_points_atomic
    → if score <= escalate_threshold → create service_ticket
```

### Pilot Execution Flow
```
pilot_run created → status = draft
  → staff clicks "Send Pilot"
    → sample members from group (locked into pilot_member_ids)
    → execute action (coupon assign / LINE push / survey invite) for pilot set only
    → status = running
  → after observation window
    → staff reviews results dashboard
    → clicks "Approve" → status = approved
      → execute action for remaining group members (excluding pilot_member_ids)
      → rollout_sent_at recorded
    → or "Abort" → status = aborted, no further sends
```

### Inferred Preferences Compute Flow
```
Nightly 00:00 — for each member with purchases in last 6 months:
  → aggregate member_purchase_lines by category → top 3 by frequency × recency weight
  → aggregate member_purchase_lines by product → top 5 by count
  → compute avg unit price → bucket into budget / mid / premium
  → compute visit day distribution → pick most common weekday
  → write result to members.inferred_prefs_json
  → if top category changed → re-evaluate "For You" offers in App cache
```

### Group Compute Flow
```
Nightly 00:00 — for each dynamic member_group:
  → evaluate criteria_json against current member data
  → diff vs current member_group_members
  → upsert adds, soft-delete removals
  → update member_groups.member_count + last_computed_at
  → log delta summary
```

### App Authentication (Flutter)
- **Primary:** Supabase Auth with LINE OAuth provider — consumer taps "Login with LINE" in Flutter app → OAuth redirect → `supabase_flutter` handles token exchange → `auth.uid()` mapped to `members.auth_uid`
- **Fallback:** Phone OTP via Supabase Auth for non-LINE users
- **Deep links (survey / referral):** token in URL → Flutter deep link handler → `survey_invitations.token` or `member_sessions.token` → auto-login and navigate to survey/referral screen
- RLS on all consumer tables uses `auth.uid()` → no separate session token table needed for the main app flow; `member_sessions` retained only for web magic-link fallback (non-app contexts)

### POS Integration (QR scan)
- Member shows App QR (contains `qr_token`)
- POS scanner posts `qr_token` to lookup endpoint
- Returns: member name, level, point balance, available coupons list
- Staff selects coupon to apply (if any) before confirming transaction

---

## 15. Org & Company Scoping

### 15.1 The Problem
The current `members` table (init migration `20260405053819`) has **no `organization_id`** — it is a global flat table. Every other business entity in the system uses `organization_id` for RLS isolation (via `get_current_org_id()`). Membership must be brought into the same pattern before any new feature is built on top of it.

### 15.2 Org Scoping — What Changes

Every membership table carries `organization_id NOT NULL REFERENCES organizations(id)`:

| Table | Scope column | RLS policy |
|---|---|---|
| `members` | `organization_id` | `org_isolation` using `get_current_org_id()` |
| `point_transactions` | `organization_id` | Same pattern |
| `member_levels` | `organization_id` | Each org configures its own tiers |
| `coupons` | `organization_id` | Coupons belong to one org's program |
| `coupon_assignments` | via `coupons.organization_id` | Join-inherited |
| `member_groups` | `organization_id` | Groups are org-specific |
| `surveys` | `organization_id` | Survey programs per org |
| `member_purchases` | `organization_id` | Purchase records scoped to issuing org |
| `preference_categories` | `organization_id` | Each org configures its own category list |
| `pilot_runs` | `organization_id` | Pilot scoped to org's data |
| `birthday_reward_config` | `organization_id` | Config per org (and optionally per store within org) |

**Migration strategy for `members`:**
```sql
-- Sprint 0 migration
ALTER TABLE members ADD COLUMN organization_id INT REFERENCES organizations(id);

-- Backfill: assume all existing members belong to the single seed org
UPDATE members SET organization_id = (SELECT id FROM organizations LIMIT 1)
WHERE organization_id IS NULL;

ALTER TABLE members ALTER COLUMN organization_id SET NOT NULL;

-- Add unique constraint: one membership per phone per org
ALTER TABLE members ADD CONSTRAINT members_phone_org_unique UNIQUE (phone, organization_id);

-- RLS
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_org_isolation ON members
  USING (organization_id = get_current_org_id());
```

### 15.3 Company Linkage

A member (B2C consumer) can optionally be linked to a company (`customers` record with `company_role = 'company'`). This enables:
- **Corporate employee memberships** — company negotiates benefits for its staff
- **B2B account members** — a business earns points on behalf of its purchases
- **Company-level analytics** — aggregate spend across all members from the same company

```sql
-- On members table
members.company_id INT REFERENCES customers(id)   -- nullable; set when member is linked to a company account
```

**Corporate membership account** — when a company itself holds a pooled membership:

```sql
company_memberships (
  id,
  organization_id     INT NOT NULL REFERENCES organizations(id),
  company_id          INT NOT NULL REFERENCES customers(id),
  level_id            INT REFERENCES member_levels(id),
  pooled_points       INT DEFAULT 0,    -- points shared across all linked members
  contact_member_id   INT REFERENCES members(id),  -- primary contact
  created_at          TIMESTAMPTZ DEFAULT now()
)
```

**Linking flow:**
1. Staff links a consumer member to a company account (System → Member 360 → "Link to Company")
2. Member earns points individually but company pool also accrues (configurable split)
3. Company-level coupons can be issued to `company_id` and redeemed by any linked member

### 15.4 Multi-Store Within an Org

A single org (`organizations`) has multiple stores (`locations`). Membership is **org-level**, not store-level:
- Points earned at any store within the org pool to one balance
- Level thresholds are org-wide (total spend across all stores)
- Coupons created by any store admin within the org are redeemable at all stores (unless `store_ids` restricted)
- `member_purchases.store_id` tracks which store recorded the purchase (for analytics) but does not silo the balance

### 15.5 App Authentication Scope (Flutter)
```
Flutter app launch (org-flavored build)
  → Supabase Auth: LINE OAuth or phone OTP
  → auth.uid() resolved
  → look up members WHERE auth_uid = auth.uid() AND organization_id = flavor.orgId
  → RLS on all consumer tables enforces organization_id automatically
  → member context loaded into Riverpod providers
```

Multi-org scenario (future): each org ships their own Flutter build flavor (separate app store listings). A single multi-tenant build with an org switcher is possible but deferred — adds auth complexity.

---

## 16. Build Sequence (Concrete Sprint Plan)

> Sprints are 1 week unless marked otherwise. Each sprint lists files to create (`+`) or modify (`~`).

---

### Sprint 0 — Schema Foundations (Days 1–3)
**Goal:** All new tables exist; `members` is org-scoped; company linkage FK in place. No UI yet.

**Migration file:** `supabase/migrations/[ts]_membership_org_company_scoping.sql`
```
+ organization_id column on members, point_transactions
+ Backfill + NOT NULL + unique(phone, org)
+ RLS policies on members, point_transactions
+ member_levels table (org-scoped)
+ member_level_history table
+ birthday_reward_config table
+ member_purchases (with payment_method, survey_id) + member_purchase_lines
  (with product_category, product_type) tables — org-scoped
+ members columns: level_id, auth_uid, type (default 'consumer'),
                   lifetime_spend, lifetime_points, visit_count,
                   qr_token, referral_code, inferred_prefs_json, company_id
+ point_transactions.expires_at
+ company_memberships table
+ skus columns: product_category (CHECK enum), product_type,
                selling_price, image_url, description, short_name,
                wine_vintage, wine_region, wine_variety, alcohol_pct,
                producer, country_of_origin
```

**Files:**
- `+ supabase/migrations/[ts]_membership_org_company_scoping.sql`
- `~ src/lib/db/crm.js` — add `organization_id` filter to all member queries

---

### Sprint 1 — Levels + Purchase Recording (Week 1)
**Goal:** Configurable tiers visible in System; every POS transaction writes a purchase record; Member 360 shows history.

**Files:**
- `+ src/pages/crm/Levels.jsx` — level config page (CRUD for `member_levels`)
- `+ src/pages/crm/components/LevelFormModal.jsx`
- `~ src/pages/crm/Members.jsx` — show level badge, lifetime spend column
- `~ src/pages/crm/Customer360.jsx` — add Purchase History tab + summary cards + monthly chart
- `~ src/lib/events/handlers/crmHandlers.js` — add `onPOSTransactionRecordPurchase` handler
- `~ src/lib/db/crm.js` — add `getMemberPurchases()`, `getMemberPurchaseLines()`, `getMemberPurchaseSummary()`
- `+ supabase/migrations/[ts]_level_upgrade_trigger.sql` — DB trigger or Postgres function for nightly level upgrade
- `~ src/modules/CRMModule.jsx` — add `/crm/levels` route

---

### Sprint 2 — Coupon Engine (Week 2)
**Goal:** Staff can create coupons and assign to individual members; POS can apply a coupon at checkout.

**Files:**
- `+ src/pages/crm/Coupons.jsx` — coupon list + status management
- `+ src/pages/crm/components/CouponFormModal.jsx` — create/edit coupon
- `+ src/pages/crm/components/CouponAssignModal.jsx` — assign to member(s)
- `~ src/pages/crm/Customer360.jsx` — add Coupons tab (active / used / expired per member)
- `~ src/pages/pos/` — QR scan → member lookup → available coupons → apply
- `~ src/lib/db/crm.js` — `createCoupon()`, `assignCoupon()`, `redeemCoupon()`, `getMemberCoupons()`
- `+ supabase/migrations/[ts]_coupons.sql` — `coupons` + `coupon_assignments` tables + RLS
- `~ src/modules/CRMModule.jsx` — add `/crm/coupons` route

---

### Sprint 3 — Group Builder (Week 3)
**Goal:** Dynamic and static groups exist; coupon distribution targets a group; Group builder UI with live preview.

**Files:**
- `+ src/pages/crm/Groups.jsx` — group list page
- `+ src/pages/crm/components/GroupBuilderModal.jsx` — AND/OR criteria builder + live count preview
- `+ src/pages/crm/components/GroupMemberList.jsx` — drill into group membership
- `~ src/pages/crm/Coupons.jsx` — distribution: add "Send to group" flow
- `~ src/lib/db/crm.js` — `createGroup()`, `computeGroupMembers()`, `getGroupPreview()`
- `+ supabase/migrations/[ts]_member_groups.sql` — `member_groups` + `member_group_members` + RLS
- `+ supabase/migrations/[ts]_group_compute_fn.sql` — Postgres function `refresh_member_group(group_id)`
- `~ src/modules/CRMModule.jsx` — add `/crm/groups` route

---

### Sprint 4 — Surveys + Pilot Runs (Week 4)
**Goal:** Post-purchase surveys send via LINE; staff can run a pilot before full distribution.

**Files:**
- `+ src/pages/crm/Surveys.jsx` — survey list + builder
- `+ src/pages/crm/components/SurveyBuilderModal.jsx` — question editor + trigger rules
- `+ src/pages/crm/components/SurveyResultsPanel.jsx` — response rate, NPS chart, free-text list
- `+ src/pages/crm/PilotRuns.jsx` — pilot list + results + decision UI
- `+ src/lib/db/crm.js` — `createSurvey()`, `sendSurveyInvitations()`, `getSurveyResults()`, `createPilotRun()`, `approvePilot()`
- `~ src/lib/events/handlers/crmHandlers.js` — add `onPurchaseRecordedQueueSurvey` handler
- `+ supabase/migrations/[ts]_surveys.sql` — surveys, survey_questions, survey_invitations, survey_responses tables + RLS
- `+ supabase/migrations/[ts]_pilot_runs.sql` — `pilot_runs` table + RLS
- `+ supabase/migrations/[ts]_survey_send_cron.sql` — pg_cron job to process pending survey_invitations
- `~ src/modules/CRMModule.jsx` — add `/crm/surveys`, `/crm/pilots` routes

---

### Sprint 5 — Flutter App Shell + Core Screens (Weeks 5–6, 2 weeks)
**Goal:** Flutter app builds and runs on iOS + Android. Home, member card, points, level, coupon wallet, and purchase history all functional against live Supabase.

**New project:** `member-app/` — separate Flutter repo, **not inside sme-ops**.

```
member-app/
  pubspec.yaml              # supabase_flutter, go_router, riverpod, qr_flutter, flutter_barcode_scanner
  lib/
    main.dart               # Supabase init, ProviderScope, app entry
    app.dart                # GoRouter routes, MaterialApp theme (org brand colors)
    core/
      supabase_client.dart  # singleton client
      auth/
        auth_service.dart   # LINE OAuth + phone OTP via Supabase Auth
        auth_notifier.dart  # Riverpod StateNotifier
        login_screen.dart
    features/
      home/
        home_screen.dart        # balance card, level badge, "For You", monthly spend
        home_controller.dart    # Riverpod provider
      member_card/
        member_card_screen.dart # QR code (qr_flutter), member number, level color
      points/
        points_screen.dart      # balance, transaction list, expiry warnings
        points_controller.dart
      level/
        level_screen.dart       # progress bar, tier benefits comparison table
      coupons/
        coupon_wallet_screen.dart   # tabs: available / used / expired
        coupon_detail_screen.dart   # barcode, terms, expiry countdown
        coupon_controller.dart
      purchases/
        purchase_history_screen.dart  # list with store/month filter
        purchase_detail_screen.dart   # line items, points earned, coupon applied
        purchase_controller.dart
      survey/
        survey_screen.dart      # question renderer, progress indicator, submit
        survey_controller.dart
      profile/
        profile_screen.dart     # edit name, birthday, notification opt-in
    shared/
      widgets/
        bottom_nav.dart
        level_badge.dart        # colored chip with tier icon
        coupon_card.dart
        points_row.dart
        spending_card.dart
      models/
        member.dart
        coupon.dart
        purchase.dart
        survey_question.dart
      theme/
        app_theme.dart          # light/dark, org brand color injection
  android/
  ios/
```

**Backend changes (sme-ops side):**
- `+ supabase/migrations/[ts]_member_sessions.sql` — `member_sessions` table + RLS (for magic-link fallback)
- `~ supabase/migrations` — verify RLS on `members`, `member_purchases`, `coupons`, `point_transactions` allows `auth.uid()` mapped to `member_id`

---

### Sprint 6 — Preferences + "For You" (Week 7)
**Goal:** Inferred preferences compute nightly; consumer sets explicit preferences in App; "For You" section on home.

**Flutter (member-app/):**
- `+ lib/features/preferences/taste_profile_screen.dart` — "My Taste Profile": drink type selector, wine region picker, variety chips, taste sliders, occasion + budget
- `+ lib/features/preferences/generic_prefs_screen.dart` — lifestyle tags, offer type, notification frequency
- `~ lib/features/home/home_screen.dart` — "For You" personalized offer cards using taste profile
- `+ lib/features/preferences/preferences_controller.dart`

**System (sme-ops/):**
- `~ src/pages/crm/Customer360.jsx` — add "Taste Profile" card (inferred wine style, explicit regions, varieties, taste dims)
- `~ src/lib/db/crm.js` — `getMemberDrinkPrefs()`, `saveMemberDrinkPrefs()`, `getMemberExplicitPrefs()`, `saveMemberExplicitPrefs()`, `getPersonalizedOffers()`
- `~ src/pages/crm/Groups.jsx` — add drink preference criteria (wine region, variety, price tier, taste profile)

**Backend:**
- `+ supabase/migrations/[ts]_preferences.sql` — `preference_lifestyle_tags`, `member_explicit_prefs`, `member_drink_preferences`, `drink_preference_options` + RLS + seed default wine regions + varieties
- `+ supabase/migrations/[ts]_inferred_prefs_cron.sql` — pg_cron nightly: compute `members.inferred_prefs_json` from `member_purchase_lines.product_category` + `.product_type`

---

### Sprint 7 — Engagement (Week 8)
**Goal:** LINE push notifications working; RFM auto-groups computed nightly; win-back flow running; referral + challenges in app.

**Flutter (member-app/):**
- `+ lib/features/referral/referral_screen.dart` — code display, shareable link, friend list + earned bonus
- `+ lib/features/challenges/challenges_screen.dart` — active challenges + badge collection

**System (sme-ops/):**
- `+ src/lib/line/messagingApi.js` — LINE Messaging API wrapper (push, flex messages)
- `+ src/lib/membership/notifications.js` — notification templates per event type
- `~ src/lib/events/handlers/crmHandlers.js` — wire push notifications to all membership events
- `+ src/pages/crm/components/WinBackConfig.jsx` — configure win-back timing + message + coupon

**Backend:**
- `+ supabase/migrations/[ts]_rfm_scoring.sql` — `rfm_scores` materialized view + pg_cron refresh
- `+ supabase/migrations/[ts]_stamp_cards.sql` — `stamp_card_types` + `stamp_cards` tables

---

### Sprint 8 — Analytics (Weeks 9–10)
**Goal:** Retention, coupon, survey, and LTV dashboards visible to managers.

**Files:**
- `~ src/pages/crm/Reports.jsx` — add tabs: Retention · Coupons · Surveys · LTV
- `+ src/pages/crm/components/RetentionCohortChart.jsx`
- `+ src/pages/crm/components/CouponFunnelChart.jsx` — issue → open → redeem funnel
- `+ src/pages/crm/components/SurveyTrendChart.jsx` — NPS over time by store
- `+ src/pages/crm/components/LTVByLevelChart.jsx`
- `+ supabase/migrations/[ts]_analytics_views.sql` — MV: cohort_retention, coupon_funnel, nps_trend, ltv_by_level
- `+ supabase/migrations/[ts]_analytics_mv_cron.sql` — pg_cron: REFRESH MATERIALIZED VIEW nightly

---

### Sprint 9+ — Paid Tiers, WhatsApp, AI (Phase F, ongoing)
- `membership_plans` + `member_subscriptions` tables + payment provider integration
- WhatsApp Business API channel alongside LINE
- Gemini AI churn prediction: score members weekly, flag high-risk to win-back automation

---

*Effort key: S = Small (≤1 week) · M = Medium (1–3 weeks) · L = Large (1–2 months)*

---

## 18. Inventory Management System (Store & Warehouse)

### 18.1 Two-Tier Inventory Model

For a multi-store F&B retail business, inventory lives in two distinct layers that must be tracked independently:

```
[Suppliers / Import]
        ↓  GR / goods receipt (§17)
  [Central Warehouse]          ← bulk cases, lot-tracked, bin-located
        ↓  replenishment transfer
  [Store Floor Stock]          ← per-store, per-SKU on-hand + back room
        ↓  POS sale
  [Sold / Out of inventory]
```

**Warehouse** — bulk storage, lot-tracked by FEFO/FIFO, bin-located, warehouse-to-warehouse transfers
**Store** — retail-position stock per store; what the POS draws from at point of sale
**Replenishment** — formal request → pick (FEFO) → transit → receive flow from warehouse to store

Both layers share the same `skus` master and route all state changes through EventBus so Finance, CRM, and POS stay consistent without polling.

---

### 18.2 What Already Exists (and Gaps)

The WMS module has 22 UI pages and 9 live EventBus handlers. Key inventory pieces:

| Component | Status | Critical Gap |
|---|---|---|
| `warehouses` table | ✅ Org-scoped | — |
| `stock_levels` table | ⚠️ | `warehouse` is TEXT not FK; no `bin_id`; **no `reserved_qty`** (noted in code comment line 18); no `sku_id` FK |
| `bins` table | ✅ | Not linked to `stock_levels` |
| `inventory_lots` table | ⚠️ | No `warehouse_id` FK; no `org_id`; no `cost_per_unit`; `received_date` missing |
| `inventory_adjustments` + atomic RPC | ✅ | Works via sku_code + warehouse TEXT — stays unchanged |
| `stock_counts` | ⚠️ JSONB items | Cannot approve/reject individual variance lines |
| `inbound_orders` / `inbound_items` | ⚠️ Basic | No `supplier_id`, `warehouse_id`, `sku_id` FKs |
| `outbound_orders` / `outbound_items` | ⚠️ Basic | No `sku_id` FK; no pick assignment |
| `wmsHandlers.js` | ⚠️ Bug | `pos.transaction.completed` deducts from warehouse `stock_levels` — should deduct from **store** stock |
| **Store stock layer** | ❌ None | No per-store stock table anywhere |
| **Replenishment flow** | ❌ None | No warehouse-to-store request/fulfillment process |
| **Expiry alerts** | ❌ No automation | `inventory_lots.expiry_date` exists; no nightly check |
| **FEFO picking** | ❌ Not enforced | Lots exist; pick order not applied |
| **Reorder automation** | ⚠️ Manual | `wms.stock.below_reorder` event exists; no pg_cron check |

---

### 18.3 Schema: Structural Fixes (Sprint I0)

#### A. Normalize `stock_levels` (warehouse layer)

```sql
ALTER TABLE public.stock_levels
  ADD COLUMN IF NOT EXISTS sku_id       INT REFERENCES skus(id),
  ADD COLUMN IF NOT EXISTS warehouse_id INT REFERENCES warehouses(id),
  ADD COLUMN IF NOT EXISTS bin_id       INT REFERENCES bins(id),
  ADD COLUMN IF NOT EXISTS reserved_qty NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT now();

UPDATE stock_levels sl SET sku_id = s.id
  FROM skus s WHERE s.code = sl.sku_code AND sl.sku_id IS NULL;

UPDATE stock_levels sl SET warehouse_id = w.id
  FROM warehouses w WHERE w.name = sl.warehouse AND sl.warehouse_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_levels_sku_wh_bin
  ON stock_levels(sku_id, warehouse_id, COALESCE(bin_id, 0));
```

`apply_inventory_adjustment_atomic()` RPC stays unchanged (uses sku_code + warehouse TEXT for backward compat). New code paths use `sku_id + warehouse_id`.

#### B. Normalize `inventory_lots`

```sql
ALTER TABLE public.inventory_lots
  ADD COLUMN IF NOT EXISTS warehouse_id  INT REFERENCES warehouses(id),
  ADD COLUMN IF NOT EXISTS store_id      INT REFERENCES stores(id),   -- null = warehouse lot
  ADD COLUMN IF NOT EXISTS cost_per_unit NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS received_date DATE DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS org_id        INT REFERENCES organizations(id);
```

#### C. Normalize `stock_counts` (relational line items)

`stock_counts.items` is JSONB today — variances cannot be approved per-line. New table:

```sql
CREATE TABLE IF NOT EXISTS stock_count_lines (
  id            BIGSERIAL PRIMARY KEY,
  count_id      INT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  sku_id        INT REFERENCES skus(id),
  sku_code      TEXT,
  sku_name      TEXT NOT NULL,
  lot_id        INT REFERENCES inventory_lots(id),
  bin_code      TEXT,
  expected_qty  NUMERIC(12,2) DEFAULT 0,     -- snapshot from stock_levels at count start
  counted_qty   NUMERIC(12,2),               -- null until scanned/entered
  variance      NUMERIC(12,2)
    GENERATED ALWAYS AS (COALESCE(counted_qty, 0) - expected_qty) STORED,
  status        TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','counted','approved','adjusted','flagged')),
  counted_by    TEXT,
  counted_at    TIMESTAMPTZ,
  org_id        INT REFERENCES organizations(id)
);
CREATE INDEX IF NOT EXISTS idx_scount_lines_count ON stock_count_lines(count_id);
```

---

### 18.4 Schema: Store Inventory (New Tables, Sprint I0)

#### `store_stock_levels` — per-store stock position

```sql
CREATE TABLE store_stock_levels (
  id              BIGSERIAL PRIMARY KEY,
  store_id        INT NOT NULL REFERENCES stores(id),
  org_id          INT NOT NULL REFERENCES organizations(id),
  sku_id          INT NOT NULL REFERENCES skus(id),
  sku_code        TEXT NOT NULL,
  quantity        NUMERIC(12,2) DEFAULT 0,
  reserved_qty    NUMERIC(12,2) DEFAULT 0,   -- holds at POS pending payment
  min_qty         NUMERIC(12,2) DEFAULT 0,   -- hard floor (alert when crossed)
  reorder_point   NUMERIC(12,2) DEFAULT 0,   -- store-level, overrides skus.reorder_point
  reorder_qty     NUMERIC(12,2) DEFAULT 0,   -- how many to request from warehouse
  auto_replenish  BOOLEAN DEFAULT FALSE,      -- auto-create request when low
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (store_id, sku_id)
);
CREATE INDEX IF NOT EXISTS idx_ssl_store ON store_stock_levels(store_id);
CREATE INDEX IF NOT EXISTS idx_ssl_low   ON store_stock_levels(store_id)
  WHERE quantity <= reorder_point;
```

#### `store_replenishment_requests` — store requests stock from warehouse

```sql
CREATE TABLE store_replenishment_requests (
  id              BIGSERIAL PRIMARY KEY,
  request_number  TEXT UNIQUE NOT NULL,
  store_id        INT NOT NULL REFERENCES stores(id),
  org_id          INT NOT NULL REFERENCES organizations(id),
  warehouse_id    INT REFERENCES warehouses(id),
  requested_by    TEXT,
  approved_by     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','picking','packed','in_transit','received','cancelled')),
  notes           TEXT,
  requested_at    TIMESTAMPTZ DEFAULT now(),
  approved_at     TIMESTAMPTZ,
  received_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE store_replenishment_lines (
  id              BIGSERIAL PRIMARY KEY,
  request_id      INT NOT NULL REFERENCES store_replenishment_requests(id) ON DELETE CASCADE,
  sku_id          INT NOT NULL REFERENCES skus(id),
  sku_name        TEXT NOT NULL,
  qty_requested   NUMERIC(12,2) NOT NULL,
  qty_approved    NUMERIC(12,2),
  qty_picked      NUMERIC(12,2) DEFAULT 0,
  qty_received    NUMERIC(12,2) DEFAULT 0,
  from_lot_id     INT REFERENCES inventory_lots(id),   -- FEFO lot assigned at pick time
  notes           TEXT
);
```

#### `store_inventory_adjustments` — store-level manual corrections

```sql
CREATE TABLE store_inventory_adjustments (
  id              BIGSERIAL PRIMARY KEY,
  store_id        INT NOT NULL REFERENCES stores(id),
  org_id          INT NOT NULL REFERENCES organizations(id),
  sku_id          INT NOT NULL REFERENCES skus(id),
  sku_name        TEXT NOT NULL,
  qty_delta       NUMERIC(12,2) NOT NULL,   -- positive = add, negative = remove
  reason          TEXT NOT NULL,            -- 盤盈|盤虧|損耗|試飲|展示品|其他
  operator        TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

---

### 18.5 Replenishment Workflow

```
[Store manager: qty ≤ reorder_point]  (or auto_replenish fires)
  → store_replenishment_requests (pending)
    → emit wms.store.replenishment_requested
      → Warehouse manager approves → status: approved
        → Warehouse staff picks lots (FEFO order) → status: picking
          → Packed → status: packed; in transit → status: in_transit
            → emit wms.store.replenishment_fulfilled
              → Store manager receives, confirms qty → status: received
                → emit wms.store.stock_received
                  → store_stock_levels += qty_received  (atomic RPC)
                  → stock_levels -= qty_picked          (atomic RPC)
```

**FEFO lot selection at pick time:**
```sql
SELECT il.* FROM inventory_lots il
WHERE il.sku_id = $sku_id AND il.warehouse_id = $warehouse_id AND il.quantity > 0
ORDER BY il.expiry_date ASC NULLS LAST, il.received_date ASC
LIMIT 1;
```

---

### 18.6 POS → Store Stock Deduction (fix existing handler)

Current `wmsHandlers.js` bug: `pos.transaction.completed` deducts from warehouse `stock_levels`. Fix:

```
pos.transaction.completed {store_id, items[]}
  → deduct from store_stock_levels WHERE store_id = payload.store_id   ← FIX
  → if qty ≤ reorder_point → emit wms.store.stock_low
      → if auto_replenish → auto-create store_replenishment_requests
  → emit wms.stock.adjusted {context: 'store', store_id}
```

Warehouse `stock_levels` is NOT touched on POS sale — warehouse decreases only when replenishment transfer is fulfilled and received.

---

### 18.7 Expiry Alert Automation (pg_cron)

```sql
-- Daily 07:00 — lots expiring ≤30 days, qty > 0
-- → INSERT notifications (type: '效期警示', priority: high)
-- → emit wms.stock.expiry_alert {items[], days_threshold: 30}
--   → wmsHandlers: notify warehouse manager + store managers with affected stock
--   → optional: crmHandlers trigger discount coupon creation for expiring SKUs
```

---

### 18.8 Reorder Automation (pg_cron)

```sql
-- Nightly 01:30 — two checks:
-- 1. stock_levels WHERE quantity <= skus.reorder_point → emit wms.stock.below_reorder
-- 2. store_stock_levels WHERE quantity <= reorder_point → emit wms.store.stock_low
--    → if auto_replenish: INSERT store_replenishment_requests automatically
-- Existing purchaseHandlers.js already creates PR on wms.stock.below_reorder
```

---

### 18.9 EventBus Additions (extend `wms.events.js`)

| Event | Payload | Description |
|---|---|---|
| `wms.store.stock_received` | store_id, request_id, items[] | 門市補貨已確認收貨 |
| `wms.store.stock_low` | store_id, items[{sku_id, qty, reorder_point}] | 門市庫存低於再訂購點 |
| `wms.store.replenishment_requested` | request_id, store_id, warehouse_id, items[] | 補貨申請建立 |
| `wms.store.replenishment_fulfilled` | request_id, store_id, items[{qty_picked}] | 倉庫出貨給門市 |
| `wms.stock.expiry_alert` | items[{sku_id, sku_name, lot_number, expiry_date, qty, warehouse}], days_threshold | 即期品警示 |
| `wms.stock.count_completed` | count_id, warehouse_id, variances[] | 盤點完成，差異待確認 |
| `wms.stock.count_approved` | count_id, adjustments[] | 差異已核准，系統自動調帳 |

#### Extended handler behaviors (`wmsHandlers.js`)

| Trigger | New / Changed Action |
|---|---|
| `pos.transaction.completed` | **Bug fix**: deduct `store_stock_levels` not `stock_levels` |
| `wms.store.stock_low` | Notify store manager; if `auto_replenish` create replenishment request |
| `wms.store.replenishment_fulfilled` | Update request status → in_transit; notify store manager |
| `wms.store.stock_received` | Atomic: `store_stock_levels += qty`; `stock_levels -= qty`; close request |
| `wms.stock.expiry_alert` | Insert notifications; optionally trigger CRM coupon flow |
| `wms.stock.count_approved` | Call `apply_inventory_adjustment_atomic()` per variance line; emit `wms.stock.adjusted` |

---

### 18.10 System UI Pages

#### New Pages

| File | Route | Purpose |
|---|---|---|
| `+ src/pages/wms/StoreInventory.jsx` | `/wms/store-inventory` | Per-store stock table; low-stock badge; adjust; replenishment button per row |
| `+ src/pages/wms/Replenishment.jsx` | `/wms/replenishment` | Request list (tabs: pending/picking/in_transit/received); create; warehouse fulfill view with FEFO lot picker |
| `+ src/pages/wms/ExpiryAlert.jsx` | `/wms/expiry` | Lots expiring ≤30/60/90 days; bulk: discount coupon, store transfer, tasting flag |
| `+ src/pages/wms/components/ReplenishmentFormModal.jsx` | — | SKU + qty lines; auto-fill reorder_qty |
| `+ src/pages/wms/components/FulfillmentPanel.jsx` | — | FEFO lot assignment per line; qty confirm |
| `+ src/pages/wms/components/StoreStockSummary.jsx` | — | Per-store: total SKUs, low-stock count, pending replenishments |

#### Enhanced Pages (existing)

| File | Enhancement |
|---|---|
| `~ src/pages/wms/Inventory.jsx` | Add warehouse_id filter, bin_id column, reserved_qty; FEFO lot drill-down |
| `~ src/pages/wms/StockCount.jsx` | Use `stock_count_lines`; per-line approve/reject; post adjustments on bulk approve |
| `~ src/pages/wms/Lots.jsx` | Expiry alert badges; FEFO default sort; store_id column |
| `~ src/pages/wms/Overview.jsx` | Add "Store Stock" summary panel; pending replenishments count |
| `~ src/pages/wms/Transfers.jsx` | Add transfer type: Warehouse→Store, Store→Store, Store→Warehouse |

---

### 18.11 Sprint Plan (I-Series)

#### Sprint I0 — Schema (Days 1–3)
`supabase/migrations/[ts]_inventory_store_warehouse.sql`
```
+ store_stock_levels, store_replenishment_requests, store_replenishment_lines
+ store_inventory_adjustments, stock_count_lines tables
~ stock_levels: add sku_id FK, warehouse_id FK, bin_id FK, reserved_qty, updated_at; composite unique index
~ inventory_lots: add warehouse_id FK, store_id FK, cost_per_unit, received_date, org_id
+ extend wms.events.js: 7 new events
+ RLS on all new tables
```

---

#### Sprint I1 — Store Stock + POS Fix (Week 1)
- `+ src/pages/wms/StoreInventory.jsx`
- `~ src/lib/events/handlers/wmsHandlers.js` — fix POS deduction to `store_stock_levels`; emit `wms.store.stock_low`; auto-replenish trigger
- `~ src/lib/db/wms.js` — `getStoreStockLevels()`, `adjustStoreStock()`, `checkStoreReorderPoints()`
- `~ src/modules/WMSModule.jsx` — add `/wms/store-inventory` route

---

#### Sprint I2 — Replenishment Flow (Week 2)
- `+ src/pages/wms/Replenishment.jsx`
- `+ src/pages/wms/components/ReplenishmentFormModal.jsx`
- `+ src/pages/wms/components/FulfillmentPanel.jsx` (FEFO lot picker)
- `~ src/lib/events/handlers/wmsHandlers.js` — `onReplenishmentFulfilled`, `onStoreStockReceived` (atomic stock swap)
- `~ src/lib/db/wms.js` — `createReplenishmentRequest()`, `fulfillReplenishment()`, `receiveReplenishment()`

---

#### Sprint I3 — Stock Count Improvements (Week 3)
- `~ src/pages/wms/StockCount.jsx` — use `stock_count_lines`; per-line status; approve → post adjustments
- `~ src/lib/db/wms.js` — `initStockCountLines()` (snapshot expected_qty), `saveCountedQty()`, `approveCountLines()`, `postCountAdjustments()`
- `~ src/lib/events/handlers/wmsHandlers.js` — `onCountApproved` → `apply_inventory_adjustment_atomic()` per variance

---

#### Sprint I4 — Expiry + FEFO (Week 4)
- `+ src/pages/wms/ExpiryAlert.jsx`
- `~ src/pages/wms/Lots.jsx` — expiry badges, FEFO sort default, store_id column
- `+ supabase/migrations/[ts]_expiry_alert_cron.sql` — pg_cron 07:00 daily

---

#### Sprint I5 — Reorder Automation + Overview Enhancement (Week 5)
- `+ supabase/migrations/[ts]_reorder_check_cron.sql` — pg_cron 01:30 nightly: both warehouse + store checks; auto-replenish for `auto_replenish = TRUE`
- `~ src/pages/wms/Overview.jsx` — Store Stock panel + health score (% SKUs above reorder point)
- `~ src/pages/wms/StoreInventory.jsx` — auto_replenish toggle + inline reorder_point/reorder_qty edit

---

### 18.12 EventBus Flow Diagram

```
[POS sale at store]
  pos.transaction.completed {store_id, items[]}
    → wmsHandlers: deduct store_stock_levels  ← BUG FIX (was warehouse)
      → if qty ≤ reorder_point: emit wms.store.stock_low
          → notify store manager
          → if auto_replenish: create store_replenishment_requests (pending)
              emit wms.store.replenishment_requested

[Warehouse fulfills]
  → approve → pick (FEFO) → pack → in_transit
    emit wms.store.replenishment_fulfilled
      → notify store manager

[Store confirms receipt]
  → receiveReplenishment() [atomic RPC]
      store_stock_levels += qty_received
      stock_levels -= qty_picked
    emit wms.store.stock_received

[Nightly 01:30 cron]
  → warehouse: stock_levels ≤ skus.reorder_point → emit wms.stock.below_reorder
      → purchaseHandlers: auto-create PR (existing flow)
  → store: store_stock_levels ≤ reorder_point → emit wms.store.stock_low
      → auto-create replenishment if auto_replenish

[Daily 07:00 cron]
  → inventory_lots WHERE expiry_date ≤ now() + 30 days AND qty > 0
    emit wms.stock.expiry_alert
      → wmsHandlers: insert notifications
      → crmHandlers (optional): trigger discount coupon for expiring SKUs

[Stock count completed]
  emit wms.stock.count_completed
    → [Manager approves per-line variances]
      emit wms.stock.count_approved
        → wmsHandlers: apply_inventory_adjustment_atomic() per variance line
          emit wms.stock.adjusted (reason: 盤點調整)
```

---

## 17. Product Lifecycle Tracker

Full end-to-end visibility from supplier quote through import, customs clearance, and inventory — to the moment a unit is sold. Every stage emits an EventBus event so Finance, WMS, and CRM stay consistent without polling.

### 17.1 Lifecycle Pipeline

```
RFQ sent to suppliers
  → Supplier quotes received
    → Quotes compared → PO awarded
      → PO approved (existing flow)
        → Import shipment booked
          → Shipment departed (origin port)
            → Shipment arrived (destination port)
              → Customs declaration filed
                → Customs cleared + duties paid
                  → Goods received (GR)
                    → Landed cost allocated → skus.unit_cost updated
                      → Units in inventory (RFID in_stock)
                        → Reserved for order (wms.stock.reserved)
                          → Sold / shipped (RFID sold)
                            → AP payment settled (finance.ap.paid)
```

### 17.2 What Already Exists vs. Gaps

| Stage | Existing | Gap |
|---|---|---|
| Supplier master | `suppliers` table (no org_id, no FK on PO) | Add `org_id`; normalize PO.supplier text → FK |
| Purchase Request | `purchase_requests` (JSONB items, no org_id) | Add `org_id`; add line items table |
| Purchase Order | `purchase_orders` (JSONB items, supplier as TEXT) | `purchase_order_lines` relational table; `supplier_id FK` |
| Goods Receipt | `goods_receipts` (JSONB items) | Link to RFID / lot assignment |
| Supplier RFQ | ❌ None | `supplier_quote_requests` + `supplier_quotes` + quote lines |
| Import shipment | ❌ None | `import_shipments` + `import_shipment_pos` junction |
| Customs | ❌ None | `customs_declarations` + `customs_declaration_lines` |
| Landed cost | ❌ None | `landed_costs` + `landed_cost_lines` |
| Barcode | `skus.barcode` (single text) | `sku_barcodes` for multi-barcode (EAN/UPC/supplier code) |
| RFID | ❌ None | `rfid_tags` + `rfid_scans` |
| AP payment | `accounts_payable` (basic) | `supplier_payments` with FX + bank ref |
| EventBus | purchase (5 events), wms (10 events) | New `import` domain; `wms.rfid.*`; `purchase.rfq.*` |

### 17.3 RFID + Barcode on Products

#### Barcode

`skus.barcode` (existing, TEXT) holds the primary scannable code. For wine/import products that carry multiple codes (EAN-13 on bottle, UPC-A in US market, supplier SKU code):

```sql
-- Sprint P0: multi-barcode support
CREATE TABLE sku_barcodes (
  id            BIGSERIAL PRIMARY KEY,
  sku_id        INT NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  barcode       TEXT NOT NULL,
  barcode_type  TEXT NOT NULL CHECK (barcode_type IN ('ean13','upc_a','qr','code128','supplier','isbn')),
  is_primary    BOOLEAN DEFAULT FALSE,
  org_id        INT REFERENCES organizations(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (sku_id, barcode)
);
CREATE INDEX idx_sku_barcodes_barcode ON sku_barcodes(barcode);   -- fast lookup at POS scan
```

`skus.barcode` stays as the primary for backward compat. `sku_barcodes` holds all alternatives. POS barcode lookup: scan → hit `sku_barcodes` first (covers all codes), fall back to `skus.barcode`.

#### RFID

Wine importers often RFID-tag cases or individual bottles at the winery or at the import warehouse. Each physical tag maps to one unit or one lot.

```sql
-- Sprint P0: RFID tag master
CREATE TABLE rfid_tags (
  id            BIGSERIAL PRIMARY KEY,
  tag_uid       TEXT NOT NULL UNIQUE,        -- EPC / ISO 15693 UID
  org_id        INT NOT NULL REFERENCES organizations(id),
  sku_id        INT REFERENCES skus(id),
  lot_id        INT REFERENCES inventory_lots(id),
  quantity      INT DEFAULT 1,               -- for case-level tags: bottles per case
  status        TEXT NOT NULL DEFAULT 'unassigned'
                CHECK (status IN ('unassigned','in_stock','reserved','sold','lost','returned','damaged')),
  location      TEXT,                        -- current shelf / bin
  assigned_at   TIMESTAMPTZ,
  sold_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Sprint P0: RFID scan event log
CREATE TABLE rfid_scans (
  id            BIGSERIAL PRIMARY KEY,
  tag_uid       TEXT NOT NULL,
  org_id        INT NOT NULL REFERENCES organizations(id),
  scanner_id    TEXT,                        -- reader device ID / location name
  scan_location TEXT,                        -- e.g. 'gate_in', 'shelf_A3', 'pos_1'
  signal_strength NUMERIC(5,2),             -- dBm (optional, for proximity filtering)
  scanned_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rfid_scans_tag ON rfid_scans(tag_uid, scanned_at DESC);
```

**Tag assignment flow:**
1. Goods received (GR completed) → staff scan tags → `rfid_tags` created/updated (status: in_stock)
2. POS scan of RFID tag at checkout → status: sold, sold_at recorded, `wms.rfid.scan_detected` emitted
3. Bulk RFID inventory count → scan all tags in zone → `wms.rfid.inventory_counted` → reconcile vs. `inventory_lots.quantity`

**`skus` additions for RFID/import (Sprint P0):**
```sql
ALTER TABLE skus
  ADD COLUMN IF NOT EXISTS rfid_enabled       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hs_code            TEXT,       -- Harmonized System code for customs
  ADD COLUMN IF NOT EXISTS reorder_point      NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reorder_qty        NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS primary_supplier_id INT REFERENCES suppliers(id),
  ADD COLUMN IF NOT EXISTS lead_time_days     INT DEFAULT 30;
  -- country_of_origin already planned in Sprint 0 (CRM section)
```

### 17.4 New Database Tables

#### A. Supplier RFQ (Request for Quotation)

```sql
-- RFQ header — sent to one or more suppliers simultaneously
CREATE TABLE supplier_quote_requests (
  id            BIGSERIAL PRIMARY KEY,
  rfq_number    TEXT UNIQUE NOT NULL,
  org_id        INT NOT NULL REFERENCES organizations(id),
  pr_id         INT REFERENCES purchase_requests(id),    -- nullable: may originate ad-hoc
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','sent','receiving','closed','cancelled')),
  sent_at       TIMESTAMPTZ,
  close_date    DATE,                                     -- deadline for supplier responses
  created_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE supplier_quote_request_lines (
  id            BIGSERIAL PRIMARY KEY,
  rfq_id        INT NOT NULL REFERENCES supplier_quote_requests(id) ON DELETE CASCADE,
  sku_id        INT REFERENCES skus(id),
  sku_name      TEXT NOT NULL,                           -- denormalized
  qty           NUMERIC(12,2) NOT NULL,
  notes         TEXT
);

-- Supplier response to an RFQ
CREATE TABLE supplier_quotes (
  id              BIGSERIAL PRIMARY KEY,
  rfq_id          INT NOT NULL REFERENCES supplier_quote_requests(id),
  supplier_id     INT NOT NULL REFERENCES suppliers(id),
  org_id          INT NOT NULL REFERENCES organizations(id),
  quote_ref       TEXT,                                  -- supplier's own quote number
  currency        TEXT NOT NULL DEFAULT 'TWD'
                  CHECK (currency IN ('TWD','USD','EUR','JPY','CNY','GBP','AUD','HKD')),
  exchange_rate   NUMERIC(12,6) DEFAULT 1.0,            -- to TWD at time of quote
  subtotal_foreign NUMERIC(14,2),
  subtotal_twd    NUMERIC(14,2),
  freight_foreign NUMERIC(14,2),
  freight_twd     NUMERIC(14,2),
  payment_terms   TEXT,
  delivery_lead_days INT,
  validity_date   DATE,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'received'
                  CHECK (status IN ('received','selected','rejected')),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE supplier_quote_lines (
  id              BIGSERIAL PRIMARY KEY,
  quote_id        INT NOT NULL REFERENCES supplier_quotes(id) ON DELETE CASCADE,
  sku_id          INT REFERENCES skus(id),
  sku_name        TEXT NOT NULL,
  qty             NUMERIC(12,2) NOT NULL,
  unit_price_foreign NUMERIC(14,4),
  unit_price_twd  NUMERIC(14,4),
  subtotal_twd    NUMERIC(14,2),
  notes           TEXT
);
```

#### B. Purchase Order Lines (normalize existing JSONB)

```sql
-- Relational line items for purchase_orders
-- (existing purchase_orders.items JSONB stays for backward compat during migration)
CREATE TABLE purchase_order_lines (
  id            BIGSERIAL PRIMARY KEY,
  po_id         INT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  sku_id        INT REFERENCES skus(id),
  sku_code      TEXT,
  sku_name      TEXT NOT NULL,               -- denormalized
  qty_ordered   NUMERIC(12,2) NOT NULL,
  qty_received  NUMERIC(12,2) DEFAULT 0,     -- updated incrementally as GRs come in
  unit_price    NUMERIC(14,4),
  currency      TEXT DEFAULT 'TWD',
  amount_twd    NUMERIC(14,2),
  notes         TEXT
);
```

#### C. Import Shipments

```sql
CREATE TABLE import_shipments (
  id                 BIGSERIAL PRIMARY KEY,
  shipment_number    TEXT UNIQUE NOT NULL,
  org_id             INT NOT NULL REFERENCES organizations(id),
  description        TEXT,
  shipper            TEXT,
  origin_port        TEXT,
  destination_port   TEXT DEFAULT '基隆',
  carrier            TEXT,
  container_number   TEXT,
  bill_of_lading     TEXT,
  incoterm           TEXT CHECK (incoterm IN ('EXW','FCA','FOB','CFR','CIF','DAP','DDP')),
  freight_currency   TEXT DEFAULT 'USD',
  freight_amount     NUMERIC(14,2),
  freight_twd        NUMERIC(14,2),
  etd                DATE,                   -- estimated time of departure
  eta                DATE,                   -- estimated time of arrival
  actual_arrival     DATE,
  status             TEXT NOT NULL DEFAULT 'booking'
                     CHECK (status IN ('booking','in_transit','arrived','customs','cleared','delivered','cancelled')),
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT now()
);

-- One shipment can consolidate multiple POs (e.g. annual wine import container)
CREATE TABLE import_shipment_pos (
  shipment_id   INT NOT NULL REFERENCES import_shipments(id) ON DELETE CASCADE,
  po_id         INT NOT NULL REFERENCES purchase_orders(id),
  PRIMARY KEY (shipment_id, po_id)
);
```

#### D. Customs Declarations

```sql
CREATE TABLE customs_declarations (
  id                   BIGSERIAL PRIMARY KEY,
  declaration_number   TEXT UNIQUE,
  org_id               INT NOT NULL REFERENCES organizations(id),
  shipment_id          INT REFERENCES import_shipments(id),
  customs_broker       TEXT,
  declared_at          TIMESTAMPTZ,
  declared_currency    TEXT DEFAULT 'USD',
  declared_value_foreign NUMERIC(14,2),
  declared_value_twd   NUMERIC(14,2),
  exchange_rate        NUMERIC(12,6),
  import_duty          NUMERIC(14,2) DEFAULT 0,
  vat                  NUMERIC(14,2) DEFAULT 0,   -- 5% in TW
  port_handling        NUMERIC(14,2) DEFAULT 0,
  storage_charges      NUMERIC(14,2) DEFAULT 0,
  total_duties         NUMERIC(14,2) DEFAULT 0,   -- sum of all above charges
  status               TEXT NOT NULL DEFAULT 'filing'
                       CHECK (status IN ('filing','under_review','approved','duties_paid','cleared')),
  cleared_at           TIMESTAMPTZ,
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT now()
);

-- HS code + duty rate per SKU line
CREATE TABLE customs_declaration_lines (
  id                  BIGSERIAL PRIMARY KEY,
  declaration_id      INT NOT NULL REFERENCES customs_declarations(id) ON DELETE CASCADE,
  sku_id              INT REFERENCES skus(id),
  sku_name            TEXT NOT NULL,
  hs_code             TEXT NOT NULL,
  qty                 NUMERIC(12,2),
  unit_value_foreign  NUMERIC(14,4),
  total_value_foreign NUMERIC(14,2),
  duty_rate           NUMERIC(6,4),           -- e.g. 0.1 = 10%
  duty_amount         NUMERIC(14,2),
  notes               TEXT
);
```

#### E. Landed Cost

```sql
CREATE TABLE landed_costs (
  id                  BIGSERIAL PRIMARY KEY,
  org_id              INT NOT NULL REFERENCES organizations(id),
  shipment_id         INT REFERENCES import_shipments(id),
  declaration_id      INT REFERENCES customs_declarations(id),
  freight_twd         NUMERIC(14,2) DEFAULT 0,
  import_duty         NUMERIC(14,2) DEFAULT 0,
  vat                 NUMERIC(14,2) DEFAULT 0,
  port_handling       NUMERIC(14,2) DEFAULT 0,
  customs_broker_fee  NUMERIC(14,2) DEFAULT 0,
  storage_charges     NUMERIC(14,2) DEFAULT 0,
  other_charges       NUMERIC(14,2) DEFAULT 0,
  total_landed_cost   NUMERIC(14,2) DEFAULT 0,  -- sum of all above
  allocation_method   TEXT DEFAULT 'by_value'
                      CHECK (allocation_method IN ('by_value','by_qty','by_weight')),
  status              TEXT DEFAULT 'draft' CHECK (status IN ('draft','posted')),
  posted_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE landed_cost_lines (
  id                BIGSERIAL PRIMARY KEY,
  landed_cost_id    INT NOT NULL REFERENCES landed_costs(id) ON DELETE CASCADE,
  sku_id            INT REFERENCES skus(id),
  sku_name          TEXT NOT NULL,
  po_qty            NUMERIC(12,2),
  unit_cost_before  NUMERIC(14,4),          -- skus.unit_cost before this shipment
  freight_allocated NUMERIC(14,2) DEFAULT 0,
  duty_allocated    NUMERIC(14,2) DEFAULT 0,
  other_allocated   NUMERIC(14,2) DEFAULT 0,
  total_allocated   NUMERIC(14,2) DEFAULT 0,
  new_unit_cost     NUMERIC(14,4),          -- updated weighted-avg cost
  notes             TEXT
);
```

When landed cost is **posted**:
- Each SKU's `skus.unit_cost` updated to `new_unit_cost` via weighted average
- `finance.landed_cost.posted` event emitted → Finance handler posts journal entry (Dr Inventory / Cr Accrued Import Charges)

#### F. Supplier Payments (AP Settlement)

```sql
CREATE TABLE supplier_payments (
  id              BIGSERIAL PRIMARY KEY,
  org_id          INT NOT NULL REFERENCES organizations(id),
  ap_id           INT REFERENCES accounts_payable(id),
  po_id           INT REFERENCES purchase_orders(id),
  amount          NUMERIC(14,2) NOT NULL,
  currency        TEXT DEFAULT 'TWD',
  exchange_rate   NUMERIC(12,6) DEFAULT 1.0,
  amount_twd      NUMERIC(14,2),
  payment_method  TEXT CHECK (payment_method IN ('wire','swift','check','cash','card','line_pay')),
  bank_ref        TEXT,                       -- wire transfer reference / SWIFT message ID
  payment_date    DATE NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### 17.5 EventBus Additions

#### New catalog: `src/lib/events/catalog/import.events.js`

```js
export const IMPORT_EVENTS = {
  'import.shipment.booked': {
    domain: 'import', action: 'shipment.booked', version: 1,
    description: '進口貨物訂艙完成',
    payload: {
      shipment_id:    { type: 'string', required: true },
      shipment_number:{ type: 'string', required: true },
      origin_port:    { type: 'string', required: true },
      carrier:        { type: 'string', required: false },
      etd:            { type: 'string', required: false },
      eta:            { type: 'string', required: true },
      po_ids:         { type: 'array',  required: true },
    },
  },
  'import.shipment.departed': {
    domain: 'import', action: 'shipment.departed', version: 1,
    description: '貨物已從出口港裝船出發',
    payload: {
      shipment_id:      { type: 'string', required: true },
      shipment_number:  { type: 'string', required: true },
      actual_departure: { type: 'string', required: true },
      container_number: { type: 'string', required: false },
      bill_of_lading:   { type: 'string', required: false },
    },
  },
  'import.shipment.arrived': {
    domain: 'import', action: 'shipment.arrived', version: 1,
    description: '貨物抵達目的港',
    payload: {
      shipment_id:    { type: 'string', required: true },
      shipment_number:{ type: 'string', required: true },
      actual_arrival: { type: 'string', required: true },
      destination_port:{ type: 'string', required: true },
    },
  },
  'import.customs.filed': {
    domain: 'import', action: 'customs.filed', version: 1,
    description: '報關申報送件',
    payload: {
      declaration_id:     { type: 'string', required: true },
      declaration_number: { type: 'string', required: true },
      shipment_id:        { type: 'string', required: true },
      declared_value_twd: { type: 'number', required: true },
      total_duties:       { type: 'number', required: false },
    },
  },
  'import.customs.cleared': {
    domain: 'import', action: 'customs.cleared', version: 1,
    description: '完成清關，可提貨',
    payload: {
      declaration_id:  { type: 'string', required: true },
      shipment_id:     { type: 'string', required: true },
      total_duties:    { type: 'number', required: true },
      cleared_at:      { type: 'string', required: true },
    },
  },
  'import.landed_cost.posted': {
    domain: 'import', action: 'landed_cost.posted', version: 1,
    description: '進口附帶成本已分攤並過帳至存貨',
    payload: {
      landed_cost_id:   { type: 'string', required: true },
      total_landed_cost:{ type: 'number', required: true },
      sku_updates:      { type: 'array',  required: true },  // [{sku_id, new_unit_cost}]
    },
  },
}
```

#### Extend `src/lib/events/catalog/purchase.events.js` (new events)

| Event | Description |
|---|---|
| `purchase.rfq.sent` | RFQ 已發出給供應商 — payload: rfq_id, rfq_number, supplier_ids[], close_date |
| `purchase.rfq.received` | 供應商報價已收到 — payload: quote_id, rfq_id, supplier_id, subtotal_twd |
| `purchase.rfq.awarded` | 報價得標 → 系統自動草稿 PO — payload: quote_id, supplier_id, po_id (draft) |
| `purchase.payment.initiated` | AP 付款發起 — payload: payment_id, ap_id, amount_twd, currency |

#### Extend `src/lib/events/catalog/wms.events.js` (new events)

| Event | Description |
|---|---|
| `wms.rfid.tag_assigned` | RFID 標籤指派給批號/單品 — payload: tag_uid, sku_id, lot_id, quantity |
| `wms.rfid.scan_detected` | RFID 讀取器偵測到標籤 — payload: tag_uid, scanner_id, scan_location, scanned_at |
| `wms.rfid.inventory_counted` | RFID 大量盤點完成 — payload: scanner_id, location, tags_read[], discrepancies[] |
| `wms.lot.received` | 批號貨物入庫 (含 RFID) — payload: lot_id, sku_id, qty, location, tag_uids[] |

#### New handler: `src/lib/events/handlers/importHandlers.js`

| Trigger event | Action |
|---|---|
| `import.shipment.arrived` | Update `import_shipments.status = 'arrived'`; notify customs broker via notification |
| `import.customs.cleared` | Update shipment status to `'cleared'`; update all linked POs to `'已清關'`; emit `wms.lot.received` for each PO line |
| `import.landed_cost.posted` | Update `skus.unit_cost` (weighted avg) for each SKU in landed_cost_lines; post journal entry via Finance |

#### Extend `src/lib/events/handlers/purchaseHandlers.js`

| Trigger event | Action |
|---|---|
| `purchase.rfq.received` | Notify buyer: `${supplierName} 報價已收到，請前往比較` |
| `purchase.rfq.awarded` | Auto-create draft PO from winning `supplier_quote_lines` → emit `purchase.pr.created` (or PO draft event) |
| `purchase.payment.initiated` | Update `accounts_payable.paid_amount += amount`; if fully paid, set status = `'已付款'` |

#### Extend `src/lib/events/handlers/wmsHandlers.js`

| Trigger event | Action |
|---|---|
| `wms.rfid.tag_assigned` | Update `rfid_tags.status = 'in_stock'`, set `assigned_at` |
| `wms.rfid.inventory_counted` | Compare `tags_read[]` vs. `rfid_tags WHERE status = 'in_stock'`; flag discrepancies in notification |
| `wms.lot.received` | Create/update `inventory_lots` row; create `rfid_tags` rows if RFID enabled |

#### Register in `src/lib/events/handlers/index.js`

```js
// Add alongside existing registrations:
import { registerImportHandlers } from './importHandlers.js'
registerImportHandlers(bus)
```

#### Register import catalog in `src/lib/events/catalog/index.js`

```js
import { IMPORT_EVENTS } from './import.events.js'
export const EVENT_CATALOG = {
  ...existing,
  ...IMPORT_EVENTS,
}
```

### 17.6 System UI Pages

| Page | Route | Purpose |
|---|---|---|
| **Products (enhanced)** | `/products` | SKU master: wine attributes, barcode management (multi-barcode), RFID enable, HS code, reorder rules, primary supplier |
| **RFQ** | `/purchase/rfq` | Create RFQ → send to multiple suppliers → receive quotes → comparison table (unit price / lead time / payment terms) → award → auto-draft PO |
| **Import Shipments** | `/purchase/imports` | Timeline view per shipment: booked → departed → arrived → customs filed → cleared → delivered; ETA countdown; link to customs + POs |
| **Customs Declarations** | `/purchase/customs` | Declare per shipment: HS code per SKU line, duty rate calculator (lookup by HS), total duties, clearance status; trigger `import.customs.cleared` |
| **Landed Cost** | `/purchase/landed-cost` | Select shipment → see all cost components (freight, duty, handling, broker fee); allocate by value/qty/weight; see new unit cost per SKU; Post button → updates `skus.unit_cost` + emits finance event |
| **RFID Manager** | `/wms/rfid` | Assign tags to lots; scan log (real-time or upload from reader); bulk inventory count via RFID; status overview (in_stock / sold / lost) |
| **Supplier Payments** | `/finance/supplier-payments` | Pay against AP: select AP/PO, amount, currency, FX rate, bank ref, payment date; partial payment support; emit `purchase.payment.initiated` |

### 17.7 Product Lifecycle State Machine

```
skus status:       啟用 ──── 停用 ──── 已淘汰

rfid_tags status:  unassigned → in_stock → reserved → sold
                                   ↓                    ↓
                                 lost                returned → in_stock (if re-inspect pass)
                                   ↓                           ↓
                                damaged ────────────────── damaged

import_shipments:  booking → in_transit → arrived → customs → cleared → delivered → cancelled

customs_declarations: filing → under_review → approved → duties_paid → cleared

landed_costs:      draft → posted

accounts_payable:  未付款 → 部分付款 → 已付款
```

### 17.8 Sprint Plan (P-Series — runs in parallel with CRM sprints)

#### Sprint P0 — Schema (Days 1–5, alongside CRM Sprint 0)
**Migration file:** `supabase/migrations/[ts]_product_lifecycle_schema.sql`
```
+ sku_barcodes table (multi-barcode, indexed for POS lookup)
+ rfid_tags table (EPC, sku_id, lot_id, status)
+ rfid_scans table (scan event log)
+ skus columns: rfid_enabled, hs_code, reorder_point, reorder_qty, primary_supplier_id, lead_time_days
+ suppliers columns: organization_id (+ backfill + NOT NULL)
+ purchase_orders columns: supplier_id (FK), org_id
+ purchase_order_lines table (normalize from JSONB)
+ supplier_quote_requests + supplier_quote_request_lines tables
+ supplier_quotes + supplier_quote_lines tables
+ import_shipments + import_shipment_pos tables
+ customs_declarations + customs_declaration_lines tables
+ landed_costs + landed_cost_lines tables
+ supplier_payments table
+ RLS policies for all new tables (org_id scoped)
```

**Files:**
- `+ supabase/migrations/[ts]_product_lifecycle_schema.sql`
- `+ src/lib/events/catalog/import.events.js` — IMPORT_EVENTS catalog
- `~ src/lib/events/catalog/index.js` — register import events
- `~ src/lib/events/catalog/purchase.events.js` — add rfq.* + payment.initiated events
- `~ src/lib/events/catalog/wms.events.js` — add rfid.* + lot.received events

---

#### Sprint P1 — RFQ Flow (Week 1)
**Goal:** Buyers can send RFQ to multiple suppliers, receive quotes, compare side-by-side, award winner → auto-draft PO.

**Files:**
- `+ src/pages/purchase/RFQ.jsx` — RFQ list + create modal
- `+ src/pages/purchase/components/RFQFormModal.jsx` — line items + supplier selection (multi-select)
- `+ src/pages/purchase/components/QuoteComparisonTable.jsx` — side-by-side price/lead time/terms
- `~ src/lib/db/purchase.js` — `createRFQ()`, `sendRFQ()`, `receiveQuote()`, `awardQuote()`
- `~ src/lib/events/handlers/purchaseHandlers.js` — `onRFQReceived` notify buyer; `onRFQAwarded` create draft PO
- `~ src/modules/PurchaseModule.jsx` — add `/purchase/rfq` route

---

#### Sprint P2 — Import Shipment Tracker (Week 2)
**Goal:** Staff can track a container from booking to port arrival. Each status change triggers an event.

**Files:**
- `+ src/pages/purchase/ImportShipments.jsx` — shipment list with status timeline component
- `+ src/pages/purchase/components/ShipmentTimeline.jsx` — visual pipeline: booked → departed → arrived → customs → cleared → delivered
- `+ src/pages/purchase/components/ShipmentFormModal.jsx` — create/edit: link POs, incoterm, carrier, BOL, ETD/ETA
- `~ src/lib/db/purchase.js` — `createShipment()`, `updateShipmentStatus()`, `linkShipmentPOs()`
- `~ src/modules/PurchaseModule.jsx` — add `/purchase/imports` route

---

#### Sprint P3 — Customs + Landed Cost (Week 3)
**Goal:** Customs declaration filed from shipment; landed cost allocated across SKUs; `skus.unit_cost` updated; Finance event posted.

**Files:**
- `+ src/pages/purchase/CustomsDeclarations.jsx` — declaration form (per-SKU HS code, duty rate lookup, total calculation)
- `+ src/pages/purchase/LandedCost.jsx` — cost allocator: freight + duty + handling; allocation method toggle; SKU-level new cost preview; Post button
- `+ src/lib/events/handlers/importHandlers.js` — `onCustomsCleared`, `onLandedCostPosted`
- `~ src/lib/events/handlers/index.js` — register importHandlers
- `~ src/lib/db/purchase.js` — `createCustomsDeclaration()`, `clearCustoms()`, `createLandedCost()`, `postLandedCost()`
- `~ src/modules/PurchaseModule.jsx` — add `/purchase/customs` + `/purchase/landed-cost` routes

---

#### Sprint P4 — RFID Management (Week 4)
**Goal:** Staff assign RFID tags at goods receipt; scan log ingested; bulk inventory count via tag reader.

**Files:**
- `+ src/pages/wms/RFID.jsx` — tag list (filter by sku/status/location), bulk assign tags to lot, scan log view
- `+ src/pages/wms/components/RFIDAssignModal.jsx` — select lot → enter / scan tag UIDs
- `+ src/pages/wms/components/RFIDScanLog.jsx` — real-time or uploaded scan events
- `~ src/lib/db/wms.js` — `assignRFIDTags()`, `ingestScanBatch()`, `runRFIDInventoryCount()`
- `~ src/lib/events/handlers/wmsHandlers.js` — `onRFIDTagAssigned`, `onRFIDInventoryCounted`
- `~ src/modules/WMSModule.jsx` — add `/wms/rfid` route

---

#### Sprint P5 — Products Page Enhancement + Supplier Payments (Week 5)
**Goal:** Products page shows full attributes (wine, RFID, barcode, reorder rules); AP payment UI with FX.

**Files:**
- `~ src/pages/products/Products.jsx` (or create if not exists) — SKU list + detail drawer: wine attributes, barcode list (add/delete), RFID enable toggle, HS code, reorder config
- `+ src/pages/products/components/BarcodeManager.jsx` — add/scan barcodes, set primary, print label
- `+ src/pages/finance/SupplierPayments.jsx` — AP payment list + create: select AP, amount, FX rate, bank ref
- `~ src/lib/db/purchase.js` — `createSupplierPayment()`, `getAPBalance()`
- `~ src/lib/events/handlers/purchaseHandlers.js` — `onPaymentInitiated` → update AP.paid_amount

---

### 17.9 EventBus Flow Diagram

```
[Buyer creates RFQ]
  → purchase.rfq.sent
    → purchaseHandlers: notify suppliers (LINE/email)
      → [Supplier responds]
        → purchase.rfq.received
          → purchaseHandlers: notify buyer
            → [Buyer awards quote]
              → purchase.rfq.awarded
                → purchaseHandlers: create draft PO

[Staff books shipment]
  → import.shipment.booked
    → importHandlers: ETA reminder scheduled

[Vessel departs]
  → import.shipment.departed

[Vessel arrives]
  → import.shipment.arrived
    → importHandlers: notify customs broker

[Customs filed]
  → import.customs.filed

[Customs cleared]
  → import.customs.cleared
    → importHandlers: update PO status '已清關'
    → importHandlers: emit wms.lot.received for each PO line

[Goods received / lots in warehouse]
  → wms.lot.received
    → wmsHandlers: create inventory_lots, create rfid_tags (in_stock)
    → purchase.goods_receipt.completed (existing)
      → financeHandlers: create accounts_payable (existing)

[Landed cost posted]
  → import.landed_cost.posted
    → importHandlers: update skus.unit_cost per SKU
    → financeHandlers: post journal Dr Inventory / Cr Accrued Charges

[AP payment initiated]
  → purchase.payment.initiated
    → purchaseHandlers: update ap.paid_amount; if full → ap.status = '已付款'

[RFID tag scanned at POS]
  → wms.rfid.scan_detected
    → wmsHandlers: update rfid_tags.status = sold
    → crm.pos.transaction_completed (existing) → membership point earn
```
