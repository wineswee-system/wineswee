-- 匯入投保級距 + 投保狀態旗標
-- 2026-07-08  來源：威耀時代 保險資料明細.xlsx（111 筆，全對到 employee_id）
-- 級距：labor_ins_grade / health_ins_grade（COALESCE 有值才寫、NULL 不蓋）
-- 旗標：labor_insurance / health_insurance 依檔案投保狀態——
--   「已加保」→ true；「退保/轉出/未加保」→ false（依附眷屬=不跟公司保→false→保費0）；
--   狀態不明 → NULL 不動。
-- 效果：跟家人保健保的人 health_insurance=false → _compute 跳過健保、不再 fallback 誤扣。
-- 級距寫入：勞保 79 / 健保 72；旗標設 false：勞保 32 / 健保 36。
-- 逗號在 ) 後避免被 -- 吃掉。idempotent。

UPDATE public.employees e SET
  labor_ins_grade  = COALESCE(v.labor,  e.labor_ins_grade),
  health_ins_grade = COALESCE(v.health, e.health_ins_grade),
  labor_insurance  = COALESCE(v.l_enr,  e.labor_insurance),
  health_insurance = COALESCE(v.h_enr,  e.health_insurance)
FROM (VALUES
  (48, 29500, 29500, true, true),  -- 韓德森
  (62, 45800, 60800, true, true),  -- 張庭瑋
  (59, 45800, 48200, true, true),  -- 李英顥
  (148, 45800, 55400, true, true),  -- 黃蘊珊
  (134, 45800, 45800, true, true),  -- 趙亭威
  (75, 45800, 45800, true, true),  -- 劉家君
  (141, 45800, 45800, true, true),  -- 陳嘉益
  (94, 45800, 45800, true, true),  -- 高承揚
  (107, 45800, 45800, true, true),  -- 鍾喬
  (84, 40100, 40100, true, true),  -- 馮千瑜
  (65, 45800, 50600, true, true),  -- 張開翔
  (71, 45800, 48200, true, true),  -- 陳佩璇
  (64, 45800, 60800, true, true),  -- 徐其祥
  (146, 40100, 40100, true, true),  -- 蘇東俞
  (101, 40100, 40100, true, true),  -- 潘胤傑
  (397, 40100, 40100, true, true),  -- 許亦翎
  (79, 11100, 29500, true, true),  -- 莊浩隆
  (99, 40100, 40100, true, true),  -- 林孟豪
  (213, 40100, 40100, true, true),  -- 沈怡臻
  (78, 11100, NULL, true, false),  -- 王澤昇
  (72, 40100, 40100, true, true),  -- 楊家謙
  (80, 45800, NULL, true, true),  -- 黃為燁
  (145, 45800, 45800, true, true),  -- 詹健如
  (208, 45800, 50600, true, true),  -- 林襄
  (110, 11100, NULL, true, true),  -- 黃瑋晴
  (113, 45800, 45800, true, true),  -- 周佳霖
  (109, 40100, 40100, true, true),  -- 陳芮葵
  (108, 45800, 48200, true, true),  -- 王育晨
  (122, 40100, 40100, true, true),  -- 温子杰
  (123, 40100, 40100, true, true),  -- 許育瑄
  (398, 40100, 40100, true, true),  -- 徐宥芯
  (77, 11100, 29500, true, true),  -- 林則宇
  (119, 40100, 40100, true, true),  -- 張耀
  (95, 40100, 40100, true, true),  -- 吳承祐
  (128, 11100, 29500, true, true),  -- 劉萱
  (127, 42000, 42000, true, true),  -- 郭芷如
  (133, 40100, 40100, true, true),  -- 陳羽庭
  (136, 40100, 40100, true, true),  -- 張惠萍
  (130, 40100, 40100, true, true),  -- 呂柏毅
  (129, 42000, 42000, true, true),  -- 蕭佑庭
  (68, 45800, 48200, true, true),  -- 劉雅玲
  (135, 45800, 45800, true, true),  -- 廖晉呈
  (74, 42000, 42000, true, true),  -- 張家禎
  (120, 42000, 42000, true, true),  -- 林家民
  (116, 42000, 42000, true, true),  -- 詹怡理
  (114, 42000, 42000, true, true),  -- 王竣禾
  (115, 45800, 45800, true, true),  -- 施怡廷
  (152, 45800, 101100, true, true),  -- 張啟達
  (60, 45800, 69800, true, true),  -- 林巧玉
  (58, 45800, 53000, true, true),  -- 尤致皓
  (209, 40100, 40100, true, true),  -- 陳楷仁
  (210, 45800, 60800, true, true),  -- 羅紹輝
  (406, 45800, 45800, true, true),  -- 吳昕芛
  (415, 45800, 80200, true, true),  -- 侯承寯
  (419, 42000, 42000, true, true),  -- 蔡沛潔
  (10, 45800, 50600, true, true),  -- 洪伯嘉
  (98, 11100, 29500, true, true),  -- 李欣霏
  (106, 11100, 29500, true, true),  -- 李忠霖
  (121, 11100, 29500, true, true),  -- 江建賦
  (131, 11100, 29500, true, true),  -- 孫嘉澤
  (384, 11100, 29500, true, true),  -- 洪瑛妏
  (111, 11100, 29500, true, true),  -- 王萱之
  (100, 11100, NULL, true, false),  -- 林豫賢
  (211, 11100, 29500, true, true),  -- 莫徐浩
  (405, 11100, NULL, true, false),  -- 游承軒
  (409, 11100, NULL, true, false),  -- 劉俊廷
  (404, 11100, 29500, true, true),  -- 鄭力瑄
  (417, 11100, 29500, true, true),  -- 許承雋
  (418, 11100, 29500, true, true),  -- 黃傑查絡
  (431, 11100, 29500, true, true),  -- 洪友銘
  (430, 11100, 29500, true, true),  -- 郭中亨
  (83, NULL, NULL, false, false),  -- 楊朝鈞
  (69, NULL, NULL, false, false),  -- 楊學文
  (86, NULL, NULL, false, false),  -- 潘琦
  (76, NULL, NULL, false, false),  -- 張丞佑
  (104, 11100, 29500, true, true),  -- 曲相澐
  (73, NULL, NULL, false, false),  -- 朱紹蕾
  (85, NULL, NULL, false, false),  -- 林善智
  (105, 11100, 29500, true, true),  -- 李建廷
  (387, NULL, NULL, false, false),  -- 張惇惠
  (118, NULL, NULL, false, false),  -- 阮玉安
  (81, NULL, NULL, false, false),  -- 許辰
  (124, NULL, NULL, false, false),  -- 陳涵妮
  (61, NULL, NULL, false, false),  -- 游以欣
  (125, 11100, NULL, true, true),  -- 陳富琦
  (126, NULL, NULL, false, false),  -- 詹程瀚
  (388, NULL, NULL, false, false),  -- 黃品翰
  (137, NULL, NULL, false, false),  -- 徐宛利
  (102, NULL, NULL, false, false),  -- 戴羿弘
  (212, NULL, NULL, false, false),  -- 邱婕涵
  (151, NULL, NULL, false, false),  -- 游如梅
  (408, NULL, NULL, false, false),  -- 廖俊凱
  (402, NULL, NULL, false, false),  -- 陳苡慧
  (97, NULL, NULL, false, false),  -- 康維珊
  (132, NULL, NULL, false, false),  -- 王莉庭
  (389, NULL, NULL, false, false),  -- 朱憲暉
  (390, NULL, NULL, false, false),  -- 何芯彗
  (399, NULL, NULL, false, false),  -- 蔡伊真
  (87, NULL, NULL, false, false),  -- 柯雨晶
  (112, NULL, NULL, false, false),  -- 邱翊瑄
  (400, NULL, NULL, false, false),  -- 林思妤
  (140, 11100, 29500, true, true),  -- 廖庭樟
  (143, NULL, NULL, false, false),  -- 余盈軒
  (401, NULL, NULL, false, false),  -- 陳姿螢
  (214, 11100, 29500, true, true),  -- 張彥婷
  (215, NULL, NULL, false, false),  -- 黃慈微
  (386, NULL, NULL, false, false),  -- 吳恩齊
  (407, NULL, NULL, false, false),  -- 陳柔逸
  (403, 11100, 29500, true, true),  -- 賴德旻
  (416, 11100, 29500, true, true),  -- 陳毅宇
  (420, 11100, 29500, true, true)   -- 吳旻軒
) AS v(emp_id, labor, health, l_enr, h_enr)
WHERE e.id = v.emp_id;

NOTIFY pgrst, 'reload schema';
