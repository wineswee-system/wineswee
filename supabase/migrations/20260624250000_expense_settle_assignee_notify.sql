-- ════════════════════════════════════════════════════════════════════════════
-- 非經常性費用申請:簽核「通過(→已核准)」後,通知核銷(驗收)單位的人去送核銷單
-- 2026-06-24
--
-- ① BEFORE UPDATE OF status:status 變「已核准」時,依申請時選的核銷(驗收)單位
--    解析核銷人寫入 settle_assignee_id:
--      有 settle_store_id(營運部→門市)→ stores.manager_id(店長)
--      否則 settle_department_id → departments.manager_id(部門主管)
-- ② AFTER UPDATE OF status:同一轉換時,推 LINE 卡(expense_settle_todo)給核銷人,
--    提醒他去填實際金額/收據、送核銷(驗收)單。
--
-- 隔離:獨立 trigger,不改既有簽核/通知大函式。net.http_post → hr-notify。
-- 申請人 ≠ 核銷人。卡片走 hr-notify Edge Function(不在 PG 內 hand-roll flex)。
-- ════════════════════════════════════════════════════════════════════════════

-- ── ① 解析核銷人(BEFORE,只設欄位、無副作用)──
CREATE OR REPLACE FUNCTION public._resolve_expense_settle_assignee()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准' THEN
    IF NEW.settle_store_id IS NOT NULL THEN
      SELECT manager_id INTO NEW.settle_assignee_id FROM stores WHERE id = NEW.settle_store_id;
    ELSIF NEW.settle_department_id IS NOT NULL THEN
      SELECT manager_id INTO NEW.settle_assignee_id FROM departments WHERE id = NEW.settle_department_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_resolve_expense_settle_assignee ON public.expense_requests;
CREATE TRIGGER trg_resolve_expense_settle_assignee
  BEFORE UPDATE OF status ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public._resolve_expense_settle_assignee();

-- ── ② 推 LINE 卡給核銷人(AFTER)──
CREATE OR REPLACE FUNCTION public._notify_expense_settle_assignee()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_url   CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_key   text;
  v_dept  text;
  v_store text;
  v_label text;
BEGIN
  IF NOT (NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准'
          AND NEW.settle_assignee_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_key := NULL; END;
  IF v_key IS NULL THEN RETURN NEW; END IF;

  -- 核銷(驗收)單位顯示字串:營運部→「部門 / 門市」;其他→「部門」
  SELECT name INTO v_dept FROM departments WHERE id = NEW.settle_department_id;
  IF NEW.settle_store_id IS NOT NULL THEN
    SELECT name INTO v_store FROM stores WHERE id = NEW.settle_store_id;
    v_label := COALESCE(v_dept, '營運部') || ' / ' || COALESCE(v_store, '');
  ELSE
    v_label := COALESCE(v_dept, '');
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object(
      'employee_id', NEW.settle_assignee_id,
      'type', 'expense_settle_todo',
      'details', jsonb_build_object(
        'request_id',        NEW.id,
        'applicant_name',    NEW.employee,
        'title',             NEW.title,
        'amount',            NEW.estimated_amount,
        'currency',          NEW.currency,
        'store',             NEW.store,
        'settle_unit_label', v_label
      )
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[_notify_expense_settle_assignee] failed: %', SQLERRM;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_expense_settle_assignee ON public.expense_requests;
CREATE TRIGGER trg_notify_expense_settle_assignee
  AFTER UPDATE OF status ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public._notify_expense_settle_assignee();

NOTIFY pgrst, 'reload schema';
