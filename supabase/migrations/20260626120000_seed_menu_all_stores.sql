-- ════════════════════════════════════════════════════════════════════════════
-- 菜單資料匯入（全門市）
-- 來源：新品上市.pdf
-- 分類 7 個 × 共 49 個品項；idempotent（同名品項已存在就跳過）
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_org_id  INT;
  v_store   RECORD;
  c_new     UUID; c_pasta UUID; c_meat  UUID;
  c_steak   UUID; c_pizza UUID; c_fried UUID; c_sea   UUID;
BEGIN
  SELECT id INTO v_org_id FROM organizations LIMIT 1;

  FOR v_store IN SELECT id FROM stores WHERE organization_id = v_org_id LOOP

    -- ── 插入 / 取得分類 ───────────────────────────────────────────────────
    INSERT INTO pos_menu_categories(organization_id, store_id, name, display_order, is_active)
    VALUES
      (v_org_id, v_store.id, '新品上市',                    1, true),
      (v_org_id, v_store.id, '義大利麵 & 燉飯',             2, true),
      (v_org_id, v_store.id, '精選肉食',                    3, true),
      (v_org_id, v_store.id, '精選牛排',                    4, true),
      (v_org_id, v_store.id, '披薩',                        5, true),
      (v_org_id, v_store.id, '精選餐點 - 炸物與烤物',       6, true),
      (v_org_id, v_store.id, '精選餐點 - 海鮮、肉類與小點', 7, true)
    ON CONFLICT DO NOTHING;

    SELECT id INTO c_new   FROM pos_menu_categories WHERE store_id = v_store.id AND name = '新品上市';
    SELECT id INTO c_pasta FROM pos_menu_categories WHERE store_id = v_store.id AND name = '義大利麵 & 燉飯';
    SELECT id INTO c_meat  FROM pos_menu_categories WHERE store_id = v_store.id AND name = '精選肉食';
    SELECT id INTO c_steak FROM pos_menu_categories WHERE store_id = v_store.id AND name = '精選牛排';
    SELECT id INTO c_pizza FROM pos_menu_categories WHERE store_id = v_store.id AND name = '披薩';
    SELECT id INTO c_fried FROM pos_menu_categories WHERE store_id = v_store.id AND name = '精選餐點 - 炸物與烤物';
    SELECT id INTO c_sea   FROM pos_menu_categories WHERE store_id = v_store.id AND name = '精選餐點 - 海鮮、肉類與小點';

    -- ── 新品上市 ──────────────────────────────────────────────────────────
    INSERT INTO pos_menu_items(organization_id, store_id, category_id, name, description, unit_price, display_order, is_available)
    SELECT v_org_id, v_store.id, c_new, t.name, t.desc, t.price, t.ord, true
    FROM (VALUES
      (1, '鮭魚炊飯',        'Salmon Takikomi Rice',        228),
      (2, '鱸魚炊飯',        'Sea Bass Takikomi Rice',      228),
      (3, 'XO 鮑魚爆炒義大利麵', 'XO Abalone Stir-Fried Pasta', 368),
      (4, '爽爆混合海鮮',    'Ultimate Mixed Seafood',       628)
    ) AS t(ord, name, desc, price)
    WHERE NOT EXISTS (
      SELECT 1 FROM pos_menu_items
      WHERE store_id = v_store.id AND name = t.name
    );

    -- ── 義大利麵 & 燉飯 ──────────────────────────────────────────────────
    INSERT INTO pos_menu_items(organization_id, store_id, category_id, name, description, unit_price, display_order, is_available)
    SELECT v_org_id, v_store.id, c_pasta, t.name, t.desc, t.price, t.ord, true
    FROM (VALUES
      (1, '南義風味鮭魚白醬義大利麵', 'Creamy Southern Italian Salmon Pasta',        168),
      (2, '蒜香雞腿排青醬燉飯',       'Garlic-Roasted Chicken Leg Pesto Risotto',    168),
      (3, '舒肥牛肉紅醬燉飯',         'Tomato Risotto with Sous Vide Beef',           288),
      (4, '松露菌菇醬燉飯',           'Truffle Mushroom Cream Risotto',               328)
    ) AS t(ord, name, desc, price)
    WHERE NOT EXISTS (
      SELECT 1 FROM pos_menu_items
      WHERE store_id = v_store.id AND name = t.name
    );

    -- ── 精選肉食 ──────────────────────────────────────────────────────────
    INSERT INTO pos_menu_items(organization_id, store_id, category_id, name, description, unit_price, display_order, is_available)
    SELECT v_org_id, v_store.id, c_meat, t.name, t.desc, t.price, t.ord, true
    FROM (VALUES
      (1, '秘制豬肋排 400-450g',   'Roasted Pork Ribs 400-450g',                   498),
      (2, '蔗香剖半豬腳 400-450g', 'Sugarcane-Scented Halved Pork Knuckle 400-450g',368),
      (3, '脆皮德國豬腳 500-600g', 'Crispy German Pork Knuckle 500-600g',           298),
      (4, '酸黃瓜片 30g',          '醬料配菜加購',                                    30),
      (5, '芥末醬 20g',            '醬料配菜加購',                                    20),
      (6, '酸菜 20g',              '醬料配菜加購',                                    20)
    ) AS t(ord, name, desc, price)
    WHERE NOT EXISTS (
      SELECT 1 FROM pos_menu_items
      WHERE store_id = v_store.id AND name = t.name
    );

    -- ── 精選牛排 ──────────────────────────────────────────────────────────
    INSERT INTO pos_menu_items(organization_id, store_id, category_id, name, description, unit_price, display_order, is_available)
    SELECT v_org_id, v_store.id, c_steak, t.name, t.desc, t.price, t.ord, true
    FROM (VALUES
      (1, '美國 Choice 肋眼牛排 10盎司', 'American Choice Rib Eye Steak / 10oz，搭配薯條', 788),
      (2, '美國帶骨牛小排 10盎司',       'US Bone-in Beef Short Ribs / 10oz，搭配薯條',    599),
      (3, '紐西蘭菲力牛排 6盎司',        'New Zealand Fillet Steak / 6oz，搭配薯條',        499)
    ) AS t(ord, name, desc, price)
    WHERE NOT EXISTS (
      SELECT 1 FROM pos_menu_items
      WHERE store_id = v_store.id AND name = t.name
    );

    -- ── 披薩 ──────────────────────────────────────────────────────────────
    INSERT INTO pos_menu_items(organization_id, store_id, category_id, name, description, unit_price, display_order, is_available)
    SELECT v_org_id, v_store.id, c_pizza, t.name, t.desc, t.price, t.ord, true
    FROM (VALUES
      (1, '11吋金牌法國廚師燻鮭魚風味比薩', '正統風味，披薩之王', 358),
      (2, '11吋金牌法國廚師特製烤蔬菜比薩', '正統風味，披薩之王', 288),
      (3, '11吋金牌法國廚師混合起司比薩',   '正統風味，披薩之王', 258),
      (4, '11吋金牌法國廚師莫札瑞拉起司比薩','正統風味，披薩之王', 258),
      (5, '11吋金牌法國廚師海鮮比薩',       '正統風味，披薩之王', 258),
      (6, '11吋金牌法國廚師菠菜蘑菇比薩',   '正統風味，披薩之王', 199),
      (7, '8吋辣味墨西哥披薩',              '正統風味，披薩之王', 288)
    ) AS t(ord, name, desc, price)
    WHERE NOT EXISTS (
      SELECT 1 FROM pos_menu_items
      WHERE store_id = v_store.id AND name = t.name
    );

    -- ── 精選餐點 - 炸物與烤物 ─────────────────────────────────────────────
    INSERT INTO pos_menu_items(organization_id, store_id, category_id, name, description, unit_price, display_order, is_available)
    SELECT v_org_id, v_store.id, c_fried, t.name, t.desc, t.price, t.ord, true
    FROM (VALUES
      ( 1, '海鮮香炸拼盤',       '卡達菲蝦+軟殼蟹+鰺魚排',               428),
      ( 2, '綜合炸物拼盤',       '薯條150g+洋蔥圈3入+檸檬雞柳條3入',     159),
      ( 3, '銷魂檸檬雞翅&翅小腿雙拼', '雞翅&翅小腿各4支',                219),
      ( 4, '十三香雞翅',         '4支',                                  148),
      ( 5, '皇家金牌線蝦',       '5隻',                                  388),
      ( 6, '屯火軟殼蟹',         '8隻',                                  288),
      ( 7, '香炸鰺魚排',         '5片',                                  188),
      ( 8, '日式炸豬排',         '200g',                                 159),
      ( 9, '秘制無骨鹽酥雞',     '160g',                                 129),
      (10, '檸檬雞柳條',         '6入',                                  129),
      (11, 'LEDUC 洋蔥圈',       '8入',                                  129),
      (12, '美式薯條',           '200g',                                 129)
    ) AS t(ord, name, desc, price)
    WHERE NOT EXISTS (
      SELECT 1 FROM pos_menu_items
      WHERE store_id = v_store.id AND name = t.name
    );

    -- ── 精選餐點 - 海鮮、肉類與小點 ──────────────────────────────────────
    INSERT INTO pos_menu_items(organization_id, store_id, category_id, name, description, unit_price, display_order, is_available)
    SELECT v_org_id, v_store.id, c_sea, t.name, t.desc, t.price, t.ord, true
    FROM (VALUES
      (1, '鮮烤大白蝦',       '8隻',                         338),
      (2, '南義風味鮭魚片',   '2片',                         258),
      (3, '岩烤魷魚',         '100g',                        198),
      (4, '岩烤鯖魚',         '125g',                        168),
      (5, '蒜香去骨雞腿排',   '280g',                        158),
      (6, '香腸拼盤',         '100g，台式飛魚卵&墨魚',       198),
      (7, '鰻魚爆卵香腸',     '120g',                        198),
      (8, '烤櫛瓜',           '150g',                         88),
      (9, '黑胡椒蒜味毛豆',   '100g',                         50)
    ) AS t(ord, name, desc, price)
    WHERE NOT EXISTS (
      SELECT 1 FROM pos_menu_items
      WHERE store_id = v_store.id AND name = t.name
    );

  END LOOP;
END $$;
