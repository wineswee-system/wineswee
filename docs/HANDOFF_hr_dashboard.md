# 交接：HR 戰情儀表板（整合既有 + 補強，不是從零做）

> 給下一個對話接手。完整 UX 設計看 **`docs/HR_DASHBOARD_PLAN.md`**（8 區、雙視角、燈號優先）。
> 本文件是「對照現況的實作交接」——**最重要的一句：別重造輪子，80% 後端 + 半套前端已經存在。**

## 0. 一句話任務
把 PLAN 的「老闆 + HR 雙視角大總覽（頂部燈號摘要 → 分區鑽取）」做出來。但**底層聚合 RPC、analytics 頁、共用元件、燈號雛形都已存在**，任務是**整合 + 補 3 區 + 加頂部摘要與鑽取**，不是新建。

## 1. 現況盤點（已經有的，務必先讀）

| 已存在 | 位置 | 內容 |
|---|---|---|
| **聚合 RPC** `fn_hr_analytics(int, date)` | migration `20260523070000_fn_domain_analytics_batch1.sql`；org guard 在 `20260614100000_secure_analytics_rpc_org_guard.sql` | 一次回 jsonb：`active_count`、`structure_by_dept`、`attendance_by_dept`(attendance_days/absence_days/late_count)、`attrition`(rate_pct/ytd_terms/by_month 離職趨勢)、`overtime`(this_month_total_hours/per_employee_avg/top_overtimers)、`training`、`salary_trend`。**已 REVOKE anon + org guard（p_org_id≠current_employee_org() 就 RAISE FORBIDDEN）** |
| **現成 HR 分析頁** | `src/pages/analytics/HRAnalytics.jsx` | 已走 `fn_hr_analytics`，已有 KPI 卡 + 薪資趨勢線圖 + 離職趨勢圖 + 部門結構 + 加班 + 培訓。**已有燈號雛形**（離職率 >10% 紅、否則綠） |
| **警示 RPC + 頁** | `fn_compute_alerts` → `src/pages/analytics/Alerts.jsx` | 跨域警示機制（區 7/8 的「風險」可接這支，不用重寫） |
| **共用儀表板元件** | `src/pages/analytics/components/AnalyticsCommon.jsx` | `KpiCard / SectionHeader / BarRow / DataTable / EmptyState / NUM / PCT`——直接用 |
| **待簽數 hook** | `src/lib/usePendingApprovals.js` | `totalPending / pendingByTable / canApprove`——區 7 簽核效率直接用 |
| **簡版 HR 報表**（參考） | `src/pages/hr/HRReport.jsx`（掛在 `src/modules/HRModule.jsx:67` `report`） | 已做 over-fetch 優化的小儀表板，可當 HR 模組內入口的參考 |

## 2. PLAN 8 區 vs 現況差距（這才是真正要做的）

| PLAN 區 | 現況 | 要補 |
|---|---|---|
| 1 人力總覽 | ✅ structure_by_dept / active_count | 正職/兼職/外籍比、本月入離職、試用期中（擴 RPC） |
| 2 出勤健康 | ✅ attendance_by_dept（遲到/缺勤） | 今日即時出勤、補卡待審數、異常打卡 |
| 3 假務 | ❌ **缺** | **特休到期風險**（最該補，呼應剛做的 cashout）、待審假、留停、補休餘額 |
| 4 加班/工時 | ✅ overtime / top_overtimers | 勞檢上限預警（接 fn_compute_alerts 或擴 RPC） |
| 5 薪資成本 | 🟡 salary_trend / structure_by_dept | 各部門成本佔比、加班費佔比、投保級距異常 |
| 6 流動率 | ✅ attrition（含趨勢 + 燈號） | 離職預測（`fn_attrition_impact` 可能已有）、試用通過率 |
| 7 簽核效率 | ❌ 缺 | 待簽分佈（用 `usePendingApprovals`）、卡關單 |
| 8 合規/到期 | ❌ 缺 | 外籍證件/契約到期、勞檢紅線（接 `fn_compute_alerts`） |
| **頂部燈號摘要列** | ❌ 缺 | PLAN 的核心 UX：6 個核心數字 + 燈號（3 秒看完健康度） |
| **鑽取** | ❌ 缺（現在純圖表，點不進去） | 每張卡 navigate 到對應 HR 頁（HR 的操作入口） |

