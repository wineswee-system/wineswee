-- =============================================
-- 組織圖重建 migration — 2026-05-04
-- 來源：docs/ORG_RECONCILE_2026-05-04.md
-- 動作：
--   71 筆 UPDATE
--   6 筆 UPDATE+rename
--   9 筆 INSERT
--   27 筆 SOFT DELETE (status='離職')
-- =============================================

BEGIN;

-- =============================================
-- Section 1: 缺漏部門 (外部接案 / 稽核室)
-- =============================================
INSERT INTO departments (organization_id, name)
SELECT 1, '外部接案'
WHERE NOT EXISTS (SELECT 1 FROM departments WHERE name = '外部接案');
INSERT INTO departments (organization_id, name)
SELECT 1, '稽核室'
WHERE NOT EXISTS (SELECT 1 FROM departments WHERE name = '稽核室');

-- =============================================
-- Section 2: UPDATE 既有 row (77 筆)
-- =============================================
-- Snow (Snow) → 外部接案/– — 外部接案 super_admin
UPDATE employees SET
  name_en = 'Snow',
  dept = '外部接案',
  department_id = (SELECT id FROM departments WHERE name = '外部接案' ORDER BY id LIMIT 1),
  store = NULL,
  store_id = NULL,
  employment_type = NULL,
  status = '在職'
WHERE id = 44;

-- 洪伯嘉 (Aska Hung) → 外部接案/– — 外部接案 super_admin
UPDATE employees SET
  name_en = 'Aska Hung',
  dept = '外部接案',
  department_id = (SELECT id FROM departments WHERE name = '外部接案' ORDER BY id LIMIT 1),
  store = NULL,
  store_id = NULL,
  employment_type = NULL,
  status = '在職'
WHERE id = 10;

-- 韓虎 (Dave) → 財務部/– — 兼總經理室；DB id=48 改名韓虎，merge 創辦人 id=55
UPDATE employees SET
  name = '韓虎',
  name_en = 'Dave',
  dept = '財務部',
  department_id = 25,
  store = NULL,
  store_id = NULL,
  employment_type = '全職',
  status = '在職'
WHERE id = 48;

-- 陳虹 (Zoey) → 品牌行銷部/– — 兼總經理室；保留有 LINE 的 id=52
UPDATE employees SET
  name_en = 'Zoey',
  dept = '品牌行銷部',
  department_id = 24,
  store = NULL,
  store_id = NULL,
  employment_type = '全職',
  status = '在職'
WHERE id = 52;

-- 林巧玉 (Cheery) → 加盟事業部/– — merge typo Cherry id=144
UPDATE employees SET
  name_en = 'Cheery',
  dept = '加盟事業部',
  department_id = 20,
  store = NULL,
  store_id = NULL,
  employment_type = '全職',
  status = '在職'
WHERE id = 60;

-- 詹建如 (Anita) → 採購部/– — 保留主管 id=145，刪 id=46 + typo 詹健如 id=70
UPDATE employees SET
  name_en = 'Anita',
  dept = '採購部',
  department_id = 21,
  store = NULL,
  store_id = NULL,
  employment_type = '全職',
  status = '在職'
WHERE id = 145;

-- 張庭瑋 (Vicky) → 營運部/– — 兼營運一課督導 + 高雄中正店長；保留有 LINE 的 id=62
UPDATE employees SET
  name_en = 'Vicky',
  dept = '營運部',
  department_id = 23,
  store = NULL,
  store_id = NULL,
  employment_type = '全職',
  status = '在職'
WHERE id = 62;

-- 張啟達 (Danny) → 人力資源部/– — 保留有 LINE 的 id=152
UPDATE employees SET
  name_en = 'Danny',
  dept = '人力資源部',
  department_id = 26,
  store = NULL,
  store_id = NULL,
  employment_type = '全職',
  status = '在職'
WHERE id = 152;

-- 劉雅玲 (Fraya) → 稽核室/–
UPDATE employees SET
  name_en = 'Fraya',
  dept = '稽核室',
  department_id = (SELECT id FROM departments WHERE name = '稽核室' ORDER BY id LIMIT 1),
  store = NULL,
  store_id = NULL,
  employment_type = '全職',
  status = '在職'
