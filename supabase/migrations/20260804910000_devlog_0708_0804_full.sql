-- 系統開發日誌 2026:一次補齊 07-08 ~ 08-04(DB 目前只到 07-07)— 2026-08-04
-- ════════════════════════════════════════════════════════════════════════════
-- 三段合併(各段先刪後建、冪等)。跑這一支即可,不必再跑 devlog_0708_0715 / devlog_0716_0722。
-- ════════════════════════════════════════════════════════════════════════════

-- ▓▓▓ 第一段 07-08 ~ 07-15 ▓▓▓
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

-- ▓▓▓ 第二段 07-16 ~ 07-22 ▓▓▓
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

-- ▓▓▓ 第三段 07-24 ~ 08-04 ▓▓▓
-- 系統開發日誌 2026:補 07-23 ~ 08-04(接續 07-22) — 2026-08-04
-- ════════════════════════════════════════════════════════════════════════════
-- 專案 id=19「系統開發日誌 2026」(owner 洪伯嘉 id10, org1)。一天一 workflow_instance
-- + 數個高階任務(給老闆看,去技術黑話)。先刪後建(sort_order 724/727/729/730/731/803/804)
-- → 可重跑更新內容。workflow_code 是 generated 不能 INSERT;tasks 只設 store_id=20/
-- assignee_id=10/step_order,store/assignee 文字靠 trigger 反填;status 直接「已完成」不發 LINE。
-- ⚠️ 07-08~07-22 由既有檔 devlog_0708_0715 / devlog_0716_0722 補(若尚未跑,先跑那兩支)。
-- ════════════════════════════════════════════════════════════════════════════

DELETE FROM tasks WHERE workflow_instance_id IN (
  SELECT id FROM workflow_instances WHERE project_id = 19 AND sort_order IN (724,727,729,730,731,803,804)
);
DELETE FROM workflow_instances WHERE project_id = 19 AND sort_order IN (724,727,729,730,731,803,804);

-- ── 07-24 ──
WITH wi AS (
  INSERT INTO workflow_instances (project_id, template_name, store, status, started_by, started_by_id, started_at, completed_at, sort_order, project_order, organization_id, priority, department, notes)
  VALUES (19, '開發日誌 07-24｜資遣金入薪資・新人特休・LINE人力儀表板', '威耀總部', '已完成', '洪伯嘉', 10, '2026-07-24T01:00:00+00', '2026-07-24T10:00:00+00', 724, 724, 1, '中', '人力資源管理部', '新功能 9＋修復 5：資遣金入當月薪資、新人特休生效規則、LINE 人力儀表板、官網起步')
  RETURNING id)
INSERT INTO tasks (workflow_instance_id, title, status, store_id, assignee_id, project_id, category, bucket, due_time, completed_at, sort_order, step_order, priority)
SELECT wi.id, t.title, '已完成', 20, 10, 19, '工作流程', '工作流程', '17:00:00'::time, '2026-07-24T10:00:00+00', t.ord, t.ord, '中'
FROM wi, (VALUES
  ('資遣金／預告工資直接算進離職當月薪資（年資無條件進位、平均工資排除到職不足月）', 1),
  ('新人特休改「到職滿 6 個月才生效／可申請」', 2),
  ('LINE 新增「人力儀表板」— 多門市範圍、主管可看', 3),
  ('LINE 特休申請加「年度額度超額」檢查（對齊網頁）', 4),
  ('儀表板整理 — 費用預算加時間篩選、今日特殊狀態納入申請中（待審假／加班／出差）', 5),
  ('非費用類簽核第一關改「部門主管→直屬主管」，在飛單同步', 6),
  ('打卡核對／薪資入帳／年終 全部加租戶隔離', 7),
  ('招募：面試多關以最後一關為準、加候選人搜尋與職缺篩選', 8),
  ('Wineswee 品牌形象頁上線（公開 /wineswee）', 9)
) AS t(title, ord);

