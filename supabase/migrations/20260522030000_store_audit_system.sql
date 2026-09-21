-- ════════════════════════════════════════════════════════════════════════════
-- 門市稽核系統 store_audits — 對齊「營運主管訪查門市稽核表」紙本
-- ────────────────────────────────────────────────────────────────────────────
-- 流程：
--   1. 稽核員填表 → status='草稿'
--   2. 送出 → status='待確認'，當班人員（1~3 人）逐一確認
--   3. 全部當班人員確認後 → status='申請中'，走 approval_chain（督導/經理/老闆）
--   4. 簽核全過 → status='已核准' → trigger 自動寫缺失/小過到 store_bonus_employee
--   5. 任一關退回 → status='已退回'
--
-- 缺失規則：
--   - 每個 passed=false 的項目 → +1 缺失
--   - 有填責任人 → 算在該責任人身上
--   - 未填責任人 → 平均分給當班人員（每人各 +1）
--   - 缺失累計到當月 store_bonus_employee.absence_count
--   - 每 4 次缺失 = 1 次小過 (minor_offense_count = floor(absence_count / 4))
--
-- 評核項目：固定 5 大類 42 小項，建單時 trigger 自動 INSERT
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 稽核單頭 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_audits (
  id                  SERIAL PRIMARY KEY,
  organization_id     INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  store_id            INT NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  store_name          TEXT NOT NULL,                    -- snapshot
  audit_date          DATE NOT NULL,
  shift               TEXT,                             -- 開店/早班/中班/晚班/打烊班
  arrive_time         TIME,
  depart_time         TIME,
  auditor_id          INT REFERENCES public.employees(id) ON DELETE SET NULL,
  auditor_name        TEXT NOT NULL,                    -- snapshot
  status              TEXT NOT NULL DEFAULT '草稿',
                      -- 草稿 / 待確認 / 申請中 / 已核准 / 已退回
  approval_chain_id   INT REFERENCES public.approval_chains(id) ON DELETE SET NULL,
  current_step        INT NOT NULL DEFAULT 0,
  total_max_score     INT NOT NULL DEFAULT 0,           -- 滿分（所有項目扣分加總）
  total_deducted      INT NOT NULL DEFAULT 0,           -- 實際扣分
  notes_violations    TEXT,                             -- 違反其他員工守則
  notes_feedback      TEXT,                             -- 店內反饋事項
  notes_suggestions   TEXT,                             -- 公司建議/活動安排事項
  reject_reason       TEXT,
  approver            TEXT,                             -- 最終核簽人
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at        TIMESTAMPTZ,
  approved_at         TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_audits_store_date
  ON public.store_audits(store_id, audit_date DESC);
CREATE INDEX IF NOT EXISTS idx_store_audits_status
  ON public.store_audits(status);
CREATE INDEX IF NOT EXISTS idx_store_audits_org
  ON public.store_audits(organization_id);


-- ─── 2. 當班人員（1~3 人）─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_audit_on_duty (
  id              SERIAL PRIMARY KEY,
  audit_id        INT NOT NULL REFERENCES public.store_audits(id) ON DELETE CASCADE,
  employee_id     INT REFERENCES public.employees(id) ON DELETE SET NULL,
  employee_name   TEXT NOT NULL,                        -- snapshot
  sort_order      INT NOT NULL DEFAULT 0,
  confirmed       BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_at    TIMESTAMPTZ,
  reject_reason   TEXT,                                 -- 當班人員退回原因
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_on_duty_audit ON public.store_audit_on_duty(audit_id);
CREATE INDEX IF NOT EXISTS idx_audit_on_duty_emp   ON public.store_audit_on_duty(employee_id);


-- ─── 3. 評核項目結果 ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_audit_items (
  id                          SERIAL PRIMARY KEY,
  audit_id                    INT NOT NULL REFERENCES public.store_audits(id) ON DELETE CASCADE,
  category_code               TEXT NOT NULL,            -- 一/二/四/五/六
  category_name               TEXT NOT NULL,
  item_no                     INT NOT NULL,
  item_text                   TEXT NOT NULL,
  deduct_score                INT NOT NULL,
  passed                      BOOLEAN,                  -- TRUE=合格 FALSE=不合格 NULL=未評核
  responsible_employee_id     INT REFERENCES public.employees(id) ON DELETE SET NULL,
  responsible_employee_name   TEXT,
  remark                      TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_items_audit ON public.store_audit_items(audit_id);
CREATE INDEX IF NOT EXISTS idx_audit_items_responsible
  ON public.store_audit_items(responsible_employee_id) WHERE responsible_employee_id IS NOT NULL;


-- ─── 4. 建單時自動 INSERT 42 個項目 ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public._create_store_audit_default_items(p_audit_id INT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.store_audit_items (audit_id, category_code, category_name, item_no, item_text, deduct_score) VALUES
  -- 一、食安衛生品質 40%
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
  -- 二、環境整潔 20%
  (p_audit_id, '二', '環境整潔', 1, '展示架上陳列商品無灰塵', 3),
  (p_audit_id, '二', '環境整潔', 2, '「廁所清潔檢查表」簽名記錄、廁所環境整潔狀況', 3),
  (p_audit_id, '二', '環境整潔', 3, '店面門前玻璃及店內玻璃清潔', 2),
  (p_audit_id, '二', '環境整潔', 4, '剛營業時，店內地板及桌面無髒汙', 2),
  (p_audit_id, '二', '環境整潔', 5, '營業中，廚房地面及工作臺桌面保持乾淨', 3),
  (p_audit_id, '二', '環境整潔', 6, '「餐具餐盤、刀叉、酒杯」清潔無指紋、污漬、水漬或發霉', 2),
  (p_audit_id, '二', '環境整潔', 7, '營業設備：「冰箱類」、「冷藏櫃」、「烤箱」及「取酒機」保持乾淨', 3),
  (p_audit_id, '二', '環境整潔', 8, '外場冰箱商品、酒類陳架區，商品擺放整齊，產品LOGO朝外、商品對應正確牌價', 2),
  -- 四、服務層面 20%（PDF 跳過三）
  (p_audit_id, '四', '服務層面', 1, '服裝儀容符合標準：內外場人員皆需戴帽子、乾淨制服、長髮需綁整齊、指甲整潔', 3),
  (p_audit_id, '四', '服務層面', 2, '面對顧客需微笑，顧客在看菜單時，須向前熱情介紹餐點', 2),
  (p_audit_id, '四', '服務層面', 3, '上餐時，須使用「請/謝謝/不好意思」等服務語', 2),
  (p_audit_id, '四', '服務層面', 4, '客人點餐完成後，主動告知「餐具」擺放位置', 2),
  (p_audit_id, '四', '服務層面', 5, '閒置時或送餐完後，巡視客人用餐情形並回收空盤', 3),
  (p_audit_id, '四', '服務層面', 6, '依照公司當時的行銷活動確實告知客人', 2),
  (p_audit_id, '四', '服務層面', 7, '門店夥伴了解每月活動內容及抽問新品', 2),
  (p_audit_id, '四', '服務層面', 8, '客人結帳離開，應立即完成收桌、消毒桌面及檢查地面髒污', 4),
  -- 五、暢飲規範
  (p_audit_id, '五', '暢飲規範', 1, '暢飲酒款依照規定品項及數量放置出來', 5),
  (p_audit_id, '五', '暢飲規範', 2, '暢飲規則及取酒機使用方式，確實告知客人', 5),
  (p_audit_id, '五', '暢飲規範', 3, '遵照暢飲規定執行：同行皆須參與活動，每人/1hr/$290', 5),
  (p_audit_id, '五', '暢飲規範', 4, '暢飲時間計算：給杯子才開始計算時間、收回杯子才可停時間', 5),
  (p_audit_id, '五', '暢飲規範', 5, '暢飲空瓶檢核：皆須依照【標籤流水號】開瓶', 5),
  (p_audit_id, '五', '暢飲規範', 6, '客人若要更換酒款飲用，須提供「洗杯」服務', 5),
  (p_audit_id, '五', '暢飲規範', 7, '打烊前，單杯酒及暢飲酒開瓶，須標示開瓶當天日期', 5),
  -- 六、其他
  (p_audit_id, '六', '其他', 1, '『零用金』數額正確', 5),
  (p_audit_id, '六', '其他', 2, '展示行銷活動文宣、活動到期日於當天打烊下架文宣', 5),
  (p_audit_id, '六', '其他', 3, '新商品入倉確實檢查，核對驗收及即時上架銷售', 5),
  (p_audit_id, '六', '其他', 4, '確實按照帳單結帳，不可隨意折扣', 5),
  (p_audit_id, '六', '其他', 5, '「每日店務交接表」、「每日工作檢核表」確實填寫並簽名確認', 5),
  (p_audit_id, '六', '其他', 6, '店內庫存【抽查3樣】如有錯誤，需與當班人員確認「現場實際數量」再記錄簽名', 5);

  -- 計算 total_max_score
  UPDATE public.store_audits
     SET total_max_score = (SELECT COALESCE(SUM(deduct_score), 0) FROM public.store_audit_items WHERE audit_id = p_audit_id)
   WHERE id = p_audit_id;
END $$;


-- AFTER INSERT trigger：自動建 42 個項目
CREATE OR REPLACE FUNCTION public._trg_store_audit_after_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public._create_store_audit_default_items(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_store_audit_after_insert ON public.store_audits;
CREATE TRIGGER trg_store_audit_after_insert
  AFTER INSERT ON public.store_audits
  FOR EACH ROW EXECUTE FUNCTION public._trg_store_audit_after_insert();


-- ─── 5. updated_at trigger ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._touch_store_audit_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_store_audit_touch ON public.store_audits;
CREATE TRIGGER trg_store_audit_touch
  BEFORE UPDATE ON public.store_audits
  FOR EACH ROW EXECUTE FUNCTION public._touch_store_audit_updated_at();


-- ─── 6. 核准後同步缺失/小過到 store_bonus_employee ────────────────────────
CREATE OR REPLACE FUNCTION public._sync_store_audit_to_bonus(p_audit_id INT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_audit       public.store_audits;
  v_ym          TEXT;
  v_monthly_id  INT;
  v_emp_id      INT;
  v_inc         INT;
  v_total       INT;
  r_item        record;
  v_on_duty_ids INT[];
BEGIN
  SELECT * INTO v_audit FROM public.store_audits WHERE id = p_audit_id;
  IF v_audit.id IS NULL THEN RETURN; END IF;

  v_ym := to_char(v_audit.audit_date, 'YYYY-MM');

  -- 找/建 monthly 結算單
  SELECT id INTO v_monthly_id
    FROM public.store_bonus_monthly
   WHERE store_id = v_audit.store_id AND year_month = v_ym;

  IF v_monthly_id IS NULL THEN
    BEGIN
      PERFORM public.initialize_store_bonus(v_audit.store_id, v_ym);
      SELECT id INTO v_monthly_id
        FROM public.store_bonus_monthly
       WHERE store_id = v_audit.store_id AND year_month = v_ym;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[sync_audit_to_bonus] initialize_store_bonus failed: %', SQLERRM;
      RETURN;
    END;
  END IF;

  IF v_monthly_id IS NULL THEN
    RAISE NOTICE '[sync_audit_to_bonus] 找不到 monthly_id for store=% ym=%', v_audit.store_id, v_ym;
    RETURN;
  END IF;

  -- 取當班人員 ids
  SELECT array_agg(employee_id) INTO v_on_duty_ids
    FROM public.store_audit_on_duty
   WHERE audit_id = p_audit_id AND employee_id IS NOT NULL;

  -- iterate 所有 passed=false 的項目
  FOR r_item IN
    SELECT responsible_employee_id FROM public.store_audit_items
     WHERE audit_id = p_audit_id AND passed = FALSE
  LOOP
    IF r_item.responsible_employee_id IS NOT NULL THEN
      -- 有指定責任人 → 該員工 +1 缺失
      PERFORM public._bump_audit_absence(v_monthly_id, r_item.responsible_employee_id, 1);
    ELSE
      -- 無指定 → 所有當班人員各 +1 缺失
      IF v_on_duty_ids IS NOT NULL AND array_length(v_on_duty_ids, 1) > 0 THEN
        FOREACH v_emp_id IN ARRAY v_on_duty_ids LOOP
          PERFORM public._bump_audit_absence(v_monthly_id, v_emp_id, 1);
        END LOOP;
      END IF;
    END IF;
  END LOOP;
END $$;


-- helper：把員工的 absence_count +N，並重算 minor_offense_count
CREATE OR REPLACE FUNCTION public._bump_audit_absence(
  p_monthly_id INT, p_employee_id INT, p_inc INT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_new_abs INT;
BEGIN
  -- 確保該員工有 store_bonus_employee row（若初始化沒拉到，這裡 skip）
  IF NOT EXISTS (
    SELECT 1 FROM public.store_bonus_employee
     WHERE monthly_id = p_monthly_id AND employee_id = p_employee_id
  ) THEN
    RAISE NOTICE '[bump_audit_absence] store_bonus_employee 不存在 monthly=% emp=%, skip',
                 p_monthly_id, p_employee_id;
    RETURN;
  END IF;

  UPDATE public.store_bonus_employee
     SET absence_count       = absence_count + p_inc,
         minor_offense_count = (absence_count + p_inc) / 4  -- 每 4 缺失 = 1 小過
   WHERE monthly_id = p_monthly_id AND employee_id = p_employee_id;
END $$;


-- AFTER UPDATE trigger：status 變 '已核准' → sync
CREATE OR REPLACE FUNCTION public._trg_store_audit_sync_on_approve()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准' THEN
    PERFORM public._sync_store_audit_to_bonus(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_store_audit_sync_bonus ON public.store_audits;
CREATE TRIGGER trg_store_audit_sync_bonus
  AFTER UPDATE OF status ON public.store_audits
  FOR EACH ROW EXECUTE FUNCTION public._trg_store_audit_sync_on_approve();


-- ─── 7. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.store_audits          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_audit_on_duty   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_audit_items     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sa_auth_all      ON public.store_audits;
DROP POLICY IF EXISTS saod_auth_all    ON public.store_audit_on_duty;
DROP POLICY IF EXISTS sai_auth_all     ON public.store_audit_items;

CREATE POLICY sa_auth_all   ON public.store_audits        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY saod_auth_all ON public.store_audit_on_duty FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY sai_auth_all  ON public.store_audit_items   FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_audits        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_audit_on_duty TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_audit_items   TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.store_audits_id_seq        TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.store_audit_on_duty_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.store_audit_items_id_seq   TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
