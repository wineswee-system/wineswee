-- 系統開發日誌：6/22~6/30 每天一個流程（KPI 紀錄）
-- 2026-07-02
-- 建 1 個專案 + 7 個 workflow_instance（一天一個，已完成）+ 每天數個高階任務。
-- 任務 status 直接給「已完成」→ 不觸發 trg_task_auto_start / enqueue_notify（不發 LINE）。
-- 任務 store/assignee/workflow 文字由 tg_sync_task_assignee 反推，只設 *_id。
-- 冪等：專案依名稱、流程依 workflow_code(DEVLOG-日期) NOT EXISTS 才建；可重跑。

DO $$
DECLARE
  v_proj int;
  v_wi   int;
  v_org  CONSTANT int := 1;
  v_emp  CONSTANT int := 10;      -- 洪伯嘉
  v_store CONSTANT int := 20;     -- 威耀總部
  v_dept CONSTANT text := '人力資源管理部';

  -- 每天：日期 / 主題摘要(notes) / 任務清單
  d record;
  t text;
  i int;
  days jsonb := '[
    {"date":"2026-06-22","code":"DEVLOG-2026-06-22","name":"開發日誌 06-22｜HR・薪資・獎金・排班",
     "note":"薪資引擎與門市獎金規則、排班權限調整",
     "tasks":["薪資引擎收斂：加班費／所得稅規則對齊","門市業績獎金：自訂欄位＋紀律/獎勵分級","排班權限與班別設定調整"]},
    {"date":"2026-06-23","code":"DEVLOG-2026-06-23","name":"開發日誌 06-23｜流程・任務・排班",
     "note":"流程詳情版面重構、任務建立對齊、班表複製貼上",
     "tasks":["流程詳情頁改左右主從版面（點步驟右側滑出）","新增專案/任務對齊共用元件（含簽核設定）","班表總覽複製/貼上（Ctrl+C/V）"]},
    {"date":"2026-06-24","code":"DEVLOG-2026-06-24","name":"開發日誌 06-24｜任務綁定表單・簽核代理",
     "note":"綁定表單自己填/他人填、簽核代理上線、費用附件擴充",
     "tasks":["任務綁定表單「自己填／他人填」＋當場填","簽核代理（代簽）Phase 1-3 上線","費用申請附件擴充＋核銷（驗收）單位"]},
    {"date":"2026-06-25","code":"DEVLOG-2026-06-25","name":"開發日誌 06-25｜費用・叫貨・薪資",
     "note":"叫貨申請單、費用複製重送、薪資試算＝入帳",
     "tasks":["叫貨申請單：獨立簽核鏈（A/B/C 三階段）","費用「複製重送」＋批次補結歷史單","薪資試算＝入帳、二代健保＋離職特休結清"]},
    {"date":"2026-06-26","code":"DEVLOG-2026-06-26","name":"開發日誌 06-26｜POS・餐飲・HR",
     "note":"POS 完整化、點餐頁重設計、假別動態計算",
     "tasks":["POS 完整化：結帳收據／發票載具／廚房出單／月業績報表","顧客/服務員點餐頁重設計＋全門市菜單匯入","假別餘額改依年資/法定動態計算（對齊 LIFF）"]},
    {"date":"2026-06-29","code":"DEVLOG-2026-06-29","name":"開發日誌 06-29｜組織權限・稽核・出勤",
     "note":"RBAC 細化、打卡改時間、門市稽核強化",
     "tasks":["RBAC 細化：HR 路徑權限、員工/部門管理限 admin","打卡管理 admin inline 改時間＋調整歷史","門市稽核：照片附件＋LIFF 獨立權限"]},
    {"date":"2026-06-30","code":"DEVLOG-2026-06-30","name":"開發日誌 06-30｜簽核鏈・訂位・儀表板",
     "note":"三級主管簽核鏈、訂位模組、儀表板與個資收斂",
     "tasks":["三級主管簽核鏈（L1/L2/L3）＋找不到人自動跳過","訂位模組上線（平面圖拖曳佈局）","儀表板「我的任務」widget＋員工個資 RLS 收斂"]}
  ]'::jsonb;
BEGIN
  -- 專案（依名稱冪等）
  SELECT id INTO v_proj FROM projects WHERE name = '系統開發日誌 2026' AND organization_id = v_org LIMIT 1;
  IF v_proj IS NULL THEN
    INSERT INTO projects(name, description, status, priority, owner, owner_id, organization_id, department, store, start_date, end_date, progress)
    VALUES('系統開發日誌 2026','系統開發每日成果紀錄（KPI）','進行中','中','洪伯嘉', v_emp, v_org, v_dept, '威耀總部', '2026-06-22', '2026-06-30', 100)
    RETURNING id INTO v_proj;
  END IF;

  -- 每天一個流程
  FOR d IN SELECT * FROM jsonb_to_recordset(days) AS x(date date, code text, name text, note text, tasks jsonb)
  LOOP
    -- workflow_code 是 generated 欄位，不能塞；改用 template_name 當冪等標記
    IF NOT EXISTS (SELECT 1 FROM workflow_instances WHERE template_name = d.name AND project_id = v_proj) THEN
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
    END IF;
  END LOOP;
END $$;
