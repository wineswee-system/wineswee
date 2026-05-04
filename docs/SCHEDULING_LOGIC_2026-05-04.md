# 排班系統完整邏輯 — 2026-05-04

> 從輸入資料 → 每週決策步驟 → 評分機制 → 法定驗證 → cycle 累積。
> 程式入口：`src/lib/schedulingAlgo/core.js`。

---

## 目錄

1. [入口函式 & 資料流](#1-入口函式--資料流)
2. [輸入資料結構](#2-輸入資料結構)
3. [Cycle-aware 模式偵測](#3-cycle-aware-模式偵測)
4. [每週演算法 11 步](#4-每週演算法-11-步)
5. [兩種派班模式](#5-兩種派班模式)
6. [Scoring 計分公式](#6-scoring-計分公式)
7. [法定驗證 (validation.js)](#7-法定驗證-validationjs)
8. [Cap / 目標時數 / 個人 cap 三層](#8-cap--目標時數--個人-cap-三層)
9. [跨店借調 (cross-store)](#9-跨店借調-cross-store)
10. [月視圖 vs Cycle 視圖差異](#10-月視圖-vs-cycle-視圖差異)
11. [已知限制](#11-已知限制)

---

## 1. 入口函式 & 資料流

```
UI (Schedule.jsx)
   │
   ▼
runMonthlyProgrammaticSchedule(data)        ← core.js:936
   │  把 monthDates split 成 weeks
   │  偵測 cycle-aware mode (work_hour_system + anchor)
   │  for 每週: 決定 cycleIndex、必要時 reset 累積
   ▼
runProgrammaticSchedule(weekData)           ← core.js:10
   │  傳 weekDates + monthlyContext (累積/剩週)
   │  跑 Step 1~4
   ▼
returns { assignments, violations, stats, ... }
```

`runProgrammaticSchedule` 是**核心**，每次處理 1 週（7 天）。
`runMonthlyProgrammaticSchedule` 是**外殼**，把整月切週迴圈呼叫核心，並維護跨週的累積狀態。

---

## 2. 輸入資料結構

```js
data = {
  employees,            // 在職員工 [{ id, name, employment_type, can_open, can_close,
                        //   schedule_priority, weekly_target_hours, personal_hour_cap,
                        //   additional_stores, ... }]
  shiftDefs,            // 班別定義 [{ name, start_time, end_time, break_minutes,
                        //   employee_type, day_type, sort_order }]
  staffingRules,        // 班別人力需求 [{ shift_name, required_count }]
  timeSlots,            // 時段人力需求 [{ start_time, end_time, day_type,
                        //   required_count, max_count }] — 有就走時段覆蓋制
  weekDates,            // 本週 7 天日期
  existingSchedules,    // 已存在的排班（不會被覆蓋）
  offRequests,          // 員工請休 [{ employee, date }]
  preferences,          // [{ employee, preferred_shifts:[], avoid_shifts:[],
                        //   neutral_shifts:[] }]
  availability,         // [{ employee, day_of_week, start_time, end_time }]
  fatigueScores,        // 月累計辛苦度 [{ employee, total_score }]
  holidays,             // 國定假日 ['YYYY-MM-DD', ...]
  storeSettings,        // { work_hour_system, variable_period_start,
                        //   ft/pt_monthly_hours_min/max, ft/pt_monthly_rest_days,
                        //   minStaff, minStaffWeekend, operating_hours,
                        //   default_hourly_rate, weekly_budget }
  monthlyContext,       // { hoursAccumulated:{emp:hours},
                        //   restDaysUsed:{emp:days}, weeksRemaining }
  previousWeek,         // 上週的 assignments（檢查 11h 間隔用）
  allStoreEmployees,    // 全部店的員工（給跨店借調用）
}
```

---

## 3. Cycle-aware 模式偵測

`runMonthlyProgrammaticSchedule`（core.js:936）：

```js
const ws = data.storeSettings?.work_hour_system || '標準工時'
const anchor = data.storeSettings?.variable_period_start || null
const isCycleMode = ws !== '標準工時' && !!anchor

// 每週對應 cycleIndex
weekCycleIdx = weeks.map(w => isCycleMode
  ? getCycleFor(w[0], ws, anchor).cycleIndex
  : 0
)

for (i in weeks) {
  // 跨 cycle 邊界 → reset 累積
  if (i > 0 && weekCycleIdx[i] !== weekCycleIdx[i-1]) {
    monthHours[emp] = 0
    monthRestDays[emp] = 0
  }

  monthlyContext = {
    hoursAccumulated: monthHours,
    restDaysUsed: monthRestDays,
    weeksRemaining: isCycleMode
      ? 本 cycle 內還剩幾週
      : 該月還剩幾週,
  }
  result = runProgrammaticSchedule(weekData)
  // 累加本週 hours / rest 到 monthHours / monthRestDays
}
```

**結論**：演算法核心 (`runProgrammaticSchedule`) 完全不知道 cycle 概念，
是外殼幫忙把累積在 cycle 邊界 reset、把 weeksRemaining 算對。

---

## 4. 每週演算法 11 步

### Step 0 — 載入 existing schedules（不覆蓋）

```js
for (const s of existingSchedules) {
  if (schedule[s.employee]?.[s.date] !== undefined) {
    schedule[s.employee][s.date] = s.shift
  }
}
```

### Step 1 — Mark rest days（休假日標記）

**1a. 員工請休 (offRequests)** → 加入 `restDayPlan[emp]`

**1b. 可用時段限制** → 員工該 dow 沒設 availability → 標休

**1c. 最低人力檢查** → 該日工作人數 < `minWorkersPerDay[date]`：
   - 移除請休的休（兼職優先、低 priority 優先）
   - 補回工作人數

**1d. 主動分配休假**（達月休目標）：
```js
getMonthRestRemaining(emp) =
  全職: ceil((target - prev) / weeksLeft) - thisWeekUsed
  兼職: target - prev - thisWeek
```
按需求最低的日期優先給休（避免衝擊低人力日）。

**1e. 全職額外休**：員工數 > 該週最大人力需求 → 給全職更多休（兼職不動，因為兼職已用 personal cap 控制）。

**1f. 寫入 schedule**：`restDayPlan[emp]` 的日期 → `schedule[emp][date] = '休'`

### Step 2 — Sort shifts by start time

`sortedShifts = shiftDefs.sort((a, b) => parseTime(a.start_time) - parseTime(b.start_time))`

### Step 3 — 派班（依模式分流）

→ 走「[時段覆蓋制](#mode-a-時段覆蓋制)」或「[班別制](#mode-b-班別制兩-pass)」，看下節。

### Step 3a — Hybrid 彈性補班

```js
// 計算每小時的覆蓋人力
hourlyCoverage[h] = 該小時有幾個人在班

// 找 gaps（覆蓋 < minStaff 的小時）
gaps = hours where coverage < minStaff

// 把連續 gaps 合併成 windows
// 嘗試指派員工填這些 windows
// 計分：時數接近目標 +20、低疲勞 +0、合適類型(全職長班/兼職短班) +10
```

### Step 3b — Post-assignment fixes

開店/關店人員若不在該班次 → 找休的員工**換班**進來補。

### Step 3c — Cross-store borrowing（跨店借調）

```js
for (date in weekDates) {
  for (sd in 班別) {
    缺額 = required - 現有
    if (缺額 == 0) continue

    // 找 additional_stores 包含本店、本週尚未排班的員工
    borrowable = allStoreEmployees.filter(emp => {
      不是本店 && additional_stores 包含本店 && 本日未排班
    })

    for (emp in borrowable) {
      if (法定有效 && 週時數+本班 <= 48 && 月時數+本班 <= 月上限) {
        指派
        標記 is_cross_store: true
      }
    }
  }
}
```

### Step 3b（再）— Fill unassigned FT cells

全職還有空格 → 從 `eligible` 班別（符合員工類型 + 日子類型 + 時數限制）挑第一個塞。

### Step 4 — Build assignments + Validate

```js
for (emp in employees) {
  for (date in weekDates) {
    assignments.push({ employee, date, shift, actual_start, actual_end, actual_hours })
  }
}

violations = validateResult(assignments, data)
stats = computeStats(...)
```

---

## 5. 兩種派班模式

### Mode A：時段覆蓋制 (`useTimeSlotMode = timeSlots.length > 0`)

對每個工作日：

**Phase 1 — 開店人員**（無 opener 時）
```js
candidates = sortByNeed(可用 + can_open=true)
for emp in candidates:
  grossH = 兼職: min(6, maxGrossH); 全職: calcFTGross(emp)
  window = tryShift(emp, storeOpenH, grossH)
  if (window && coverage_score > -50) { 指派; break }
```

**Phase 2 — 關店人員**（無 closer 時）
同上，從 `effectiveCloseH - grossH` 起算。

**Phase 3 — 補滿覆蓋**
```js
for emp in unassigned (sortByNeed):
  if 全職 && 週時數 >= max → skip
  if 兼職:
    if 所有時段都已 max → 給「休」
    if 月時數已達 min && 所有時段都已 min → 給「休」

  // 嘗試多種班長
  ftGross = [calcFTGross, -1, 9]
  ptGross = [ideal, ideal-1, ideal-2, ideal-3]

  for grossH in durations:
    for h in storeOpen ~ storeClose-grossH:
      window = tryShift(emp, h, grossH)
      score = scoreCoverage + alignment + opener/closer + 時數 + fatigue
      if score > best: best = window

  if best > -50: 指派 best
  else: 兼職給「休」、全職留空（之後 Step 3b 再補）
```

`tryShift` 做這些檢查：
- 起迄落在營業時間內
- grossH ≤ `wsConstraints.dailyAbsoluteMax` (12h for variable)
- 加上後週時數不超 `hoursRange[emp].max + 2`
- can_open / can_close 限制
- 上一日結束到今日開始間隔 ≥ `MIN_SHIFT_INTERVAL` (11h 法定)

### Mode B：班別制（兩 Pass）

**Pass 1 — 偏好優先**
```js
for emp in toAssign:
  if pref.preferred 包含 X 班 && shift 可用：
    wantMap[X 班].push({ emp, priority, fatigue })

for shift in wantMap:
  needed = staffingMap[shift] - 已指派
  candidates.sort((a,b) => priority asc, fatigue asc)
  指派 needed 人到 shift
```

**Pass 2 — 中性 / 補位**
```js
for emp in remaining:
  for shift in sortedShifts:
    if pref.avoid → skip
    score = 0
    if 已滿: monthRest 用完 → -30; 否則 skip
    else: score += 40 + (needed - current) * 10
    score -= current * 3                     // 已多人扣分
    if pref.preferred → +20; neutral → +8
    if monthRest 用完 → +60                  // 強迫繼續排班
    if 加班後 <= target → +15
    elif <= target+4 → +5
    else → -10
    if fatigue > 15 → score -= fatiguePoints * 3
    if 假日 || 週末:
      score -= fatigue * 0.5
      if 連續週末 >= 2 → -40
      elif >= 1 → -15

  挑最高 score 的 shift 指派
```

---

## 6. Scoring 計分公式（時段覆蓋制詳細）

`scoreCoverage(window)`：對每個 timeSlot 檢查 overlap：
- 已達 max → return -999
- 未達 required → +40 (+30 if 0 covered)
- 已達 required → +3 each

加成：
- 對齊未補位的 slot 起始 (h ≈ uncovStart) → +25
- 是當日 opener (h == storeOpen) → +50
- 是當日 closer (h+grossH == storeClose) → +50
- 加班後落在 [min, max] → +15
- 加班後 < min → +3
- 加班後 > max → -20
- 全職 && < min → 加 (netH - 8) * 8（鼓勵長班）
- fatigue > 15 → -fatigue * 0.3

---

## 7. 法定驗證 (`validation.js`)

每次 `isLegallyValid` / `validateResult` 檢查：

| Code | 規則 |
|---|---|
| L1 | 連續工作 ≤ 6 天 |
| L2 | 兩班間隔 ≥ 11 小時（MIN_SHIFT_INTERVAL） |
| L3 | 單日工時 ≤ `dailyAbsoluteMax` (12h for variable, 8h for standard) |
| L4 | 週工時 ≤ `weeklyMax` (40h standard, 隨變形變大) |
| L5 | 例假（每 7 天 ≥ 1 例） |
| L6 | 月加班 ≤ MONTHLY_OVERTIME_CAP (46h) |
| L7 | 變形週期內總工時 ≤ `periodTotalHours` (84/160/320) |
| L8 | 變形週期內休假天數 ≥ `periodRestDays` (4/8/16) |
| S1, S10 | 班別 / 時段未覆蓋 (warning) |
| S8 | 缺開店/關店人員 (warning) |

`severity` 分 `error` / `warning`：
- error → publishChecklist `無違規` fail
- warning → 影響特定 check (S1/S8/S10)

---

## 8. Cap / 目標時數 / 個人 cap 三層

```
法定上限 (dailyAbsoluteMax / periodTotalHours)
    ↓
店面預設 (ft/pt_monthly_hours_max)
    ↓
個人 cap (employees.personal_hour_cap)
    ↓
實際使用 = min(法定, 店面預設, 個人 cap)
```

寫成程式：
```js
const monthMax = emp.personal_hour_cap != null
  ? Math.min(emp.personal_hour_cap, isPT ? PT_MAX : FT_MAX)
  : (isPT ? PT_MAX : FT_MAX)
```

下限只有 1 個來源：`store_settings.ft/pt_monthly_hours_min`（沒個人下限）。

每週 target:
```js
remainTarget = max(0, monthMin - accumulated)
remainMax = max(0, monthMax - accumulated)
targetHoursMap[emp] = round(remainTarget / weeksLeft)
hoursRange[emp] = { min: 0, max: round(remainMax / weeksLeft) + 8 }
```

兼職的月休目標:
```js
weeklyH = emp.weekly_target_hours || 20
workDaysPerMonth = ceil(weeklyH / 6) * 4.3
restTarget = min(pt_monthly_rest_days, max(8, 30 - workDays))
```

---

## 9. 跨店借調 (cross-store)

員工的 `additional_stores` 欄位（int 陣列）標記能去哪些店支援。

排班時若本店某班缺人：
1. 找 `additional_stores` 包含本店、本週尚未在他店排班的員工
2. 跑 `isLegallyValid` 檢查
3. 檢查週 / 月時數限制
4. 指派並標 `is_cross_store: true`、記 `home_store`

---

## 10. 月視圖 vs Cycle 視圖差異

| 維度 | 📅 月視圖 | 🔄 Cycle 視圖 |
|---|---|---|
| `monthDates` 傳入演算法的範圍 | 整月（30/31 天） | 整 cycle（28 天等） |
| weeks 切割數量 | 4-5 週 | 4 週（一致） |
| 跨 cycle reset 行為 | **可能跨 cycle**（演算法處理） | 不會跨（範圍剛好一個 cycle） |
| Schedules DB 撈的範圍 | 月份範圍 | cycle 範圍 |
| AnalyticsTab 計算 | 全月 | 該 cycle |
| Cycle 進度卡顯示 | 否 | 是 |

**底層演算法完全相同**，只是吃的 `monthDates` 不一樣。

---

## 11. 已知限制 / 未做

1. **`monthHours` 命名未改** — 變形模式下實際是 cycleHours，但變數名沒重命名
2. **`monthlyContext` API 沿用** — 跟 cycle 概念混用，新人讀程式可能誤會
3. **2/8 週變形跨年沒測過** — anchor 跨年時 cycleIndex 會是大數字（無功能影響）
4. **AI 排班** (`schedulingAi.js`) 使用同一個 `runProgrammaticSchedule` 但 prompt 帶 LLM 修正，沒文件化
5. **報表只有 cycle 視圖才有 Cycle 進度卡** — 月視圖看不到，但月跨 cycle 時可能想看
6. **stores 表的 `working_hour_type` / `variable_period_start` 已 deprecated** 但未清掉
7. **沒測 Cycle Mode 開機檢查**（store_settings 缺欄位的 fallback）

---

**程式檔案對照**：

| 檔案 | 角色 |
|---|---|
| `src/lib/schedulingAlgo/core.js` | 主演算法（`runProgrammaticSchedule`, `runMonthlyProgrammaticSchedule`） |
| `src/lib/schedulingAlgo/scoring.js` | 疲勞點數 (`getFatiguePoints`) |
| `src/lib/schedulingAlgo/validation.js` | 法定驗證 + 違規檢測 |
| `src/lib/schedulingAlgo/stats.js` | 統計輸出 |
| `src/lib/schedulingAlgo/history.js` | 歷史排班載入 |
| `src/lib/scheduleUtils.js` | 工具：`getCycleFor`, `listCyclesInRange`, `getWorkSystemConstraints` |
| `src/lib/schedulingAi.js` | LLM 增強層（包覆 programmatic） |
| `src/pages/hr/Schedule.jsx` | UI 入口 |
| `src/pages/hr/components/StoreSettingsTab.jsx` | 店面排班設定（含變形工時 + anchor） |
| `src/pages/hr/components/PreferencesTab.jsx` | 員工偏好 + 個人 cap |
| `src/pages/hr/components/MonthScheduleTable.jsx` | 班表 grid 渲染 |
| `src/pages/hr/components/AnalyticsTab.jsx` | 報表（含 Cycle 進度卡） |
