-- ============================================================
-- 信義安和展店 — 實際專案資料 (45 tasks / 8 phases)
-- Source: JSON from wines-admin workflow-management
-- Replaces best-guess 6-phase template with exact data.
-- ============================================================

-- Fix stale trigger: assigned_to was dropped in 20260420020400 but the
-- log_task_activity() function still references NEW.assigned_to.
CREATE OR REPLACE FUNCTION log_task_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO task_activity(task_id, actor, action, new_value)
    VALUES (NEW.id, COALESCE(NEW.assignee, 'system'), 'created', NEW.title);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO task_activity(task_id, action, field, old_value, new_value)
      VALUES (NEW.id, 'status_changed', 'status', OLD.status, NEW.status);
    END IF;
    IF NEW.assignee IS DISTINCT FROM OLD.assignee OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
      INSERT INTO task_activity(task_id, action, field, old_value, new_value)
      VALUES (NEW.id, 'assigned', 'assignee', OLD.assignee, NEW.assignee);
    END IF;
    IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
      INSERT INTO task_activity(task_id, action, field, old_value, new_value)
      VALUES (NEW.id, 'due_changed', 'due_date', OLD.due_date::TEXT, NEW.due_date::TEXT);
    END IF;
    IF NEW.priority IS DISTINCT FROM OLD.priority THEN
      INSERT INTO task_activity(task_id, action, field, old_value, new_value)
      VALUES (NEW.id, 'field_changed', 'priority', OLD.priority, NEW.priority);
    END IF;
    IF NEW.section_id IS DISTINCT FROM OLD.section_id THEN
      INSERT INTO task_activity(task_id, action, field, old_value, new_value)
      VALUES (NEW.id, 'moved', 'section_id', OLD.section_id::TEXT, NEW.section_id::TEXT);
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

BEGIN;

