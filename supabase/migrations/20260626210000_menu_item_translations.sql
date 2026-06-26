-- 菜單品項多語言翻譯欄位
ALTER TABLE pos_menu_items
  ADD COLUMN IF NOT EXISTS name_en TEXT,
  ADD COLUMN IF NOT EXISTS name_ja TEXT,
  ADD COLUMN IF NOT EXISTS name_ko TEXT;

-- ── 新品上市 ──────────────────────────────────────────────────────────────────
UPDATE pos_menu_items SET
  name_en = 'Salmon Takikomi Rice',
  name_ja = '鮭の炊き込みご飯',
  name_ko = '연어 다키코미 밥'
WHERE name = '鮭魚炊飯';

UPDATE pos_menu_items SET
  name_en = 'Sea Bass Takikomi Rice',
  name_ja = 'スズキの炊き込みご飯',
  name_ko = '농어 다키코미 밥'
WHERE name = '鱸魚炊飯';

UPDATE pos_menu_items SET
  name_en = 'XO Abalone Stir-Fried Pasta',
  name_ja = 'XO鮑炒めパスタ',
  name_ko = 'XO 전복 볶음 파스타'
WHERE name = 'XO 鮑魚爆炒義大利麵';

UPDATE pos_menu_items SET
  name_en = 'Ultimate Mixed Seafood',
  name_ja = '特選ミックスシーフード',
  name_ko = '혼합 해산물 특선'
WHERE name = '爽爆混合海鮮';

-- ── 義大利麵 & 燉飯 ──────────────────────────────────────────────────────────
UPDATE pos_menu_items SET
  name_en = 'Creamy Southern Italian Salmon Pasta',
  name_ja = '南イタリア風サーモンクリームパスタ',
  name_ko = '남이탈리아 연어 크림 파스타'
WHERE name = '南義風味鮭魚白醬義大利麵';

UPDATE pos_menu_items SET
  name_en = 'Garlic Chicken Leg Pesto Risotto',
  name_ja = 'ガーリックチキンレッグ ペストリゾット',
  name_ko = '마늘 닭다리 페스토 리조또'
WHERE name = '蒜香雞腿排青醬燉飯';

UPDATE pos_menu_items SET
  name_en = 'Tomato Risotto with Sous Vide Beef',
  name_ja = 'スービード牛肉のトマトリゾット',
  name_ko = '수비드 소고기 토마토 리조또'
WHERE name = '舒肥牛肉紅醬燉飯';

UPDATE pos_menu_items SET
  name_en = 'Truffle Mushroom Cream Risotto',
  name_ja = 'トリュフきのこクリームリゾット',
  name_ko = '트러플 버섯 크림 리조또'
WHERE name = '松露菌菇醬燉飯';

-- ── 精選肉食 ──────────────────────────────────────────────────────────────────
UPDATE pos_menu_items SET
  name_en = 'Roasted Pork Ribs 400-450g',
  name_ja = '秘伝ポークリブ 400-450g',
  name_ko = '비법 돼지 갈비 400-450g'
WHERE name = '秘制豬肋排 400-450g';

UPDATE pos_menu_items SET
  name_en = 'Sugarcane Pork Knuckle 400-450g',
  name_ja = 'サトウキビ香るポークナックル 400-450g',
  name_ko = '사탕수수 향 족발 400-450g'
WHERE name = '蔗香剖半豬腳 400-450g';

UPDATE pos_menu_items SET
  name_en = 'Crispy German Pork Knuckle 500-600g',
  name_ja = 'クリスピードイツポークナックル 500-600g',
  name_ko = '바삭한 독일 족발 500-600g'
WHERE name = '脆皮德國豬腳 500-600g';

UPDATE pos_menu_items SET
  name_en = 'Pickled Cucumber 30g',
  name_ja = 'ピクルス 30g',
  name_ko = '피클 오이 30g'
WHERE name = '酸黃瓜片 30g';

UPDATE pos_menu_items SET
  name_en = 'Mustard Sauce 20g',
  name_ja = 'マスタードソース 20g',
  name_ko = '머스터드 소스 20g'
WHERE name = '芥末醬 20g';

UPDATE pos_menu_items SET
  name_en = 'Sauerkraut 20g',
  name_ja = 'ザワークラウト 20g',
  name_ko = '사우어크라우트 20g'
