-- ════════════════════════════════════════════════════════════════════════════
-- task_form_bindings 擴充：第 5 種綁定 = goods_transfer（商品調撥）
--
-- 任務可以綁「要做一張商品調撥」當完成條件。
-- 商品調撥單 status='已完成' → binding 完成（兩階段都簽完才算）。
-- 跟 store_audit 同 pattern（依 linked_binding_id 反向追蹤）。
--
-- 同步改動：
--   1. CHECK constraint 加 'goods_transfer'
--   2. goods_transfer_requests 加 linked_binding_id 欄位
--   3. AFTER INSERT / AFTER UPDATE OF status trigger 同步 binding
--   4. create_task_form_binding RPC 加 'goods_transfer' 支援
--   5. liff_insert_transfer_request 加 p_binding_id 參數
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. CHECK constraint 加 'goods_transfer' ─────────────────────────────
ALTER TABLE public.task_form_bindings
  DROP CONSTRAINT IF EXISTS task_form_bindings_form_type_check;

ALTER TABLE public.task_form_bindings
  ADD CONSTRAINT task_form_bindings_form_type_check
  CHECK (form_type IN ('expense_request', 'expense', 'form_submission', 'store_audit', 'goods_transfer'));

-- ─── 2. goods_transfer_requests 加 linked_binding_id ────────────────────
ALTER TABLE public.goods_transfer_requests
  ADD COLUMN IF NOT EXISTS linked_binding_id INT
    REFERENCES public.task_form_bindings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_goods_transfer_binding
  ON public.goods_transfer_requests(linked_binding_id)
  WHERE linked_binding_id IS NOT NULL;


-- ─── 3a. AFTER UPDATE OF status trigger：status 變動 → 同步 binding ──────
CREATE OR REPLACE FUNCTION public._trg_sync_goods_transfer_to_binding()
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

  -- goods_transfer 完成 = 已完成（驗收鏈走完）
  v_new_status := CASE
    WHEN NEW.status = '已完成'                              THEN '已完成'
    WHEN NEW.status = '已駁回'                              THEN '已退回'
    WHEN NEW.status IN ('申請審核中', '待驗收', '驗收審核中') THEN '簽核中'
    ELSE v_binding.status
  END;

  UPDATE task_form_bindings
     SET status = v_new_status,
         form_id = NEW.id,
         completed_at = CASE WHEN v_new_status = '已完成' THEN NOW() ELSE NULL END
   WHERE id = NEW.linked_binding_id;

  IF v_new_status = '已完成' THEN
    PERFORM public._check_task_bindings_complete(v_binding.task_id);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_goods_transfer_sync_binding ON public.goods_transfer_requests;
CREATE TRIGGER trg_goods_transfer_sync_binding
  AFTER UPDATE OF status ON public.goods_transfer_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_sync_goods_transfer_to_binding();


