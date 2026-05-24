-- ════════════════════════════════════════════════════════════════════════════
-- 修：task_form_bindings 同步 + 任務完成守門
-- ----------------------------------------------------------------------------
-- 問題 1：expense_request / expense sync trigger 只聽 UPDATE OF status
--   LIFF 流程：INSERT expense_request 時 linked_binding_id=NULL → 沒事
--             之後 UPDATE linked_binding_id → status 沒變 → trigger 跳過
--   結果：binding.status 永遠停在「未填」
--
-- 問題 2：任務完成守門 trigger 可能沒部署
--   20260523030000_task_binding_notify_and_guard.sql 沒跑 → 用戶能直接
--   按完成跳過 binding
--
-- 解法：
-- 1. sync trigger 加 AFTER INSERT + AFTER UPDATE OF linked_binding_id
--    INSERT 時 binding_id 有就 sync 一次
--    UPDATE binding_id 從 NULL 變值時 sync 一次
-- 2. 重新部署 block_complete trigger
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 1a. expense_requests sync — 改成支援 INSERT / linked_binding_id update
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trg_sync_expense_request_to_binding()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_binding    task_form_bindings;
  v_new_status TEXT;
  v_should_run BOOLEAN := FALSE;
BEGIN
  IF NEW.linked_binding_id IS NULL THEN RETURN NEW; END IF;

  -- INSERT 一律跑
  IF TG_OP = 'INSERT' THEN
    v_should_run := TRUE;
  -- UPDATE 三種情況跑：status 變、binding_id 從 NULL 變值、binding_id 改成別的
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN v_should_run := TRUE; END IF;
    IF NEW.linked_binding_id IS DISTINCT FROM OLD.linked_binding_id THEN v_should_run := TRUE; END IF;
  END IF;
  IF NOT v_should_run THEN RETURN NEW; END IF;

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
  AFTER INSERT OR UPDATE OF status, linked_binding_id ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_sync_expense_request_to_binding();


-- ═════════════════════════════════════════════════════════════════════════
-- 1b. expenses sync — 同樣處理
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trg_sync_expense_to_binding()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_binding    task_form_bindings;
  v_new_status TEXT;
  v_should_run BOOLEAN := FALSE;
BEGIN
  IF NEW.linked_binding_id IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    v_should_run := TRUE;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN v_should_run := TRUE; END IF;
    IF NEW.linked_binding_id IS DISTINCT FROM OLD.linked_binding_id THEN v_should_run := TRUE; END IF;
  END IF;
  IF NOT v_should_run THEN RETURN NEW; END IF;

  SELECT * INTO v_binding FROM task_form_bindings WHERE id = NEW.linked_binding_id;
  IF v_binding.id IS NULL THEN RETURN NEW; END IF;

  v_new_status := CASE
    WHEN NEW.status = '已核銷'   THEN '已完成'
    WHEN NEW.status = '已退回'   THEN '已退回'
    WHEN NEW.status IN ('待審核') THEN '簽核中'
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
  AFTER INSERT OR UPDATE OF status, linked_binding_id ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public._trg_sync_expense_to_binding();


-- ═════════════════════════════════════════════════════════════════════════
-- 1c. form_submissions sync — 同樣處理
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trg_sync_form_submission_to_binding()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_binding    task_form_bindings;
  v_new_status TEXT;
  v_should_run BOOLEAN := FALSE;
BEGIN
  IF NEW.linked_binding_id IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    v_should_run := TRUE;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN v_should_run := TRUE; END IF;
    IF NEW.linked_binding_id IS DISTINCT FROM OLD.linked_binding_id THEN v_should_run := TRUE; END IF;
  END IF;
  IF NOT v_should_run THEN RETURN NEW; END IF;

  SELECT * INTO v_binding FROM task_form_bindings WHERE id = NEW.linked_binding_id;
  IF v_binding.id IS NULL THEN RETURN NEW; END IF;

  v_new_status := CASE
    WHEN NEW.status = '已核准'              THEN '已完成'
    WHEN NEW.status IN ('已退回', '已駁回') THEN '已退回'
    WHEN NEW.status = '申請中'              THEN '簽核中'
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
  AFTER INSERT OR UPDATE OF status, linked_binding_id ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION public._trg_sync_form_submission_to_binding();


-- ═════════════════════════════════════════════════════════════════════════
-- 2. 重新部署任務完成守門 trigger（萬一 20260523030000 沒跑）
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trg_task_block_complete_with_pending_bindings()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = '已完成' AND OLD.status IS DISTINCT FROM '已完成' THEN
    IF EXISTS (
      SELECT 1 FROM task_form_bindings
       WHERE task_id = NEW.id AND status <> '已完成'
    ) THEN
      RAISE EXCEPTION '任務還有未完成的綁定表單，請先填完再完成任務'
        USING HINT = '查看任務詳情的「需完成表單」清單';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_block_complete_pending_bindings ON public.tasks;
CREATE TRIGGER trg_task_block_complete_pending_bindings
  BEFORE UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._trg_task_block_complete_with_pending_bindings();


-- ═════════════════════════════════════════════════════════════════════════
-- 3. 一次性：把目前 linked_binding_id 有設、但 binding 還在「未填」的補正
-- ═════════════════════════════════════════════════════════════════════════
-- expense_requests
UPDATE task_form_bindings tfb SET
  form_id      = er.id,
  status       = CASE
    WHEN er.status = '已核銷'                       THEN '已完成'
    WHEN er.status IN ('已駁回', '核銷已退回')       THEN '已退回'
    WHEN er.status IN ('申請中', '待核銷', '已核准') THEN '簽核中'
    ELSE tfb.status
  END,
  completed_at = CASE WHEN er.status = '已核銷' THEN NOW() ELSE NULL END
FROM expense_requests er
WHERE er.linked_binding_id = tfb.id
  AND tfb.status = '未填';

-- expenses
UPDATE task_form_bindings tfb SET
  form_id      = e.id,
  status       = CASE
    WHEN e.status = '已核銷'   THEN '已完成'
    WHEN e.status = '已退回'   THEN '已退回'
    WHEN e.status IN ('待審核') THEN '簽核中'
    ELSE tfb.status
  END,
  completed_at = CASE WHEN e.status = '已核銷' THEN NOW() ELSE NULL END
FROM expenses e
WHERE e.linked_binding_id = tfb.id
  AND tfb.status = '未填';

-- form_submissions
UPDATE task_form_bindings tfb SET
  form_id      = fs.id,
  status       = CASE
    WHEN fs.status = '已核准'              THEN '已完成'
    WHEN fs.status IN ('已退回', '已駁回') THEN '已退回'
    WHEN fs.status = '申請中'              THEN '簽核中'
    ELSE tfb.status
  END,
  completed_at = CASE WHEN fs.status = '已核准' THEN NOW() ELSE NULL END
FROM form_submissions fs
WHERE fs.linked_binding_id = tfb.id
  AND tfb.status = '未填';

COMMIT;

NOTIFY pgrst, 'reload schema';
