-- ════════════════════════════════════════════════════════════════════════════
-- task_form_bindings 擴充：第 4 種綁定 = store_audit（門市稽核）
-- ----------------------------------------------------------------------------
-- 任務可以綁「要做一張門市稽核」當完成條件，稽核 status='已核准' → binding 完成
-- 跟 form_submission 同套邏輯（依 linked_binding_id 反向追蹤）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. CHECK constraint 加 'store_audit' ───────────────────────────────
ALTER TABLE public.task_form_bindings
  DROP CONSTRAINT IF EXISTS task_form_bindings_form_type_check;

ALTER TABLE public.task_form_bindings
  ADD CONSTRAINT task_form_bindings_form_type_check
  CHECK (form_type IN ('expense_request', 'expense', 'form_submission', 'store_audit'));

-- ─── 2. store_audits 加 linked_binding_id ───────────────────────────────
ALTER TABLE public.store_audits
  ADD COLUMN IF NOT EXISTS linked_binding_id INT
    REFERENCES public.task_form_bindings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_store_audits_binding
  ON public.store_audits(linked_binding_id) WHERE linked_binding_id IS NOT NULL;


-- ─── 3. trigger：稽核 status 變化 → 同步 binding ─────────────────────────
CREATE OR REPLACE FUNCTION public._trg_sync_store_audit_to_binding()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_binding    task_form_bindings;
  v_new_status TEXT;
BEGIN
  IF NEW.linked_binding_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  SELECT * INTO v_binding FROM task_form_bindings WHERE id = NEW.linked_binding_id;
  IF v_binding.id IS NULL THEN RETURN NEW; END IF;

  -- store_audit 完成 = 已核准
  v_new_status := CASE
    WHEN NEW.status = '已核准'  THEN '已完成'
    WHEN NEW.status = '已退回'  THEN '已退回'
    WHEN NEW.status IN ('申請中', '待確認') THEN '簽核中'
    ELSE v_binding.status
  END;

  UPDATE task_form_bindings
     SET status = v_new_status,
         form_id = NEW.id,
         completed_at = CASE WHEN v_new_status = '已完成' THEN NOW() ELSE NULL END
   WHERE id = NEW.linked_binding_id;

  -- 完成就推一次「全部 binding 完成？→ 任務 auto 完成」
  IF v_new_status = '已完成' THEN
    PERFORM public._check_task_bindings_complete(v_binding.task_id);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_store_audit_sync_binding ON public.store_audits;
CREATE TRIGGER trg_store_audit_sync_binding
  AFTER UPDATE OF status ON public.store_audits
  FOR EACH ROW EXECUTE FUNCTION public._trg_sync_store_audit_to_binding();

-- 也要 AFTER INSERT，因為 ON INSERT 就帶 linked_binding_id 進來時要設成 '簽核中'
CREATE OR REPLACE FUNCTION public._trg_sync_store_audit_to_binding_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.linked_binding_id IS NULL THEN RETURN NEW; END IF;
  UPDATE task_form_bindings
     SET status = CASE
       WHEN NEW.status = '已核准' THEN '已完成'
       WHEN NEW.status IN ('申請中', '待確認') THEN '簽核中'
       ELSE '簽核中'
     END,
     form_id = NEW.id,
     completed_at = CASE WHEN NEW.status = '已核准' THEN NOW() ELSE NULL END
   WHERE id = NEW.linked_binding_id;

  IF NEW.status = '已核准' THEN
    PERFORM public._check_task_bindings_complete(
      (SELECT task_id FROM task_form_bindings WHERE id = NEW.linked_binding_id)
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_store_audit_sync_binding_insert ON public.store_audits;
CREATE TRIGGER trg_store_audit_sync_binding_insert
  AFTER INSERT ON public.store_audits
  FOR EACH ROW EXECUTE FUNCTION public._trg_sync_store_audit_to_binding_insert();


-- ─── 4. create_task_form_binding RPC 加 'store_audit' 支援 ───────────────
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
  IF p_form_type NOT IN ('expense_request', 'expense', 'form_submission', 'store_audit') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_FORM_TYPE');
  END IF;

  v_required_status := CASE p_form_type
    WHEN 'expense_request' THEN '已核銷'
    WHEN 'expense'         THEN '已核銷'
    WHEN 'form_submission' THEN '已核准'
    WHEN 'store_audit'     THEN '已核准'
  END;

  v_label := CASE p_form_type
    WHEN 'expense_request' THEN '申請費用'
    WHEN 'expense'         THEN '費用報銷'
    WHEN 'form_submission' THEN COALESCE(
      (SELECT name FROM form_templates WHERE id = p_form_template_id),
      '自訂表單'
    )
    WHEN 'store_audit'     THEN '門市稽核'
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


-- ─── 5. liff_create_store_audit 加 p_binding_id 參數（LIFF 端從任務跳來時帶上）
CREATE OR REPLACE FUNCTION public.liff_create_store_audit(
  p_line_user_id text,
  p_store_id     int,
  p_audit_date   date,
  p_shift        text DEFAULT NULL,
  p_arrive_time  time DEFAULT NULL,
  p_depart_time  time DEFAULT NULL,
  p_binding_id   int  DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp           employees;
  v_store_name  text;
  v_chain_id    int;
  v_new_id      int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT name INTO v_store_name FROM stores
   WHERE id = p_store_id AND organization_id = emp.organization_id;
  IF v_store_name IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'STORE_NOT_FOUND_OR_NO_ACCESS');
  END IF;

  SELECT chain_id INTO v_chain_id
  FROM form_chain_configs
  WHERE form_type = 'store_audit' AND organization_id = emp.organization_id
  LIMIT 1;

  INSERT INTO store_audits (
    organization_id, store_id, store_name,
    audit_date, shift, arrive_time, depart_time,
    auditor_id, auditor_name,
    approval_chain_id, status, linked_binding_id
  ) VALUES (
    emp.organization_id, p_store_id, v_store_name,
    p_audit_date, p_shift, p_arrive_time, p_depart_time,
    emp.id, emp.name,
    v_chain_id, '草稿', p_binding_id
  ) RETURNING id INTO v_new_id;

  RETURN json_build_object('ok', true, 'audit_id', v_new_id);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_create_store_audit(text, int, date, text, time, time, int) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
