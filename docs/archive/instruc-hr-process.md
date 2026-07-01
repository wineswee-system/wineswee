# 人資 (HR) ＆ 流程 (Process) 模組使用手冊

本手冊涵蓋 SME Ops 系統中 **人資模組** 與 **流程模組** 的功能總覽、設定步驟與實際使用情境。
適用對象：店長、HR 行政、財務、專案負責人、第一線員工。

> 📸 **截圖標示說明**：本手冊每個關鍵畫面都附「截圖佔位區」，並用 🔴 / 🟡 / 🟢 標註應該圈選的重點。
> - 🔴 **必看**：第一眼要看到的主要按鈕或欄位
> - 🟡 **次要**：影響操作的輔助選項
> - 🟢 **狀態**：操作完成後系統會更新的位置

---

## 目錄

- [Part A — 人資模組 (人資 / HR)](#part-a--人資模組)
  - [A1. 出勤管理](#a1-出勤管理)
  - [A2. 請假與排班](#a2-請假與排班)
  - [A3. 薪酬與績效](#a3-薪酬與績效)
  - [A4. 人才發展](#a4-人才發展)
  - [A5. 人才分析 (AI)](#a5-人才分析-ai)
  - [A6. 行政庶務](#a6-行政庶務)
- [Part B — 流程模組 (流程 / Process)](#part-b--流程模組)
  - [B1. 流程總覽](#b1-流程總覽)
  - [B2. 專案管理](#b2-專案管理)
  - [B3. 流程 (SOP) 管理](#b3-流程-sop-管理)
  - [B4. AI 設定專案](#b4-ai-設定專案)
  - [B5. 任務](#b5-任務)
  - [B6. 查核清單](#b6-查核清單)
  - [B7. SOP 模板庫](#b7-sop-模板庫)
  - [B8. 設定 (簽核鏈／分類／標籤)](#b8-設定-簽核鏈分類標籤)
- [Part C — 跨模組整合](#part-c--跨模組整合)
- [Part D — 常見使用情境](#part-d--常見使用情境)

---

# Part A — 人資模組

人資模組位於側邊欄 **人員組織** 群組下，以實際身份決定可見頁面：

| 角色 | 預設可見範圍 |
|------|------------|
| `store_staff` 一般員工 | 自己的打卡 / 請假 / 薪資 / 班表 |
| `manager` 店長 / 主管 | 該店所有員工的人資資料 |
| `admin` / `super_admin` | 全公司資料、政策設定、AI 分析 |

權限對照表定義在 [Sidebar.jsx](src/components/Sidebar.jsx) 的 `ROLE_GROUPS` 與 `ROLE_ALLOWED_PATHS`。

---

## A1. 出勤管理

### A1.1 打卡追蹤 [Attendance.jsx](src/pages/hr/Attendance.jsx)

**功能**：顯示每日／每月打卡紀錄，支援 GPS 位置驗證打卡。

**主要操作**
- 篩選：部門 / 門市 / 員工姓名
- 「打卡」按鈕：自動讀取定位 → 與門市座標比對 → 寫入 `attendance_records`
- 「匯出 PDF」：產生月度報表
- 切換 **紀錄 / 工時** 兩個視圖

> 📸 **截圖：打卡頁主畫面**
> - 🔴 右上「打卡」按鈕（一般員工的主要入口）
> - 🟡 上方部門 / 門市篩選列
> - 🟢 下方表格：當日 `clock_in` / `clock_out` / `total_hours` 即時更新

**範例情境**
> 早上 09:02，門市夥伴小陳到店後打開 LIFF →「打卡」按鈕變綠 → 系統用 GPS 偵測她在公司方圓 50 公尺內 → 寫入 `clock_in = 09:02`，主管在「打卡追蹤」即時看到打卡資料。

---

### A1.2 補登申請 [PunchCorrection.jsx](src/pages/hr/PunchCorrection.jsx)

**功能**：員工忘記打卡時提出補登；主管核准後自動更新 `attendance_records`。

**設定要點**
- 員工：點「新增補登」→ 選日期、補登類型 (上班 / 下班)、修正時間、原因
- 主管：在「待審核」分頁按「核准」或「退回」
- 核准後系統自動把 `corrected_time` 寫回當日打卡紀錄

> 📸 **截圖：補登申請列表**
> - 🔴 「新增補登」按鈕
> - 🟡 分頁切換「待審核 / 已核准」
> - 🟢 主管視圖會多出「核准 / 退回」兩個按鈕

**情境**：阿明昨天忘記下班打卡 → 今天上午補申請 → 店長午休前核准 → 昨日工時自動更新為 8 小時。

---

## A2. 請假與排班

### A2.1 請假管理 [Leave.jsx](src/pages/hr/Leave.jsx)

**功能**：所有假別申請的入口，整合年資政策、餘額驗證、簽核流程。

**支援假別**：特休、病假、事假、婚假、喪假、產假、陪產假、家庭照顧假、生理假、公假、補休等。
（定義在 [src/lib/leavePolicy.js](src/lib/leavePolicy.js)）

**操作流程**
1. 點「新增請假」→ 開啟對話框
2. 選擇員工 → 系統自動帶出部門
3. 選假別 → 系統呼叫 `getLeaveTypeInfo()` 顯示剩餘天數與規則
4. 選日期區間 (可切換「日 / 小時」)
5. 填寫原因 → 送出
6. 系統呼叫 `createApprovalWorkflow('leave', ...)` 通知主管 (LINE 推播)

> 📸 **截圖：新增請假對話框**
> - 🔴 「假別」下拉選單（影響後續可請天數）
> - 🟡 右側「ⓘ」按鈕 → 跳出該員工的「假別餘額」彈窗
> - 🟢 送出後表格新增一列，狀態欄為 `待審核`（黃色）

**情境**：小芳要請 4/29~5/2 共 4 天特休，剩餘 6 天 → 系統驗證通過 → 主管收到 LINE 推播 → 點開 LIFF 直接核准 → 假單狀態變 `已核准`、`leave_balances.used_days` +4。

---

### A2.2 請假日曆 [LeaveCalendar.jsx](src/pages/hr/LeaveCalendar.jsx)

月曆檢視所有 **已核准** 的假，主管可一眼看出：
- 哪一天人手最少 (避免重疊請假)
- 國定假日疊加顯示

**情境**：店長在排下個月班表前先看「請假日曆」→ 發現 5/15 有 3 個人請假 → 提早跟員工協調或安排 PT 支援。

---

### A2.3 假別餘額 [LeaveBalances.jsx](src/pages/hr/LeaveBalances.jsx)

每個員工每年每種假的：總天數 / 已用 / 剩餘 / 過期日。HR 可手動調整 `carry_over_days` (展期)。

> 📸 **截圖：餘額表**
> - 🔴 「編輯」按鈕（只有 HR / admin 看得到）
> - 🟡 年度切換下拉
> - 🟢 「剩餘」欄 = 總天數 + 展期 - 已用，自動算出

---

### A2.4 加班申請 [Overtime.jsx](src/pages/hr/Overtime.jsx)

員工提交加班 → 主管核准 → 自動把時數加到當日 `attendance_records.hours`。

**情境**：颱風夜倉管支援理貨 3 小時 → 隔天填加班單 → 主管核准 → 當日工時從 8 變 11 → 月底薪資自動算入加班費。

---

### A2.5 排班 [Schedule.jsx](src/pages/hr/Schedule.jsx) ⭐ 重點頁

**功能**：月度班表編排，支援 AI 排班、勞基法檢查、疲勞分數、換班申請。

**設定步驟**
1. **先設好班別**：到「排班規則」建立 `早班 09:00-17:00`、`晚班 14:00-22:00` 等（含顏色）
2. **設定門市規則**：每班最少幾人、營業時段
3. **員工填寫偏好**：在「偏好」分頁設定 `不可排早班` 或 `偏好週末`
4. **主管按「AI 排班」** → Gemini 產生草稿 → 預覽違規 (紅色) 與警告 (黃色)
5. 微調後按「發布班表」 → LINE 推播個別員工

> 📸 **截圖：排班月表 + AI 草稿側欄**
> - 🔴 上方「AI 排班」與「發布班表」兩顆主按鈕
> - 🟡 月表格子：點擊可手動指派班別
> - 🟢 右側 AI 草稿面板顯示：違規數、疲勞警告、可採納 / 重新生成

**情境**：5 月份要排班 → 點「AI 排班」→ 系統考量：員工偏好、勞基法 (連續工作不超過 6 天)、疲勞分數 (上夜後不接早) → 草稿出爐顯示「2 件違規 (週工時>40h)、3 件警告」→ 店長手動微調 2 格 → 違規清零 → 發布 → 14 位員工 LINE 收到自己的下月班表。

---

### A2.6 排班規則 [ScheduleRules.jsx](src/pages/hr/ScheduleRules.jsx)

定義班別 (名稱、起訖時間、顏色) 與排班約束 (最少人力、最大日工時、休息間隔)。

**最佳實踐**：班別名稱用「動作 + 時段」例如 `早班-開店`、`晚班-收店`，方便後續查找。

---

### A2.7 假日管理 [Holidays.jsx](src/pages/hr/Holidays.jsx)

維護國定假日，供排班引擎參考。「重新整理假日」按鈕會自動拉取政府公告。

---

## A3. 薪酬與績效

### A3.1 薪資管理 [Salary.jsx](src/pages/hr/Salary.jsx)

**功能**：每月薪資單建立 + 自動計算勞健保、退休金、所得稅。

**新增薪資紀錄欄位**
- 月份（YYYY-MM）
- 員工
- 本薪、加班費、津貼、獎金
- 扶養人數、自提退休金比例 (0~6%)
- 手動扣款：缺勤 / 遲到 / 其他 (含備註)

**自動扣款公式**（即時試算）
```
毛額 = 本薪 + 加班 + 津貼 + 獎金
- 勞保     calculateLaborInsurance(本薪)
- 健保     calculateHealthInsurance(本薪, 扶養人數)
- 自提退   本薪 × 自提%
- 所得稅   calculateMonthlyWithholding(毛額)
- 手動扣款 缺勤 + 遲到 + 其他
= 實領
```

> 📸 **截圖：薪資編輯對話框**
> - 🔴 「實領」金額（右下角粗體即時更新）
> - 🟡 「手動扣款備註」欄（勞檢時用得到）
> - 🟢 自動扣款欄位灰底唯讀

**批次發薪**：點「批次薪資」→ 選月份 → 系統按 `salary_structures` 與 `employees` 預設值產生整批草稿 → 確認後一次寫入。

---

### A3.2 薪資結構 [SalaryStructures.jsx](src/pages/hr/SalaryStructures.jsx)

預設薪資範本：例如「店長 — 本薪 38,000、伙食 2,400、交通 1,500、自提 6%」。批次發薪時自動套用。

---

### A3.3 薪資發放 [Payroll.jsx](src/pages/hr/Payroll.jsx)

**Payroll Run 概念**：一次發薪作業。流程：
1. 「建立薪資批次」→ 選月份 → 呼叫 Postgres `generate_payroll()`
2. 展開批次 → 檢視所有員工薪資單
3. 「發送薪資單」→ LINE 推播 (notifyPayslip)
4. 「鎖定批次」→ status=`finalized`，無法再改

> 📸 **截圖：薪資批次列表**
> - 🔴 「建立薪資批次」按鈕
> - 🟡 「發送薪資單」與「鎖定批次」（順序很重要：先發送、再鎖定）
> - 🟢 批次狀態 `draft → finalized` 變色

---

### A3.4 績效獎金 [Bonus.jsx](src/pages/hr/Bonus.jsx)

四個分頁：**業務 / 倉管 / 內勤採購 / 跨部門**。
- 「新增設定」：定義獎金公式（指標、目標、權重、獎金）
- 「新增紀錄」：選員工 → 系統自動帶出福利政策獎金 (`getEffectiveBenefits`)

**情境**：業務 Karen 4 月業績達標 120 萬 → 在獎金設定「達 100 萬發 5,000、達 120 萬再加 3,000」→ 新增 4 月紀錄時自動算出 base_bonus = 8,000。

---

### A3.5 績效管理 [Performance.jsx](src/pages/hr/Performance.jsx)

兩個分頁：**評分** / **目標**。
- 評分：S / A+ / A / B+ / B / C；狀態 `自評中 → 主管評 → 已簽核`
- 目標：可量化欄位 (target/current/unit)，每個目標旁有 +／-按鈕快速更新進度

**情境**：行銷組設 Q1 目標「IG 粉絲 1.5 萬」→ 每週點一下 +50 → 進度條從 60% 跳到 75% → 季末主管打分 A → 連動到績效獎金。

---

### A3.6 福利政策 [BenefitSettings.jsx](src/pages/hr/BenefitSettings.jsx)

可針對「門市」或「個別員工」設定特殊福利：
- 加碼特休 (例如：北車店全員特休 +2 天)
- 伙食津貼 (每日 120)
- 抽成比例 (業績 2%)

被「請假」「薪資」「獎金」三個頁面同時引用。

---

### A3.7 扣繳憑單 [TaxForms.jsx](src/pages/hr/TaxForms.jsx)

年初開立給員工的 50 字憑單，匯出 PDF。

---

## A4. 人才發展

### A4.1 招募管理 [Recruitment.jsx](src/pages/hr/Recruitment.jsx)

職缺貼文管理：標題、部門、地點、雇用型態 (全職／兼職／約聘)。

### A4.2 教育訓練 [Training.jsx](src/pages/hr/Training.jsx)

**設定流程**
1. 「新增課程」→ 標題、類別 (一般／安全／技術／管理／合規)、講師、時數、上限
2. 展開課程 → 「新增報名」加入員工
3. 課程結束後更新狀態與分數

**情境**：5 月排「食品安全衛生講習」(2 小時、上限 20 人) → 開放報名 → 結業填分數 → 之後勞檢可印出已受訓清單。

### A4.3 試用期管理 [ProbationTracker.jsx](src/pages/hr/ProbationTracker.jsx)

新人試用期 (通常 90 天) 追蹤：
- 建立紀錄：員工、起訖日、輔導員
- 期中可多次「新增評核」(分數 + 評語 + 結果)
- 結果：`已通過 / 未通過 / 延長試用`

### A4.4 轉調紀錄 [Transfer.jsx](src/pages/hr/Transfer.jsx)

跨店 / 跨部門調動歷史 (目前唯讀展示)。

---

## A5. 人才分析 (AI)

### A5.1 HR AI 助理 [HRAssistant.jsx](src/pages/hr/HRAssistant.jsx)

自然語言查詢 HR 資料的聊天機器人。會載入近 30 天的員工 / 出勤 / 假單 / 薪資 / 績效作為上下文。

**範例提問**
- 「哪些人這個月遲到超過 3 次？」
- 「東區門市的平均薪資是多少？」
- 「上個月誰沒申請特休？」

> 📸 **截圖：HR AI 助理介面**
> - 🔴 下方輸入框
> - 🟡 預設提問按鈕 (一鍵套用範例)
> - 🟢 AI 回覆區，可能包含表格或圖表

### A5.2 AI 離職預測 [AttritionPrediction.jsx](src/pages/hr/AttritionPrediction.jsx)

加權模型：年資 15% + 升遷停滯 10% + 遲到 20% + 請假激增 15% + 績效 20% + 薪資差距 10% + 滿意度 10%。

輸出：高 / 中 / 低風險，並列出具體因子（例如「過去 3 個月遲到 8 次」「同職位薪資 P25 以下」）。

**情境**：HR 月會時打開頁面 → 篩選「高風險」→ 看到 3 名員工 → 點開展開因子 → 與店長討論 1on1 安排。

### A5.3 滿意度調查 [EngagementSurveys.jsx](src/pages/hr/EngagementSurveys.jsx)

建立調查 → 派發 → 收回應 → 看分群結果。

---

## A6. 行政庶務

### A6.1 公出差旅 [BusinessTravel.jsx](src/pages/hr/BusinessTravel.jsx)

出差申請 (目的地、日期、原因、交通工具) → 主管簽核 → 可串費用核銷。

### A6.2 費用核銷 [Expenses.jsx](src/pages/hr/Expenses.jsx)

**特別之處**：依金額自動套用 `approval_chains`。例如：
- < 5,000：店長一關
- 5,000~50,000：店長 → 區經理
- > 50,000：店長 → 區經理 → 財務長

定義在 [B8 簽核鏈設定](#b8-設定-簽核鏈分類標籤)。

### A6.3 文件管理 [Documents.jsx](src/pages/hr/Documents.jsx)

合約 / 政策 / 培訓教材的雲端檔案庫。

### A6.4 勞檢報表 [LaborInspection.jsx](src/pages/hr/LaborInspection.jsx)

一鍵產出勞檢用清單：工時違規、加班超時、休息日、薪資扣款合理性。

### A6.5 員工自助 [SelfService.jsx](src/pages/hr/SelfService.jsx) / 我的班表 [MySchedule.jsx](src/pages/hr/MySchedule.jsx)

員工個人入口：看自己的出勤、假單、薪資、班表。`MySchedule` 可發起換班申請。

### A6.6 HR 報表 [HRReport.jsx](src/pages/hr/HRReport.jsx)

主管儀表板：在職人數、今日遲到、待簽假單、本月薪資總額、部門人數圖。

---

# Part B — 流程模組

流程模組的設計理念在 [instruc-project.md](instruc-project.md) 已詳述，這裡聚焦在**操作層**。
模組採三層結構：

```
專案 Project
  └─ 流程實例 Workflow Instance (由 SOP 模板產生)
       └─ 任務 Task (含子項目、簽核、依賴)
```

---

## B1. 流程總覽 [Overview.jsx](src/pages/process/Overview.jsx)

**用途**：所有進行中流程的儀表板，是主管每天第一個打開的頁面。

**畫面區塊**
- 上方統計卡：進行中流程數 / 待簽核 / 已完成任務 / 清單進度
- 中段「待簽核」清單：直接按「核准 / 退回」(會跳出原因輸入)
- 下段「進行中流程」：展開列可看每個 step 的指派人與狀態
- 點任務 → 右側滑出 [TaskDetailPanel.jsx](src/components/TaskDetailPanel.jsx) 可即時編輯標題、到期日、子項目

> 📸 **截圖：總覽畫面**
> - 🔴 「待簽核」區塊的「核准 / 退回」按鈕
> - 🟡 上方四張統計卡
> - 🟢 點任務後右側滑出的詳情面板

**載入時行為**：自動執行 `checkAndNotifyDueTasks()` → 對即將到期任務發 LINE 推播。

---

## B2. 專案管理 [Projects.jsx](src/pages/process/Projects.jsx)

**用途**：把多個 SOP 流程包成一個目標 (例：展店、活動、季度專案)。

**新增專案欄位**
- 名稱 / 描述
- 狀態：規劃中 / 進行中 / 已完成 / 暫停 / 已取消
- 優先：高 / 中 / 低
- 負責人 / 部門 / 門市 / 起訖日 / 預算

**展開專案後的分頁**
1. **總覽**：基本資訊、團隊成員
2. **流程**：套用過的 SOP 模板實例
3. **任務**：所有相關任務 (清單或看板)
4. **討論**：留言串
5. **設定**：自訂分區、欄位

**部署 SOP**：點「套用 SOP 模板」→ 選模板 → 角色對應到實際員工 → 產生 `workflow_instance`。

> 📸 **截圖：專案詳情面板**
> - 🔴 「套用 SOP 模板」按鈕
> - 🟡 上方分頁切換
> - 🟢 「流程」分頁的步驟條碼示

**情境**：要在 7/1 開新店「松山店」→ 建立專案 `松山店開幕` → 套用 SOP 模板 `展店 SOP` (15 步驟，跨人資 / 採購 / 行銷) → 各步驟自動指派給對應職務 → 主管在「總覽」追蹤進度。

---

## B3. 流程 (SOP) 管理 [Workflows.jsx](src/pages/process/Workflows.jsx)

**用途**：建立 / 編輯 SOP、追蹤實例執行。

**分頁說明**
| 分頁 | 內容 |
|------|------|
| 進行中實例 | 有人在跑的流程，可加註記、改指派、提早完成 |
| 已完成實例 | 歷史紀錄 |
| 模板 | 自製 SOP 範本 |
| AI 助理 | 用自然語言生成 SOP 步驟 |
| 分類管理 | 流程分類 (展店 / 新人 / 盤點...) |

**新增 SOP 模板**
1. 名稱、分類、描述
2. 步驟編輯器 (可新增多個 step)：每步含 標題 / 角色 / 優先 / 描述 / 查核清單 / 簽核鏈
3. 儲存後可在「專案」或這裡按「部署」啟動實例

**部署模板對話框**
- 選擇門市 / 地點
- 角色對應：把每個 step 的「角色」映射到具體員工
- 一鍵啟動 → 產生 instance + steps + tasks，並 LINE 通知所有指派人

> 📸 **截圖：SOP 模板編輯器**
> - 🔴 「新增步驟」按鈕
> - 🟡 每步驟內的「查核清單」與「簽核鏈」下拉
> - 🟢 「儲存」「部署」雙按鈕

---

## B4. AI 設定專案 [SetupAssistant.jsx](src/pages/process/SetupAssistant.jsx) ⭐ 新功能

**用途**：對話式生成完整專案 + SOP + 任務 + 簽核鏈，避免從零建立。

**操作流程**
1. 進入頁面 → 左側聊天，右側預覽
2. 用一句話描述需求：「我想做一個跨年促銷活動，11 月底開始準備，要含商品、行銷、IT、門市四方協作」
3. (可選) 上傳參考文件 (簡報、Word、Excel)
4. AI 多輪追問細節 → 在右側預覽逐步生成
5. 預覽通過後按「提交草稿」→ `commitSetupDraft()` 一次寫入：
   - `projects` 一筆
   - `sop_templates` 或直接 `workflow_instances`
   - `tasks` (含指派、到期日)
   - `approval_chains` (如有需要)

> 📸 **截圖：SetupAssistant 雙欄畫面**
> - 🔴 左下「送出訊息」與右下「提交草稿」按鈕
> - 🟡 右上「重新開始」按鈕（清空草稿）
> - 🟢 右側預覽：專案 → SOP 步驟 → 任務清單依序成形

**草稿儲存**：用 `localStorage` 持久化，關掉頁面再回來不會消失。

**限制** (參見 [src/lib/setupAgent/constants.js](src/lib/setupAgent/constants.js))：
- 單次最大步驟數
- 單次最大任務數
- 附件數量上限

**情境**：新店長想設「每週清潔 SOP」但不熟系統 → 在 SetupAssistant 說「我要每週六早上的店面深度清潔流程，含 5 個區域，每區指派 1 人，主管驗收」→ AI 產出：1 個 weekly project + 5 個 task + 1 個簽核步驟 → 提交。

---

## B5. 任務 [Tasks.jsx](src/pages/process/Tasks.jsx)

**用途**：所有任務 (專案任務 + 獨立任務) 統一管理。

**四種檢視**
| 檢視 | 適用情境 |
|------|---------|
| List 列表 | 找特定任務、批次操作 |
| Kanban 看板 | 拖曳改狀態、視覺化進度 |
| Calendar 日曆 | 看期限分布 |
| Timeline 時間軸 | Gantt 風格、看跨任務時序 |

**篩選**：指派人、門市、Bucket (歸屬專案)、關鍵字搜尋。

> 📸 **截圖：Kanban 視圖**
> - 🔴 右上「新增任務」按鈕
> - 🟡 左上四個檢視切換 icon
> - 🟢 拖曳卡片到「已完成」欄會自動寫 `completed_at`

**最佳實踐**：個人偏好的檢視會記在 `localStorage.tasks_view`，下次自動回到上次視圖。

---

## B6. 查核清單 [Checklists.jsx](src/pages/process/Checklists.jsx)

**用途**：可重複套用的子項目清單。例如「開店 8 點檢核」「離職交接 12 項」。

**操作**：建立清單 → 加入項目 (可拖曳排序) → 在 SOP 步驟設定中綁定。

**情境**：每天開店要做的 10 件事 (清潔、收銀、補貨...) → 建立「開店檢核」清單 → 在「早班開店 SOP」的步驟裡綁定 → 員工執行時逐項打勾 → 全勾完才能進下一步。

---

## B7. SOP 模板庫 [SOPTemplates.jsx](src/pages/process/SOPTemplates.jsx)

**用途**：90+ 內建模板的展示與部署。

**內建模板分類**：HR (新人到職、離職交接) / 倉管 (盤點、收貨) / 營運 (展店、結束營業) / 採購 (詢比議) / 客服 (申訴處理)。

**部署**：與 [Workflows](#b3-流程-sop-管理) 的部署流程相同，多了預覽。

**情境**：新人 Lisa 5/1 報到 → HR 從模板庫部署「新人到職 SOP」(8 步驟) → 角色對應：「設備開通」→ IT 阿哲、「新人訓練」→ 店長 → 8 個任務同時派發 → Lisa 第一週每完成一項就會自動推進。

---

## B8. 設定 (簽核鏈／分類／標籤)

### B8.1 簽核鏈 [ApprovalChains.jsx](src/pages/system/ApprovalChains.jsx)

**用途**：多層簽核規則。可依「金額」「類別」自動路由。

**設定欄位**
- 名稱 / 類別 (expense / workflow / leave / overtime)
- 金額區間 (min / max) — 留空表示不依金額
- 步驟列表：步序、角色、標籤、簽核類型 (人工 / 自動)、超時天數

**範例**：費用簽核鏈
```
Chain 名稱           金額範圍       步驟
小額       <5000           店長
中額       5000~50000      店長 → 區經理
大額       >50000          店長 → 區經理 → 財務長
```

> 📸 **截圖：簽核鏈編輯**
> - 🔴 「新增步驟」按鈕
> - 🟡 「金額區間」兩個欄位（觸發條件路由的關鍵）
> - 🟢 步驟列表顯示順序與超時天數

### B8.2 分類管理 [Categories.jsx](src/pages/process/settings/Categories.jsx)

把流程 / 專案歸類，方便篩選與報表。每類可設顏色與排序。

### B8.3 標籤管理 [Tags.jsx](src/pages/process/settings/Tags.jsx)

更輕量的標記 (例：`urgent`、`合規必看`)。可跨流程跨任務貼。

---

# Part C — 跨模組整合

## C1. 簽核流程

人資模組多數申請 (請假 / 加班 / 出差 / 費用) 都會呼叫 `createApprovalWorkflow(type, data, employee)`：
1. 依員工 → 找主管 (`getSupervisor`)
2. 依類別 / 金額 → 比對 `approval_chains`
3. 產生 workflow_instance + steps
4. 推播 LINE 給第一關簽核者

主管在 **流程 → 總覽** 或 LIFF 連結中按「核准」→ 呼叫 `advanceWorkflow(stepId, actor, action)` 推進到下一步，全部簽完後狀態變 `已完成`。

## C2. LINE / LIFF 推播

| 觸發點 | 推播內容 |
|------|---------|
| 任務指派 | `notifyTaskAssignee` → 含 LIFF 任務詳情連結 |
| 班表發布 | `notifySchedulePublished` → 個人月班表 |
| 薪資發送 | `notifyPayslip` → 薪資單下載 |
| 任務即將到期 | `taskDueChecker` 在「總覽」載入時觸發 |

設定 LINE 對應在 [src/lib/lineNotify.js](src/lib/lineNotify.js)，員工的 LINE userId 對應在 `employee_line_accounts` view。

## C3. AI 應用全景

| 模組 | AI 功能 | 模型 |
|------|--------|------|
| 排班 | AI 排班、勞基法檢查 | Gemini |
| 流程 SOP | 自然語言生成 SOP | Gemini |
| AI 設定專案 | 多輪對話建立完整專案 | Claude (Anthropic) |
| HR 助理 | 自然語言查詢 HR 資料 | Gemini |
| 離職預測 | 加權風險模型 | 內建演算法 |

API key 設在 `.env`：`VITE_GEMINI_API_KEY`。

---

# Part D — 常見使用情境

## D1. 「新人到職」端到端

| 步驟 | 模組 | 動作 |
|------|------|------|
| 1 | 招募 | 在 [Recruitment](src/pages/hr/Recruitment.jsx) 結案職缺 |
| 2 | 員工資料 | 建立 `employees` 紀錄、綁定 LINE |
| 3 | 流程 | 套用「新人到職 SOP」(8 步驟) |
| 4 | 設備 | IT 收到 LINE → 開通帳號 → 完成步驟 |
| 5 | 訓練 | 報名「新人必修課」於 [Training](src/pages/hr/Training.jsx) |
| 6 | 試用期 | 建立 [ProbationTracker](src/pages/hr/ProbationTracker.jsx) 紀錄 |
| 7 | 排班 | 加入下個月 [Schedule](src/pages/hr/Schedule.jsx) |
| 8 | 90 天後 | 試用期評核 → 通過 → 流程關閉 |

## D2. 「跨店活動」端到端

| 步驟 | 模組 | 動作 |
|------|------|------|
| 1 | 流程 | 用 [SetupAssistant](src/pages/process/SetupAssistant.jsx) 對話生成專案 |
| 2 | 專案 | 在 [Projects](src/pages/process/Projects.jsx) 補齊預算與時程 |
| 3 | 任務 | 在 [Tasks](src/pages/process/Tasks.jsx) Kanban 拖曳追蹤 |
| 4 | 費用 | 活動採購由 [Expenses](src/pages/hr/Expenses.jsx) 提報，依金額走簽核鏈 |
| 5 | 結案 | 流程實例完成後留言 + 上傳成果到 [Documents](src/pages/hr/Documents.jsx) |

## D3. 「月底發薪」端到端

1. **人資**：對帳 [Attendance](src/pages/hr/Attendance.jsx) 與 [PunchCorrection](src/pages/hr/PunchCorrection.jsx) → 確認工時
2. **獎金**：在 [Bonus](src/pages/hr/Bonus.jsx) 結算當月績效獎金
3. **薪資**：[Payroll](src/pages/hr/Payroll.jsx) 「建立批次」→ 自動算扣款
4. **檢查**：展開批次審視幾個高薪員工的扣款明細
5. **發送**：「發送薪資單」LINE 推播
6. **鎖定**：「鎖定批次」防止改動
7. **記錄**：[TaxForms](src/pages/hr/TaxForms.jsx) 年底彙整為扣繳憑單

---

## 附錄：權限速查

| 動作 | 最低角色 |
|------|---------|
| 自己打卡 / 請假 / 看薪資 | store_staff |
| 看部門 / 門市資料 | manager |
| 改別人薪資結構 / 福利政策 | admin |
| 系統級簽核鏈 / 角色管理 | super_admin |

完整對照在 [Sidebar.jsx](src/components/Sidebar.jsx) 的 `ROLE_ALLOWED_PATHS`。

---

## 附錄：相關技術文件

- 流程模組架構深度說明：[instruc-project.md](instruc-project.md)
- 專案 README：[CLAUDE.md](CLAUDE.md)
- 資料庫 schema：[supabase-schema.sql](supabase-schema.sql)
- 事件處理 (Kafka-ready)：[src/lib/events/](src/lib/events/)

---

**最後更新**：2026-04-23
**維護者**：請更新此處