→ **後端缺的欄位都擴在 `fn_hr_analytics` 裡**（incremental 加 key，**禁止整支重寫**，見鐵則）。前端新增「頂部摘要 + 缺的 3 區 panel + 鑽取」。

## 3. 建議路線（先跟用戶確認，見第 5 節）

**方案 A（推薦）**：在 **HR 模組下新增一頁「HR 戰情室」**（`src/pages/hr/HRDashboard.jsx`，掛 `HRModule.jsx`），複用 `fn_hr_analytics`(+擴欄) + AnalyticsCommon 元件 + usePendingApprovals。`/analytics/HRAnalytics` 維持分析師視角不動。
- 好處：不動既有 analytics 頁；HR 在自己模組就有戰情室 + 鑽取入口；雙視角自然分（analytics=分析、hr 戰情室=操作）

**方案 B**：直接把 `HRAnalytics.jsx` 升級成雙視角（加頂部摘要 + 鑽取 + 3 區）。
- 好處：一頁到底；壞處：analytics 頁定位被改，且它在 analytics 模組不在 hr。

## 4. 要做的具體工作（擇路後）
1. **擴 `fn_hr_analytics`**（incremental）：加 區3假務 / 區7簽核 / 區8到期 缺的 key + 區1/5 補充欄位。`current_employee_org()` org guard 已在 wrapper，不用自己加。
2. **燈號**：每指標配 🟢🟡🔴，門檻**放設定表**別寫死（離職率紅線 / 加班上限 / 特休到期提前天數）。可沿用 `fn_compute_alerts` 既有門檻邏輯。
3. **頂部摘要列** + **缺的 3 區 panel**（用 AnalyticsCommon）。
4. **鑽取**：每卡 `navigate('/hr/xxx')`，鑽到既有 HR 頁（待審假→leave、補卡→punch-correction、待簽→簽核中心…）。

## 5. 動手前要跟用戶確認
- **燈號門檻**：離職率多少算紅？單月加班上限（46h？）？特休到期提前幾天示警？
- **方案 A 還 B**（HR 模組新頁 / 升級既有 analytics 頁）——傾向 A。
- **權限**：含薪資成本 + 個資。`fn_hr_analytics` 目前 org guard 是「同 org 即可」，**薪資成本區要不要再收緊到 admin/manager？**（比照特休結清的 role guard 做法）

## 6. 鐵則（踩過的雷，務必遵守）
- **擴 `fn_hr_analytics` 一律 incremental 加 key，禁止整支 CREATE OR REPLACE 重 paste**（見記憶 `feedback_resolve_snapshot_rewrite_disaster`、`feedback_migration_partial_overwrite_disaster`——這專案重 paste 洗掉邏輯出過大事）。改前先 `npm run db:drift` 確認 live=migration。
- **不要 over-fetch**：數字一律後端聚合回來，別撈大表到前端 reduce（見 `feedback_slim_select_check_usage`）。
- **顏色用 token**，禁硬編碼/Tailwind palette（見 CLAUDE.md 色彩規則）；圖表色用 `chartPalette()`。
- **UI 文字禁露勞基法暗道**（§32/合法/違法/守門 等字眼，見 `feedback_no_compliance_leaks_in_ui`）——區 4/8 勞檢相關用語小心。
- migration idempotent；新增/改的 RPC 記得加進 `scripts/db-drift.mjs` CRITICAL。

## 7. 關鍵檔案
- 設計：`docs/HR_DASHBOARD_PLAN.md`
- 後端：`supabase/migrations/20260523070000_fn_domain_analytics_batch1.sql`（fn_hr_analytics 現況）、`20260614100000_secure_analytics_rpc_org_guard.sql`（org guard wrapper）
- 前端：`src/pages/analytics/HRAnalytics.jsx`（現成骨架）、`src/pages/analytics/Alerts.jsx`（警示）、`src/pages/analytics/components/AnalyticsCommon.jsx`（元件）、`src/pages/hr/HRReport.jsx`（簡版參考）、`src/lib/usePendingApprovals.js`、`src/modules/HRModule.jsx`（掛新 route）
- 記憶可先讀：`project_offload_frontend_to_rpc`（搬後端模式/鐵則）、`project_rls_audit_2026_06_14`（analytics RPC 的 org guard 脈絡）