WHERE id = 68;

-- 楊家謙  → 倉儲物流部/–
UPDATE employees SET
  name_en = NULL,
  dept = '倉儲物流部',
  department_id = 28,
  store = NULL,
  store_id = NULL,
  employment_type = '全職',
  status = '在職'
WHERE id = 72;

-- 楊學文  → 總務部/– — 保留主管 id=153，刪 typo 學文 id=53 + 專員 id=69
UPDATE employees SET
  name_en = NULL,
  dept = '總務部',
  department_id = 27,
  store = NULL,
  store_id = NULL,
  employment_type = '全職',
  status = '在職'
WHERE id = 153;

-- 張開翔 (Ken) → 品牌行銷部/– — 保留中文 id=65，刪另一個 Ken id=49 (門市人員)
UPDATE employees SET
  name_en = 'Ken',
  dept = '品牌行銷部',
  department_id = 24,
  store = NULL,
  store_id = NULL,
  employment_type = '全職',
  status = '在職'
WHERE id = 65;

-- 徐其祥 (Mark) → 品牌行銷部/–
UPDATE employees SET
  name_en = 'Mark',
  dept = '品牌行銷部',
  department_id = 24,
  store = NULL,
  store_id = NULL,
  employment_type = '全職',
  status = '在職'
WHERE id = 64;

-- 陳佩璇 (Alica) → 財務部/– — 注意：DB 拼 Alicia, 圖上 Alica
UPDATE employees SET
  name_en = 'Alica',
  dept = '財務部',
  department_id = 25,
  store = NULL,
  store_id = NULL,
  employment_type = '全職',
  status = '在職'
WHERE id = 71;

-- 游如梅 (Grace) → 財務部/– — 保留有英文 Grace 的 id=151
UPDATE employees SET
  name_en = 'Grace',
  dept = '財務部',
  department_id = 25,
  store = NULL,
  store_id = NULL,
  employment_type = '全職',
  status = '在職'
WHERE id = 151;

-- 尤致皓 (Max) → 人力資源部/– — 保留有 LINE 的 id=58
UPDATE employees SET
  name_en = 'Max',
  dept = '人力資源部',
  department_id = 26,
  store = NULL,
  store_id = NULL,
  employment_type = '全職',
  status = '在職'
WHERE id = 58;

-- 李英顯 (Ivan) → 倉儲物流部/– — rename from 李英穎 id=59 + 補英文 Ivan
UPDATE employees SET
  name = '李英顯',
  name_en = 'Ivan',
  dept = '倉儲物流部',
  department_id = 28,
  store = NULL,
  store_id = NULL,
  employment_type = '全職',
  status = '在職'
WHERE id = 59;

-- 朱紹蕾  → 倉儲物流部/– — rename from 朱紹蓉 id=73
UPDATE employees SET
  name = '朱紹蕾',
  name_en = NULL,
  dept = '倉儲物流部',
  department_id = 28,
  store = NULL,
  store_id = NULL,
  employment_type = '全職',
  status = '在職'
WHERE id = 73;

-- 黃蘊珊 (Molly) → 營運部/– — 保留有 LINE 的 id=148，刪 typo 黃瑀珊 id=63
UPDATE employees SET
  name_en = 'Molly',
  dept = '營運部',
  department_id = 23,
  store = NULL,
  store_id = NULL,
  employment_type = '全職',
  status = '在職'
WHERE id = 148;

-- 陳嘉益 (Tako) → 營運部/– — 營運三課
UPDATE employees SET
  name_en = 'Tako',
  dept = '營運部',
  department_id = 23,
  store = NULL,
  store_id = NULL,
  employment_type = '全職',
  status = '在職'
WHERE id = 141;

-- 趙亭威 (Willy) → 營運部/台中英才 — 同時兼台中文心店長
UPDATE employees SET
  name_en = 'Willy',
  dept = '營運部',
  department_id = 23,
  store = '台中英才',
  store_id = 26,
  employment_type = '全職',
  status = '在職'
