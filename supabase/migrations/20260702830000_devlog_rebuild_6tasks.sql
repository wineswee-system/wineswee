-- 系統開發日誌：重建 6/22~6/30 流程（每天 10 項＝新功能＋修復摘要；取代 3/6 項版）
-- 2026-07-02
-- 每天任務含「新功能項目」＋「【修復】N 件」摘要，IT+RD 兩面都呈現。
-- 本支「先刪後建」：刪掉 devlog 專案下的流程+任務再重建，讓每天任務數對齊。
-- 這批是開發日誌紀錄，無業務資料/無綁定，刪除安全。可重跑（每次重建成同一結果）。

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
    {"date":"2026-06-22","name":"開發日誌 06-22｜HR・薪資・獎金",
     "note":"新功能 8＋修復 7：門市獎金制度、薪資匯出、證明文件",
     "tasks":["在職/離職證明一鍵開立下載","門市業績獎金：自訂欄位（新增/排序/定義，可進應發）","門市獎金：紀律/獎勵分級（大過・小功・大功）","門市獎金：兩條領取資格原則（兼職滿80h／正職次月）","費用/調撥「申請」與「驗收」可各自綁進任務步驟","費用卡死偵測 RPC＋薪資結構在職/離職篩選 Excel 匯出","代發薪改 Excel 匯出（身分證/帳號/金額/姓名四欄）","新增員工同步建薪資結構、揀貨 FEFO 提示、CRM B2C 接入側欄","【修復】薪資/排班/費用核銷狀態等 7 件","【修復】migration 撞號時間戳、資料校正"]},
    {"date":"2026-06-23","name":"開發日誌 06-23｜流程・任務・幣別・薪資",
     "note":"新功能 17＋修復 7：任務綁定表單、流程對齊、幣別資料驅動",
     "tasks":["綁定表單「自己填/他人填」＋自訂表單任務內彈窗填","重型表單（費用/調撥/稽核）任務內 iframe inline 填","任務「變更日誌」整合活動時間軸＋變更紀錄","班表總覽複製/貼上（Ctrl+C/V、平鋪填滿）","專案內建流程/任務改完整版（含簽核設定）","幣別改資料驅動（後台頁新增/停用、NZD/AUD、免碰 SQL）","後台重設員工薪資密碼＋薪資按鈕細項權限","薪資明細展開顯示完整計算過程","【修復】流程雙推/誤推、LINE 卡片格式等 7 件","【修復】薪資條/引擎重算校正"]},
    {"date":"2026-06-24","name":"開發日誌 06-24｜任務綁定表單・簽核代理",
     "note":"新功能 20＋修復 11：自己填他人填全鋪、簽核代理、費用核銷單位",
     "tasks":["任務綁定表單「自己填/他人填」鋪到所有入口＋當場填","部署時可設「誰來填」＋執行人當場先填","簽核代理（代簽）Phase 1-3：後端比對＋管理頁","代簽通知擴大到請假/加班/經常性費用","非經常性費用加「核銷（驗收）單位」＋通過後提醒核銷人","核銷人也能用 Web 送核銷＋核銷段挑「待驗收」單","步驟啟動卡帶上「需完成表單」","流程詳情頁改左右主從版面","儀表板「我的任務」widget＋儲備幹部可排自己門市班","【修復】費用/流程/簽核/儀表板等 11 件"]},
    {"date":"2026-06-25","name":"開發日誌 06-25｜叫貨單・費用複製・薪資",
     "note":"新功能 23＋修復 20：叫貨申請單、全型別複製、薪資試算＝入帳",
     "tasks":["叫貨申請單：doc_type 子型別＋獨立簽核鏈（A/B/C 三階段）","費用申請「複製重送」以自己舊單為範本","全型別「複製」含附件複製（請假/費用/加班/補打卡/自訂）","無附件表單也加複製（出差/離職/留停/異動/人力需求）","商品調撥申請加複製（含品項＋附件）","薪資試算＝入帳（generate 改共用 _compute 引擎）","薪資：二代健保補充保費＋離職特休結清","加班費休息日 deem＋國定固定 8h＋所得稅不代扣","費用附件上限 3→20＋批次補結歷史單（137 筆）","【修復】費用/流程/薪資/排程/no-undef 等 20 件"]},
    {"date":"2026-06-26","name":"開發日誌 06-26｜POS・餐飲・訂位・HR",
     "note":"新功能 16＋修復 19：POS 完整化、點餐頁重設計、訂位模組",
     "tasks":["POS 完整化：結帳收據／發票載具／廚房出單／桌卡列印","POS：X 報表（今日快報＋現金盤點）","POS：作廢/折扣/退款/內外帶完整實作","門市月業績報表（RPC＋頁面＋側欄）","服務員點餐模式完整升級＋顧客點餐頁重設計","全門市菜單匯入（7 分類 49 品項）＋品項多語言","訂位模組建立（4 張表）","假別餘額改依年資/法定動態計算＋批次調整","員工編制內/編制外設定（計薪自動排除編制外）","【修復】POS/HR/費用/專案等 19 件"]},
    {"date":"2026-06-29","name":"開發日誌 06-29｜組織權限・稽核・出勤",
     "note":"新功能 16＋修復 27：RBAC 細化、打卡改時間、門市稽核強化",
     "tasks":["打卡管理 admin inline 直接改時間（原因必填＋歷史）","門市稽核：LIFF 獨立權限（逐人可開）＋備註欄","經常性費用改品項明細（品名/數量/單價/小計，合計自動）","流程加部門欄＋部門篩選取代門市＋即時訂閱","流程負責人必填＋自動帶部門、名稱 inline 可編輯","任務頁獨立權限碼（admin+，可逐人開）","門市改名連動員工 store 文字","訂位座位地圖拖曳編輯佈局","POS 廚房出單＋桌卡列印＋發票載具 UI","【修復】組織/門市稽核/POS/出勤等 27 件"]},
    {"date":"2026-06-30","name":"開發日誌 06-30｜簽核鏈・訂位・儀表板",
     "note":"新功能 24＋修復 30：三級主管鏈、chain-aware 簽核、個資收斂",
     "tasks":["三級主管簽核鏈（applicant_supervisor L1/L2/L3）","簽核找不到人自動跳過（skip_if_no_approver）","HR 表單三路分流（門市/行政/部門）","HR 卡片加核准/駁回/加簽/詳情四顆按鈕","請假/加班/補打卡/出差接 chain-aware 簽核","費用編輯 RPC 補齊供應商/核銷＋刪附件；門市報修表","10 個申請頁面搜尋擴展為多欄位","補 10 個 HR 路徑權限 gate（封鎖 store_staff）","訂位平面圖拖曳佈局＋POS 結帳加備註/會員綁定","【修復】組織/簽核鏈/RLS/POS/儀表板等 30 件"]}
  ]'::jsonb;
