-- ============================================================
-- 門市開幕 workflow seed — 45 tasks + 依序/聚合依賴
--
-- 使用方法：貼到 Supabase SQL Editor → Run
-- 跑完會：
--   1. 新增一筆 workflow_instance「門市開幕流程」
--   2. 插入 45 個 tasks（各階段負責人已標記）
--   3. 建立 task_dependencies 讓前置任務完成時，後面的可以開始
--
-- 調整空間：
--   - 想綁特定門市 → 把 store = NULL 改成門市名稱
--   - 想指派真的員工 → 負責人姓名要跟 employees.name 一致，
--     SQL 會自動補 assignee_id FK；沒對上的先留空後面改
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_wi_id INT;
  v_org_id INT;
BEGIN
  -- ① 抓第一個 org 當歸屬
  SELECT id INTO v_org_id FROM organizations ORDER BY id LIMIT 1;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION '找不到 organization，請先建立至少一個 org';
  END IF;

  -- ② 建立 workflow_instance
  INSERT INTO workflow_instances (template_name, status, started_at, organization_id, store)
  VALUES ('門市開幕流程', '進行中', now(), v_org_id, NULL)
  RETURNING id INTO v_wi_id;

  RAISE NOTICE 'Created workflow_instance id=%', v_wi_id;

  -- ③ 插入 45 個 tasks，sort_order 保留原 #
  INSERT INTO tasks (title, assignee, status, priority, sort_order, workflow_instance_id, organization_id, category, bucket)
  SELECT v.title, v.assignee, '未開始', '中', v.seq, v_wi_id, v_org_id, '門市開幕', '開幕流程'
  FROM (VALUES
    (1,  '設計圖確認',             'Zoey'),
    (2,  '工程第一次報價',         'Zoey'),
    (3,  '工程最終報價定案',       'Zoey'),
    (4,  '現場規劃圖初稿確認',     'Zoey'),
    (5,  '施工圖面確認及工程發包', 'Zoey'),
    (6,  '電力申請',               '學文'),
    (7,  '大陸設備採購',           'Antia'),
    (8,  '台灣設備採購',           '學文'),
    (9,  '小家電及小五金採購',     '營運'),
    (10, '統編及稅籍申請',         'Alicia'),
    (11, '電子發票申請',           'Alicia'),
    (12, 'POS機準備',              'Alicia'),
    (13, '刷卡機準備',             'Alicia'),
    (14, '家具採購',               'Zoey'),
    (15, '招牌安裝',               'Ken'),
    (16, '軟裝及布置物採購＋植栽', 'Zoey'),
    (17, '電話及網路申請',         '學文'),
    (18, '監視器採購及安裝',       '學文'),
    (19, '音響採購及安裝',         '學文'),
    (20, '門市用筆電及印表機採購', '學文'),
    (21, '裝修後細清廠商',         '學文'),
    (22, '垃圾清運廠商',           '學文'),
    (23, '除蟲防治廠商',           '學文'),
    (24, '保險投保',               '學文'),
    (25, '人力編制到位',           '營運'),
    (26, '人力訓練安排',           '營運'),
    (27, '門市營業用小物件採購',   '營運'),
    (28, '首次庫存需求請購',       '營運'),
    (29, '完工前施工狀況檢視',     '學文'),
    (30, '行銷廣告案確認及發布',   'Zoey'),
    (31, '傳單及廣告輸出物',       'Zoey'),
    (32, '收銀機準備',             'Vicky'),
    (33, '確認桌椅排位',           'Zoey'),
    (34, '確認規劃廚房',           'Vicky'),
    (35, '任務6-9、14-15完成',     NULL),
    (36, '監工進度（回報DAVE）',   '學文'),
    (37, '監工回報(DAVE)',         NULL),
    (38, '完成任務10-20、32',      NULL),
    (39, '須調整項目',             'Zoey'),
    (40, '家具進場確認',           'Vicky'),
    (41, '設備進場確認',           'Vicky'),
    (42, '硬體設備確認',           'Vicky'),
    (43, '人員培訓完成確認',       'Vicky'),
    (44, '任務完成40-43',          NULL),
    (45, '確認開幕時間',           'Zoey')
  ) AS v(seq, title, assignee);

  -- ④ 補 assignee_id：名字對得上 employees.name 就自動連 FK
  UPDATE tasks t
  SET assignee_id = e.id
  FROM employees e
  WHERE t.workflow_instance_id = v_wi_id
    AND t.assignee IS NOT NULL
    AND t.assignee = e.name;

  -- ⑤ 建 task_dependencies（prerequisite：被依賴的那邊）
  -- 語意：t1 必須等 t2 完成後才能開始
  INSERT INTO task_dependencies (task_id, depends_on_task_id, dep_type)
  SELECT t1.id, t2.id, 'prerequisite'
  FROM (VALUES
    -- 前期設計 → 報價 → 定案 → 規劃 → 桌椅/廚房 → 發包
    (2, 1), (3, 2), (4, 3),
    (33, 4),
    (5, 33), (5, 34),
    -- 發包後的第一波採購（6-9, 14, 15）
    (6, 5), (7, 5), (8, 5), (9, 5),
    (14, 5), (15, 5),
    -- 第一波完成聚合點 → 35
    (35, 6), (35, 7), (35, 8), (35, 9), (35, 14), (35, 15),
    -- 35 → 36 監工
    (36, 35),
    -- 36 觸發第二波（10-13, 16-20, 25-28, 32）
    (10, 36), (11, 36), (12, 36), (13, 36),
    (16, 36), (17, 36), (18, 36), (19, 36), (20, 36),
    (25, 36), (26, 36), (27, 36), (28, 36),
    (32, 36),
    -- 37 監工回報落在 36 之後
    (37, 36),
    -- 38 完成聚合（10-20 + 32）
    (38, 10), (38, 11), (38, 12), (38, 13), (38, 14), (38, 15),
    (38, 16), (38, 17), (38, 18), (38, 19), (38, 20),
    (38, 32), (38, 37),
    -- 38 觸發第三波（21-24 清潔/保險、30-31 行銷）
    (21, 38), (22, 38), (23, 38), (24, 38),
    (30, 38), (31, 38),
    -- 29 完工檢視 → 39 調整（if any）
    (39, 29),
    -- 39 調整後再進場確認 40-43
    (40, 39), (41, 39), (42, 39), (43, 39),
    -- 44 完成聚合（40-43）
    (44, 40), (44, 41), (44, 42), (44, 43),
    -- 45 開幕時間（在 44 後）
    (45, 44),
    -- 29 在所有施工相關完成後才能做（21-28 前置）
    (29, 21), (29, 22), (29, 23), (29, 24),
    (29, 25), (29, 26), (29, 27), (29, 28)
  ) AS d(dependent_seq, prereq_seq)
  JOIN tasks t1 ON t1.sort_order = d.dependent_seq AND t1.workflow_instance_id = v_wi_id
  JOIN tasks t2 ON t2.sort_order = d.prereq_seq   AND t2.workflow_instance_id = v_wi_id;

  RAISE NOTICE 'Seeded workflow "門市開幕流程": instance=%, 45 tasks', v_wi_id;
