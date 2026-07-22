-- 系統開發日誌 2026:補 07-16 ~ 07-22(接續 07-15) — 2026-07-22
-- ════════════════════════════════════════════════════════════════════════════
-- 專案 id=19「系統開發日誌 2026」(owner 洪伯嘉 id10, org1)。一天一 workflow_instance
-- + 數個高階任務(給老闆看 KPI,去技術黑話)。只算 aska911023 的 commit。
-- 先刪後建(sort_order 716/717/720/721/722)→可重跑更新內容。
-- 雷:workflow_code 是 generated 不能 INSERT;tasks 只設 store_id=20/assignee_id=10/
--   step_order,store/assignee 文字靠 trigger 反填;task status 直接「已完成」不發 LINE。
-- ════════════════════════════════════════════════════════════════════════════

DELETE FROM tasks WHERE workflow_instance_id IN (
  SELECT id FROM workflow_instances WHERE project_id = 19 AND sort_order IN (716,717,720,721,722)
);
DELETE FROM workflow_instances WHERE project_id = 19 AND sort_order IN (716,717,720,721,722);

-- ── 07-16 ──
WITH wi AS (
  INSERT INTO workflow_instances (project_id, template_name, store, status, started_by, started_by_id, started_at, completed_at, sort_order, project_order, organization_id, priority, department, notes)
  VALUES (19, '開發日誌 07-16｜員工編號・投保級距・班別休息', '威耀總部', '已完成', '洪伯嘉', 10, '2026-07-16T01:00:00+00', '2026-07-16T10:00:00+00', 716, 716, 1, '中', '人力資源管理部', '新功能 15＋修復 15：員工編號新制、投保級距分開、班別自訂休息')
  RETURNING id)
INSERT INTO tasks (workflow_instance_id, title, status, store_id, assignee_id, project_id, category, bucket, due_time, completed_at, sort_order, step_order, priority)
SELECT wi.id, t.title, '已完成', 20, 10, 19, '工作流程', '工作流程', '17:00:00'::time, '2026-07-16T10:00:00+00', t.ord, t.ord, '中'
FROM wi, (VALUES
  ('員工編號新制（W+到職年+當年入職序，自動產生）+ 員工詳情顯示真實編號', 1),
  ('新增員工表單加投保級距（勞保／健保／勞退分開填）', 2),
  ('班別可自訂休息時間（兩頭班）— 從排班到計薪全鏈生效', 3),
  ('排班連續工作上限依員工類型（正職12天／兼職6天）+ 天數改實際班次判定', 4),
  ('行事曆活動加計薪比照（比照國定／例假／休息日）+ 天災宣告自動顯示', 5),
  ('排班格假別改顯示圖示+全名（不再只顯示隱晦代碼）+ 月曆圖例說明', 6),
  ('門市稽核服務類加分列（可回補分數、上限100、說明必填）', 7),
  ('即時打卡「換天時間」改浮動（讀門市設定，不再寫死凌晨6點）', 8),
  ('簽核鏈凍結開單當下的簽核人 + 快照補代簽（主管異動舊單不漂移）', 9),
  ('【修復】多件：軟刪資料不再進彙總、schema漂移壞函式、跨午夜打卡合併、在職證明版面', 10)
) AS t(title, ord);

-- ── 07-17 ──
WITH wi AS (
  INSERT INTO workflow_instances (project_id, template_name, store, status, started_by, started_by_id, started_at, completed_at, sort_order, project_order, organization_id, priority, department, notes)
  VALUES (19, '開發日誌 07-17｜品牌換裝・中英雙語・資料匯入匯出', '威耀總部', '已完成', '洪伯嘉', 10, '2026-07-17T01:00:00+00', '2026-07-17T10:00:00+00', 717, 717, 1, '中', '人力資源管理部', '新功能 22＋修復 20：WINESWEE品牌換裝、中英雙語、員工資料匯入匯出')
  RETURNING id)
INSERT INTO tasks (workflow_instance_id, title, status, store_id, assignee_id, project_id, category, bucket, due_time, completed_at, sort_order, step_order, priority)
SELECT wi.id, t.title, '已完成', 20, 10, 19, '工作流程', '工作流程', '17:00:00'::time, '2026-07-17T10:00:00+00', t.ord, t.ord, '中'
FROM wi, (VALUES
  ('WINESWEE 威士威 品牌換裝（logo、配色、淺色主題、浮水印）', 1),
  ('導入中英雙語框架 + EN／中一鍵切換（側欄274項＋流程／共用約千條英譯）', 2),
  ('員工資料匯出 Excel（可選欄位＋選同仁，仿104企業大師）', 3),
  ('員工資料匯入補齊（家庭成員／緊急聯絡人／身分族群等，對映114人）', 4),
  ('跨午夜夜班請假靠「換日線」判斷收尾日（整天假顯示成一天，不改資料）', 5),
  ('LIFF「我的班表」可看全店同事班表 + 完整簽核鏈進度', 6),
  ('儀表板左側改放「所有模組」選單（取代隱藏側欄留白）', 7),
  ('打卡 GPS 不穩改「確認後照打並標記」不直接擋（對齊104）', 8),
  ('【修復】多件：任務通知三雷（發起人／流程名／步數）、打卡搜尋、淺色底色、離線快取', 9)
) AS t(title, ord);

