-- ════════════════════════════════════════════════════════════════════════════
-- 簽核鏈必填 guard：沒設 chain 一律擋送出
-- 2026-05-29
--
-- 根因：費用報銷 (expenses) 沒設 chain 也能送出，trigger fallback 走
--   _resolve_hr_approver_ids 對「店長」分支會返回所有 leave.approve 持有者
--   → 全公司有 LINE 的都收到卡片。
--
-- 修法 4 步：
--   1. expenses 加「依金額自動掛 chain」（category='費用報銷'）— 對齊
--      expense_requests 的 auto_apply_expense_approval_chain 邏輯。
--      優先級高於既有 form_chain_configs 的固定 chain。
--   2. 通用 _guard_chain_required：approval_chain_id IS NULL → RAISE EXCEPTION
--   3. 掛到 7 個表：leave_requests / overtime_requests / business_trips /
--      clock_corrections / expenses / expense_requests / form_submissions
--      （form_submissions 特殊：chain 綁在 template.approval_chain_id）
--   4. 拔掉 _notify_hr_request_approvers 的 broadcast fallback
--      （變死代碼後直接刪，避免 guard 漏接又被觸發）
--
-- Trigger 執行順序（alphabetical by name）：
--   trg_a_*                  ← 金額 auto-apply（最先）
--   trg_auto_fill_chain_id   ← form_chain_configs auto-apply（中間）
--   trg_z_guard_*            ← 必填 guard（最後）
--
-- 既有資料：放著（只擋新建）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. expenses 依金額 auto-apply chain（category='費用報銷'）
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_apply_expenses_approval_chain_by_amount()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_chain_id INT;
  v_amount   NUMERIC;
BEGIN
  -- 已手動指定就不動
  IF NEW.approval_chain_id IS NOT NULL THEN RETURN NEW; END IF;

  v_amount := COALESCE(NEW.amount, 0);

  SELECT id INTO v_chain_id
    FROM public.approval_chains
   WHERE category = '費用報銷'
     AND COALESCE(is_active, true) = true
     AND (min_amount IS NULL OR min_amount <= v_amount)
     AND (max_amount IS NULL OR max_amount >= v_amount)
   ORDER BY COALESCE(min_amount, 0) DESC
   LIMIT 1;

  IF v_chain_id IS NOT NULL THEN
    NEW.approval_chain_id := v_chain_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_a_auto_apply_expenses_chain_by_amount ON public.expenses;
CREATE TRIGGER trg_a_auto_apply_expenses_chain_by_amount
  BEFORE INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.auto_apply_expenses_approval_chain_by_amount();


-- ──────────────────────────────────────────────────────────────────────────
-- 2. 通用 chain-required guard
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._guard_chain_required()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_label TEXT;
BEGIN
  IF NEW.approval_chain_id IS NOT NULL THEN RETURN NEW; END IF;

  v_label := CASE TG_TABLE_NAME
    WHEN 'leave_requests'     THEN '請假'
    WHEN 'overtime_requests'  THEN '加班'
    WHEN 'business_trips'     THEN '出差'
    WHEN 'clock_corrections'  THEN '補打卡'
    WHEN 'expenses'           THEN '費用報銷'
    WHEN 'expense_requests'   THEN '費用申請'
    ELSE TG_TABLE_NAME
  END;

  RAISE EXCEPTION '尚未設定「%」的簽核鏈，請聯絡管理員至「簽核設定」設定後再送出', v_label
    USING ERRCODE = 'P0001',
          HINT    = format('table=%s, organization_id=%s, approval_chain_id IS NULL',
                           TG_TABLE_NAME, NEW.organization_id);
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. 掛 guard 到 6 個有 approval_chain_id 欄位的表（trg_z_ 前綴確保最後跑）
-- ──────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_z_guard_chain_required ON public.leave_requests;
CREATE TRIGGER trg_z_guard_chain_required
  BEFORE INSERT ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public._guard_chain_required();

