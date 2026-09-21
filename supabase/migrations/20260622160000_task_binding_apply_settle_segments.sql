-- ════════════════════════════════════════════════════════════════════════════
-- 申請段 / 驗收段 各自成為「流程步驟」可綁進任務（純加法）
-- 2026-06-22
--
-- 目標：費用(申請/核銷=驗收)、調撥(申請/入庫驗收) 各自能當任務的一個步驟分別綁定。
--   新增 4 個分段 form_type，舊 5 型(expense_request/expense/form_submission/
--   store_audit/goods_transfer)語意「一字不動」。
--
-- 關鍵：一筆單對多 binding 同步。同一張單在同一任務裡可同時是「申請步驟」+「驗收
--   步驟」，但 row 上 linked_binding_id 只有一個。改用 dispatcher 走雙路徑：
--     路徑1(相容舊)：id = linked_binding_id
--     路徑2(新分段)：form_id = 本單 id 且 form_type 屬同家族
--   並在 dispatcher 內把「同任務的驗收段 binding」認領到同一張單(form_id 回填)。
--
-- gate「申請通過才能驗收」：靠既有 record 層 RPC(expense_settle_step_advance /
--   goods_transfer_submit_receipt 擋狀態)＋前端 UX lock，不在此新增。
--
-- 全 idempotent：CREATE OR REPLACE / DROP CONSTRAINT IF EXISTS + ADD /
--   DROP TRIGGER IF EXISTS + CREATE / 回填用 IS DISTINCT 條件。
-- 絕對不動：expense_settle_step_advance、goods_transfer_approve/submit_receipt、
--   各掛鏈 trigger、開分錄、_check_task_bindings_complete、_task_advance_next_step。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. form_type CHECK 擴充（舊 5 型 + 新 4 型）──────────────────────────────
ALTER TABLE public.task_form_bindings
  DROP CONSTRAINT IF EXISTS task_form_bindings_form_type_check;
ALTER TABLE public.task_form_bindings
  ADD CONSTRAINT task_form_bindings_form_type_check
  CHECK (form_type IN (
    'expense_request', 'expense', 'form_submission', 'store_audit', 'goods_transfer',  -- 既有，不動
    'expense_apply', 'expense_settle', 'goods_transfer_apply', 'goods_transfer_receipt' -- 新增分段
  ));


-- ─── 2. dispatcher：費用單 → 同步所有相關 binding（雙路徑）───────────────────
CREATE OR REPLACE FUNCTION public._sync_expense_request_bindings(rec public.expense_requests)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b      task_form_bindings;
  v_new  TEXT;
BEGIN
  -- bootstrap：把同任務的「核銷(驗收)段」binding 認領到同一張單（form_id 回填）
  IF rec.linked_binding_id IS NOT NULL THEN
    UPDATE task_form_bindings sib
       SET form_id = rec.id
      FROM task_form_bindings cur
     WHERE cur.id = rec.linked_binding_id
       AND sib.task_id = cur.task_id
       AND sib.form_type = 'expense_settle'
       AND sib.form_id IS NULL;
  END IF;

  FOR b IN
    SELECT * FROM task_form_bindings
     WHERE id = rec.linked_binding_id
        OR (form_id = rec.id AND form_type IN ('expense_request','expense_apply','expense_settle'))
  LOOP
    v_new := CASE b.form_type
      -- 申請段：已核准(含之後 待核銷/已核銷)都算「申請完成」
      WHEN 'expense_apply' THEN CASE
        WHEN rec.status IN ('已核准','待核銷','已核銷') THEN '已完成'
        WHEN rec.status = '已駁回'                      THEN '已退回'
        WHEN rec.status = '申請中'                      THEN '簽核中'
        ELSE b.status END
      -- 核銷(驗收)段：已核銷才算完成
      WHEN 'expense_settle' THEN CASE
        WHEN rec.status = '已核銷'                       THEN '已完成'
        WHEN rec.status IN ('已駁回','核銷已退回')        THEN '已退回'
        WHEN rec.status IN ('申請中','已核准','待核銷')   THEN '簽核中'
        ELSE b.status END
      -- 既有整單型別(expense_request)：逐字保留原行為（已核銷才完成）
      ELSE CASE
        WHEN rec.status = '已核銷'                       THEN '已完成'
        WHEN rec.status IN ('已駁回','核銷已退回')        THEN '已退回'
        WHEN rec.status IN ('申請中','待核銷','已核准')   THEN '簽核中'
        ELSE b.status END
    END;

    UPDATE task_form_bindings SET
      form_id      = rec.id,
      status       = v_new,
      completed_at = CASE WHEN v_new = '已完成' THEN NOW() ELSE NULL END
     WHERE id = b.id AND status IS DISTINCT FROM v_new;

    IF v_new = '已完成' THEN PERFORM public._check_task_bindings_complete(b.task_id); END IF;
  END LOOP;
END $$;


-- ─── 3. dispatcher：調撥單 → 同步所有相關 binding（雙路徑）───────────────────
CREATE OR REPLACE FUNCTION public._sync_goods_transfer_bindings(rec public.goods_transfer_requests)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b      task_form_bindings;
  v_new  TEXT;