WHERE id = 134;

-- 周佳霖  → 營運部/南京建國
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '南京建國',
  store_id = 24,
  employment_type = '全職',
  status = '在職'
WHERE id = 113;

-- 鍾喬  → 營運部/中信南港
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '中信南港',
  store_id = 25,
  employment_type = '全職',
  status = '在職'
WHERE id = 107;

-- 劉家君  → 營運部/中山國小
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '中山國小',
  store_id = 29,
  employment_type = '全職',
  status = '在職'
WHERE id = 75;

-- 高承揚  → 營運部/微風廣場
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '微風廣場',
  store_id = 30,
  employment_type = '全職',
  status = '在職'
WHERE id = 94;

-- 馮千瑜  → 營運部/台中英才
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '台中英才',
  store_id = 26,
  employment_type = '全職',
  status = '在職'
WHERE id = 84;

-- 楊朝鈞  → 營運部/台中英才 — rename from 楊昭鈞 id=83
UPDATE employees SET
  name = '楊朝鈞',
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '台中英才',
  store_id = 26,
  employment_type = '全職',
  status = '在職'
WHERE id = 83;

-- 潘琦  → 營運部/台中英才
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '台中英才',
  store_id = 26,
  employment_type = '兼職',
  status = '在職'
WHERE id = 86;

-- 柯雨晶  → 營運部/台中英才
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '台中英才',
  store_id = 26,
  employment_type = '兼職',
  status = '在職'
WHERE id = 87;

-- 張惠萍  → 營運部/台中文心
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '台中文心',
  store_id = 27,
  employment_type = '全職',
  status = '在職'
WHERE id = 136;

-- 廖晉呈  → 營運部/台中文心
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '台中文心',
  store_id = 27,
  employment_type = '全職',
  status = '在職'
WHERE id = 135;

-- 張家禎  → 營運部/台中文心
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '台中文心',
  store_id = 27,
  employment_type = '全職',
  status = '在職'
WHERE id = 74;

-- 廖庭樟  → 營運部/台中文心
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '台中文心',
  store_id = 27,
  employment_type = '兼職',
  status = '在職'
WHERE id = 140;

-- 張耀  → 營運部/高雄中正
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '高雄中正',
  store_id = 28,
  employment_type = '全職',
  status = '在職'
WHERE id = 119;

-- 林家民  → 營運部/高雄中正
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '高雄中正',
  store_id = 28,
  employment_type = '全職',
  status = '在職'
WHERE id = 120;

-- 許育瑄  → 營運部/高雄中正
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '高雄中正',
  store_id = 28,
  employment_type = '全職',
  status = '在職'
WHERE id = 123;

-- 温子杰  → 營運部/高雄中正 — rename from 溫子杰 id=122 (unicode 異體)
UPDATE employees SET
  name = '温子杰',
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '高雄中正',
  store_id = 28,
  employment_type = '全職',
  status = '在職'
WHERE id = 122;

-- 陳涵妮  → 營運部/高雄中正
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '高雄中正',
  store_id = 28,
  employment_type = '兼職',
  status = '在職'
WHERE id = 124;

-- 陳富琦  → 營運部/高雄中正
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '高雄中正',
  store_id = 28,
  employment_type = '兼職',
  status = '在職'
WHERE id = 125;

-- 江建賦  → 營運部/高雄中正
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '高雄中正',
  store_id = 28,
  employment_type = '兼職',
  status = '在職'
WHERE id = 121;

-- 蘇東俞  → 營運部/Mla — 刪 typo 蘇東瑜 id=146
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = 'Mla',
  store_id = 19,
  employment_type = '全職',
  status = '在職'
WHERE id = 139;

-- 詹怡理  → 營運部/南京建國
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '南京建國',
  store_id = 24,
  employment_type = '全職',
  status = '在職'
WHERE id = 116;

-- 王竣禾  → 營運部/南京建國
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '南京建國',
  store_id = 24,
  employment_type = '全職',
  status = '在職'
WHERE id = 114;

-- 施怡廷  → 營運部/南京建國
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '南京建國',
  store_id = 24,
  employment_type = '全職',
  status = '在職'
