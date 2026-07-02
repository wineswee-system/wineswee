-- 系統開發日誌：重建 6/22~6/30 流程（每天 6 項；取代先前 3 項版）
-- 2026-07-02
-- 先前 20260702820000 已建（每天 3 項），冪等 guard 擋住後續擴充。
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
    {"date":"2026-06-22","name":"開發日誌 06-22｜HR・薪資・獎金・排班",
     "note":"薪資引擎與門市獎金規則、排班權限調整",
     "tasks":["薪資引擎收斂：加班費／所得稅規則對齊","門市業績獎金：自訂欄位（新增/排序/定義，可進應發）","門市業績獎金：紀律/獎勵分級（大過・小功・大功）","門市獎金領取資格兩原則（兼職滿80h／正職入職次月）","排班合規檢查與班別設定調整","費用申請相關細部調整"]},
    {"date":"2026-06-23","name":"開發日誌 06-23｜流程・任務・排班",
     "note":"流程詳情版面重構、任務建立對齊、班表複製貼上、幣別資料驅動",
     "tasks":["流程詳情頁改左右主從版面（點步驟右側滑出任務）","新增專案內建流程改完整版（含簽核鏈/優先度/備註）","專案內任務對齊共用元件（含簽核設定）","流程名稱 inline 可編輯","班表總覽複製/貼上（Ctrl+C/V、平鋪填滿）","幣別改資料驅動（currencies 表，加幣別只需一列）"]},
    {"date":"2026-06-24","name":"開發日誌 06-24｜任務綁定表單・簽核代理",
     "note":"綁定表單自己填/他人填、簽核代理上線、費用附件擴充",
     "tasks":["任務綁定表單「自己填／他人填」＋自己填當場填","重型表單（費用/調撥/稽核）任務內 iframe inline 填","簽核代理（代簽）Phase 1-3：後端比對＋管理頁＋LINE 卡","費用申請附件上限 3→20","費用「複製重送」以自己舊單為範本","費用檢視全部人權限（expense.view_all）"]},
    {"date":"2026-06-25","name":"開發日誌 06-25｜費用・叫貨・薪資",
     "note":"叫貨申請單、費用/表單複製、薪資試算＝入帳",
     "tasks":["叫貨申請單：doc_type 子型別＋獨立簽核鏈（A/B/C 三階段）","費用/表單「複製」全型別（含附件 storage 複製）","批次補結新制上線前的歷史費用單（137 筆）","薪資試算＝入帳（generate 改共用 _compute 引擎）","薪資：二代健保補充保費＋離職特休結清","加班費休息日 deem＋國定假日固定 8h 規則"]},
    {"date":"2026-06-26","name":"開發日誌 06-26｜POS・餐飲・HR",
     "note":"POS 完整化、點餐頁重設計、假別動態計算",
     "tasks":["POS 完整化：結帳收據／發票載具／廚房出單／桌卡列印","POS：X 報表、作廢/折扣/退款/內外帶、門市月業績報表","服務員點餐模式＋顧客點餐頁全面重設計","全門市菜單匯入（7 分類 49 品項）＋品項多語言","假別餘額改依年資/法定動態計算（對齊 LIFF）","假別批次調整（多選員工＋天/小時單位切換）"]},
    {"date":"2026-06-29","name":"開發日誌 06-29｜組織權限・稽核・出勤",
     "note":"RBAC 細化、打卡改時間、門市稽核強化",
     "tasks":["RBAC 細化：10+ HR 路徑 sidebar/page 權限 gate","員工/部門/門市管理限 admin＋員工頁加簽核代理 Tab","打卡管理 admin inline 直接改時間＋原因必填＋調整歷史","門市稽核：照片附件＋LIFF 獨立權限（逐人可開）","流程列表顯示部門＋部門篩選取代門市篩選","任務頁獨立權限碼（nav.project.tasks）"]},
    {"date":"2026-06-30","name":"開發日誌 06-30｜簽核鏈・訂位・儀表板",
     "note":"三級主管簽核鏈、訂位模組、儀表板與個資收斂",
     "tasks":["三級主管簽核鏈（applicant_supervisor L1/L2/L3）","簽核找不到人自動跳過（skip_if_no_approver）","HR 表單三路分流（門市/行政/部門）","訂位模組上線（4 張表＋平面圖拖曳佈局）","儀表板「我的任務」widget","員工個資 RLS 依角色/門市範圍收斂"]}
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