-- ── 07-27 ──
WITH wi AS (
  INSERT INTO workflow_instances (project_id, template_name, store, status, started_by, started_by_id, started_at, completed_at, sort_order, project_order, organization_id, priority, department, notes)
  VALUES (19, '開發日誌 07-27｜官網整合進系統・編輯重送重簽・排班看全公司', '威耀總部', '已完成', '洪伯嘉', 10, '2026-07-27T01:00:00+00', '2026-07-27T10:00:00+00', 727, 727, 1, '中', '人力資源管理部', '新功能 12＋修復 4：官網整合進系統、駁回重送重簽、排班看全公司、專案範本可排序')
  RETURNING id)
INSERT INTO tasks (workflow_instance_id, title, status, store_id, assignee_id, project_id, category, bucket, due_time, completed_at, sort_order, step_order, priority)
SELECT wi.id, t.title, '已完成', 20, 10, 19, '工作流程', '工作流程', '17:00:00'::time, '2026-07-27T10:00:00+00', t.ord, t.ord, '中'
FROM wi, (VALUES
  ('Wineswee 官網整合進系統（同一網址 /wineswee，多頁式、開場動畫、手機響應式）', 1),
  ('官網後台第一階段 — 商品／消息／門市文案可改、圖片可上傳', 2),
  ('駁回後「編輯重送」從第一關重簽 + 通知前面已簽的人（費用／自建表單／經常性費用）', 3),
  ('非費用申請核准即完成（不再進核銷驗收）', 4),
  ('專案範本內的流程與任務可上下換順序', 5),
  ('排班「看全公司」改資料驅動（營運部經理自動繼承）、LINE 我的班表可選門市看全店', 6),
  ('營運經理可跨門市改班表、看得到全部鎖定狀態', 7),
  ('批次補結張庭瑋 17 筆驗收單', 8)
) AS t(title, ord);

-- ── 07-29 ──
WITH wi AS (
  INSERT INTO workflow_instances (project_id, template_name, store, status, started_by, started_by_id, started_at, completed_at, sort_order, project_order, organization_id, priority, department, notes)
  VALUES (19, '開發日誌 07-29｜薪資結算細修・排班每日彙總・半天特休・招募強化', '威耀總部', '已完成', '洪伯嘉', 10, '2026-07-29T01:00:00+00', '2026-07-29T10:00:00+00', 729, 729, 1, '中', '人力資源管理部', '新功能 15＋修復 12：排班每日彙總、半天特休顯示、薪資結算細修、招募強化、官網後台')
  RETURNING id)
INSERT INTO tasks (workflow_instance_id, title, status, store_id, assignee_id, project_id, category, bucket, due_time, completed_at, sort_order, step_order, priority)
SELECT wi.id, t.title, '已完成', 20, 10, 19, '工作流程', '工作流程', '17:00:00'::time, '2026-07-29T10:00:00+00', t.ord, t.ord, '中'
FROM wi, (VALUES
  ('排班每日彙總 — 總工時／預估業績／人事成本比', 1),
  ('半天特休不覆蓋班別，班表與請假並存顯示', 2),
  ('薪資：當月離職也算離職結算（資遣費列出、特休折現、月薪比例分母固定 30）', 3),
  ('批次計薪門市篩選只認本店（不被跨店權限汙染）', 4),
  ('銀行帳號核對只看本租戶（不再混入示範資料）', 5),
  ('手動加補休（單人＋批次）、離職當月未過期補休也全部結清折現', 6),
  ('直屬主管改「浮動式」— 依組織圖自動推導、換人自動同步', 7),
  ('招募：職缺可手動排序、可刪除、可重新開啟', 8),
  ('新租戶開通自動帶預設權限', 9),
  ('官網後台大改版 — 側欄＋儀表板＋商品表格／篩選／批次＋圖文編輯', 10)
) AS t(title, ord);

-- ── 07-30 ──
WITH wi AS (
  INSERT INTO workflow_instances (project_id, template_name, store, status, started_by, started_by_id, started_at, completed_at, sort_order, project_order, organization_id, priority, department, notes)
  VALUES (19, '開發日誌 07-30｜部分請假扣休息・工時休息校正・驗收可編輯・官網視覺', '威耀總部', '已完成', '洪伯嘉', 10, '2026-07-30T01:00:00+00', '2026-07-30T10:00:00+00', 730, 730, 1, '中', '人力資源管理部', '新功能 14＋修復 10：部分請假扣休息、工時休息窗校正、驗收可編輯、官網視覺升級')
  RETURNING id)