WHERE id = 115;

-- 阮玉安  → 營運部/南京建國
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '南京建國',
  store_id = 24,
  employment_type = '兼職',
  status = '在職'
WHERE id = 118;

-- 陳芮葵  → 營運部/中信南港
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '中信南港',
  store_id = 25,
  employment_type = '全職',
  status = '在職'
WHERE id = 109;

-- 王育晨  → 營運部/中信南港
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '中信南港',
  store_id = 25,
  employment_type = '全職',
  status = '在職'
WHERE id = 108;

-- 黃瑋晴  → 營運部/中信南港
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '中信南港',
  store_id = 25,
  employment_type = '兼職',
  status = '在職'
WHERE id = 110;

-- 王萱之  → 營運部/中信南港
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '中信南港',
  store_id = 25,
  employment_type = '兼職',
  status = '在職'
WHERE id = 111;

-- 邱翊瑄  → 營運部/中信南港
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '中信南港',
  store_id = 25,
  employment_type = '兼職',
  status = '在職'
WHERE id = 112;

-- 黃為燁  → 營運部/中山國小
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '中山國小',
  store_id = 29,
  employment_type = '全職',
  status = '在職'
WHERE id = 80;

-- 許辰  → 營運部/中山國小
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '中山國小',
  store_id = 29,
  employment_type = '兼職',
  status = '在職'
WHERE id = 81;

-- 莊浩隆  → 營運部/中山國小
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '中山國小',
  store_id = 29,
  employment_type = '兼職',
  status = '在職'
WHERE id = 79;

-- 王澤昇  → 營運部/中山國小
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '中山國小',
  store_id = 29,
  employment_type = '兼職',
  status = '在職'
WHERE id = 78;

-- 林則宇  → 營運部/中山國小
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '中山國小',
  store_id = 29,
  employment_type = '兼職',
  status = '在職'
WHERE id = 77;

-- 林孟豪  → 營運部/微風廣場 — 圖標全職、DB 為兼職 → 改全職
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '微風廣場',
  store_id = 30,
  employment_type = '全職',
  status = '在職'
WHERE id = 99;

-- 吳承祐  → 營運部/微風廣場
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '微風廣場',
  store_id = 30,
  employment_type = '全職',
  status = '在職'
WHERE id = 95;

-- 李欣霏  → 營運部/微風廣場
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '微風廣場',
  store_id = 30,
  employment_type = '兼職',
  status = '在職'
WHERE id = 98;

-- 林豫賢  → 營運部/微風廣場
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '微風廣場',
  store_id = 30,
  employment_type = '兼職',
  status = '在職'
WHERE id = 100;

-- 陳羽庭  → 營運部/松江長安 — 圖標全職、DB 為兼職 → 改全職
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '松江長安',
  store_id = 34,
  employment_type = '全職',
  status = '在職'
WHERE id = 133;

-- 呂柏毅  → 營運部/松江長安
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '松江長安',
  store_id = 34,
  employment_type = '全職',
  status = '在職'
WHERE id = 130;

-- 蕭佑庭  → 營運部/松江長安
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '松江長安',
  store_id = 34,
  employment_type = '全職',
  status = '在職'
WHERE id = 129;

-- 孫嘉澤  → 營運部/松江長安
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '松江長安',
  store_id = 34,
  employment_type = '全職',
  status = '在職'
WHERE id = 131;

-- 王莉庭  → 營運部/松江長安
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '松江長安',
  store_id = 34,
  employment_type = '兼職',
  status = '在職'
WHERE id = 132;

-- 潘胤傑  → 營運部/天母百貨
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '天母百貨',
  store_id = 32,
  employment_type = '全職',
  status = '在職'
WHERE id = 101;

-- 戴羿弘  → 營運部/天母百貨
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '天母百貨',
  store_id = 32,
  employment_type = '全職',
  status = '在職'
WHERE id = 102;

-- 曲相澐  → 營運部/天母百貨
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '天母百貨',
  store_id = 32,
  employment_type = '兼職',
  status = '在職'
WHERE id = 104;

