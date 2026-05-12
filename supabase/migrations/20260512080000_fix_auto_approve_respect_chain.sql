-- ============================================================
-- 修：trg_hr_auto_approve_owner 不該旁路 chain 配置
-- 2026-05-12
--
-- 慘案：
--   用戶在簽核設定頁設「指定員工：Snow」當第 1 關，
--   結果送出請假後直接 status='已核准'，Snow 根本沒看到。
--
-- 根因：
--   leave_requests 上掛了兩個 BEFORE INSERT trigger（同 timing），
--   按字母順序執行：
--     1) trg_auto_apply_chain_leave   → 依 form_chain_configs 掛 chain_id ✓
--     2) trg_leave_auto_owner         → 用「職屬關係」判斷組織頂端 → 自動核准
--
--   第 2 個 trigger 不看 NEW.approval_chain_id，自顧自用
--   _resolve_single_approver()  + _is_store_manager()  判斷：
--     - 申請人 supervisor_id=NULL（admin 通常沒主管）
--     - 不是任何門市的 store manager
--     → trigger 認定「老闆」→ NEW.status := '已核准'
--
--   = 兩套人員解析邏輯打架：
--     - chain_steps 配置「指定員工 Snow」(用戶 UI 設的)
--     - trigger _resolve_single_approver (組織圖推算)
--
--   而且 chain 含「指定員工」這種完全脫離組織圖的設定時，
--   trigger 用組織圖判斷根本毫無意義 — 任何 chain 配置都該尊重。
--
-- 修：
--   trg_hr_auto_approve_owner 第一行加：
--     IF NEW.approval_chain_id IS NOT NULL THEN RETURN NEW; END IF;
--
--   有 chain 就完全不動 status，由 chain 流程主導（_employee_matches_chain_step
--   會用 chain step 的 target_type 解析簽核人，含「指定員工」/「直屬主管」/
--   「店長」/「部門主管」等 9 種）。
--
-- 影響範圍：5 張表共用 function → 一改全修
--   leave_requests / overtime_requests / business_trips /
--   clock_corrections / expenses
--
-- 兼容：沒設 chain 的舊單 fallback 走舊的職屬判斷，行為不變。
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_hr_auto_approve_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp_id INT;
BEGIN
  -- ★ 修正：有掛 chain（用戶在簽核設定頁配的「指定員工 / 直屬主管 / 店長 / ...」）
  --        就完全不動 status，讓 chain 流程主導。trigger 只在「完全沒設 chain」
  --        的單上做 fallback 自動核准。
  IF NEW.approval_chain_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- ── 以下為原本邏輯（沒 chain 時 fallback 用組織圖判斷） ──

  v_emp_id := NEW.employee_id;
  IF v_emp_id IS NULL AND NEW.employee IS NOT NULL THEN
    SELECT id INTO v_emp_id FROM employees
     WHERE name = NEW.employee
       AND organization_id = COALESCE(NEW.organization_id,
           (SELECT organization_id FROM employees WHERE name = NEW.employee LIMIT 1))
     LIMIT 1;
  END IF;

  IF v_emp_id IS NULL THEN RETURN NEW; END IF;

  -- 是組織頂端（無人可簽）→ 自動核准
  IF public._resolve_single_approver(v_emp_id) IS NULL
     AND NOT public._is_store_manager(v_emp_id) THEN
    NEW.status := CASE TG_TABLE_NAME
      WHEN 'expenses' THEN '已核銷'
      ELSE '已核准'
    END;
    BEGIN NEW.approver := '系統(自動)'; EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN NEW;
END $$;

-- ═══ 修 leave #25：誤判的單回到「待審核」讓 Snow 重審 ═══
UPDATE public.leave_requests
   SET status = '待審核',
       approver = NULL,
       current_step = 0,
       reject_reason = NULL
 WHERE id = 25
   AND status = '已核准'
   AND approval_chain_id IS NOT NULL;

-- 順手清除同時段（2026-05-12 之前一週內）被誤自動核准的 chain 單
-- 條件：approval_chain_id 有值（表示有設 chain）+ approver='系統(自動)'
UPDATE public.leave_requests
   SET status = '待審核', approver = NULL, current_step = 0, reject_reason = NULL
 WHERE approval_chain_id IS NOT NULL
   AND approver = '系統(自動)'
   AND created_at >= '2026-05-05'
   AND status = '已核准';

UPDATE public.overtime_requests
   SET status = '待審核', approver = NULL, current_step = 0
 WHERE approval_chain_id IS NOT NULL
   AND approver = '系統(自動)'
   AND COALESCE(created_at, request_date::timestamptz) >= '2026-05-05'
   AND status = '已核准';

COMMIT;

-- 驗證
SELECT id, employee, status, approver, current_step, approval_chain_id, created_at
  FROM leave_requests WHERE id = 25;
