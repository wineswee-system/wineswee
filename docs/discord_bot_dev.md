# Discord Bot 整合 — 開發 / 部署指南

雙向 Discord Bot：員工在 Discord 用 slash commands 查詢 ERP（班表、假期餘額、營運 KPI）。
採用 **Interactions Endpoint（HTTP webhook）** 模式 — 不需要常駐 gateway process，
Discord 直接把 interaction POST 到 Supabase Edge Function。

## 相關檔案

| 檔案 | 用途 |
|------|------|
| `supabase/migrations/20260702700000_discord_integration.sql` | `discord_account_links`、`discord_link_codes` 資料表 + RPC `generate_discord_link_code()` + RLS |
| `supabase/functions/discord-bot/index.ts` | Interactions endpoint（Ed25519 驗簽 + 4 個指令 handler） |
| `scripts/register-discord-commands.mjs` | 向 Discord REST API 註冊 slash commands |

## 一、建立 Discord Application

1. 到 [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. **General Information** 頁記下：
   - `APPLICATION ID` → 之後的 `DISCORD_APP_ID`
   - `PUBLIC KEY` → 之後的 `DISCORD_PUBLIC_KEY`
3. **Bot** 頁 → **Reset Token** 取得 → 之後的 `DISCORD_BOT_TOKEN`（只顯示一次，妥善保存）
4. **Installation** 頁產生邀請連結（scope 勾 `applications.commands` + `bot`），把 Bot 加進公司的 Discord 伺服器

## 二、部署 Edge Function

```bash
# 1. 設定 secret（驗簽用的 public key）
supabase secrets set DISCORD_PUBLIC_KEY=<PUBLIC_KEY>

# 2. 套用 migration（建表 + RPC）
supabase db push

# 3. 部署 function
#    --no-verify-jwt 必要：Discord 呼叫時不會帶 Supabase JWT，
#    安全性由 Ed25519 簽章驗證取代（同 line-webhook 的公開 endpoint 模式）
supabase functions deploy discord-bot --no-verify-jwt
```

部署後 endpoint URL 為：

```
https://<PROJECT_REF>.supabase.co/functions/v1/discord-bot
```

## 三、設定 Interactions Endpoint URL

回到 Discord Developer Portal → **General Information** → **Interactions Endpoint URL**
填入上面的 URL 後按 Save。Discord 會立刻送一個 PING（type 1）驗證：

- function 回 `{"type":1}` → 儲存成功
- 失敗 → 檢查 `DISCORD_PUBLIC_KEY` 是否設對、function 是否用 `--no-verify-jwt` 部署

## 四、註冊 Slash Commands

```bash
# macOS / Linux
DISCORD_APP_ID=<APP_ID> DISCORD_BOT_TOKEN=<BOT_TOKEN> node scripts/register-discord-commands.mjs

# Windows PowerShell
$env:DISCORD_APP_ID='<APP_ID>'; $env:DISCORD_BOT_TOKEN='<BOT_TOKEN>'; node scripts/register-discord-commands.mjs
```

全域指令最多需 1 小時生效（通常幾分鐘內）。

## 五、員工綁定流程

1. 員工登入 ERP，呼叫 RPC 產生綁定碼（**UI 按鈕為後續任務**，目前可從瀏覽器 console 執行，
   或由管理員代為產生後轉交）：

   ```js
   const { data: code } = await supabase.rpc('generate_discord_link_code')
   // 例如 "A7F3K9Q2"，15 分鐘有效、一次性
   ```

2. 員工在 Discord 輸入：

   ```
   /link code:A7F3K9Q2
   ```

3. Bot 回覆「✅ 綁定成功！」後即可使用其他指令。重新執行 `/link` 會自動換綁（舊綁定刪除）。

## 指令一覽

| 指令 | 說明 | 權限 | 資料來源 |
|------|------|------|----------|
| `/link code:<8碼>` | 綁定 ERP 員工帳號 | 所有人 | `discord_link_codes` → `discord_account_links` |
| `/schedule` | 未來 7 天班表（含班別時間） | 已綁定員工 | `schedules` + `shift_definitions` |
| `/leave` | 今年假期餘額（特休/病假/事假…） | 已綁定員工 | `leave_balances` |
| `/kpi` | 今日營業額 + 交易筆數 | `admin` / `super_admin` / `manager` | `pos_transactions`（僅所屬組織門市） |

未識別指令會回覆指令清單。**所有回覆皆為 ephemeral（flag 64）**，只有發指令的人看得到。

## 需要設定的 Secrets / 環境變數

| 名稱 | 放哪裡 | 用途 |
|------|--------|------|
| `DISCORD_PUBLIC_KEY` | `supabase secrets set` | Edge function 驗證 Discord Ed25519 簽章 |
| `DISCORD_APP_ID` | 本機 shell（跑註冊 script 時） | Discord REST API 路徑 |
| `DISCORD_BOT_TOKEN` | 本機 shell（跑註冊 script 時） | Discord REST API 授權 |

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 為 Supabase Edge Runtime 內建，不需另外設定。

## 安全性設計

- **Ed25519 驗簽**：每個 request 都用 `X-Signature-Ed25519` + `X-Signature-Timestamp` 對 raw body
  驗證（`crypto.subtle.verify('Ed25519', ...)`），失敗一律 401。這是 endpoint 公開
  （`--no-verify-jwt`）的前提，等同 line-webhook 的 HMAC 驗簽角色。
- **Ephemeral 回覆**：所有內容（班表、假期、營收）都只有本人看得到，不會洩漏到頻道。
- **Service-role 只活在 edge function 內**：service key 不出函式；`discord_account_links` 的
  INSERT/UPDATE 只有 service_role 能做，authenticated 只能 SELECT/DELETE 自己的綁定
  （或同組織 admin）。`discord_link_codes` 對 authenticated 完全不開 policy。
- **綁定碼**：8 碼隨機、15 分鐘過期、一次性；重新產生會作廢舊碼。
- **Org scoping**：`/kpi` 只彙總「該員工所屬組織的門市」的交易；`/schedule`、`/leave`
  只查綁定者本人的資料。錯誤回覆不含內部細節（細節只進 `console.error` → function logs）。

## 已知假設 / 後續任務

- `schedules` 表以員工「姓名」為主要 key（同 `src/lib/db/attendance.js getEmployeeShiftForDate`），
  `employee_id` 為後補欄位 — bot 兩者都比對。若未來全面改用 `employee_id`，可簡化查詢。
- `/kpi` 只統計 `status = '完成'` 且 `store_id` 已回填的交易（legacy 純文字 `store` 欄的舊資料不計入）。
- ERP 內「產生 Discord 綁定碼」的 UI 按鈕為後續任務（目前用 console / 管理員代發）。