-- ─── 3b. AFTER INSERT trigger：建立時就帶 linked_binding_id ─────────────
CREATE OR REPLACE FUNCTION public._trg_sync_goods_transfer_to_binding_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.linked_binding_id IS NULL THEN RETURN NEW; END IF;
  UPDATE task_form_bindings
     SET status = CASE
       WHEN NEW.status = '已完成'                              THEN '已完成'
       WHEN NEW.status IN ('申請審核中', '待驗收', '驗收審核中') THEN '簽核中'
       ELSE '簽核中'
     END,
     form_id = NEW.id,
     completed_at = CASE WHEN NEW.status = '已完成' THEN NOW() ELSE NULL END
   WHERE id = NEW.linked_binding_id;

  IF NEW.status = '已完成' THEN
    PERFORM public._check_task_bindings_complete(
      (SELECT task_id FROM task_form_bindings WHERE id = NEW.linked_binding_id)
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_goods_transfer_sync_binding_insert ON public.goods_transfer_requests;
CREATE TRIGGER trg_goods_transfer_sync_binding_insert
  AFTER INSERT ON public.goods_transfer_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_sync_goods_transfer_to_binding_insert();


-- ─── 4. create_task_form_binding RPC 加 'goods_transfer' 支援 ────────────
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
  IF p_form_type NOT IN ('expense_request', 'expense', 'form_submission', 'store_audit', 'goods_transfer') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_FORM_TYPE');
  END IF;

  v_required_status := CASE p_form_type
    WHEN 'expense_request' THEN '已核銷'
    WHEN 'expense'         THEN '已核銷'
    WHEN 'form_submission' THEN '已核准'
    WHEN 'store_audit'     THEN '已核准'
    WHEN 'goods_transfer'  THEN '已完成'
  END;

  v_label := CASE p_form_type
    WHEN 'expense_request' THEN '申請費用'
    WHEN 'expense'         THEN '費用報銷'
    WHEN 'form_submission' THEN COALESCE(
      (SELECT name FROM form_templates WHERE id = p_form_template_id),
      '自訂表單'
    )
    WHEN 'store_audit'     THEN '門市稽核'
    WHEN 'goods_transfer'  THEN '商品調撥'
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


-- ─── 5. liff_insert_transfer_request 加 p_binding_id 參數 ────────────────
-- 從任務綁定跳到 LIFF 新建商品調撥時帶上
-- （主系統前端 supabase.from().insert() 直接帶 linked_binding_id 即可，不用改 RPC）
CREATE OR REPLACE FUNCTION public.liff_insert_transfer_request(
  p_line_user_id text,
  p_payload      json,
  p_binding_id   int DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  v_app_id INT;
  v_app    employees;
  v_to_store INT;
  v_from_store INT;
  v_type TEXT;
  v_store_manager_id INT;
  v_new_id INT;
  v_doc_no TEXT;
  v_item JSONB;
  v_line INT := 1;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  v_type := p_payload->>'transfer_type';
  v_from_store := NULLIF(p_payload->>'from_store_id', '')::INT;
  v_to_store   := NULLIF(p_payload->>'to_store_id', '')::INT;

  IF v_type = 'store_to_store' THEN
    IF v_to_store IS NULL THEN RAISE EXCEPTION '門市↔門市調撥必須指定調入門市'; END IF;
    SELECT manager_id INTO v_store_manager_id FROM stores WHERE id = v_to_store;
    IF v_store_manager_id IS NULL THEN RAISE EXCEPTION '調入門市未設店長'; END IF;
    IF v_store_manager_id <> emp.id THEN RAISE EXCEPTION '門市↔門市調撥必須由調入門市店長發起'; END IF;
    v_app_id := v_store_manager_id;
  ELSE
    v_app_id := emp.id;
  END IF;

  SELECT * INTO v_app FROM employees WHERE id = v_app_id;

  INSERT INTO goods_transfer_requests (
    organization_id, applicant_id, applicant_name,
    transfer_type, from_store_id, to_store_id,
    from_label, to_label,
    request_date, needed_date,
    reasons, reason_other,
    status, linked_binding_id
  ) VALUES (
    v_app.organization_id, v_app.id, v_app.name,
    v_type, v_from_store, v_to_store,
    CASE WHEN v_type = 'warehouse_to_store' THEN '總倉' ELSE (SELECT name FROM stores WHERE id = v_from_store) END,
    CASE WHEN v_type = 'store_to_warehouse' THEN '總倉' ELSE (SELECT name FROM stores WHERE id = v_to_store)   END,
    COALESCE((p_payload->>'request_date')::date, CURRENT_DATE),
    NULLIF(p_payload->>'needed_date', '')::date,
    COALESCE((p_payload->'reasons')::jsonb, '[]'::jsonb),
    p_payload->>'reason_other',
    '申請審核中', p_binding_id
  ) RETURNING id, document_no INTO v_new_id, v_doc_no;

  -- 明細
  FOR v_item IN SELECT * FROM jsonb_array_elements((p_payload->'items')::jsonb) LOOP
    INSERT INTO goods_transfer_items (
      transfer_request_id, line_no, product_code, product_name, spec, unit, requested_qty, notes
    ) VALUES (
      v_new_id, v_line,
      v_item->>'product_code', v_item->>'product_name',
      v_item->>'spec', v_item->>'unit',
      NULLIF(v_item->>'requested_qty', '')::NUMERIC, v_item->>'notes'
    );
    v_line := v_line + 1;
  END LOOP;

  RETURN json_build_object('ok', true, 'id', v_new_id, 'document_no', v_doc_no);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_insert_transfer_request(text, json, int) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
