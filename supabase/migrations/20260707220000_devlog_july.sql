-- 系統開發日誌 2026：新增 7 月流程（KPI，一天一流程；每天約 10 項＝新功能＋修復摘要）
-- 2026-07-07
-- 只算 aska911023 帳號的 commit（老闆 astrops111 不計）。有 commit 的日子：7/1、7/2、7/6、7/7。
-- ★「先刪後建」但**只鎖 7 月**（template_name LIKE '開發日誌 07-%'），不動 6 月既有日誌。
-- 這批是開發日誌紀錄，無業務資料/無綁定，刪除安全。可重跑（每次重建成同一結果）。
-- 雷：workflow_code 是 generated 欄不能塞（用 template_name 當冪等標記）；
--     tasks 只設 store_id/assignee_id/workflow_instance_id（文字欄交給 trigger 反推）；
--     status 直接給「已完成」→ 不觸發 auto_start / 不發 LINE。

DO $$
DECLARE
  v_proj int;
  v_wi   int;
  v_org  CONSTANT int := 1;
  v_emp  CONSTANT int := 10;      -- 洪伯嘉
  v_store CONSTANT int := 20;     -- 威耀總部
  v_dept CONSTANT text := '人力資源管理部';
  d record; t text; i int;
  days jsonb := '[
    {"date":"2026-07-01","name":"開發日誌 07-01｜門市稽核・假別・任務通知",
     "note":"新功能 9＋修復 13：門市稽核計分、LIFF假別餘額、任務通知強化",
     "tasks":["門市稽核列表改「扣分/得分」雙欄＋顯示剩餘分數","門市稽核加第三態（不扣分△紫色標記）","LIFF 讀假別餘額 RPC（對齊主系統顯示）","假別批次調整加「天/小時」單位切換＋補休改小時輸入","假別餘額加補休（對齊請假類型 key）","任務通知卡片加步驟進度（第N步/共M步）","任務加建立者欄位＋通知顯示發起人/負責人/部門/門市/到期","任務啟動通知顯示「需完成表單」清單","【修復】LIFF簽核中心全鎖(函式歧義)/門市稽核核准/任務通知/門市下拉空白 等 13 件"]},
    {"date":"2026-07-02","name":"開發日誌 07-02｜排班權限・快照簽核・打卡定位",
     "note":"新功能 12＋修復 23：排班權限碼、快照簽核不影響在飛單、跨午夜打卡容錯",
     "tasks":["排班權限改吃權限碼（可逐人控管）","快照判斷推廣到全部表段＋費用申請讀快照（改流程不影響在飛單）","忘刷補登簽核鏈切開（不再跟請假/加班共用）","打卡追蹤位置改經緯度（可點開 Google 地圖）","行政應上下班＋遲到早退寬限改讀門市設定","請假開放公假/產假/陪產假等可按小時＋最小單位加分鐘","四週變形排班加週分隔紅線＋格子快捷鈕讀班別設定","員工資料加 Email 欄；物流調度/通訊協作限 super_admin","【修復】跨午夜打卡自動補下班容錯（多道守衛）＋孤兒單校正","【修復】RLS收緊(假別餘額/reservations公網洞)＋流程任務補建立者過RLS 等 20+ 件"]},
    {"date":"2026-07-06","name":"開發日誌 07-06｜天災假・POS列印・簽核時間軸",
     "note":"新功能 9＋修復 15：天災假、POS 58mm熱感列印、每關核准時間",
     "tasks":["新增天災假（全門市、照給全薪）","改時間可手動填工時＋補打卡核准後自動重算工時","POS 列印支援 58mm 熱感機＋手動印客人明細","POS 桌卡 QR 熱感列印優化（純黑/固定尺寸/銳化）","服務員模式加「釋放桌位」（免結帳清用餐中）","專案範本任務對齊流程範本（綁表單/簽核鏈/查核清單）","簽核時間軸顯示每關實際核准時間","門市稽核草稿階段保存當班人員/簽名","【修復】approved_by 型別連環雷＋補打卡簽核白名單補「待審核」","【修復】POS菜單去重/加班核准撞名/時數請假小數截斷 等 15 件"]},
    {"date":"2026-07-07","name":"開發日誌 07-07｜姓名連動・計薪校正・104匯入",
     "note":"新功能 8＋修復 12：員工姓名連動、計薪夾到職日、104六月資料匯入",
     "tasks":["員工姓名連動（編輯頁改名→cascade 全表 13 張）","計薪只算到職日~離職日區間內的出勤/加班/遲到","換算時薪改為含全部津貼（月底薪＋各項津貼）","加班補登日期智慧解析（6/24 自動補年份）","排班精靈網格對齊主表格（框選＋快捷鍵）","打卡追蹤加「加班列」（已核准加班獨立顯示）","104 六月資料匯入（出勤/加班/請假/排班）＋假勤餘額對齊上線基準","僅 super_admin 可指派 super_admin（堵升權破口）","【修復】補打卡核准cascade雷＋改名避開薪資/排班業務閘門","【修復】LIFF離職/異動清單RPC/加簽退回按鈕/104匯入格式 等 12 件"]}
  ]'::jsonb;