END $$;

COMMIT;

-- ============================================================
-- 驗證（跑完後看這張總覽表）
-- ============================================================

-- 工作流程概況
SELECT
  wi.id AS instance_id, wi.template_name, wi.status, wi.started_at,
  (SELECT count(*) FROM tasks WHERE workflow_instance_id = wi.id) AS total_tasks,
  (SELECT count(*) FROM task_dependencies td JOIN tasks t ON t.id = td.task_id
   WHERE t.workflow_instance_id = wi.id) AS total_deps
FROM workflow_instances wi
WHERE template_name = '門市開幕流程'
ORDER BY id DESC
LIMIT 1;

-- 每個任務 + 前置 + 負責人狀態
SELECT
  t.sort_order AS "#",
  t.title AS 任務,
  COALESCE(t.assignee, '未指派') AS 負責人,
  CASE WHEN t.assignee_id IS NULL AND t.assignee IS NOT NULL THEN '✗ 未連結 FK' ELSE '✓' END AS 連結狀態,
  COALESCE(
    (SELECT string_agg(t2.sort_order::text, ',' ORDER BY t2.sort_order)
     FROM task_dependencies td
     JOIN tasks t2 ON t2.id = td.depends_on_task_id
     WHERE td.task_id = t.id),
    '（無前置）'
  ) AS 前置任務,
  t.status
FROM tasks t
WHERE t.workflow_instance_id = (
  SELECT id FROM workflow_instances WHERE template_name = '門市開幕流程' ORDER BY id DESC LIMIT 1
)
ORDER BY t.sort_order;
