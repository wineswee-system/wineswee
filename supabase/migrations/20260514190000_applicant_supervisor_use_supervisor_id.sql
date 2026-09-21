-- ════════════════════════════════════════════════════════════
-- applicant_supervisor target_type 改用 supervisor_id（前端實際寫入的欄位）
-- 2026-05-14
--
-- 問題：DB employees 表有兩個欄位 supervisor_id / reporting_to 表達同概念。
--   - 前端員工編輯頁只寫 supervisor_id
--   - resolve_chain_step_approvers 的 applicant_supervisor target_type 用 reporting_to
--   → 員工設了直屬主管後，chain 仍解不到（reporting_to 沒人維護）
--
-- 修法：改用 COALESCE(supervisor_id, reporting_to) — 優先讀新欄位，
-- 老資料的 reporting_to 仍可 fallback。
--
-- 同時加 trigger 把 supervisor_id 自動 sync 到 reporting_to，未來無論誰寫
-- 都能保持一致。
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. 改 resolve_chain_step_approvers 用 COALESCE ═══
-- 完整重寫該 function 是大改動，這裡用單行 sed-like 替換策略：
-- 把 v_app.reporting_to 改成 COALESCE(v_app.supervisor_id, v_app.reporting_to)
-- 但 PG 沒有 ALTER FUNCTION sed，要重寫整個 function。
-- 既然該 function 在 20260508030000 migration 內，我只 patch 那一個 IF 分支。

-- 把舊 function 取出 source → replace → re-create
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='resolve_chain_step_approvers';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'resolve_chain_step_approvers not found';
  END IF;

  -- 把 v_app.reporting_to IS NOT NULL 改成 COALESCE(supervisor_id, reporting_to) IS NOT NULL
  -- 把 e.id = v_app.reporting_to 改成 e.id = COALESCE(v_app.supervisor_id, v_app.reporting_to)
  v_def := replace(v_def,
    'v_app.reporting_to IS NOT NULL',
    'COALESCE(v_app.supervisor_id, v_app.reporting_to) IS NOT NULL');
  v_def := replace(v_def,
    'e.id = v_app.reporting_to',
    'e.id = COALESCE(v_app.supervisor_id, v_app.reporting_to)');

  EXECUTE v_def;
END $$;


-- ═══ 2. trigger：UPDATE employees 時自動 sync supervisor_id ↔ reporting_to ═══
CREATE OR REPLACE FUNCTION public.trg_sync_employee_supervisor_fields()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- 任一邊變動 → 同步到另一邊（以 NEW 那個有值的為主）
  IF NEW.supervisor_id IS DISTINCT FROM OLD.supervisor_id THEN
    NEW.reporting_to := NEW.supervisor_id;
  ELSIF NEW.reporting_to IS DISTINCT FROM OLD.reporting_to THEN
    NEW.supervisor_id := NEW.reporting_to;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_employee_supervisor ON public.employees;
CREATE TRIGGER trg_sync_employee_supervisor
  BEFORE INSERT OR UPDATE OF supervisor_id, reporting_to ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_employee_supervisor_fields();

-- ═══ 3. 一次性 sync 既有資料 ═══
UPDATE employees SET reporting_to = supervisor_id
 WHERE supervisor_id IS NOT NULL AND reporting_to IS DISTINCT FROM supervisor_id;

NOTIFY pgrst, 'reload schema';
COMMIT;
