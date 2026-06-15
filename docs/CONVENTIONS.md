# 工程慣例（走正路鐵律）

> 背景：本專案的基礎設施（react-query 快取層、db 層、SECURITY DEFINER RPC、結構化
> logger、`ui/*` design-system）都已蓋好，但多數舊頁面沒用到。本文件的目的**不是**要求
> 回頭重寫舊 code，而是**從現在起、新增或大改的程式碼一律走正路**，止住兩套寫法並行擴大。
> 「碰到舊的就順手換」歡迎，但非強制。

---

## 1. 資料讀取 — 走 db 層 + react-query，不在頁面裸連 supabase

- ❌ 不要：頁面裡 `useEffect(() => { supabase.from('x').select('*').then(setState) }, [])`
- ✅ 要：查詢收斂到 `src/lib/db/<domain>.js` 的 named function → 頁面用 `src/lib/hooks/useDbQuery.js`（react-query）取用。

**為什麼**：跨頁快取（切頁不重抓）、載入/錯誤/重試/失效自動一致、schema 變動時只改 db 層一處（避免「改欄位要 grep 全部頁面」的 drift 慘案）、多租戶 `organization_id` 過濾集中在 db 層（漏一個就跨租戶外洩）。

## 2. 金錢 / 簽核 / 狀態推進的「寫入」— 一律走 RPC

- ❌ 不要：前端 `supabase.from('expense_requests').update({ status })`、前端自己算薪資/加班費。
- ✅ 要：走 `supabase.rpc('...')`（SECURITY DEFINER）。寫入的權限檢查、業務規則、稽核、狀態機都在 DB 內完成。

**為什麼**：前端可被竄改；業務規則散在前端會多端 drift；RLS silent skip / service_role 被擋等慘案的根因就是邏輯沒集中在 RPC。LIFF 已全面改走 RPC，主系統前端逐步跟上。**純讀取的列表/報表**可以直接 `from()`（搭配第 1 點）。

## 3. 薪資 / 勞健保 / 稅務 / 加班倍率 — DB 是唯一真相源

- ❌ 不要：在前端 JS 算 net salary、把級距/費率/稅表/倍率 hardcode 在 `.js` 或 migration 邏輯裡。
- ✅ 要：計算走 DB（`generate_payroll` 等）；前端「試算預覽」呼叫同一個 RPC 的 dry-run，而非自己重算；級距/費率放 DB table，年度更新只改資料、不 deploy。

**為什麼**：試算（前端）與入帳（DB）兩套邏輯必然 drift → 員工看到的數字 ≠ 實領，這是會出錢的事。

## 4. 錯誤處理 — 用 logger，不要 console

- ❌ 不要：`console.error(err)` 然後靜默 `setState([])`。
- ✅ 要：`import { logger } from '@/lib/logger'` → `logger.error(...)`；使用者面向的錯誤交給 react-query 的 `isError`/`refetch` 或頁級錯誤 UI。金錢/簽核路徑的 catch 一定要上報。

## 5. UI — 用 `src/components/ui/*` design-system

- ❌ 不要：手刻 `className="btn btn-primary"`、手刻 table、每頁重刻 loading/empty/error。
- ✅ 要：`<Button>`、`<DataTable>`、`<EmptyState>`、`<PageHeader>` 等既有元件。inline style 只留給「真正動態的值」（如 `width: ${pct}%`）；版面用 utility class / 共用元件。
- 顏色一律 `var(--accent-*)` token（見 CLAUDE.md），不寫死 hex / 不用 Tailwind palette 工具類。

## 6. 共用元件 — 補型別註記

- `src/components/` 與 `ui/*` 這種「被很多人 import」的共用元件，至少補 `PropTypes` 或檔頭 `// @ts-check` + JSDoc `@param`。被很多人用的東西改 prop 沒型別保護 = 隱性破壞。

## 7. 超大檔案 — 拆

- 新頁面目標單檔 < 500 行。超過就用「`pages/<x>/components/` 子目錄」拆 tab / section（`Schedule.jsx` 已示範）。30+ 個 useState 的元件無法 review 也難測。

## 8. 資料庫遷移 — 防 drift

- 高風險函式（`generate_payroll`、簽核鏈 `resolve_*` / `liff_*_approval`）**禁止整支 `CREATE OR REPLACE` 重 paste**——容易漏 case 洗掉既有邏輯（已多次出事）。改用「主體 + incremental `ALTER` / 新增 `IF` 分支」。
- migration 一律寫成 idempotent（Studio SQL editor 不 rollback 部分 commit）。
- 老闆 / 任何人在 Studio 直接 hotfix 後，**要回填成 migration**；定期 `npm run db:drift`（見 `scripts/`）抓 live DB 與 migration 的落差。

---

## 自動把關（CI / ESLint）

- `.github/workflows/ci.yml`：PR/push main 自動跑 `vitest` + `build`，壞了擋合併。
- `eslint.config.js`：`no-console`、`no-unused-vars` 目前是 `warn`（既有違規多，先可見不擋）。新 code 請保持零 warn；待舊 code 逐步修綠後會把關鍵規則升為 `error` 並納入 CI gate。
- 跑 `npm run lint` 自檢。
