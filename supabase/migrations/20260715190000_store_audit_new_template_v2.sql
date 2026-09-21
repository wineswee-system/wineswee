-- ════════════════════════════════════════════════════════════════════════════
-- 門市稽核表大改 v2 — 2026-07-15
-- 對齊新版「威士威稽核表」：6 大類 142 項，每大類滿分 100，群組配分制，總平均。
--   · 扣分改由稽核「自由填入」→ 存 deduct_score（每群組加總 ≤ group_allot）
--     deduct_score 語意從「固定扣分」改為「稽核實扣分」
--   · group_allot = 該群組配分（denormalize 到每列，方便前端分組計分）
--   · is_star = ★ 可開罰旗標（先存著，開罰/獎金邏輯待重訂）
--   · input_type = check / text（結尾冒號的填空題給文字框）
--   · 業績獎金連動「先停」（定義待重訂）→ no-op sync trigger，保留 _sync 供日後接回
-- 舊題庫(42 項)汰換；新建單一律用新題庫。idempotent。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. store_audit_items 新制欄位 ───────────────────────────────────────────
ALTER TABLE public.store_audit_items
  ADD COLUMN IF NOT EXISTS relation_group TEXT,
  ADD COLUMN IF NOT EXISTS group_allot    INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_star        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS input_type     TEXT    NOT NULL DEFAULT 'check';
-- deduct_score 改語意為「稽核實扣」，預設 0
ALTER TABLE public.store_audit_items ALTER COLUMN deduct_score SET DEFAULT 0;

-- ─── 2. store_audits 總平均 ─────────────────────────────────────────────────
ALTER TABLE public.store_audits
  ADD COLUMN IF NOT EXISTS avg_score NUMERIC(5,2) NOT NULL DEFAULT 0;