BEGIN
  -- 專案（依名稱冪等）；已存在就沿用，並把結束日延到 7/7
  SELECT id INTO v_proj FROM projects WHERE name = '系統開發日誌 2026' AND organization_id = v_org LIMIT 1;
  IF v_proj IS NULL THEN
    INSERT INTO projects(name, description, status, priority, owner, owner_id, organization_id, department, store, start_date, end_date, progress)
    VALUES('系統開發日誌 2026','系統開發每日成果紀錄（KPI）','進行中','中','洪伯嘉', v_emp, v_org, v_dept, '威耀總部', '2026-06-22', '2026-07-07', 100)
    RETURNING id INTO v_proj;
  ELSE
    UPDATE projects SET end_date = '2026-07-07' WHERE id = v_proj AND (end_date IS NULL OR end_date < '2026-07-07');
  END IF;

  -- ★ 只刪 7 月 devlog 流程 + 任務（6 月保留）
  DELETE FROM tasks
   WHERE workflow_instance_id IN (
     SELECT id FROM workflow_instances WHERE project_id = v_proj AND template_name LIKE '開發日誌 07-%');
  DELETE FROM workflow_instances WHERE project_id = v_proj AND template_name LIKE '開發日誌 07-%';

  -- 重建 7 月每天一個流程
  FOR d IN SELECT * FROM jsonb_to_recordset(days) AS x(date date, name text, note text, tasks jsonb)
  LOOP
    INSERT INTO workflow_instances(template_name, store, status, started_by, started_by_id, started_at, completed_at,
                                   organization_id, department, project_id, sort_order, project_order, priority, notes)
    VALUES(d.name, '威耀總部', '已完成', '洪伯嘉', v_emp,
           (d.date::text || ' 09:00+08')::timestamptz, (d.date::text || ' 18:00+08')::timestamptz,
           v_org, v_dept, v_proj,
           (extract(month from d.date)::int * 100 + extract(day from d.date)::int),
           (extract(month from d.date)::int * 100 + extract(day from d.date)::int), '中', d.note)
    RETURNING id INTO v_wi;

    i := 0;
    FOR t IN SELECT jsonb_array_elements_text(d.tasks)
    LOOP
      i := i + 1;
      INSERT INTO tasks(title, workflow_instance_id, step_order, sort_order, status, assignee_id, store_id,
                        organization_id, bucket, category, completed_at, started_at, priority, project_id, created_by_emp_id)
      VALUES(t, v_wi, i, i, '已完成', v_emp, v_store, v_org, '工作流程', '工作流程',
             (d.date::text || ' 18:00+08')::timestamptz, (d.date::text || ' 09:00+08')::timestamptz, '中', v_proj, v_emp);
    END LOOP;
  END LOOP;
END $$;
