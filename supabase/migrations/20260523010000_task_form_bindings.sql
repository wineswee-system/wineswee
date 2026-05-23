-- ════════════════════════════════════════════════════════════════════════════
-- Phase 1: 任務 ↔ 表單綁定基礎建設
-- ────────────────────────────────────────────────────────────────────────────
-- 目標：流程任務可以綁定多張表單作為「需完成事項」，全部完成 → 任務自動完成
--
-- 綁定範圍 (4 種)：
--   1. expense_request  — 申請費用（兩階段，完成 = 已核銷）
--   2. expense          — 費用報銷（單階段，完成 = 已核銷）
--   3. form_submission  — 自訂表單（門市報修等，完成 = 已核准）
--
-- 設計原則：表單系統「不知道」綁定的存在
--   - 員工照常填表單走自己的 chain
--   - 任務這邊靠 linked_binding_id 追蹤
--   - DB trigger 監聽表單 status 變化自動更新 binding
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 任務 ↔ 表單綁定表 ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_form_bindings (
  id                SERIAL PRIMARY KEY,
  task_id           INT NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,

  -- 該綁定要求填的表單類型
  form_type         TEXT NOT NULL CHECK (form_type IN ('expense_request', 'expense', 'form_submission')),

  -- form_submission 才需要：指定哪一張表單模板
  form_template_id  INT REFERENCES public.form_templates(id) ON DELETE SET NULL,

  -- 實際被綁定的表單 id（員工填完才會回寫）
  form_id           INT,

  -- 該綁定的完成狀態
  status            TEXT NOT NULL DEFAULT '未填'
                    CHECK (status IN ('未填', '簽核中', '已退回', '已完成')),

  -- 觸發 binding 完成的狀態（依 form_type）
  required_status   TEXT NOT NULL,  -- '已核准' / '已核銷'

  -- 顯示用：表單名稱 snapshot（避免後來表單模板被刪）
  form_label        TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tfb_task        ON public.task_form_bindings(task_id);
CREATE INDEX IF NOT EXISTS idx_tfb_form_lookup ON public.task_form_bindings(form_type, form_id) WHERE form_id IS NOT NULL;


-- ─── 2. 三張表加 linked_binding_id（form 端記得自己屬於哪個 binding）─────
ALTER TABLE public.form_submissions ADD COLUMN IF NOT EXISTS linked_binding_id INT REFERENCES public.task_form_bindings(id) ON DELETE SET NULL;
ALTER TABLE public.expense_requests ADD COLUMN IF NOT EXISTS linked_binding_id INT REFERENCES public.task_form_bindings(id) ON DELETE SET NULL;
ALTER TABLE public.expenses         ADD COLUMN IF NOT EXISTS linked_binding_id INT REFERENCES public.task_form_bindings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_form_sub_binding   ON public.form_submissions(linked_binding_id) WHERE linked_binding_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exp_req_binding    ON public.expense_requests(linked_binding_id) WHERE linked_binding_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exp_binding        ON public.expenses(linked_binding_id) WHERE linked_binding_id IS NOT NULL;


-- ─── 3. updated_at 自動維護 ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._touch_tfb_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_tfb_touch ON public.task_form_bindings;
CREATE TRIGGER trg_tfb_touch
  BEFORE UPDATE ON public.task_form_bindings
  FOR EACH ROW EXECUTE FUNCTION public._touch_tfb_updated_at();


-- ─── 4. 共用：任務檢查全部 binding 完成 → 推進 task ─────────────────────
CREATE OR REPLACE FUNCTION public._check_task_bindings_complete(p_task_id INT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_total      INT;
  v_completed  INT;
BEGIN
  SELECT COUNT(*) INTO v_total
    FROM task_form_bindings WHERE task_id = p_task_id;

  -- 沒綁定就不用管
  IF v_total = 0 THEN RETURN; END IF;

  SELECT COUNT(*) INTO v_completed
    FROM task_form_bindings WHERE task_id = p_task_id AND status = '已完成';

  -- 全部完成 → 任務自動完成
  IF v_completed = v_total THEN
    UPDATE tasks SET status = '已完成', completed_at = NOW()
     WHERE id = p_task_id AND status <> '已完成';
  END IF;
END $$;


-- ─── 5. 監聽 form_submissions status 變化 ────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_sync_form_submission_to_binding()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_binding  task_form_bindings;
  v_new_status TEXT;
BEGIN
  -- 只在有綁 binding 時才動
  IF NEW.linked_binding_id IS NULL THEN RETURN NEW; END IF;
  -- status 沒變化不動
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  SELECT * INTO v_binding FROM task_form_bindings WHERE id = NEW.linked_binding_id;
  IF v_binding.id IS NULL THEN RETURN NEW; END IF;

  -- form_submission 完成 = 已核准
  v_new_status := CASE
    WHEN NEW.status = '已核准'               THEN '已完成'
    WHEN NEW.status IN ('已退回', '已駁回')   THEN '已退回'
    WHEN NEW.status = '申請中'               THEN '簽核中'
    ELSE v_binding.status
  END;

  UPDATE task_form_bindings SET
    form_id      = NEW.id,
    status       = v_new_status,
    completed_at = CASE WHEN v_new_status = '已完成' THEN NOW() ELSE NULL END
   WHERE id = NEW.linked_binding_id;

  IF v_new_status = '已完成' THEN
    PERFORM public._check_task_bindings_complete(v_binding.task_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_form_sub_sync_binding ON public.form_submissions;
CREATE TRIGGER trg_form_sub_sync_binding
  AFTER UPDATE OF status ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION public._trg_sync_form_submission_to_binding();


-- ─── 6. 監聽 expense_requests status 變化 ────────────────────────────────
-- 完成條件 = 已核銷 (跑完核銷階段)
CREATE OR REPLACE FUNCTION public._trg_sync_expense_request_to_binding()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_binding  task_form_bindings;
  v_new_status TEXT;
BEGIN
  IF NEW.linked_binding_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  SELECT * INTO v_binding FROM task_form_bindings WHERE id = NEW.linked_binding_id;
  IF v_binding.id IS NULL THEN RETURN NEW; END IF;

  v_new_status := CASE
    WHEN NEW.status = '已核銷'                       THEN '已完成'
    WHEN NEW.status IN ('已駁回', '核銷已退回')       THEN '已退回'
    WHEN NEW.status IN ('申請中', '待核銷', '已核准') THEN '簽核中'
    ELSE v_binding.status
  END;

  UPDATE task_form_bindings SET
    form_id      = NEW.id,
    status       = v_new_status,
    completed_at = CASE WHEN v_new_status = '已完成' THEN NOW() ELSE NULL END
   WHERE id = NEW.linked_binding_id;

  IF v_new_status = '已完成' THEN
    PERFORM public._check_task_bindings_complete(v_binding.task_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_exp_req_sync_binding ON public.expense_requests;
CREATE TRIGGER trg_exp_req_sync_binding
  AFTER UPDATE OF status ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_sync_expense_request_to_binding();


-- ─── 7. 監聽 expenses (費用報銷) status 變化 ─────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_sync_expense_to_binding()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_binding  task_form_bindings;
  v_new_status TEXT;
BEGIN
  IF NEW.linked_binding_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  SELECT * INTO v_binding FROM task_form_bindings WHERE id = NEW.linked_binding_id;
  IF v_binding.id IS NULL THEN RETURN NEW; END IF;

  v_new_status := CASE
    WHEN NEW.status = '已核銷'           THEN '已完成'
    WHEN NEW.status = '已退回'           THEN '已退回'
    WHEN NEW.status IN ('待審核')         THEN '簽核中'
    ELSE v_binding.status
  END;

  UPDATE task_form_bindings SET
    form_id      = NEW.id,
    status       = v_new_status,
    completed_at = CASE WHEN v_new_status = '已完成' THEN NOW() ELSE NULL END
   WHERE id = NEW.linked_binding_id;

  IF v_new_status = '已完成' THEN
    PERFORM public._check_task_bindings_complete(v_binding.task_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_exp_sync_binding ON public.expenses;
CREATE TRIGGER trg_exp_sync_binding
  AFTER UPDATE OF status ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public._trg_sync_expense_to_binding();


-- ─── 8. RPC：建立綁定（從任務頁呼叫，員工點「去填寫」前先建 binding）─────
-- 之後員工帶 binding_id 進填表頁，submit 時把 linked_binding_id 寫回 form 表
CREATE OR REPLACE FUNCTION public.create_task_form_binding(
  p_task_id           INT,
  p_form_type         TEXT,
  p_form_template_id  INT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_required_status TEXT;
  v_label           TEXT;
  v_id              INT;
BEGIN
  IF p_form_type NOT IN ('expense_request', 'expense', 'form_submission') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_FORM_TYPE');
  END IF;

  v_required_status := CASE p_form_type
    WHEN 'expense_request' THEN '已核銷'
    WHEN 'expense'         THEN '已核銷'
    WHEN 'form_submission' THEN '已核准'
  END;

  v_label := CASE p_form_type
    WHEN 'expense_request' THEN '申請費用'
    WHEN 'expense'         THEN '費用報銷'
    WHEN 'form_submission' THEN COALESCE(
      (SELECT name FROM form_templates WHERE id = p_form_template_id),
      '自訂表單'
    )
  END;

  -- 同 task 同 type+template 不重複建
  SELECT id INTO v_id FROM task_form_bindings
   WHERE task_id = p_task_id
     AND form_type = p_form_type
     AND COALESCE(form_template_id, -1) = COALESCE(p_form_template_id, -1)
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN json_build_object('ok', true, 'binding_id', v_id, 'reused', true);
  END IF;

  INSERT INTO task_form_bindings (task_id, form_type, form_template_id, required_status, form_label)
  VALUES (p_task_id, p_form_type, p_form_template_id, v_required_status, v_label)
  RETURNING id INTO v_id;

  RETURN json_build_object('ok', true, 'binding_id', v_id, 'reused', false);
END $$;

GRANT EXECUTE ON FUNCTION public.create_task_form_binding(INT, TEXT, INT) TO authenticated, anon;


-- ─── 9. form_templates 加分類旗標：是否為「業務申請」專用 ─────────────────
-- 業務申請 = 從 HR 表單中心拉出來、只在「業務申請」頁面 + 任務內出現
ALTER TABLE public.form_templates
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'hr'
    CHECK (scope IN ('hr', 'business_expense', 'business_non_expense'));

-- 把現有兩張表單標記為業務申請（門市報修=費用組、叫貨驗收=非費用組）
-- 注意：用 name 識別。如果 name 不同就要手動 UPDATE。
UPDATE public.form_templates SET scope = 'business_expense'
 WHERE name LIKE '%門市報修%' OR name LIKE '%報修申請%';
UPDATE public.form_templates SET scope = 'business_non_expense'
 WHERE name LIKE '%叫貨驗收%' OR name LIKE '%驗收單%';


-- ─── 10. RLS / Grants ──────────────────────────────────────────────────────
ALTER TABLE public.task_form_bindings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tfb_auth_all ON public.task_form_bindings;
CREATE POLICY tfb_auth_all ON public.task_form_bindings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_form_bindings TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.task_form_bindings_id_seq TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