DROP TRIGGER IF EXISTS trg_z_guard_chain_required ON public.overtime_requests;
CREATE TRIGGER trg_z_guard_chain_required
  BEFORE INSERT ON public.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION public._guard_chain_required();

DROP TRIGGER IF EXISTS trg_z_guard_chain_required ON public.business_trips;
CREATE TRIGGER trg_z_guard_chain_required
  BEFORE INSERT ON public.business_trips
  FOR EACH ROW EXECUTE FUNCTION public._guard_chain_required();

DROP TRIGGER IF EXISTS trg_z_guard_chain_required ON public.clock_corrections;
CREATE TRIGGER trg_z_guard_chain_required
  BEFORE INSERT ON public.clock_corrections
  FOR EACH ROW EXECUTE FUNCTION public._guard_chain_required();

DROP TRIGGER IF EXISTS trg_z_guard_chain_required ON public.expenses;
CREATE TRIGGER trg_z_guard_chain_required
  BEFORE INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public._guard_chain_required();

DROP TRIGGER IF EXISTS trg_z_guard_chain_required ON public.expense_requests;
CREATE TRIGGER trg_z_guard_chain_required
  BEFORE INSERT ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public._guard_chain_required();


-- ──────────────────────────────────────────────────────────────────────────
-- 4. form_submissions 特殊 guard（chain 綁在 form_templates.approval_chain_id）
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._guard_form_submission_chain_required()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_chain_id INT;
  v_tmpl_name TEXT;
BEGIN
  SELECT approval_chain_id, name
    INTO v_chain_id, v_tmpl_name
    FROM public.form_templates
   WHERE id = NEW.template_id;

  IF v_chain_id IS NULL THEN
    RAISE EXCEPTION '表單「%」尚未設定簽核鏈，請聯絡管理員至「表單設定」設定後再送出',
                    COALESCE(v_tmpl_name, '此表單')
      USING ERRCODE = 'P0001',
            HINT    = format('form_submissions: template_id=%s, template.approval_chain_id IS NULL',
                             NEW.template_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_z_guard_form_submission_chain ON public.form_submissions;
CREATE TRIGGER trg_z_guard_form_submission_chain
  BEFORE INSERT ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION public._guard_form_submission_chain_required();


-- ──────────────────────────────────────────────────────────────────────────
-- 5. 拔掉 _notify_hr_request_approvers 的 broadcast fallback
--    （變死代碼後直接刪，避免哪天 guard 漏接又被觸發 broadcast 給全公司）
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._notify_hr_request_approvers(
  p_rt           text,
  p_id           int,
  p_applicant_id int
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_chain_id   int;
  v_table_name text;
BEGIN
  IF p_applicant_id IS NULL THEN RETURN 0; END IF;

  v_table_name := CASE p_rt
    WHEN 'leave'      THEN 'leave_requests'
    WHEN 'overtime'   THEN 'overtime_requests'
    WHEN 'trip'       THEN 'business_trips'
    WHEN 'correction' THEN 'clock_corrections'
    WHEN 'expense'    THEN 'expenses'
  END;

  EXECUTE format('SELECT approval_chain_id FROM %I WHERE id = $1', v_table_name)
    INTO v_chain_id USING p_id;

  -- 有 chain → 走 chain step 0
  IF v_chain_id IS NOT NULL THEN
    RETURN public._notify_hr_chain_step(p_rt, p_id, v_chain_id, 0, p_applicant_id);
  END IF;

  -- 沒 chain → 不通知（理論上 _guard_chain_required 已擋掉這狀況）
  -- ★ 已拔除舊 broadcast fallback：原本會 SELECT * FROM _resolve_hr_approver_ids(...)
  --    把所有 leave.approve 持有者全推一遍。對店長申請者來說等於廣播全公司。
  RAISE WARNING '[_notify_hr_request_approvers] request_type=% id=% approval_chain_id IS NULL — skipped (should have been blocked by _guard_chain_required)',
                p_rt, p_id;
  RETURN 0;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
