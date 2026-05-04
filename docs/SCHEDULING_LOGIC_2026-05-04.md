# 排班系統邏輯總覽 — 2026-05-04

> 月視圖 vs Cycle 視圖、演算法怎麼決定 cap、個人 cap 怎麼套。

---

## 1. 兩種視圖差在「看到什麼」，演算法**幾乎一樣**

| 維度 | 📅 月視圖 | 🔄 Cycle 視圖 |
|---|---|---|
| Grid 顯示天數 | 30/31 天 | 28 天（剛好一個 cycle，2/8週變形則為 14/56 天） |
| 月份選擇器 | 顯示 | 隱藏（用 cycle 上下鍵切換） |
| 上下切換按鈕 | ◀ 月 ▶ | ◀ Cycle ▶ |
| `activeDates` | 該月所有日期 | 該 cycle 所有日期 |
| Schedules 從 DB 撈的範圍 | activeStart~activeEnd | 同左（cycle 範圍） |
| AnalyticsTab 計算範圍 | 該月 | 該 cycle |
| Cycle 進度卡 | **不出現** | **出現**（顯示每人 hours / cap） |

**結論**：兩種視圖唯一差別 = **看哪段日期**。底層資料、演算法、cap 邏輯**完全一樣**。

---

## 2. 演算法吃什麼

`runProgrammaticSchedule(weekData)` 對每週決定：
- 哪天上班、哪天休
- 上什麼班別

`runMonthlyProgrammaticSchedule(monthDates)` 把整段日期切成週，迭代每週呼叫上面那個。

關鍵變數：
```
storeSettings.work_hour_system    = '標準工時' | '2週/4週/8週變形'
storeSettings.variable_period_start = anchor date (DATE)
employees.personal_hour_cap       = 個人時數上限 (NULL=用店面預設)
storeSettings.ft_monthly_hours_max = 全職店面預設 max（如 175）
storeSettings.pt_monthly_hours_max = 兼職店面預設 max（如 175）
```

---

## 3. 演算法怎麼算「上限 / 累積」

### A. 標準工時（store_settings.work_hour_system='標準工時'）

- 每週 cap = 40h
- 月累計 cap = `min(personal_hour_cap, ft/pt_monthly_hours_max)`
- 逐週 reset 是「按月 reset」（從 month 的第 1 週開始累積到月底）

### B. 變形工時（'2週/4週/8週變形' + 有 anchor）→ Cycle-aware

- 演算法**自動偵測**並切換到 cycle-aware 模式
- 切 cycle 邊界時：`monthHours[emp] = 0`、`monthRestDays[emp] = 0` 重置
- `weeksRemaining` 改成「**本 cycle 還剩幾週**」（不是該月剩幾週）
- 每 cycle 的 cap：
  - 法定上限：2週 84h / 4週 168h / 8週 320h
  - 店面預設：`ft/pt_monthly_hours_max`（你 store_settings 設定的，預設 175）
  - 個人 cap：`employees.personal_hour_cap`
  - **實際使用的 cap = `min(法定上限, 店面預設, 個人 cap)`**

#### 跨 cycle 範例（4週變形, anchor=2026-05-01）

| 週 | 日期 | Cycle | hoursAccumulated | weeksRemaining (cycle內) |
|---|---|---|---|---|
| 1 | 5/1~5/3 | #1 | 0 | 3 |
| 2 | 5/4~5/10 | #1 | 累積 W1 | 2 |
| 3 | 5/11~5/17 | #1 | 累積 W1+W2 | 1 |
| 4 | 5/18~5/24 | #1 | 累積 W1+W2+W3 | 0 |
| 5 | 5/25~5/28 | #1 (尾) | 累積 W1~W4 | 0 |
| 6 | 5/29~5/31 | **#2 起** | **重置=0** | 3 |

→ 即使「在月視圖看 5 月」，內部跑的時候 5/29 開始的週會重置時數，**不會把 cycle #1 的 168h 加到 cycle #2 上**。

---

## 4. 個人 cap (`personal_hour_cap`) 怎麼套

| 情境 | 結果 |
|---|---|
| 沒設個人 cap (NULL) | 用 ft/pt_monthly_hours_max |
| 設了個人 cap = 80 | `cap = min(80, 法定上限, 店面預設)` |
| 個人 cap > 法定上限 | 自動降到法定上限（不會違法） |

UI：排班 → 排班偏好 tab → 每人那行的 `cap [-] h/cycle` 欄位

---

## 5. 「目標時數」 vs 「上限」

兩個概念不要搞混：

| 名稱 | 欄位 | 用途 |
|---|---|---|
| 個人**目標**時數 | `employees.weekly_target_hours` (h/週) | 演算法「希望排到」的目標（軟性，可超可不到） |
| 個人**上限** | `employees.personal_hour_cap` (h/cycle) | 演算法「絕對不能超」的硬上限（硬性） |
| 店面預設**最大** | `store_settings.ft/pt_monthly_hours_max` | 沒設個人 cap 時的 fallback 上限 |
| 店面預設**最小** | `store_settings.ft/pt_monthly_hours_min` | 演算法分配時的下限參考 |

---

## 6. 報表（AnalyticsTab）

- 「總排班時數 / 人均時數 / 預估成本」→ 看當下視圖範圍（月 or cycle）
- 「📐 本 Cycle 進度」卡片 → 只在**變形工時 + 有 anchor** 時出現
  - 顯示每人「已排時數 / 個人 cap」+ 進度條 + 紅黃綠燈

---

## 7. 流程建議（之前討論過的）

| 動作 | 用什麼視圖 |
|---|---|
| 編排班 | 🔄 Cycle |
| 看每人累計 | 🔄 Cycle |
| 老闆看月損益 | 📅 月 |
| 薪資結算 | 📅 月（另一張報表） |
| 員工自己看「我這月排幾班」 | 📅 月 |

---

## 8. 已知限制 / 之後要做

- **Phase 9 cleanup**：`stores.working_hour_type` / `stores.variable_period_start` 兩個欄位 deprecated 沒清掉（功能不影響）
- **演算法目前還是把整個 monthDates 當輸入**，沒讓 cycle view 直接送 cycleDates。但因為 cycle-aware 偵測會自動切，結果一樣。如果之後要「明確按 cycle 排」(不要被月份框架影響)，可以改成讓 viewMode='cycle' 時 entry 直接吃 cycleDates。
- **2/8週變形跨年**：現在沒測過，理論上 anchor 不變只要按 cycle 算，但要驗證 cycleIndex 不會出怪數字