INSERT INTO tasks (workflow_instance_id, title, status, store_id, assignee_id, project_id, category, bucket, due_time, completed_at, sort_order, step_order, priority)
SELECT wi.id, t.title, '已完成', 20, 10, 19, '工作流程', '工作流程', '17:00:00'::time, '2026-07-30T10:00:00+00', t.ord, t.ord, '中'
FROM wi, (VALUES
  ('部分請假時數扣掉內含休息（半天假不多算），並改判遲到／早退', 1),
  ('工時扣休息統一走「休息窗∩打卡」— 提早走只扣涵蓋到的休息', 2),
  ('打卡核對報表修正 — 排休日／排班時數誤判、天災停班免罰、排除編制外', 3),
  ('結薪前可先查本月「時數假」影響清單', 4),
  ('驗收送出後、還沒人簽核前，本人可自行編輯金額／備註／收據（含 LINE）', 5),
  ('例休違規月檢視也顯示、違規訊息改顯示日期區間', 6),
  ('表單查詢點列彈出唯讀詳細（含簽核流程）', 7),
  ('官網：首頁輪播、商品卡電商化（會員價）、圖文編輯器、字級放大、響應式', 8)
) AS t(title, ord);

-- ── 07-31 ──
WITH wi AS (
  INSERT INTO workflow_instances (project_id, template_name, store, status, started_by, started_by_id, started_at, completed_at, sort_order, project_order, organization_id, priority, department, notes)
  VALUES (19, '開發日誌 07-31｜多租戶安全封堵・離職生效統一・出勤時數表・出勤紀錄強化', '威耀總部', '已完成', '洪伯嘉', 10, '2026-07-31T01:00:00+00', '2026-07-31T10:00:00+00', 731, 731, 1, '中', '人力資源管理部', '新功能 8＋修復 14：多租戶安全洞封堵、離職生效統一、出缺勤時數表、出勤紀錄強化')
  RETURNING id)
INSERT INTO tasks (workflow_instance_id, title, status, store_id, assignee_id, project_id, category, bucket, due_time, completed_at, sort_order, step_order, priority)
SELECT wi.id, t.title, '已完成', 20, 10, 19, '工作流程', '工作流程', '17:00:00'::time, '2026-07-31T10:00:00+00', t.ord, t.ord, '中'
FROM wi, (VALUES
  ('封堵最高權限跨租戶資料洞（全站 72 個畫面加租戶保護）', 1),
  ('離職生效統一為「最後工作日當天仍在職、隔天才離職」', 2),
  ('離職申請簽核完成自動套用到員工（帶入離職日／原因）、取消資遣自動恢復在職', 3),
  ('一鍵匯出「每月出缺勤時數表」（全部小時、Excel 美化）', 4),
  ('出勤紀錄大強化 — 班表移到日期旁、每天都顯示、新增當天班表／加班／請假三欄、每人整月淨工時', 5),
  ('加班紀錄可搜尋員工姓名、加班審核標紅提示不合理時段', 6),
  ('投保級距自動帶入 — 勞保／職災／勞退各自封頂、兼職健保 29,500 起', 7),
  ('加保日期空白時自動帶入到職日', 8),
  ('官網品牌換皮只綁本公司，其他租戶維持原樣', 9)
) AS t(title, ord);

-- ── 08-03 ──
WITH wi AS (
  INSERT INTO workflow_instances (project_id, template_name, store, status, started_by, started_by_id, started_at, completed_at, sort_order, project_order, organization_id, priority, department, notes)
  VALUES (19, '開發日誌 08-03｜班表刪除止血救回・曠職自動扣・薪資報表・跨店可見性', '威耀總部', '已完成', '洪伯嘉', 10, '2026-08-03T01:00:00+00', '2026-08-03T10:00:00+00', 803, 803, 1, '中', '人力資源管理部', '新功能 12＋修復 13：班表刪除歸檔救回、曠職自動扣、薪資報表、軟刪濾除、跨店可見性')
  RETURNING id)
