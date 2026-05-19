-- ════════════════════════════════════════════════════════════════════════════
-- HR 5 表 INSERT 自動 snapshot form_chain_configs.chain_id 到 approval_chain_id
-- ────────────────────────────────────────────────────────────────────────────
-- 慘案 (2026-05-19)：劉雅玲送出差，business_trips row 的 approval_chain_id=NULL，
-- 但 form_chain_configs(trip) 有 chain_id=23 → liff_approve_request 看 row 自己
-- 那欄是 NULL → 走 fallback → 撞 _employee_is_eligible_approver does not exist。
--
-- Root cause：送單流程（前端 INSERT 或 RPC）沒把 form_chain_configs 對應的
-- chain_id snapshot 到 row.approval_chain_id。這是「兩條獨立軌道」的典型踩雷
-- (對齊記憶 feedback_workflow_chain_independent)。
--
-- 修法兩段：
--   1. backfill 現有 status='申請中/待審/待審核' 且 approval_chain_id IS NULL 的 row
--   2. BEFORE INSERT trigger 幫 5 表（leave/overtime/trip/correction/expense）
--      在送單時自動補 chain_id（前端不用改）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. backfill 既有 NULL row ─────────────────────────────────────────
UPDATE leave_requests lr
   SET approval_chain_id = fcc.chain_id
  FROM form_chain_configs fcc
 WHERE lr.approval_chain_id IS NULL
   AND lr.status IN ('申請中','待審','待審核')
   AND fcc.form_type = 'leave'
   AND fcc.organization_id = lr.organization_id
   AND fcc.is_active = TRUE;

UPDATE overtime_requests o
   SET approval_chain_id = fcc.chain_id
  FROM form_chain_configs fcc
 WHERE o.approval_chain_id IS NULL
   AND o.status IN ('申請中','待審','待審核')
   AND fcc.form_type = 'overtime'
   AND fcc.organization_id = o.organization_id
   AND fcc.is_active = TRUE;

UPDATE business_trips bt
   SET approval_chain_id = fcc.chain_id
  FROM form_chain_configs fcc
 WHERE bt.approval_chain_id IS NULL
   AND bt.status IN ('申請中','待審','待審核')
   AND fcc.form_type = 'trip'
   AND fcc.organization_id = bt.organization_id
   AND fcc.is_active = TRUE;

UPDATE clock_corrections cc
   SET approval_chain_id = fcc.chain_id
  FROM form_chain_configs fcc
 WHERE cc.approval_chain_id IS NULL
   AND cc.status IN ('申請中','待審','待審核')
   AND fcc.form_type = 'correction'
   AND fcc.organization_id = cc.organization_id
   AND fcc.is_active = TRUE;

UPDATE expenses ex
   SET approval_chain_id = fcc.chain_id
  FROM form_chain_configs fcc
 WHERE ex.approval_chain_id IS NULL
   AND ex.status IN ('申請中','待審','待審核')
   AND fcc.form_type = 'expense'
   AND fcc.organization_id = ex.organization_id
   AND fcc.is_active = TRUE;


-- ─── 2. BEFORE INSERT trigger function（5 表共用） ─────────────────────
CREATE OR REPLACE FUNCTION public._trg_auto_fill_chain_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_form_type TEXT;
  v_chain_id  INT;
BEGIN
  -- 已有 chain_id 就不動（讓 INSERT 端可以強制指定）
  IF NEW.approval_chain_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.organization_id IS NULL THEN RETURN NEW; END IF;

  v_form_type := CASE TG_TABLE_NAME
    WHEN 'leave_requests'    THEN 'leave'
    WHEN 'overtime_requests' THEN 'overtime'
    WHEN 'business_trips'    THEN 'trip'
    WHEN 'clock_corrections' THEN 'correction'
    WHEN 'expenses'          THEN 'expense'
    ELSE NULL
  END;

  IF v_form_type IS NULL THEN RETURN NEW; END IF;

  SELECT chain_id INTO v_chain_id
    FROM form_chain_configs
   WHERE form_type = v_form_type
     AND organization_id = NEW.organization_id
     AND is_active = TRUE
   LIMIT 1;

  IF v_chain_id IS NOT NULL THEN
    NEW.approval_chain_id := v_chain_id;
  END IF;

  RETURN NEW;
END $$;


-- ─── 3. 掛到 5 張表 ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_auto_fill_chain_id ON public.leave_requests;
CREATE TRIGGER trg_auto_fill_chain_id BEFORE INSERT ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_auto_fill_chain_id();

DROP TRIGGER IF EXISTS trg_auto_fill_chain_id ON public.overtime_requests;
CREATE TRIGGER trg_auto_fill_chain_id BEFORE INSERT ON public.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_auto_fill_chain_id();

DROP TRIGGER IF EXISTS trg_auto_fill_chain_id ON public.business_trips;
CREATE TRIGGER trg_auto_fill_chain_id BEFORE INSERT ON public.business_trips
  FOR EACH ROW EXECUTE FUNCTION public._trg_auto_fill_chain_id();

DROP TRIGGER IF EXISTS trg_auto_fill_chain_id ON public.clock_corrections;
CREATE TRIGGER trg_auto_fill_chain_id BEFORE INSERT ON public.clock_corrections
  FOR EACH ROW EXECUTE FUNCTION public._trg_auto_fill_chain_id();

DROP TRIGGER IF EXISTS trg_auto_fill_chain_id ON public.expenses;
CREATE TRIGGER trg_auto_fill_chain_id BEFORE INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public._trg_auto_fill_chain_id();

COMMIT;

NOTIFY pgrst, 'reload schema';