-- 李建廷  → 營運部/天母百貨
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '天母百貨',
  store_id = 32,
  employment_type = '兼職',
  status = '在職'
WHERE id = 105;

-- 李忠霖  → 營運部/天母百貨
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '天母百貨',
  store_id = 32,
  employment_type = '兼職',
  status = '在職'
WHERE id = 106;

-- 余盈軒  → 營運部/天母百貨
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '天母百貨',
  store_id = 32,
  employment_type = '兼職',
  status = '在職'
WHERE id = 143;

-- 郭芷如  → 營運部/六張犁
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '六張犁',
  store_id = 33,
  employment_type = '全職',
  status = '在職'
WHERE id = 127;

-- 劉萱  → 營運部/六張犁
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '六張犁',
  store_id = 33,
  employment_type = '兼職',
  status = '在職'
WHERE id = 128;

-- 許亦翎  → 營運部/台北永春
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '台北永春',
  store_id = 31,
  employment_type = '全職',
  status = '在職'
WHERE id = 89;

-- 徐宥芯  → 營運部/台北永春
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '台北永春',
  store_id = 31,
  employment_type = '全職',
  status = '在職'
WHERE id = 90;

-- 洪瑛奴  → 營運部/台北永春 — rename from 洪瑛妏 id=92
UPDATE employees SET
  name = '洪瑛奴',
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '台北永春',
  store_id = 31,
  employment_type = '兼職',
  status = '在職'
WHERE id = 92;

-- 蔡伊真  → 營運部/台北永春
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '台北永春',
  store_id = 31,
  employment_type = '兼職',
  status = '在職'
WHERE id = 93;

-- 林思妤  → 營運部/台北永春
UPDATE employees SET
  name_en = NULL,
  dept = '營運部',
  department_id = 23,
  store = '台北永春',
  store_id = 31,
  employment_type = '兼職',
  status = '在職'
WHERE id = 142;

-- =============================================
-- Section 3: INSERT 新人 (9 筆)
-- =============================================
-- 林襄 (Sunny) → 品牌行銷部/–
INSERT INTO employees (organization_id, name, name_en, dept, department_id, store, store_id, position, employment_type, status)
VALUES (
  1, '林襄', 'Sunny',
  '品牌行銷部', 24,
  NULL, NULL,
  '部員', '全職', '在職'
);

-- 陳楷仁 (Kevin) → 人力資源部/–
INSERT INTO employees (organization_id, name, name_en, dept, department_id, store, store_id, position, employment_type, status)
VALUES (
  1, '陳楷仁', 'Kevin',
  '人力資源部', 26,
  NULL, NULL,
  '部員', '全職', '在職'
);

-- 羅紹輝 (Jack) → 營運部/–
INSERT INTO employees (organization_id, name, name_en, dept, department_id, store, store_id, position, employment_type, status)
VALUES (
  1, '羅紹輝', 'Jack',
  '營運部', 23,
  NULL, NULL,
  '督導', '全職', '在職'
);

-- 莫徐浩  → 營運部/中信南港
INSERT INTO employees (organization_id, name, name_en, dept, department_id, store, store_id, position, employment_type, status)
VALUES (
  1, '莫徐浩', NULL,
  '營運部', 23,
  '中信南港', 25,
  '店員', '兼職', '在職'
);

-- 邱婕涵  → 營運部/中山國小
INSERT INTO employees (organization_id, name, name_en, dept, department_id, store, store_id, position, employment_type, status)
VALUES (
  1, '邱婕涵', NULL,
  '營運部', 23,
  '中山國小', 29,
  '店員', '全職', '在職'
);

-- 沈怡臻  → 營運部/微風廣場
INSERT INTO employees (organization_id, name, name_en, dept, department_id, store, store_id, position, employment_type, status)
VALUES (
  1, '沈怡臻', NULL,
  '營運部', 23,
  '微風廣場', 30,
  '店員', '全職', '在職'
);

-- 張彥婷  → 營運部/松江長安
INSERT INTO employees (organization_id, name, name_en, dept, department_id, store, store_id, position, employment_type, status)
VALUES (
  1, '張彥婷', NULL,
  '營運部', 23,
  '松江長安', 34,
  '店員', '兼職', '在職'
);