-- ── 1. 專案模板（8 大階段概要） ────────────────────────────────
INSERT INTO project_templates (name, description, category, workflows, default_priority, estimated_days, estimated_budget, created_by)
VALUES (
  '酒品門市展店 SOP',
  '酒品零售新門市從設計規劃到正式開幕的完整標準作業流程（8 大階段 / 45 工項）',
  '展店',
  '[
    {"name": "設計規劃", "tasks": [
      {"title": "設計圖確認",             "role": "設計/現場規劃/行銷", "priority": "高"},
      {"title": "工程第一次報價",         "role": "設計/現場規劃/行銷", "priority": "中"},
      {"title": "工程最終報價定案",       "role": "設計/現場規劃/行銷", "priority": "高"},
      {"title": "現場規劃圖初稿確認",     "role": "設計/現場規劃/行銷", "priority": "高"},
      {"title": "施工圖面確認及工程發包", "role": "設計/現場規劃/行銷", "priority": "高"},
      {"title": "確認桌椅排位",           "role": "設計/現場規劃/行銷", "priority": "中"},
      {"title": "確認規劃廚房",           "role": "現場確認/收銀",      "priority": "中"}
    ]},
    {"name": "設備採購", "tasks": [
      {"title": "電力申請",               "role": "設施/機電/採購/監工", "priority": "高"},
      {"title": "大陸設備採購",           "role": "大陸設備採購",        "priority": "高"},
      {"title": "台灣設備採購",           "role": "設施/機電/採購/監工", "priority": "中"},
      {"title": "小家電及小五金採購",     "role": "營運部門",            "priority": "中"},
      {"title": "家具採購",               "role": "設計/現場規劃/行銷",  "priority": "中"},
      {"title": "招牌安裝",               "role": "招牌安裝",            "priority": "高"},
      {"title": "軟裝及布置物採購+植栽",  "role": "設計/現場規劃/行銷",  "priority": "中"},
      {"title": "監視器採購及安裝",       "role": "設施/機電/採購/監工", "priority": "中"},
      {"title": "音響採購及安裝",         "role": "設施/機電/採購/監工", "priority": "中"},
      {"title": "門市用筆電及印表機採購", "role": "設施/機電/採購/監工", "priority": "中"}
    ]},
    {"name": "行政申請", "tasks": [
      {"title": "統編及稅籍申請", "role": "行政/財務/POS",        "priority": "高"},
      {"title": "電子發票申請",   "role": "行政/財務/POS",        "priority": "高"},
      {"title": "POS機準備",      "role": "行政/財務/POS",        "priority": "高"},
      {"title": "刷卡機準備",     "role": "行政/財務/POS",        "priority": "中"},
      {"title": "電話及網路申請", "role": "設施/機電/採購/監工",  "priority": "中"},
      {"title": "保險投保",       "role": "設施/機電/採購/監工",  "priority": "中"}
    ]},
    {"name": "施工監工", "tasks": [
      {"title": "完工前施工狀況檢視", "role": "設施/機電/採購/監工", "priority": "高"},
      {"title": "任務6-9/14-15完成",  "role": null,                  "priority": "高"},
      {"title": "監工進度(回報DAVE)", "role": "設施/機電/採購/監工", "priority": "高"},
      {"title": "監工回報(DAVE)",     "role": null,                  "priority": "中"},
      {"title": "須調整項目",         "role": "設計/現場規劃/行銷",  "priority": "中"}
    ]},
    {"name": "清潔維護", "tasks": [
      {"title": "裝修後細清廠商", "role": "設施/機電/採購/監工", "priority": "中"},
      {"title": "垃圾清運廠商",   "role": "設施/機電/採購/監工", "priority": "中"},
      {"title": "除蟲防治廠商",   "role": "設施/機電/採購/監工", "priority": "中"}
    ]},
    {"name": "人員準備", "tasks": [
      {"title": "人力編制到位",         "role": "營運部門", "priority": "高"},
      {"title": "人力訓練安排",         "role": "營運部門", "priority": "高"},
      {"title": "門市營業用小物件採購", "role": "營運部門", "priority": "中"},
      {"title": "首次庫存需求請購",     "role": "營運部門", "priority": "中"}
    ]},
    {"name": "行銷宣傳", "tasks": [
      {"title": "行銷廣告案確認及發布", "role": "設計/現場規劃/行銷", "priority": "高"},
      {"title": "傳單及廣告輸出物",     "role": "設計/現場規劃/行銷", "priority": "中"},
      {"title": "收銀機準備",           "role": "現場確認/收銀",      "priority": "中"}
    ]},
    {"name": "最終確認", "tasks": [
      {"title": "完成任務10-20, 32", "role": null,            "priority": "高"},
      {"title": "家具進場確認",       "role": "現場確認/收銀", "priority": "高"},
      {"title": "設備進場確認",       "role": "現場確認/收銀", "priority": "高"},
      {"title": "硬體設備確認",       "role": "現場確認/收銀", "priority": "高"},
      {"title": "人員培訓完成確認",   "role": "現場確認/收銀", "priority": "高"},
      {"title": "任務完成40-43",      "role": null,            "priority": "高"},
      {"title": "確認開幕時間",       "role": "設計/現場規劃/行銷", "priority": "高"}
    ]}
  ]'::jsonb,
  '高',
  90,
  500000,
  '系統'
) ON CONFLICT DO NOTHING;


-- ── 2. 進行中專案 ─────────────────────────────────────────────
INSERT INTO projects (name, description, status, priority, owner, department, store, start_date, end_date, budget, organization_id)
VALUES (
  '信義安和展店',
  '信義安和路新門市，8 大流程 45 工項，含設計規劃、設備採購、行政申請、施工監工、清潔維護、人員準備、行銷宣傳、最終確認。任務 7（大陸設備採購/Anita）已進行中。',
  '進行中',
  '高',
  '系統',
  '展店事業部',
  '信義安和',
  '2026-04-24',
  '2026-06-28',
  500000,
  1
) ON CONFLICT DO NOTHING;


-- ── 3. 流程實例 + 任務 ────────────────────────────────────────
DO $$
DECLARE
  proj_id BIGINT;
  wi1_id  BIGINT;  -- 設計規劃
  wi2_id  BIGINT;  -- 設備採購
  wi3_id  BIGINT;  -- 行政申請
  wi4_id  BIGINT;  -- 施工監工
  wi5_id  BIGINT;  -- 清潔維護
  wi6_id  BIGINT;  -- 人員準備
  wi7_id  BIGINT;  -- 行銷宣傳
  wi8_id  BIGINT;  -- 最終確認