WHERE name = '酸菜 20g';

-- ── 精選牛排 ──────────────────────────────────────────────────────────────────
UPDATE pos_menu_items SET
  name_en = 'US Choice Ribeye Steak 10oz',
  name_ja = 'USチョイス リブアイステーキ 10oz',
  name_ko = '미국 초이스 립아이 스테이크 10oz'
WHERE name = '美國 Choice 肋眼牛排 10盎司';

UPDATE pos_menu_items SET
  name_en = 'US Bone-in Short Ribs 10oz',
  name_ja = 'アメリカン骨付き牛カルビ 10oz',
  name_ko = '미국 본인 소갈비 10oz'
WHERE name = '美國帶骨牛小排 10盎司';

UPDATE pos_menu_items SET
  name_en = 'New Zealand Fillet Steak 6oz',
  name_ja = 'NZフィレステーキ 6oz',
  name_ko = '뉴질랜드 필레 스테이크 6oz'
WHERE name = '紐西蘭菲力牛排 6盎司';

-- ── 披薩 ──────────────────────────────────────────────────────────────────────
UPDATE pos_menu_items SET
  name_en = '11" Gold Medal Smoked Salmon Pizza',
  name_ja = '11インチ金賞スモークサーモンピザ',
  name_ko = '11인치 금메달 훈제연어 피자'
WHERE name = '11吋金牌法國廚師燻鮭魚風味比薩';

UPDATE pos_menu_items SET
  name_en = '11" Gold Medal Roasted Vegetable Pizza',
  name_ja = '11インチ金賞ロースト野菜ピザ',
  name_ko = '11인치 금메달 구운 채소 피자'
WHERE name = '11吋金牌法國廚師特製烤蔬菜比薩';

UPDATE pos_menu_items SET
  name_en = '11" Gold Medal Mixed Cheese Pizza',
  name_ja = '11インチ金賞ミックスチーズピザ',
  name_ko = '11인치 금메달 믹스 치즈 피자'
WHERE name = '11吋金牌法國廚師混合起司比薩';

UPDATE pos_menu_items SET
  name_en = '11" Gold Medal Mozzarella Pizza',
  name_ja = '11インチ金賞モッツァレラピザ',
  name_ko = '11인치 금메달 모짜렐라 피자'
WHERE name = '11吋金牌法國廚師莫札瑞拉起司比薩';

UPDATE pos_menu_items SET
  name_en = '11" Gold Medal Seafood Pizza',
  name_ja = '11インチ金賞シーフードピザ',
  name_ko = '11인치 금메달 해산물 피자'
WHERE name = '11吋金牌法國廚師海鮮比薩';

UPDATE pos_menu_items SET
  name_en = '11" Gold Medal Spinach Mushroom Pizza',
  name_ja = '11インチ金賞ほうれん草きのこピザ',
  name_ko = '11인치 금메달 시금치 버섯 피자'
WHERE name = '11吋金牌法國廚師菠菜蘑菇比薩';

UPDATE pos_menu_items SET
  name_en = '8" Spicy Mexican Pizza',
  name_ja = '8インチスパイシーメキシカンピザ',
  name_ko = '8인치 스파이시 멕시코 피자'
WHERE name = '8吋辣味墨西哥披薩';

-- ── 精選餐點 - 炸物與烤物 ─────────────────────────────────────────────────────
UPDATE pos_menu_items SET
  name_en = 'Crispy Seafood Platter',
  name_ja = 'クリスピーシーフードプラッター',
  name_ko = '바삭한 해산물 모둠'
WHERE name = '海鮮香炸拼盤';

UPDATE pos_menu_items SET
  name_en = 'Mixed Fried Platter',
  name_ja = 'ミックスフライドプラッター',
  name_ko = '혼합 튀김 모둠'
WHERE name = '綜合炸物拼盤';

UPDATE pos_menu_items SET
  name_en = 'Lemon Chicken Wings & Drumettes',
  name_ja = 'レモンチキンウィング＆ドラムエット',
  name_ko = '레몬 닭날개 & 봉 모둠'
WHERE name = '銷魂檸檬雞翅&翅小腿雙拼';