INSERT INTO tasks (workflow_instance_id, title, status, store_id, assignee_id, project_id, category, bucket, due_time, completed_at, sort_order, step_order, priority)
SELECT wi.id, t.title, '已完成', 20, 10, 19, '工作流程', '工作流程', '17:00:00'::time, '2026-08-03T10:00:00+00', t.ord, t.ord, '中'
FROM wi, (VALUES
  ('班表刪除／編輯全歸檔留痕、可一鍵還原（誤刪救回、誤改回舊值）+ 操作紀錄新增「班表異動」', 1),
  ('清除本月班表加強確認（防手滑一整片刪掉）', 2),
  ('曠職自動扣款 — 編制內行政無故未出勤自動扣、明細列出曠職日期、擴到門市（依排班）', 3),
  ('資遣費還原進當月薪資 + 特休折現加生效日閘門（到職滿 6 個月）', 4),
  ('軟刪的假單／加班不再被計薪扣款或溢付（引擎全面補濾）', 5),
  ('薪資計算報表 — 每門市一張工作表、動態欄位（有值才出）、離職者補回任職門市、拆遲到／早退／曠職', 6),
  ('HR 補登打卡（可補離職者／任意日期、可搜尋）', 7),
  ('打卡追蹤加「缺下班」警示、凌晨加班歸前一天（讀門市換日設定）', 8),
  ('簽核中心加申請人姓名篩選、通知「待簽核」導向簽核中心', 9),
  ('跨店可見性 — 督導看得到轄下所有門市（打卡／儀表板／薪資，但不看總部）', 10),
  ('鎖定／解鎖班表權限自動跟隨營運部主管', 11),
  ('天災宣告刪除連動、沒來結算逐日、只對當天有排班者建假', 12)
) AS t(title, ord);

-- ── 08-04 ──
WITH wi AS (
  INSERT INTO workflow_instances (project_id, template_name, store, status, started_by, started_by_id, started_at, completed_at, sort_order, project_order, organization_id, priority, department, notes)
  VALUES (19, '開發日誌 08-04｜離職前月份計薪・專案部署循序・補休軟扣・出勤夜班校正', '威耀總部', '已完成', '洪伯嘉', 10, '2026-08-04T01:00:00+00', '2026-08-04T10:00:00+00', 804, 804, 1, '中', '人力資源管理部', '新功能 12＋修復 13：離職前月份計薪、專案部署循序流程、補休軟扣、出勤夜班校正')
  RETURNING id)
INSERT INTO tasks (workflow_instance_id, title, status, store_id, assignee_id, project_id, category, bucket, due_time, completed_at, sort_order, step_order, priority)
SELECT wi.id, t.title, '已完成', 20, 10, 19, '工作流程', '工作流程', '17:00:00'::time, '2026-08-04T10:00:00+00', t.ord, t.ord, '中'
FROM wi, (VALUES
  ('離職者納入「離職前的月份」計薪（做滿的月份不漏薪），離職結算只在離職當月', 1),
  ('專案範本部署全修 — 負責人／成員吃得進去、流程可循序執行（前一流程完成才開下一個）', 2),
  ('補休改「軟扣」— 送出即預留額度防超額，核准後才實扣', 3),
  ('加班明細／列表顯示「折算方式」（換補休／換現金）', 4),
  ('出勤紀錄顯示離職者已核准的請假、夜班下班日歸屬校正', 5),
  ('補休帳回補（已核准卻沒建帳的自動補回）', 6),
  ('費用申請搜尋支援申請人／項目', 7),
  ('任務改負責人正確寫入（通知／我的任務不再指到舊人）', 8),
  ('附件保留中文檔名 + 附件列加下載鈕', 9),
  ('兼職特休實排折算暫停（等歷史班表匯齊後恢復）', 10)
) AS t(title, ord);

-- 專案結束日更新到 08-04
UPDATE projects SET end_date='2026-08-04' WHERE name='系統開發日誌 2026' AND organization_id=1 AND (end_date IS NULL OR end_date < '2026-08-04');