-- ─── 3. 新題庫產生函式（6 類 142 項）────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._create_store_audit_default_items(p_audit_id INT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.store_audit_items
    (audit_id, category_code, category_name, relation_group, group_allot, item_no, item_text, is_star, input_type)
  VALUES
  (p_audit_id, '一', '食品安全', '保存相關', 25, 1, '食材存放溫層', false, 'check'),
  (p_audit_id, '一', '食品安全', '保存相關', 25, 2, '冰箱食材是否有異樣、異味', false, 'check'),
  (p_audit_id, '一', '食品安全', '保存相關', 25, 3, '櫃台、廚房區須有消毒酒精，並標示', false, 'check'),
  (p_audit_id, '一', '食品安全', '保存相關', 25, 4, '食材確實加封加蓋', false, 'check'),
  (p_audit_id, '一', '食品安全', '保存相關', 25, 5, '內場全區食材、物品擺放整齊', false, 'check'),
  (p_audit_id, '一', '食品安全', '保存相關', 25, 6, '食材、裝箱酒/飲料不落地，需有棧板', false, 'check'),
  (p_audit_id, '一', '食品安全', '保存相關', 25, 7, '調理區清潔劑、消毒物品須放置水槽下', false, 'check'),
  (p_audit_id, '一', '食品安全', '保存相關', 25, 8, '儲藏區清潔劑、消毒物品須放置獨立區', false, 'check'),
  (p_audit_id, '一', '食品安全', '保存相關', 25, 9, '冷藏冰箱存放：熟>蔬果>肉>海鮮', false, 'check'),
  (p_audit_id, '一', '食品安全', '人員相關', 25, 10, '廚房同仁服儀是否正確：帽、口罩、手套', false, 'check'),
  (p_audit_id, '一', '食品安全', '人員相關', 25, 11, '同仁確實遵守洗手、消毒時機', false, 'check'),
  (p_audit_id, '一', '食品安全', '人員相關', 25, 12, '結帳後，手部確實消毒（透明手套隔離）', false, 'check'),
  (p_audit_id, '一', '食品安全', '標示相關', 25, 13, '拆封後食材是否標示拆封日', false, 'check'),
  (p_audit_id, '一', '食品安全', '標示相關', 25, 14, '分裝食材是否標示拆封日、保存期限', false, 'check'),
  (p_audit_id, '一', '食品安全', '標示相關', 25, 15, '食材均在保存期限內，無過期品', true, 'check'),
  (p_audit_id, '一', '食品安全', '標示相關', 25, 16, '清潔、消毒物品確實標示', false, 'check'),
  (p_audit_id, '一', '食品安全', '標示相關', 25, 17, '打烊前，須標示單杯酒、暢飲酒開瓶日期', false, 'check'),
  (p_audit_id, '一', '食品安全', '分類相關', 25, 18, '抹布是否確實分類', false, 'check'),
  (p_audit_id, '一', '食品安全', '分類相關', 25, 19, '砧板是否確實分類', false, 'check'),
  (p_audit_id, '二', '公司政策', '表單相關', 40, 20, '值班日誌是否落實閱讀簽名', false, 'check'),
  (p_audit_id, '二', '公司政策', '表單相關', 40, 21, '值班日誌內是否落實個人上下班紀錄簽名', false, 'check'),
  (p_audit_id, '二', '公司政策', '表單相關', 40, 22, '週月清潔表落實清潔與複查', false, 'check'),
  (p_audit_id, '二', '公司政策', '表單相關', 40, 23, '油品檢查紀錄表是否確實', false, 'check'),
  (p_audit_id, '二', '公司政策', '表單相關', 40, 24, '廚房清潔表是否確實', false, 'check'),
  (p_audit_id, '二', '公司政策', '表單相關', 40, 25, '冰箱溫度檢查表是否確實', false, 'check'),
  (p_audit_id, '二', '公司政策', '表單相關', 40, 26, '靜電機檢查表是否確實', false, 'check'),
  (p_audit_id, '二', '公司政策', '表單相關', 40, 27, '製冰機檢查表是否確實', false, 'check'),
  (p_audit_id, '二', '公司政策', '表單相關', 40, 28, '濾心檢查表是否確實', false, 'check'),
  (p_audit_id, '二', '公司政策', '抽考訊息', 30, 29, '當前行銷活動', false, 'check'),
  (p_audit_id, '二', '公司政策', '抽考訊息', 30, 30, '當月主推酒款介紹', false, 'check'),
  (p_audit_id, '二', '公司政策', '抽考訊息', 30, 31, 'sop：', false, 'text'),
  (p_audit_id, '二', '公司政策', '其他相關', 30, 32, '食材斷貨：', false, 'text'),
  (p_audit_id, '二', '公司政策', '其他相關', 30, 33, '食材過多：', false, 'text'),
  (p_audit_id, '二', '公司政策', '其他相關', 30, 34, '行銷文宣效期', false, 'check'),
  (p_audit_id, '二', '公司政策', '其他相關', 30, 35, '進貨商品盡速上架', false, 'check'),
  (p_audit_id, '二', '公司政策', '其他相關', 30, 36, '抽查3樣庫存與現場實際對比>>簽名', false, 'check'),
  (p_audit_id, '二', '公司政策', '其他相關', 30, 37, '確實遵守暢飲規則：給杯起算；同行列費用', false, 'check'),
  (p_audit_id, '二', '公司政策', '其他相關', 30, 38, '暢飲空瓶檢核：依循流水號開瓶', false, 'check'),
  (p_audit_id, '三', '品質類', '餐點品質', 25, 39, '抽查出餐品質：', false, 'text'),
  (p_audit_id, '三', '品質類', '餐點品質', 25, 40, '抽查出餐品質：', false, 'text'),
  (p_audit_id, '三', '品質類', '餐點品質', 25, 41, '抽查出餐品質：', false, 'text'),
  (p_audit_id, '三', '品質類', '餐點品質', 25, 42, '抽查出餐品質：', false, 'text'),
  (p_audit_id, '三', '品質類', '餐點品質', 25, 43, '抽查出餐品質：', false, 'text'),
  (p_audit_id, '三', '品質類', '區域維護', 40, 44, '大門口擺放標準（門口目錄架、傘架、A字架）', false, 'check'),
  (p_audit_id, '三', '品質類', '區域維護', 40, 45, '客席區整齊', false, 'check'),
  (p_audit_id, '三', '品質類', '區域維護', 40, 46, '自取區整齊標準（餐具、衛生紙）', false, 'check'),
  (p_audit_id, '三', '品質類', '區域維護', 40, 47, '暢飲區酒品擺放標準', false, 'check'),
  (p_audit_id, '三', '品質類', '區域維護', 40, 48, '商品櫃擺放標準', false, 'check'),
  (p_audit_id, '三', '品質類', '區域維護', 40, 49, '花車櫃擺放標準', false, 'check'),
  (p_audit_id, '三', '品質類', '區域維護', 40, 50, '三層櫃擺放標準', false, 'check'),
  (p_audit_id, '三', '品質類', '區域維護', 40, 51, '櫃檯區擺放標準', false, 'check'),
  (p_audit_id, '三', '品質類', '區域維護', 40, 52, '調理區擺放標準(餐期/非餐期)', false, 'check'),
  (p_audit_id, '三', '品質類', '區域維護', 40, 53, '廁所區擺放標準', false, 'check'),
  (p_audit_id, '三', '品質類', '區域維護', 40, 54, '倉儲區擺放標準', false, 'check'),
  (p_audit_id, '三', '品質類', '區域維護', 40, 55, '展示冰箱擺放標準', false, 'check'),
  (p_audit_id, '三', '品質類', '區域維護', 40, 56, '暢飲酒款依照規定品項及數量放置出來', false, 'check'),
  (p_audit_id, '三', '品質類', '體感相關', 35, 57, '冷氣溫度適中', false, 'check'),
  (p_audit_id, '三', '品質類', '體感相關', 35, 58, '音樂音量適中', false, 'check'),
  (p_audit_id, '三', '品質類', '體感相關', 35, 59, '音樂種類合適', false, 'check'),
  (p_audit_id, '三', '品質類', '體感相關', 35, 60, '店內燈光合適(加分題)', false, 'check'),
  (p_audit_id, '三', '品質類', '體感相關', 35, 61, '海報、文宣放置位子適中、不翹起或損壞', false, 'check'),
  (p_audit_id, '三', '品質類', '體感相關', 35, 62, '同仁服儀標準：制服乾淨整齊+帽子', false, 'check'),
  (p_audit_id, '四', '服務類', '主動相關', 40, 63, '保持親切、微笑', false, 'check'),
  (p_audit_id, '四', '服務類', '主動相關', 40, 64, '客人進店10秒內主動打招呼、帶位入座', false, 'check'),
  (p_audit_id, '四', '服務類', '主動相關', 40, 65, '主動介紹消費流程', false, 'check'),
  (p_audit_id, '四', '服務類', '主動相關', 40, 66, '客人點暢飲，主動介紹使用方式與規則', false, 'check'),
  (p_audit_id, '四', '服務類', '主動相關', 40, 67, '客人東張西望時，主動協助解決問題', false, 'check'),
  (p_audit_id, '四', '服務類', '主動相關', 40, 68, '主動確認客人餐點是否漏餐', false, 'check'),
  (p_audit_id, '四', '服務類', '主動相關', 40, 69, '主動進行試吃試喝活動', false, 'check'),
  (p_audit_id, '四', '服務類', '主動相關', 40, 70, '主動於結帳時，推廣特色酒款', false, 'check'),
  (p_audit_id, '四', '服務類', '主動相關', 40, 71, '客人在商品櫃前，須主動上前介紹', false, 'check'),
  (p_audit_id, '四', '服務類', '主動相關', 40, 72, '適時運用禮貌用語，不可沒禮貌回應', false, 'check'),
  (p_audit_id, '四', '服務類', '主動相關', 40, 73, '客人太醉狀況，主動協助需求>>停止時間', false, 'check'),
  (p_audit_id, '四', '服務類', '主動相關', 40, 74, '客人想換酒款飲用，須提供洗杯服務', false, 'check'),
  (p_audit_id, '四', '服務類', '櫃台相關', 30, 75, '點餐確實複頌餐點', false, 'check'),
  (p_audit_id, '四', '服務類', '櫃台相關', 30, 76, 'pos確實進單>>通知廚房', false, 'check'),
  (p_audit_id, '四', '服務類', '櫃台相關', 30, 77, '結帳前，關心客人用餐感受', false, 'check'),
  (p_audit_id, '四', '服務類', '櫃台相關', 30, 78, '確實複誦餐點內容>>告知總金額', false, 'check'),
  (p_audit_id, '四', '服務類', '櫃台相關', 30, 79, '確實複誦收取方式(現金、信用卡...)', false, 'check'),
  (p_audit_id, '四', '服務類', '櫃台相關', 30, 80, '感謝並歡迎常來', false, 'check'),
  (p_audit_id, '四', '服務類', '新品上架', 5, 81, '新品貼標、POS機、牌價內容確實到位', false, 'check'),
  (p_audit_id, '四', '服務類', '送餐相關', 10, 82, '餐點到齊時，告知客人', false, 'check'),
  (p_audit_id, '四', '服務類', '送餐相關', 10, 83, '送餐位置不可從客人身後進餐', false, 'check'),
  (p_audit_id, '四', '服務類', '送餐相關', 10, 84, '餐點超過15分鐘出餐，需致歉久候', false, 'check'),
  (p_audit_id, '四', '服務類', '送餐相關', 10, 85, '若有吃完的空盤，須適時收回(非分享盤)', false, 'check'),
  (p_audit_id, '四', '服務類', '其他相關', 15, 86, '是否有熟客互動(加分題)', false, 'check'),
  (p_audit_id, '四', '服務類', '其他相關', 15, 87, '客席區關心客人用餐感受', false, 'check'),
  (p_audit_id, '四', '服務類', '其他相關', 15, 88, '保持理性溝通，不可與他人吵架、打架', true, 'check'),
  (p_audit_id, '五', '清潔類', '大門區', 10, 89, '天花板：檢視是否蜘蛛網；燈光正常', false, 'check'),
  (p_audit_id, '五', '清潔類', '大門區', 10, 90, '玻璃：髒、指紋', false, 'check'),
  (p_audit_id, '五', '清潔類', '大門區', 10, 91, '文宣海報：位子正確、乾淨', false, 'check'),
  (p_audit_id, '五', '清潔類', '大門區', 10, 92, '地板：乾淨、無菸蒂', false, 'check'),
  (p_audit_id, '五', '清潔類', '大門區', 10, 93, '是否看起來像營業中', false, 'check'),
  (p_audit_id, '五', '清潔類', '客席區', 20, 94, '桌面不黏膩', false, 'check'),
  (p_audit_id, '五', '清潔類', '客席區', 20, 95, '桌面衛生紙方向正確、數量適中', false, 'check'),
  (p_audit_id, '五', '清潔類', '客席區', 20, 96, '椅子坐面乾淨不黏膩', false, 'check'),
  (p_audit_id, '五', '清潔類', '客席區', 20, 97, '桌下地板乾淨無菜渣', false, 'check'),
  (p_audit_id, '五', '清潔類', '客席區', 20, 98, '沙發乾淨整齊', false, 'check'),
  (p_audit_id, '五', '清潔類', '客席區', 20, 99, '沙發底乾淨', false, 'check'),
  (p_audit_id, '五', '清潔類', '客席區', 20, 100, '燈光正常運作', false, 'check'),
  (p_audit_id, '五', '清潔類', '客席區', 20, 101, '燈罩乾淨無灰塵', false, 'check'),
  (p_audit_id, '五', '清潔類', '客席區', 20, 102, '紙箱區立即整理，不放置客席區', false, 'check'),
  (p_audit_id, '五', '清潔類', '櫃檯/吧台/自取', 10, 103, '櫃檯後方乾淨整齊，無同仁私人物品', false, 'check'),
  (p_audit_id, '五', '清潔類', '櫃檯/吧台/自取', 10, 104, '吧區後方乾淨整齊，無同仁私人物品', false, 'check'),
  (p_audit_id, '五', '清潔類', '櫃檯/吧台/自取', 10, 105, '起司展示冰箱乾淨整齊，無同仁私人物品', false, 'check'),
  (p_audit_id, '五', '清潔類', '櫃檯/吧台/自取', 10, 106, '自取區乾淨整齊', false, 'check'),
  (p_audit_id, '五', '清潔類', '櫃檯/吧台/自取', 10, 107, '檸檬水是否每日更新', false, 'check'),
  (p_audit_id, '五', '清潔類', '櫃檯/吧台/自取', 10, 108, '水杯是否倒蓋；是否有灰塵', false, 'check'),
  (p_audit_id, '五', '清潔類', '廚房區', 20, 109, '調理區不可有紙箱，包含冷藏冰箱、層架', false, 'check'),
  (p_audit_id, '五', '清潔類', '廚房區', 20, 110, '地板乾淨乾燥', false, 'check'),
  (p_audit_id, '五', '清潔類', '廚房區', 20, 111, '桌面乾淨整齊', false, 'check'),
  (p_audit_id, '五', '清潔類', '廚房區', 20, 112, '層架乾淨整齊', false, 'check'),
  (p_audit_id, '五', '清潔類', '廚房區', 20, 113, '烤箱乾淨，積碳不會過多', false, 'check'),
  (p_audit_id, '五', '清潔類', '廚房區', 20, 114, '炸爐油品顏色正常，不可過黑', false, 'check'),
  (p_audit_id, '五', '清潔類', '廚房區', 20, 115, '微波爐內外乾淨', false, 'check'),
  (p_audit_id, '五', '清潔類', '廚房區', 20, 116, '燈光亮度正常運作', false, 'check'),
  (p_audit_id, '五', '清潔類', '廚房區', 20, 117, '抽油煙機乾淨、正常運作', false, 'check'),
  (p_audit_id, '五', '清潔類', '廚房區', 20, 118, '香菸、檳榔不可放置廚房區域', true, 'check'),
  (p_audit_id, '五', '清潔類', '廚房區', 20, 119, '冷藏冰箱乾淨整齊，無超過5公分的結霜', false, 'check'),
  (p_audit_id, '五', '清潔類', '廚房區', 20, 120, '冷凍冰箱乾淨整齊，無超過5公分的結霜', false, 'check'),
  (p_audit_id, '五', '清潔類', '廚房區', 20, 121, '飯鍋內外乾淨', false, 'check'),
  (p_audit_id, '五', '清潔類', '廁所區', 15, 122, '備品充足', false, 'check'),
  (p_audit_id, '五', '清潔類', '廁所區', 15, 123, '地板乾淨乾燥', false, 'check'),
  (p_audit_id, '五', '清潔類', '廁所區', 15, 124, '無異味', false, 'check'),
  (p_audit_id, '五', '清潔類', '廁所區', 15, 125, '馬桶乾淨無異味', false, 'check'),
  (p_audit_id, '五', '清潔類', '廁所區', 15, 126, '水槽乾淨、水流進出順暢', false, 'check'),
  (p_audit_id, '五', '清潔類', '廁所區', 15, 127, '水槽旁檯面乾淨乾燥', false, 'check'),
  (p_audit_id, '五', '清潔類', '廁所區', 15, 128, '每間廁所是否放置酒精瓶(1/2以上酒精)', false, 'check'),
  (p_audit_id, '五', '清潔類', '倉庫區', 15, 129, '冷凍冰箱擺放定位', false, 'check'),
  (p_audit_id, '五', '清潔類', '倉庫區', 15, 130, '確實加封加蓋', false, 'check'),
  (p_audit_id, '五', '清潔類', '倉庫區', 15, 131, '確實有棧板', false, 'check'),
  (p_audit_id, '五', '清潔類', '倉庫區', 15, 132, '清潔品、消毒品不亂放', false, 'check'),
  (p_audit_id, '五', '清潔類', '倉庫區', 15, 133, '同仁物品有特定區域，不亂放', false, 'check'),
  (p_audit_id, '五', '清潔類', '後門區', 10, 134, '垃圾車、廚餘桶均確實蓋好蓋子', false, 'check'),
  (p_audit_id, '五', '清潔類', '後門區', 10, 135, '地板乾淨乾燥無異味', false, 'check'),
  (p_audit_id, '六', '遠端稽核', '監視畫面', 50, 136, '同仁在廚區料理時，是否戴手套口罩帽子', false, 'check'),
  (p_audit_id, '六', '遠端稽核', '監視畫面', 50, 137, '上班時是否確實大洗手', false, 'check'),
  (p_audit_id, '六', '遠端稽核', '監視畫面', 50, 138, '洗手時機', false, 'check'),
  (p_audit_id, '六', '遠端稽核', '監視畫面', 50, 139, '人員閒置過久', false, 'check'),
  (p_audit_id, '六', '遠端稽核', '調撥', 15, 140, '進貨調撥驗收超過七天', false, 'check'),
  (p_audit_id, '六', '遠端稽核', 'google評論', 35, 141, '正向評論的回覆', false, 'check'),
  (p_audit_id, '六', '遠端稽核', 'google評論', 35, 142, '負向評論是否回報，並與主管討論回覆', false, 'check');

  -- 新制:每大類滿分 100 → 全表滿分 600(供舊欄位相容)；扣分改由稽核填入 deduct_score
  UPDATE public.store_audits SET total_max_score = 600 WHERE id = p_audit_id;
END $function$;
-- ─── 4. 業績獎金連動先停（no-op；定義待重訂，_sync 函式保留供日後接回）──────
CREATE OR REPLACE FUNCTION public._trg_store_audit_sync_on_approve()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  -- 稽核表大改：業績獎金「缺失/小過」連動暫停，核准不再自動寫入 store_bonus_employee。
  -- 待重新定義開罰規則後，改回 PERFORM public._sync_store_audit_to_bonus(NEW.id);
  RETURN NEW;
END $function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