BEGIN
  SELECT id INTO proj_id FROM projects WHERE name = '信義安和展店' LIMIT 1;
  IF proj_id IS NULL THEN RETURN; END IF;

  -- ── Phase 1: 設計規劃 (tasks 1,2,3,4,5,33,34) ───────────────
  INSERT INTO workflow_instances (template_name, status, started_by, store, project_id, sort_order, started_at)
  VALUES ('設計規劃', '進行中', '系統', '信義安和', proj_id, 1, now())
  RETURNING id INTO wi1_id;

  INSERT INTO tasks (title, workflow_instance_id, status, assignee, role, step_order, priority, notes) VALUES
    ('設計圖確認',             wi1_id, '未開始', 'Zoey',  '設計/現場規劃/行銷', 1, '高', '平面圖、3D圖'),
    ('工程第一次報價',         wi1_id, '未開始', 'Zoey',  '設計/現場規劃/行銷', 2, '中', null),
    ('工程最終報價定案',       wi1_id, '未開始', 'Zoey',  '設計/現場規劃/行銷', 3, '高', null),
    ('現場規劃圖初稿確認',     wi1_id, '未開始', 'Zoey',  '設計/現場規劃/行銷', 4, '高', '規劃設備跟座位擺設'),
    ('施工圖面確認及工程發包', wi1_id, '未開始', 'Zoey',  '設計/現場規劃/行銷', 5, '高', '確認時間給dave'),
    ('確認桌椅排位',           wi1_id, '未開始', 'Zoey',  '設計/現場規劃/行銷', 6, '中', null),
    ('確認規劃廚房',           wi1_id, '未開始', 'Vicky', '現場確認/收銀',      7, '中', null);

  -- ── Phase 2: 設備採購 (tasks 6,7,8,9,14,15,16,18,19,20) ─────
  INSERT INTO workflow_instances (template_name, status, started_by, store, project_id, sort_order, started_at)
  VALUES ('設備採購', '進行中', '系統', '信義安和', proj_id, 2, now())
  RETURNING id INTO wi2_id;

  INSERT INTO tasks (title, workflow_instance_id, status, assignee, role, step_order, priority, notes) VALUES
    ('電力申請',               wi2_id, '未開始', '學文',  '設施/機電/採購/監工', 1,  '高', '不受其他任務引響'),
    ('大陸設備採購',           wi2_id, '進行中', 'Anita', '大陸設備採購',        2,  '高', '3/25待付訂金,交期約14天完成'),
    ('台灣設備採購',           wi2_id, '未開始', '學文',  '設施/機電/採購/監工', 3,  '中', '暫定:炸爐*1.電視*2.電飯鍋*1.電磁爐*1.微波爐*1'),
    ('小家電及小五金採購',     wi2_id, '未開始', '營運',  '營運部門',            4,  '中', null),
    ('家具採購',               wi2_id, '未開始', 'Zoey',  '設計/現場規劃/行銷',  5,  '中', null),
    ('招牌安裝',               wi2_id, '未開始', 'Ken',   '招牌安裝',            6,  '高', '3/17 11:00 跟廠商約現場丈量招牌尺寸'),
    ('軟裝及布置物採購+植栽',  wi2_id, '未開始', 'Zoey',  '設計/現場規劃/行銷',  7,  '中', null),
    ('監視器採購及安裝',       wi2_id, '未開始', '學文',  '設施/機電/採購/監工', 8,  '中', '新勢力'),
    ('音響採購及安裝',         wi2_id, '未開始', '學文',  '設施/機電/採購/監工', 9,  '中', '恩亞'),
    ('門市用筆電及印表機採購', wi2_id, '未開始', '學文',  '設施/機電/採購/監工', 10, '中', '待採購');

  -- ── Phase 3: 行政申請 (tasks 10,11,12,13,17,24) ─────────────
  INSERT INTO workflow_instances (template_name, status, started_by, store, project_id, sort_order, started_at)
  VALUES ('行政申請', '未開始', '系統', '信義安和', proj_id, 3, now())
  RETURNING id INTO wi3_id;

  INSERT INTO tasks (title, workflow_instance_id, status, assignee, role, step_order, priority, notes) VALUES
    ('統編及稅籍申請', wi3_id, '未開始', 'Alicia', '行政/財務/POS',        1, '高', null),
    ('電子發票申請',   wi3_id, '未開始', 'Alicia', '行政/財務/POS',        2, '高', null),
    ('POS機準備',      wi3_id, '未開始', 'Alicia', '行政/財務/POS',        3, '高', null),
    ('刷卡機準備',     wi3_id, '未開始', 'Alicia', '行政/財務/POS',        4, '中', null),
    ('電話及網路申請', wi3_id, '未開始', '學文',   '設施/機電/採購/監工',  5, '中', '待申請中華電信(300M網路/市話/放心播)'),
    ('保險投保',       wi3_id, '未開始', '學文',   '設施/機電/採購/監工',  6, '中', '南山保險.待投保');

  -- ── Phase 4: 施工監工 (tasks 29,35,36,37,39) ─────────────────
  INSERT INTO workflow_instances (template_name, status, started_by, store, project_id, sort_order, started_at)
  VALUES ('施工監工', '進行中', '系統', '信義安和', proj_id, 4, now())
  RETURNING id INTO wi4_id;

  INSERT INTO tasks (title, workflow_instance_id, status, assignee, role, step_order, priority, notes, description) VALUES
    ('完工前施工狀況檢視', wi4_id, '未開始', '學文', '設施/機電/採購/監工', 1, '高', '看是否有需要調整', null),
    ('任務6-9/14-15完成',  wi4_id, '未開始', null,   null,                  2, '高', null, 'Milestone: tasks 6–9 and 14–15 all completed'),
    ('監工進度(回報DAVE)',  wi4_id, '未開始', '學文', '設施/機電/採購/監工', 3, '高', '回復施工進度', null),
    ('監工回報(DAVE)',      wi4_id, '未開始', null,   null,                  4, '中', '時間段開始上油漆', null),
    ('須調整項目',         wi4_id, '未開始', 'Zoey', '設計/現場規劃/行銷',  5, '中', '直到確認完工', null);

  -- ── Phase 5: 清潔維護 (tasks 21,22,23) ───────────────────────
  INSERT INTO workflow_instances (template_name, status, started_by, store, project_id, sort_order, started_at)
  VALUES ('清潔維護', '未開始', '系統', '信義安和', proj_id, 5, now())
  RETURNING id INTO wi5_id;

  INSERT INTO tasks (title, workflow_instance_id, status, assignee, role, step_order, priority, notes) VALUES
    ('裝修後細清廠商', wi5_id, '未開始', '學文', '設施/機電/採購/監工', 1, '中', '待確認'),
    ('垃圾清運廠商',   wi5_id, '未開始', '學文', '設施/機電/採購/監工', 2, '中', '待確認'),
    ('除蟲防治廠商',   wi5_id, '未開始', '學文', '設施/機電/採購/監工', 3, '中', '史偉莎');

  -- ── Phase 6: 人員準備 (tasks 25,26,27,28) ────────────────────
  INSERT INTO workflow_instances (template_name, status, started_by, store, project_id, sort_order, started_at)
  VALUES ('人員準備', '未開始', '系統', '信義安和', proj_id, 6, now())
  RETURNING id INTO wi6_id;

  INSERT INTO tasks (title, workflow_instance_id, status, assignee, role, step_order, priority, notes) VALUES
    ('人力編制到位',         wi6_id, '未開始', '營運', '營運部門', 1, '高', null),
    ('人力訓練安排',         wi6_id, '未開始', '營運', '營運部門', 2, '高', null),
    ('門市營業用小物件採購', wi6_id, '未開始', '營運', '營運部門', 3, '中', null),
    ('首次庫存需求請購',     wi6_id, '未開始', '營運', '營運部門', 4, '中', null);

  -- ── Phase 7: 行銷宣傳 (tasks 30,31,32) ───────────────────────
  INSERT INTO workflow_instances (template_name, status, started_by, store, project_id, sort_order, started_at)
  VALUES ('行銷宣傳', '未開始', '系統', '信義安和', proj_id, 7, now())
  RETURNING id INTO wi7_id;

  INSERT INTO tasks (title, workflow_instance_id, status, assignee, role, step_order, priority, notes) VALUES
    ('行銷廣告案確認及發布', wi7_id, '未開始', 'Zoey',  '設計/現場規劃/行銷', 1, '高', null),
    ('傳單及廣告輸出物',     wi7_id, '未開始', 'Zoey',  '設計/現場規劃/行銷', 2, '中', null),
    ('收銀機準備',           wi7_id, '未開始', 'Vicky', '現場確認/收銀',      3, '中', null);

  -- ── Phase 8: 最終確認 (tasks 38,40,41,42,43,44,45) ──────────
  INSERT INTO workflow_instances (template_name, status, started_by, store, project_id, sort_order, started_at)
  VALUES ('最終確認', '未開始', '系統', '信義安和', proj_id, 8, now())
  RETURNING id INTO wi8_id;

  INSERT INTO tasks (title, workflow_instance_id, status, assignee, role, step_order, priority, notes, description) VALUES
    ('完成任務10-20, 32', wi8_id, '未開始', null,    null,             1, '高', null, 'Milestone: tasks 10–20 and 32 all completed'),
    ('家具進場確認',       wi8_id, '未開始', 'Vicky', '現場確認/收銀',  2, '高', null, null),
    ('設備進場確認',       wi8_id, '未開始', 'Vicky', '現場確認/收銀',  3, '高', null, null),
    ('硬體設備確認',       wi8_id, '未開始', 'Vicky', '現場確認/收銀',  4, '高', null, null),
    ('人員培訓完成確認',   wi8_id, '未開始', 'Vicky', '現場確認/收銀',  5, '高', null, null),
    ('任務完成40-43',      wi8_id, '未開始', null,    null,             6, '高', null, 'Milestone: tasks 40–43 all completed'),
    ('確認開幕時間',       wi8_id, '未開始', 'Zoey',  '設計/現場規劃/行銷', 7, '高', null, null);