-- 黃慈微  → 營運部/天母百貨
INSERT INTO employees (organization_id, name, name_en, dept, department_id, store, store_id, position, employment_type, status)
VALUES (
  1, '黃慈微', NULL,
  '營運部', 23,
  '天母百貨', 32,
  '店員', '兼職', '在職'
);

-- 陳姿瑩  → 營運部/台北永春
INSERT INTO employees (organization_id, name, name_en, dept, department_id, store, store_id, position, employment_type, status)
VALUES (
  1, '陳姿瑩', NULL,
  '營運部', 23,
  '台北永春', 31,
  '店員', '兼職', '在職'
);

-- =============================================
-- Section 4: SOFT DELETE (status='離職') 27 筆
-- 不 hard DELETE 是因為 23 個 NO ACTION FK 會擋。
-- 後續 cleanup 階段可以另外處理硬刪。
-- =============================================
-- 4a. 雙胞胎 / typo merge (13 筆)
-- id=55 曠虎 → merge 到 韓虎 (id=48)
-- id=56 陳虹 → merge 到 陳虹 (id=52)
-- id=144 Cherry → merge 到 林巧玉 (id=60)
-- id=46 Anita → merge 到 詹建如 (id=145)
-- id=70 詹健如 → merge 到 詹建如 (id=145)
-- id=50 Vicky → merge 到 張庭瑋 (id=62)
-- id=147 Vicky → merge 到 張庭瑋 (id=62)
-- id=57 張啟達 → merge 到 張啟達 (id=152)
-- id=53 學文 → merge 到 楊學文 (id=153)
-- id=69 楊學文 → merge 到 楊學文 (id=153)
-- id=49 Ken → merge 到 張開翔 (id=65)
-- id=63 黃瑀珊 → merge 到 黃蘊珊 (id=148)
-- id=146 蘇東瑜 → merge 到 蘇東俞 (id=139)
UPDATE employees SET status = '離職'
WHERE id IN (46, 49, 50, 53, 55, 56, 57, 63, 69, 70, 144, 146, 147);

-- 4b. 真離職 / 測試帳號 / 漏列 (14 筆)
-- id=45 Alicia (財務部/門市人員)
-- id=54 營運 (營運部/營運專員)
-- id=61 游以欣 (加盟展店事業部/主任)
-- id=66 林冀 (品牌行銷部/視覺設計)
-- id=67 黃品穎 (品牌行銷部/行銷)
-- id=76 張丞佑 (營運部/門市正職人員)
-- id=85 林善智 (營運部/門市兼職人員)
-- id=96 陳怡臻 (營運部/門市正職人員)
-- id=97 康維珊 (營運部/門市兼職人員)
-- id=126 詹程瀚 (營運部/門市正職人員)
-- id=154 花輪 (倉儲物流部/部門主管)
-- id=155 阿謙 (倉儲物流部/副主管)
-- id=204 測試管理員 (–/系統管理員)
-- id=205 測試員工 (營運部/門市人員)
UPDATE employees SET status = '離職'
WHERE id IN (45, 54, 61, 66, 67, 76, 85, 96, 97, 126, 154, 155, 204, 205);

-- =============================================
-- Section 5: 安全檢查 assertion
-- =============================================
-- 確認 8 個 LINE 綁定 id 還在且 status='在職'
DO $$
DECLARE
  missing_count INT;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM (VALUES (10),(44),(48),(52),(58),(62),(148),(152)) AS t(id)
  WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = t.id AND e.status = '在職');
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'LINE 綁定 id 缺失或變成離職: %', missing_count;
  END IF;
END $$;

-- 確認在職人數 = 86
DO $$
DECLARE
  active_count INT;
BEGIN
  SELECT COUNT(*) INTO active_count FROM employees WHERE status = '在職';
  IF active_count <> 86 THEN
    RAISE EXCEPTION '在職人數異常: 期望 86, 實際 %', active_count;
  END IF;
END $$;

COMMIT;
