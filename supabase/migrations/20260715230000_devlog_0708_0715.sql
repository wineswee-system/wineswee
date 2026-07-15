-- 系統開發日誌 2026：補 07-08 / 07-09 / 07-13 / 07-14 / 07-15（承接做到 07-07）
-- 每天約 10 項＝新功能濃縮＋最後 1 項「【修復】N 件」摘要（IT+RD 兩面呈現、去技術黑話）。
-- 「先刪後建」但**只鎖這 5 天**（template_name LIKE 這幾天），不動既有 07-01/02/06/07 與 6 月。
-- 只算 aska911023 帳號的 commit（老闆 astrops111 不計入 KPI）。開發日誌紀錄、無業務資料，可重跑。

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
    {"date":"2026-07-08","name":"開發日誌 07-08｜薪資投保・加班費・加簽對齊",
     "note":"新功能 15＋修復 23：固定投保級距、加班費四類、加簽全表單、加班上限",
     "tasks":[
       "薪資改吃固定投保級距（勞健保／勞退，匯入 79 人級距）",
       "加班費四類分段（正職例假前8×1後4×2、國定假依員工類型、額外費率疊加）",
       "雇主勞退 6% 接員工開關（可逐人開關）",
       "行政人員午休固定扣 60 分（即時打卡＋改時間＋回填歷史）",
       "排班加「國定假」日別（門市國定假可排他日）＋例假出勤自動給 8h 補休",
       "每月加班上限 46h 硬擋（DB 觸發器＋前端）＋對齊四週變形工時",
       "加簽功能全表單對齊（補完報帳＋4 個 HR 簽核表單）",
       "全系統函式健檢工具（plpgsql_check＋自動 lint）",
       "權限頁加「經常性費用」列（查詢＋審核）、刪流程一併刪步驟任務",
       "【修復】加班費互蓋／請假核准報錯／加簽通知沒觸發／RLS 洩漏等 23 件"
     ]},
    {"date":"2026-07-09","name":"開發日誌 07-09｜薪資明細・勞健退・簽核中心",
     "note":"新功能 18＋修復 23：薪資分項明細、投保異動時間軸、儀表板逐張簽核",
     "tasks":[
       "薪資明細存／顯示分項（勞保／健保／勞退自提／所得稅／特休折現）＋加班逐筆明細",
       "勞健退分頁整合眷屬＋投保異動時間軸（加保／退保／眷屬加保歷史）",
       "匯入投保資料（職災／勞退級距＋加退保日＋474 筆異動＋11 眷屬）",
       "健保眷屬保費接眷屬名單、勞退自提 6% 開關",
       "勞退整合固定提繳級距",
       "批次計薪引擎整併（試算＝入帳，delegate 給同一引擎）",
       "儀表板簽核中心改 inline 逐張核准／退回＋勾選批次通過（對齊 LIFF）",
       "經常性費用逐關簽核 RPC＋納入儀表板批次",
       "請假／加班／補打卡／打卡追蹤 改用日期區間選擇器（104 樣式）",
       "【修復】薪資為 0 倒扣／例假補假重複／浮點誤差／RLS regression 等 23 件"
     ]},
    {"date":"2026-07-13","name":"開發日誌 07-13｜跨部門工單・假別對齊・薪資發布",
     "note":"新功能 17＋修復 20：跨部門工單、假別餘額對齊 104、薪資發布閘門",
     "tasks":[
       "跨部門工單（cross-dept work order）＋LIFF RPC＋LINE 通知卡片＋儀表板待辦分頁",
       "薪資改「發布給員工」閘門（不刪草稿，員工不再提前看到未定案薪資）",
       "假別餘額對齊 104 一般假勤明細（2026 年度，未生效特休可休歸 0）",
       "產檢假 5→7 天（性平法§15 2022 修法）＋移除未三讀的心理假",
       "天災宣告改起訖時間區間（支援跨天班次）",
       "專案成員通知（被安排到專案發 LINE＋站內彙總）＋專案內流程全可見",
       "打卡缺一隻 → 計薪時讀班表算工時",
       "打卡核對報表（行政固定辦公時間＋納入離職＋篩選器）",
       "出差申請簽核鏈可見性＋儀表板加「待送驗收」分頁",
       "【修復】離職特休結清／核銷時間軸／日期篩選被裁切／104 殘骸假別等 20 件"
     ]},
    {"date":"2026-07-14","name":"開發日誌 07-14｜工單整合・職位自編・計薪封頂",
     "note":"新功能 16＋修復 19：工單↔專案流程整合、職位管理、本薪封頂班表",
     "tasks":[
       "跨部門工單↔專案／流程／任務全整合（受理後轉、任務指派他部門＝開工單、完成自動結案）",
       "工單綁定填寫改 inline 原生彈窗（不開新分頁）＋成為任務可綁定型別",
       "職位管理 UI — 職稱清單改資料表可後台自編＋拖曳排序",
       "本薪工時封頂在班表（超時走加班申請，打卡只抓遲到早退）",
       "離職特休折現改年資現算天數＋平均工資日薪",
       "兼職特休額度依 6 個月實際排班時數比例計算",
       "加班申請明細自動帶入當天班表＋打卡（審核參考）",
       "流程／專案全任務完成 → 自動已完成（DB 觸發器，任何途徑生效）",
       "流程「封存流程」改名「已完成流程」＋專案簡化（只留完成或刪除）",
       "【修復】排班檢查單日 12h／假別時數 0.5h 差／跨午夜打卡校正／104 五月匯入等 19 件"
     ]},
    {"date":"2026-07-15","name":"開發日誌 07-15｜招募簽核鏈・門市稽核v2・證明文件",
     "note":"新功能 22＋修復 28：錄取動態簽核鏈、門市稽核評分制、在職離職證明",
     "tasks":[
       "招募模組修復 schema drift（補回缺失欄位）→ 新增職缺／人力需求單復活",
       "錄取動態簽核鏈（自己挑多位簽核人依序簽＋簽核中心可簽＋進度時間軸）＋候選人可編輯／移動階段",
       "門市稽核表大改 v2（6 類 142 項／群組配分／評分制／整張照片 20 張／總平均）＋LIFF 版",
       "在職／離職證明版面重製（logo 浮水印／公司資訊／A4 尺寸／月薪）",
       "會計科目重整 38 個＋紅黑（收入／支出）可見度過濾",
       "換天時間可後台設定（系統設定→出勤設定）＋補打卡早上 6 點才換天",
       "鎖定／解鎖班表改權限碼控制（schedule.lock）＋權限頁開關",
       "費用申請／出差／經常性費用拿掉「主管全看」洞（RLS 收斂到本人／店長／主管鏈）",
       "LIFF 儀表板補跨部門工單＋門市報修改讀正確表＋天災照給薪時薪員工補班表時數",
       "【修復】補打卡編輯吃新時間／撤回／簽核後鎖／跨午夜多筆校正／簽核繞過後門等 28 件"
     ]}
  ]'::jsonb;