UPDATE pos_menu_items SET
  name_en = 'Thirteen-Spice Chicken Wings',
  name_ja = '十三香チキンウィング',
  name_ko = '13향신료 닭날개'
WHERE name = '十三香雞翅';

UPDATE pos_menu_items SET
  name_en = 'Royal Gold Shrimp',
  name_ja = 'ロイヤルゴールドシュリンプ',
  name_ko = '로얄 골드 새우'
WHERE name = '皇家金牌線蝦';

UPDATE pos_menu_items SET
  name_en = 'Soft Shell Crab',
  name_ja = 'ソフトシェルクラブ',
  name_ko = '소프트쉘 크랩'
WHERE name = '屯火軟殼蟹';

UPDATE pos_menu_items SET
  name_en = 'Crispy Trevally Fillet',
  name_ja = 'クリスピーアジフィレ',
  name_ko = '바삭한 전갱이 필레'
WHERE name = '香炸鰺魚排';

UPDATE pos_menu_items SET
  name_en = 'Japanese Tonkatsu',
  name_ja = 'とんかつ',
  name_ko = '일본식 돈가스'
WHERE name = '日式炸豬排';

UPDATE pos_menu_items SET
  name_en = 'Boneless Salt Popcorn Chicken',
  name_ja = '秘伝ボーンレスソルトチキン',
  name_ko = '비법 뼈없는 소금 닭'
WHERE name = '秘制無骨鹽酥雞';

UPDATE pos_menu_items SET
  name_en = 'Lemon Chicken Strips',
  name_ja = 'レモンチキンストリップス',
  name_ko = '레몬 닭가슴살 스트립'
WHERE name = '檸檬雞柳條';

UPDATE pos_menu_items SET
  name_en = 'LEDUC Onion Rings',
  name_ja = 'LEDUCオニオンリング',
  name_ko = 'LEDUC 양파링'
WHERE name = 'LEDUC 洋蔥圈';

UPDATE pos_menu_items SET
  name_en = 'American Fries',
  name_ja = 'アメリカンフライドポテト',
  name_ko = '아메리칸 감자튀김'
WHERE name = '美式薯條';

-- ── 精選餐點 - 海鮮、肉類與小點 ──────────────────────────────────────────────
UPDATE pos_menu_items SET
  name_en = 'Grilled King Prawns',
  name_ja = '焼き大エビ',
  name_ko = '구운 대왕새우'
WHERE name = '鮮烤大白蝦';

UPDATE pos_menu_items SET
  name_en = 'Southern Italian Style Salmon',
  name_ja = '南イタリア風サーモンスライス',
  name_ko = '남이탈리아 스타일 연어'
WHERE name = '南義風味鮭魚片';

UPDATE pos_menu_items SET
  name_en = 'Rock-Grilled Squid',
  name_ja = '岩焼きイカ',
  name_ko = '돌구이 오징어'
WHERE name = '岩烤魷魚';

UPDATE pos_menu_items SET
  name_en = 'Rock-Grilled Mackerel',
  name_ja = '岩焼きサバ',
  name_ko = '돌구이 고등어'
WHERE name = '岩烤鯖魚';

UPDATE pos_menu_items SET
  name_en = 'Garlic Boneless Chicken Leg',
  name_ja = 'ガーリックボーンレスチキンレッグ',
  name_ko = '마늘 뼈없는 닭다리'
WHERE name = '蒜香去骨雞腿排';

UPDATE pos_menu_items SET
  name_en = 'Sausage Platter',
  name_ja = 'ソーセージプラッター',
  name_ko = '소시지 모둠'
WHERE name = '香腸拼盤';

UPDATE pos_menu_items SET
  name_en = 'Eel & Roe Sausage',
  name_ja = 'うなぎ卵ソーセージ',
  name_ko = '장어 알 소시지'
WHERE name = '鰻魚爆卵香腸';

UPDATE pos_menu_items SET
  name_en = 'Grilled Zucchini',
  name_ja = 'グリルズッキーニ',
  name_ko = '구운 애호박'
WHERE name = '烤櫛瓜';

UPDATE pos_menu_items SET
  name_en = 'Black Pepper Garlic Edamame',
  name_ja = '黒胡椒ガーリック枝豆',
  name_ko = '블랙페퍼 마늘 에다마메'
WHERE name = '黑胡椒蒜味毛豆';
