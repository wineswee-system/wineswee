# Supabase 專案切換 Runbook（舊 → 新）

- **舊(廠商)** ref `mvkvnuxeamahhfahclmi` — 全程留著,穩定 1–2 天後才停(回退用)
- **新(公司)** ref `uoernfpfieurtjqwbnii`
- **切換窗**:週一 **07:00–09:00**(門市未開工、沒人打卡)
- **鐵則**:舊專案切換窗開始才「凍寫」;新專案沒驗證過**不要**停舊專案。

---

## 前置（今天 17:00 前 / 週末做完,週一才輕鬆）

- [ ] **今天 17:00 起 code / DB 凍結**:不再 push、不再跑 migration。新舊 schema 從此一致。
- [ ] 準備新專案 `service_role` key:新專案 → Settings → API → `service_role`。
      Windows PowerShell 設環境變數(切換窗全程用同一個視窗):
      ```powershell
      $env:NEW_KEY = "貼上新專案 service_role key"
      ```
- [ ] 準備新專案 `anon` key(給 cutover SQL 與 Vercel env 用)。

---

## 今天 — 完整同步一遍（預演,週末就不用碰）

> 目的:把重活(storage 全量 + 灌 DB 演練)今天做完;週末照常放假。
> 週一只剩「週末新增」的極小 delta。

1. [ ] **完整 dump→restore(預演)**:舊專案 dump → 灌進新專案。
       (照你既有冷備份流程;灌完後**跑 `standby_cron.sql` 上半段**把新專案 cron 全 `active=false`,
        避免它拿舊 URL 亂發。這份週一會被新鮮 dump 蓋掉,今天只是確認流程通。)
2. [ ] **Storage 全量同步**(這步今天做最划算,週一只補 delta):
       ```powershell
       node scripts/storage_sync.mjs
       ```
3. [ ] **驗證對齊**:
       ```powershell
       node scripts/migration_verify.mjs
       ```
       → 目標「✓ 全對齊」。有 Δ 先查清楚,今天排除掉,週一才不會卡。

> 週末:放假,不用做任何事。門市週末產生的資料,週一重灌 dump 時一次涵蓋。

---

## 週一 07:00 — 凍寫

- [ ] **07:00** 貼公告 / 開維護模式(讓舊系統唯讀或擋登入),避免切換窗內有人寫到舊。
      (若沒維護模式:靠「這時段沒人上班」也行,但風險自負。)

## 週一 07:05 — 灌新鮮 dump + storage delta

- [ ] **DB 重灌一次新鮮 dump**:07:00 凍寫後,對舊專案做最新 dump → 灌進新專案。
      一次涵蓋整個週末,不用手工挑 delta(乾淨、不出錯)。SME 資料量通常 15–30 分內。
      (灌完別忘 cron 還是 `active=false`,等 07:25 那步才開。)
- [ ] **Storage delta**(今天已全量,這裡只補週末新增,幾分鐘):
      ```powershell
      node scripts/storage_sync.mjs
      ```
- [ ] **驗證**:`node scripts/migration_verify.mjs` → 對已凍寫的舊應「✓ 全對齊」。

## 週一 07:25 — 改新專案內嵌位址 + 開 cron

- [ ] 在**新專案** SQL editor 跑 `scripts/cutover_repoint_new_project.sql`
      (先把 `v_new_url` / `v_new_anon` 填新值、`v_on_new_project` 改 `true`)。
- [ ] `standby_cron.sql` **下半段**:`UPDATE cron.job SET active = true;` → 新專案 cron 上線。
- [ ] 確認 `SELECT jobid, jobname, active FROM cron.job` 全 `t`。

## 週一 07:35 — Edge functions + secrets ✅【今天(8/7)已預先做完,週一只需抽驗】

- ✅ **26 個 edge functions 已在新專案**;7/23 後改過的 4 支(clock-in / hr-notify /
      line-webhook / send-payslips)今天已補部署成最新(含 line-webhook 附件檔名修正)。
- ✅ **Secrets 已全設好且值正確**(該讀的全在、值 = 現行舊專案,已 sha256 逐項比對)。
      ⚠️ **週一不要再跑 `secrets set`** —— `Downloads/新專案_secrets.env` 內的
      `LINE_CHANNEL_ACCESS_TOKEN_WORKFLOW` 是舊值(已註解),誤灌會蓋掉新專案上正確的 token。
- [ ] 週一抽驗即可:`npx supabase functions list --project-ref uoernfpfieurtjqwbnii`
      看 clock-in/hr-notify/line-webhook/send-payslips 的 UPDATED 是今天、其餘 ACTIVE。

## 週一 07:50 — 切前端 + 第三方指向

- [ ] **Vercel 主系統 + LIFF**:兩個專案都把這兩個 env 換成下面的值 → Redeploy。
      (domain 不變,只換這兩個 env。)
      ```
      VITE_SUPABASE_URL=https://uoernfpfieurtjqwbnii.supabase.co
      VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvZXJuZnBmaWV1cnRqcXdibmlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3Nzg0NDUsImV4cCI6MjEwMDM1NDQ0NX0.jubKj63U9L4GiosFbu0p530zepbcdVTG86XSua1SnsU
      ```
- [ ] **LINE Developers**:Messaging API **webhook URL** → `https://uoernfpfieurtjqwbnii.supabase.co/functions/v1/line-webhook`。
      (這條會變,因為 edge function 綁專案 ref;LIFF endpoint 指向 Vercel domain 不變,不用改。)
- [ ] ~~金流 / 發票 callback~~ → **系統沒接,略過。**

## 週一 08:05 — 驗證 smoke test（逐項點過）

- [ ] LIFF 開得起來、能登入(會要求重登,正常:JWT 密鑰不同)。
- [ ] **打卡**(上班/下班)成功、寫進新 DB。
- [ ] **簽核**:LIFF 收到卡片 → 核准 → chain 推進 → LINE 通知回來。
- [ ] **請假附件**:卡片看得到附件 + 檔名正確。
- [ ] **薪資**:Salary 頁試算 / 薪資條顯示正常。
- [ ] **cron**:等最近一個排程時點,確認有跑且沒重複發(舊已凍)。
- [ ] `node scripts/migration_verify.mjs` 對「已凍寫的舊」→ 應完全一致。

## 週一 08:50 — 解除維護、上線

- [ ] 關維護模式,系統正式在新專案。
- [ ] **09:00 開工。**

---

## 回退（任何一步爆掉）

還沒改 Vercel env 前:直接放棄,一切還在舊,無損。
已改 env 後要回退:Vercel env 改回舊 + Redeploy、LINE webhook 改回舊、`standby_cron` 把新 cron 關掉。舊專案資料是切換窗那一刻的(凍寫後沒再變),乾淨。

## 收尾（穩定 1–2 天後）

- [ ] 確認新專案穩定、無漏。
- [ ] 停舊專案 cron / 通知廠商 / 保留最後一份舊 dump 存檔。
- [ ] 更新 memory `project_infra_takeover_from_vendor`:已完成切換。