BEGIN
  -- bootstrap：把同任務的「入庫驗收段」binding 認領到同一張單
  IF rec.linked_binding_id IS NOT NULL THEN
    UPDATE task_form_bindings sib
       SET form_id = rec.id
      FROM task_form_bindings cur
     WHERE cur.id = rec.linked_binding_id
       AND sib.task_id = cur.task_id
       AND sib.form_type = 'goods_transfer_receipt'
       AND sib.form_id IS NULL;
  END IF;

  FOR b IN
    SELECT * FROM task_form_bindings
     WHERE id = rec.linked_binding_id
        OR (form_id = rec.id AND form_type IN ('goods_transfer','goods_transfer_apply','goods_transfer_receipt'))
  LOOP
    v_new := CASE b.form_type
      -- 申請段：申請鏈跑完(待驗收)起算完成
      WHEN 'goods_transfer_apply' THEN CASE
        WHEN rec.status IN ('待驗收','驗收審核中','已完成') THEN '已完成'
        WHEN rec.status = '已駁回'                          THEN '已退回'
        WHEN rec.status = '申請審核中'                      THEN '簽核中'
        ELSE b.status END
      -- 入庫驗收段：已完成才算完成
      WHEN 'goods_transfer_receipt' THEN CASE
        WHEN rec.status = '已完成'                              THEN '已完成'
        WHEN rec.status = '已駁回'                              THEN '已退回'
        WHEN rec.status IN ('申請審核中','待驗收','驗收審核中')   THEN '簽核中'
        ELSE b.status END
      -- 既有整單型別(goods_transfer)：逐字保留原行為（已完成才完成）
      ELSE CASE
        WHEN rec.status = '已完成'                              THEN '已完成'
        WHEN rec.status = '已駁回'                              THEN '已退回'
        WHEN rec.status IN ('申請審核中','待驗收','驗收審核中')   THEN '簽核中'
        ELSE b.status END
    END;

    UPDATE task_form_bindings SET
      form_id      = rec.id,
      status       = v_new,
      completed_at = CASE WHEN v_new = '已完成' THEN NOW() ELSE NULL END
     WHERE id = b.id AND status IS DISTINCT FROM v_new;

    IF v_new = '已完成' THEN PERFORM public._check_task_bindings_complete(b.task_id); END IF;
  END LOOP;
END $$;


-- ─── 4. trigger 函式改成呼叫 dispatcher（掛點/gating 維持，只換內部）─────────
-- 4a. 費用：原 trigger AFTER INSERT OR UPDATE OF status, linked_binding_id（不變）
CREATE OR REPLACE FUNCTION public._trg_sync_expense_request_to_binding()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_should_run BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_should_run := TRUE;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN v_should_run := TRUE; END IF;
    IF NEW.linked_binding_id IS DISTINCT FROM OLD.linked_binding_id THEN v_should_run := TRUE; END IF;
  END IF;
  IF NOT v_should_run THEN RETURN NEW; END IF;

  PERFORM public._sync_expense_request_bindings(NEW);
  RETURN NEW;
END $$;

-- 4b. 調撥 AFTER UPDATE：加聽 linked_binding_id（讓 insert 後補綁也同步）
CREATE OR REPLACE FUNCTION public._trg_sync_goods_transfer_to_binding()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.linked_binding_id IS NOT DISTINCT FROM OLD.linked_binding_id THEN
    RETURN NEW;
  END IF;
  PERFORM public._sync_goods_transfer_bindings(NEW);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_goods_transfer_sync_binding ON public.goods_transfer_requests;
CREATE TRIGGER trg_goods_transfer_sync_binding
  AFTER UPDATE OF status, linked_binding_id ON public.goods_transfer_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_sync_goods_transfer_to_binding();

-- 4c. 調撥 AFTER INSERT
CREATE OR REPLACE FUNCTION public._trg_sync_goods_transfer_to_binding_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public._sync_goods_transfer_bindings(NEW);
  RETURN NEW;
END $$;
-- trigger trg_goods_transfer_sync_binding_insert 掛點不變，函式體已換


-- ─── 5. create_task_form_binding RPC：追加 4 新型（舊 5 型不動）──────────────
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
  IF p_form_type NOT IN (
    'expense_request', 'expense', 'form_submission', 'store_audit', 'goods_transfer',
    'expense_apply', 'expense_settle', 'goods_transfer_apply', 'goods_transfer_receipt'
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_FORM_TYPE');
  END IF;

  v_required_status := CASE p_form_type
    WHEN 'expense_request' THEN '已核銷'
    WHEN 'expense'         THEN '已核銷'
    WHEN 'form_submission' THEN '已核准'
    WHEN 'store_audit'     THEN '已核准'
    WHEN 'goods_transfer'  THEN '已完成'
    WHEN 'expense_apply'          THEN '已核准'
    WHEN 'expense_settle'         THEN '已核銷'
    WHEN 'goods_transfer_apply'   THEN '待驗收'
    WHEN 'goods_transfer_receipt' THEN '已完成'
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
    WHEN 'expense_apply'          THEN '費用-申請'
    WHEN 'expense_settle'         THEN '費用-核銷(驗收)'
    WHEN 'goods_transfer_apply'   THEN '調撥-申請'
    WHEN 'goods_transfer_receipt' THEN '調撥-入庫驗收'
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


-- ─── 6. 一次性回填（對已綁定的舊單跑 dispatcher 對齊；IS DISTINCT → 重跑無副作用）─
DO $$
DECLARE r public.expense_requests;
BEGIN
  FOR r IN SELECT er.* FROM public.expense_requests er WHERE er.linked_binding_id IS NOT NULL LOOP
    PERFORM public._sync_expense_request_bindings(r);
  END LOOP;
END $$;

DO $$
DECLARE r public.goods_transfer_requests;
BEGIN
  FOR r IN SELECT gt.* FROM public.goods_transfer_requests gt WHERE gt.linked_binding_id IS NOT NULL LOOP
    PERFORM public._sync_goods_transfer_bindings(r);
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