BEGIN
  -- 專案（依名稱冪等）
  SELECT id INTO v_proj FROM projects WHERE name = '系統開發日誌 2026' AND organization_id = v_org LIMIT 1;
  IF v_proj IS NULL THEN
    INSERT INTO projects(name, description, status, priority, owner, owner_id, organization_id, department, store, start_date, end_date, progress)
    VALUES('系統開發日誌 2026','系統開發每日成果紀錄（KPI）','進行中','中','洪伯嘉', v_emp, v_org, v_dept, '威耀總部', '2026-06-22', '2026-06-30', 100)
    RETURNING id INTO v_proj;
  END IF;

  -- ★ 先刪舊的 devlog 流程 + 任務（讓每天任務數重建對齊）
  DELETE FROM tasks
   WHERE workflow_instance_id IN (
     SELECT id FROM workflow_instances WHERE project_id = v_proj AND template_name LIKE '開發日誌%');
  DELETE FROM workflow_instances WHERE project_id = v_proj AND template_name LIKE '開發日誌%';

  -- 重建每天一個流程
  FOR d IN SELECT * FROM jsonb_to_recordset(days) AS x(date date, name text, note text, tasks jsonb)
  LOOP
    INSERT INTO workflow_instances(template_name, store, status, started_by, started_by_id, started_at, completed_at,
                                   organization_id, department, project_id, sort_order, project_order, priority, notes)
    VALUES(d.name, '威耀總部', '已完成', '洪伯嘉', v_emp,
           (d.date::text || ' 09:00+08')::timestamptz, (d.date::text || ' 18:00+08')::timestamptz,
           v_org, v_dept, v_proj,
           extract(day from d.date)::int, extract(day from d.date)::int, '中', d.note)
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