BEGIN
  SELECT id INTO v_proj FROM projects WHERE name = '系統開發日誌 2026' AND organization_id = v_org LIMIT 1;
  IF v_proj IS NULL THEN
    INSERT INTO projects(name, description, status, priority, owner, owner_id, organization_id, department, store, start_date, end_date, progress)
    VALUES('系統開發日誌 2026','系統開發每日成果紀錄（KPI）','進行中','中','洪伯嘉', v_emp, v_org, v_dept, '威耀總部', '2026-06-22', '2026-07-15', 100)
    RETURNING id INTO v_proj;
  ELSE
    UPDATE projects SET end_date = '2026-07-15' WHERE id = v_proj AND (end_date IS NULL OR end_date < '2026-07-15');
  END IF;

  -- ★ 先刪後建，但只鎖這 5 天（不動既有 07-01/02/06/07 與 6 月）
  DELETE FROM tasks
   WHERE workflow_instance_id IN (
     SELECT id FROM workflow_instances WHERE project_id = v_proj AND (
       template_name LIKE '開發日誌 07-08%' OR template_name LIKE '開發日誌 07-09%' OR
       template_name LIKE '開發日誌 07-13%' OR template_name LIKE '開發日誌 07-14%' OR
       template_name LIKE '開發日誌 07-15%'));
  DELETE FROM workflow_instances WHERE project_id = v_proj AND (
     template_name LIKE '開發日誌 07-08%' OR template_name LIKE '開發日誌 07-09%' OR
     template_name LIKE '開發日誌 07-13%' OR template_name LIKE '開發日誌 07-14%' OR
     template_name LIKE '開發日誌 07-15%');

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