END $$;


-- ── 4. 任務相依關係 ───────────────────────────────────────────
-- Uses title-based lookup scoped to this project to avoid cross-project collisions.
DO $$
DECLARE
  proj_id BIGINT;
BEGIN
  SELECT id INTO proj_id FROM projects WHERE name = '信義安和展店' LIMIT 1;
  IF proj_id IS NULL THEN RETURN; END IF;

  INSERT INTO task_dependencies (task_id, depends_on_task_id, dep_type)
  SELECT t_child.id, t_parent.id, edges.dep_type
  FROM (VALUES
    -- 設計規劃序列 (1→2→3→4)
    ('工程第一次報價',          '設計圖確認',             'prerequisite'),
    ('工程最終報價定案',        '工程第一次報價',         'prerequisite'),
    ('現場規劃圖初稿確認',      '工程最終報價定案',       'prerequisite'),
    -- 4 → 33, 34
    ('確認桌椅排位',            '現場規劃圖初稿確認',     'prerequisite'),
    ('確認規劃廚房',            '現場規劃圖初稿確認',     'prerequisite'),
    -- 33, 34 → 5
    ('施工圖面確認及工程發包',  '確認桌椅排位',           'prerequisite'),
    ('施工圖面確認及工程發包',  '確認規劃廚房',           'prerequisite'),
    -- 5 → 6,7,8,9,14,15
    ('電力申請',                '施工圖面確認及工程發包', 'trigger'),
    ('大陸設備採購',            '施工圖面確認及工程發包', 'trigger'),
    ('台灣設備採購',            '施工圖面確認及工程發包', 'trigger'),
    ('小家電及小五金採購',      '施工圖面確認及工程發包', 'trigger'),
    ('家具採購',                '施工圖面確認及工程發包', 'trigger'),
    ('招牌安裝',                '施工圖面確認及工程發包', 'trigger'),
    -- milestone 35 waits for 6,7,8,9,14,15
    ('任務6-9/14-15完成',       '電力申請',               'prerequisite'),
    ('任務6-9/14-15完成',       '大陸設備採購',           'prerequisite'),
    ('任務6-9/14-15完成',       '台灣設備採購',           'prerequisite'),
    ('任務6-9/14-15完成',       '小家電及小五金採購',     'prerequisite'),
    ('任務6-9/14-15完成',       '家具採購',               'prerequisite'),
    ('任務6-9/14-15完成',       '招牌安裝',               'prerequisite'),
    -- 35 → 36
    ('監工進度(回報DAVE)',       '任務6-9/14-15完成',      'prerequisite'),
    -- 36 → 10-20, 32 (trigger: notify to start)
    ('統編及稅籍申請',          '監工進度(回報DAVE)',      'trigger'),
    ('電子發票申請',            '監工進度(回報DAVE)',      'trigger'),
    ('POS機準備',               '監工進度(回報DAVE)',      'trigger'),
    ('刷卡機準備',              '監工進度(回報DAVE)',      'trigger'),
    ('軟裝及布置物採購+植栽',   '監工進度(回報DAVE)',      'trigger'),
    ('電話及網路申請',          '監工進度(回報DAVE)',      'trigger'),
    ('監視器採購及安裝',        '監工進度(回報DAVE)',      'trigger'),
    ('音響採購及安裝',          '監工進度(回報DAVE)',      'trigger'),
    ('門市用筆電及印表機採購',  '監工進度(回報DAVE)',      'trigger'),
    ('收銀機準備',              '監工進度(回報DAVE)',      'trigger'),
    -- 36 → 25-28 (trigger: notify HR/ops)
    ('人力編制到位',            '監工進度(回報DAVE)',      'trigger'),
    ('人力訓練安排',            '監工進度(回報DAVE)',      'trigger'),
    ('門市營業用小物件採購',    '監工進度(回報DAVE)',      'trigger'),
    ('首次庫存需求請購',        '監工進度(回報DAVE)',      'trigger'),
    -- milestone 38 waits for 10-20 and 32
    ('完成任務10-20, 32',       '統編及稅籍申請',         'prerequisite'),
    ('完成任務10-20, 32',       '電子發票申請',           'prerequisite'),
    ('完成任務10-20, 32',       'POS機準備',              'prerequisite'),
    ('完成任務10-20, 32',       '刷卡機準備',             'prerequisite'),
    ('完成任務10-20, 32',       '家具採購',               'prerequisite'),
    ('完成任務10-20, 32',       '招牌安裝',               'prerequisite'),
    ('完成任務10-20, 32',       '軟裝及布置物採購+植栽',  'prerequisite'),
    ('完成任務10-20, 32',       '電話及網路申請',         'prerequisite'),
    ('完成任務10-20, 32',       '監視器採購及安裝',       'prerequisite'),
    ('完成任務10-20, 32',       '音響採購及安裝',         'prerequisite'),
    ('完成任務10-20, 32',       '門市用筆電及印表機採購', 'prerequisite'),
    ('完成任務10-20, 32',       '收銀機準備',             'prerequisite'),
    -- 38 → 21-24, 30-31 (trigger)
    ('裝修後細清廠商',          '完成任務10-20, 32',      'trigger'),
    ('垃圾清運廠商',            '完成任務10-20, 32',      'trigger'),
    ('除蟲防治廠商',            '完成任務10-20, 32',      'trigger'),
    ('保險投保',                '完成任務10-20, 32',      'trigger'),
    ('行銷廣告案確認及發布',    '完成任務10-20, 32',      'trigger'),
    ('傳單及廣告輸出物',        '完成任務10-20, 32',      'trigger'),
    -- 29 → 39
    ('須調整項目',              '完工前施工狀況檢視',     'trigger'),
    -- 39 → 40-43
    ('家具進場確認',            '須調整項目',             'prerequisite'),
    ('設備進場確認',            '須調整項目',             'prerequisite'),
    ('硬體設備確認',            '須調整項目',             'prerequisite'),
    ('人員培訓完成確認',        '須調整項目',             'prerequisite'),
    -- milestone 44 waits for 40-43
    ('任務完成40-43',           '家具進場確認',           'prerequisite'),
    ('任務完成40-43',           '設備進場確認',           'prerequisite'),
    ('任務完成40-43',           '硬體設備確認',           'prerequisite'),
    ('任務完成40-43',           '人員培訓完成確認',       'prerequisite'),
    -- 44 → 45
    ('確認開幕時間',            '任務完成40-43',          'prerequisite')
  ) AS edges(child_title, parent_title, dep_type)
  JOIN tasks t_child ON t_child.title = edges.child_title
    AND t_child.workflow_instance_id IN (
      SELECT id FROM workflow_instances WHERE project_id = proj_id
    )
  JOIN tasks t_parent ON t_parent.title = edges.parent_title
    AND t_parent.workflow_instance_id IN (
      SELECT id FROM workflow_instances WHERE project_id = proj_id
    )
  ON CONFLICT DO NOTHING;

END $$;

COMMIT;