-- ── 07-20 ──
WITH wi AS (
  INSERT INTO workflow_instances (project_id, template_name, store, status, started_by, started_by_id, started_at, completed_at, sort_order, project_order, organization_id, priority, department, notes)
  VALUES (19, '開發日誌 07-20｜展店範本・就地簽核・加班淨工時', '威耀總部', '已完成', '洪伯嘉', 10, '2026-07-20T01:00:00+00', '2026-07-20T10:00:00+00', 720, 720, 1, '中', '人力資源管理部', '新功能 10＋修復 19：新品牌展店範本、儀表板就地簽核、加班淨工時')
  RETURNING id)
INSERT INTO tasks (workflow_instance_id, title, status, store_id, assignee_id, project_id, category, bucket, due_time, completed_at, sort_order, step_order, priority)
SELECT wi.id, t.title, '已完成', 20, 10, 19, '工作流程', '工作流程', '17:00:00'::time, '2026-07-20T10:00:00+00', t.ord, t.ord, '中'
FROM wi, (VALUES
  ('新增專案範本「新品牌展店專案」（20流程／132任務）', 1),
  ('儀表板就地開明細+當場簽核（加班／請假／補打卡／出差帶當天班表打卡）', 2),
  ('排班可見性升級：部門經理看整部門所有店員工、督導看所轄課／管理門市員工', 3),
  ('流程／專案範本編輯可在中間插入步驟', 4),
  ('加班時數自動扣休息改淨工時 + 回填歷史加班單66筆', 5),
  ('簽呈 PDF 每關補實際簽核時間 + 標對駁回關（費用／全表單）', 6),
  ('打卡追蹤紀錄加分頁（每頁100筆）+ 換頁自動捲回頂端', 7),
  ('流程參與者可見整條流程所有步驟', 8),
  ('【修復】多件：跨夜班孤兒打卡合併、鈴鐺待簽核區塊、縮放版面殘影、模組權限閘', 9)
) AS t(title, ord);

-- ── 07-21 ──
WITH wi AS (
  INSERT INTO workflow_instances (project_id, template_name, store, status, started_by, started_by_id, started_at, completed_at, sort_order, project_order, organization_id, priority, department, notes)
  VALUES (19, '開發日誌 07-21｜招募狀態機・特休單一來源・計算搬後端', '威耀總部', '已完成', '洪伯嘉', 10, '2026-07-21T01:00:00+00', '2026-07-21T10:00:00+00', 721, 721, 1, '中', '人力資源管理部', '新功能 35＋修復 23：招募狀態機、特休單一來源、多項計算搬後端RPC')
  RETURNING id)
INSERT INTO tasks (workflow_instance_id, title, status, store_id, assignee_id, project_id, category, bucket, due_time, completed_at, sort_order, step_order, priority)
SELECT wi.id, t.title, '已完成', 20, 10, 19, '工作流程', '工作流程', '17:00:00'::time, '2026-07-21T10:00:00+00', t.ord, t.ord, '中'
FROM wi, (VALUES
  ('招募模組升級：11態狀態機 + 錄取動態簽核鏈（多把關＋LINE升級卡＋錄取自動建員工檔）', 1),
  ('人力需求單走簽核鏈 + 核准後自動開缺', 2),
  ('特休額度收斂成單一來源（前後端同源、修階梯錯、PT改實際排班比例）', 3),
  ('請假／加班建單改走後端單一來源（天數時數／淨工時唯一計算）', 4),
  ('排班批次匯入改後端（200次寫入→1次）', 5),
  ('財務分錄過帳 + 流程／專案部署改後端（修好先前壞掉的過帳與部署）', 6),
  ('離職／資遣改「到職日才生效」+ 每日到期自動轉離職 + 資遣費修正', 7),
  ('簽核軌跡補記簽核人姓名 + 每關簽核時間（含歷史回填）', 8),
  ('門市稽核評分搬後端單一來源', 9),
  ('【修復】多件：出差隱形單、費用送驗收權限、簽核鏈靜默還原、假勤明細額度顯示', 10)
) AS t(title, ord);

-- ── 07-22 ──
WITH wi AS (
  INSERT INTO workflow_instances (project_id, template_name, store, status, started_by, started_by_id, started_at, completed_at, sort_order, project_order, organization_id, priority, department, notes)
  VALUES (19, '開發日誌 07-22｜表單查詢中心・多租戶隔離・資安收斂', '威耀總部', '已完成', '洪伯嘉', 10, '2026-07-22T01:00:00+00', '2026-07-22T10:00:00+00', 722, 722, 1, '中', '人力資源管理部', '新功能 7＋修復 24：表單查詢中心、多租戶隔離、RLS資安收斂')
  RETURNING id)
INSERT INTO tasks (workflow_instance_id, title, status, store_id, assignee_id, project_id, category, bucket, due_time, completed_at, sort_order, step_order, priority)
SELECT wi.id, t.title, '已完成', 20, 10, 19, '工作流程', '工作流程', '17:00:00'::time, '2026-07-22T10:00:00+00', t.ord, t.ord, '中'
FROM wi, (VALUES
  ('HR 表單查詢中心（跨所有假勤／異動表單統一查詢 + 批次強制通過／抽單）', 1),
  ('LINE 管理頁多租戶隔離（其他組織不再看到本公司機器人／綁定／訊息）', 2),
  ('全庫組織資料隔離補漏（部門／員工／門市／流程／財務／採購約35頁不再混入他組織）', 3),
  ('資安收斂：修 anon 公網寫入洞 + 跨組織讀取洞（含後端函式加組織守門）', 4),
  ('排班合規檢查工時改淨工時（扣休息）', 5),
  ('全店排班權（營運部經理）可看所有門市員工', 6),
  ('【修復】多件：班別跨午夜時數顯示0、表單查詢白屏／編號對齊、加簽選人撈不到人', 7)
) AS t(title, ord);
