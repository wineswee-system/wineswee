-- 還原被誤改的扣分（之前誤把 4→3、5→4，現在改回原始值）
-- 同時更新 function，套用正確分數 + 新分類編號（三四五）
-- idempotent

-- 1. 還原現有 store_audit_items 的扣分到原始正確值
UPDATE public.store_audit_items
   SET deduct_score = 4
 WHERE category_code = '一' AND item_no = 11 AND deduct_score <> 4;

UPDATE public.store_audit_items
   SET deduct_score = 5
 WHERE category_code = '一' AND item_no IN (12, 13) AND deduct_score <> 5;

UPDATE public.store_audit_items
   SET deduct_score = 4
 WHERE category_code = '三' AND item_no = 8 AND deduct_score <> 4;

UPDATE public.store_audit_items
   SET deduct_score = 5
 WHERE category_code = '四' AND deduct_score <> 5;

UPDATE public.store_audit_items
   SET deduct_score = 5
 WHERE category_code = '五' AND deduct_score <> 5;

-- 2. 重算 total_max_score
UPDATE public.store_audits sa
   SET total_max_score = (
     SELECT COALESCE(SUM(sai.deduct_score), 0)
       FROM public.store_audit_items sai
      WHERE sai.audit_id = sa.id
   );

-- 3. 更新 function：正確分數 + 分類編號 三/四/五
CREATE OR REPLACE FUNCTION public._create_store_audit_default_items(p_audit_id INT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.store_audit_items (audit_id, category_code, category_name, item_no, item_text, deduct_score) VALUES
  -- 一、食安衛生品質
  (p_audit_id, '一', '食安衛生品質', 1,  '檢查自主衛生管理表單：「廚房清潔表、油品檢查紀錄表、靜電機、製冰機」記錄', 3),
  (p_audit_id, '一', '食安衛生品質', 2,  '冰箱食材品質是否有異樣或異味(外場及內場)、「冷凍冰箱溫度記錄表」簽名記錄', 2),
  (p_audit_id, '一', '食安衛生品質', 3,  '櫃台及廚房放置「消毒酒精」', 2),
  (p_audit_id, '一', '食安衛生品質', 4,  '觸碰所有食材前，先清洗手部、戴手套、口罩', 3),
  (p_audit_id, '一', '食安衛生品質', 5,  '結帳時，使用透明手套隔離，收銀台旁放置手套擺放區', 2),
  (p_audit_id, '一', '食安衛生品質', 6,  '當天開封未使用完食品，使用完，須封口保存', 3),
  (p_audit_id, '一', '食安衛生品質', 7,  '當天開封未使用完食品，打烊前須標示日期及封口保存', 3),
  (p_audit_id, '一', '食安衛生品質', 8,  '白酒、清酒、氣泡酒，須預冷做更換。白飯依照1:1比例煮，烤箱、炸爐預熱', 2),
  (p_audit_id, '一', '食安衛生品質', 9,  '「砧板」按照食材分類使用。熟食-白色、蔬菜生食類-綠色、奶油起司類-黃色', 3),
  (p_audit_id, '一', '食安衛生品質', 10, '內場「冰箱食材、冷凍食品、廚房備料」須擺放整齊', 3),
  (p_audit_id, '一', '食安衛生品質', 11, '產品出餐按照標準。（請參照餐點SOP）', 4),
  (p_audit_id, '一', '食安衛生品質', 12, '「裝箱酒類、飲品」必須放置棧板上：離地 5cm，不可直接放置地上', 5),
  (p_audit_id, '一', '食安衛生品質', 13, '「食材品項」不可直接放置地上，至少離地15cm 以上', 5),
  -- 二、環境整潔
  (p_audit_id, '二', '環境整潔', 1, '展示架上陳列商品無灰塵', 3),
  (p_audit_id, '二', '環境整潔', 2, '「廁所清潔檢查表」簽名記錄、廁所環境整潔狀況', 3),
  (p_audit_id, '二', '環境整潔', 3, '店面門前玻璃及店內玻璃清潔', 2),
  (p_audit_id, '二', '環境整潔', 4, '剛營業時，店內地板及桌面無髒汙', 2),
  (p_audit_id, '二', '環境整潔', 5, '營業中，廚房地面及工作臺桌面保持乾淨', 3),
  (p_audit_id, '二', '環境整潔', 6, '「餐具餐盤、刀叉、酒杯」清潔無指紋、污漬、水漬或發霉', 2),
  (p_audit_id, '二', '環境整潔', 7, '營業設備：「冰箱類」、「冷藏櫃」、「烤箱」及「取酒機」保持乾淨', 3),
  (p_audit_id, '二', '環境整潔', 8, '外場冰箱商品、酒類陳架區，商品擺放整齊，產品LOGO朝外、商品對應正確牌價', 2),
  -- 三、服務層面
  (p_audit_id, '三', '服務層面', 1, '服裝儀容符合標準：內外場人員皆需戴帽子、乾淨制服、長髮需綁整齊、指甲整潔', 3),
  (p_audit_id, '三', '服務層面', 2, '面對顧客需微笑，顧客在看菜單時，須向前熱情介紹餐點', 2),
  (p_audit_id, '三', '服務層面', 3, '上餐時，須使用「請/謝謝/不好意思」等服務語', 2),
  (p_audit_id, '三', '服務層面', 4, '客人點餐完成後，主動告知「餐具」擺放位置', 2),
  (p_audit_id, '三', '服務層面', 5, '閒置時或送餐完後，巡視客人用餐情形並回收空盤', 3),
  (p_audit_id, '三', '服務層面', 6, '依照公司當時的行銷活動確實告知客人', 2),
  (p_audit_id, '三', '服務層面', 7, '門店夥伴了解每月活動內容及抽問新品', 2),
  (p_audit_id, '三', '服務層面', 8, '客人結帳離開，應立即完成收桌、消毒桌面及檢查地面髒污', 4),
  -- 四、暢飲規範
  (p_audit_id, '四', '暢飲規範', 1, '暢飲酒款依照規定品項及數量放置出來', 5),
  (p_audit_id, '四', '暢飲規範', 2, '暢飲規則及取酒機使用方式，確實告知客人', 5),
  (p_audit_id, '四', '暢飲規範', 3, '遵照暢飲規定執行：同行皆須參與活動，每人/1hr/$290', 5),
  (p_audit_id, '四', '暢飲規範', 4, '暢飲時間計算：給杯子才開始計算時間、收回杯子才可停時間', 5),
  (p_audit_id, '四', '暢飲規範', 5, '暢飲空瓶檢核：皆須依照【標籤流水號】開瓶', 5),
  (p_audit_id, '四', '暢飲規範', 6, '客人若要更換酒款飲用，須提供「洗杯」服務', 5),
  (p_audit_id, '四', '暢飲規範', 7, '打烊前，單杯酒及暢飲酒開瓶，須標示開瓶當天日期', 5),
  -- 五、其他
  (p_audit_id, '五', '其他', 1, '『零用金』數額正確', 5),
  (p_audit_id, '五', '其他', 2, '展示行銷活動文宣、活動到期日於當天打烊下架文宣', 5),
  (p_audit_id, '五', '其他', 3, '新商品入倉確實檢查，核對驗收及即時上架銷售', 5),
  (p_audit_id, '五', '其他', 4, '確實按照帳單結帳，不可隨意折扣', 5),
  (p_audit_id, '五', '其他', 5, '「每日店務交接表」、「每日工作檢核表」確實填寫並簽名確認', 5),
  (p_audit_id, '五', '其他', 6, '店內庫存【抽查3樣】如有錯誤，需與當班人員確認「現場實際數量」再記錄簽名', 5);

  UPDATE public.store_audits
     SET total_max_score = (SELECT COALESCE(SUM(deduct_score), 0) FROM public.store_audit_items WHERE audit_id = p_audit_id)
   WHERE id = p_audit_id;
END $$;

NOTIFY pgrst, 'reload schema';
