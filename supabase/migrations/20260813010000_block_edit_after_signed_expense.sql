-- 2026-08-13 費用申請補「簽過禁改內容」守門(比照請假 trg_block_edit_after_signed_leave)。
-- 現況:費用單簽過(如 #490 張啟達初核已簽)申請人仍能編輯,編了整鏈重跑→簽核人可能沒察覺重簽。
--   請假有此守門、費用沒有 → 補齊一致。駁回/退回不擋(要能退回重送);request_type='expense_request'。
CREATE OR REPLACE FUNCTION public.trg_block_edit_after_signed_expense()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_changed BOOLEAN := false;
BEGIN
  -- 駁回/退回狀態不擋(允許退回)
  IF NEW.status IN ('已拒絕','已駁回','已退回') THEN
    RETURN NEW;
  END IF;
  -- 從駁回/退回重新送出(編輯重送)放行
  IF OLD.status IN ('已拒絕','已駁回','已退回')
     AND NEW.status IN ('待審核','申請中') THEN
    RETURN NEW;
  END IF;
  -- 尚無任何「已簽核」關 → 放行(可自由編輯)
  IF NOT public._request_has_approved_step('expense_request', NEW.id) THEN
    RETURN NEW;
  END IF;

  -- 已有簽核紀錄 → 申請內容欄位不可再變(核准後才改=簽核人簽的是舊內容)
  v_changed := (
       NEW.account_code     IS DISTINCT FROM OLD.account_code
    OR NEW.title            IS DISTINCT FROM OLD.title
    OR NEW.description       IS DISTINCT FROM OLD.description
    OR NEW.estimated_amount IS DISTINCT FROM OLD.estimated_amount
    OR NEW.supplier          IS DISTINCT FROM OLD.supplier
    OR NEW.items             IS DISTINCT FROM OLD.items
    OR NEW.currency          IS DISTINCT FROM OLD.currency
    OR NEW.project_id        IS DISTINCT FROM OLD.project_id
  );

  IF v_changed THEN
    RAISE EXCEPTION '費用申請已有簽核紀錄，無法修改內容（如需更改請先請簽核人退回）';
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_block_edit_after_signed_expense ON public.expense_requests;
CREATE TRIGGER trg_block_edit_after_signed_expense
  BEFORE UPDATE ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_edit_after_signed_expense();
