-- ════════════════════════════════════════════════════════════
-- 簽核流程各關卡停留時間追蹤
-- 2026-05-13
--
-- 廠商需求：簽核流程要看每一關卡停了多久（卡在 Snow 簽核 12 小時了之類），
-- LIFF / 主系統簽核詳情頁能顯示時間軸。
--
-- 設計：
--   新建 approval_step_history audit 表，每筆代表單據在某 chain step 的進站/出站。
--   靠 BEFORE UPDATE OF current_step trigger 自動寫入：
--     - 舊 step 設 exited_at + action
--     - 新 step 插一筆 entered_at
--   申請當下（INSERT）寫第一筆（step 0 entered）。
--   核准/駁回時設定 action + exited_at。
--
-- 涵蓋 6 種單據：
--   leave_requests / overtime_requests / business_trips /
--   clock_corrections / expenses / expense_requests
--
-- 不破壞既有資料：trigger 加上後才開始記錄；既有舊單沒有歷史也 OK。
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. approval_step_history 表 ═══
CREATE TABLE IF NOT EXISTS public.approval_step_history (
  id              SERIAL PRIMARY KEY,
  request_type    TEXT NOT NULL,    -- 'leave' / 'overtime' / 'trip' / 'correction' / 'expense' / 'expense_request'
  request_id      INT  NOT NULL,
  organization_id INT,
  chain_id        INT  REFERENCES public.approval_chains(id) ON DELETE SET NULL,
  step_order      INT  NOT NULL,
  step_label      TEXT,             -- 該關卡名稱（例：直屬主管）
  target_type     TEXT,             -- chain step target_type 快照
  entered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  exited_at       TIMESTAMPTZ,
  duration_seconds INT GENERATED ALWAYS AS (
    CASE WHEN exited_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (exited_at - entered_at))::INT
      ELSE NULL
    END
  ) STORED,
  approver_id     INT REFERENCES public.employees(id) ON DELETE SET NULL,
  approver_name   TEXT,             -- 實際簽核人快照
  action          TEXT,             -- 'approved' / 'rejected' / 'pending' / 'submitted'
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 防 Studio drift：表可能已存在但缺欄位，全部 ADD COLUMN IF NOT EXISTS 補齊
ALTER TABLE public.approval_step_history
  ADD COLUMN IF NOT EXISTS organization_id  INT,
  ADD COLUMN IF NOT EXISTS chain_id         INT,
  ADD COLUMN IF NOT EXISTS step_label       TEXT,
  ADD COLUMN IF NOT EXISTS target_type      TEXT,
  ADD COLUMN IF NOT EXISTS exited_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approver_id      INT,
  ADD COLUMN IF NOT EXISTS approver_name    TEXT,
  ADD COLUMN IF NOT EXISTS action           TEXT,
  ADD COLUMN IF NOT EXISTS notes            TEXT;

CREATE INDEX IF NOT EXISTS idx_ash_request
  ON public.approval_step_history(request_type, request_id);
CREATE INDEX IF NOT EXISTS idx_ash_org
  ON public.approval_step_history(organization_id);
CREATE INDEX IF NOT EXISTS idx_ash_pending
  ON public.approval_step_history(request_type, request_id, step_order)
  WHERE exited_at IS NULL;

-- RLS：同 org 可讀，service_role 可寫
ALTER TABLE public.approval_step_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='approval_step_history' AND policyname='same_org_can_read') THEN
    CREATE POLICY same_org_can_read ON public.approval_step_history
      FOR SELECT USING (
        organization_id IN (
          SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
        )
        OR auth.role() = 'service_role'
      );
  END IF;
END $$;


-- ═══ 2. helper：取 request 的 chain_id、current_step、employee_id ═══
CREATE OR REPLACE FUNCTION public._ash_get_request_meta(
  p_request_type TEXT,
  p_request_id   INT
) RETURNS TABLE (
  chain_id        INT,
  current_step    INT,
  status          TEXT,
  organization_id INT,
  applicant_id    INT,
  applicant_name  TEXT,
  approver_name   TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table TEXT;
BEGIN
  v_table := CASE p_request_type
    WHEN 'leave'           THEN 'leave_requests'
    WHEN 'overtime'        THEN 'overtime_requests'
    WHEN 'trip'            THEN 'business_trips'
    WHEN 'correction'      THEN 'clock_corrections'
    WHEN 'expense'         THEN 'expenses'
    WHEN 'expense_request' THEN 'expense_requests'
  END;
  IF v_table IS NULL THEN RETURN; END IF;

  IF p_request_type IN ('leave','overtime') THEN
    RETURN QUERY EXECUTE format(
      'SELECT approval_chain_id, current_step, status, organization_id, employee_id, employee, approver FROM %I WHERE id=$1',
      v_table
    ) USING p_request_id;
  ELSE
    -- 其他表 employee_id 可能 NULL，回 NULL
    RETURN QUERY EXECUTE format(
      'SELECT approval_chain_id, current_step, status, organization_id, NULL::INT, employee, COALESCE(approver, approved_by) FROM %I WHERE id=$1',
      v_table
    ) USING p_request_id;
  END IF;
END $$;


-- ═══ 3. 共用 trigger function：在 6 個單據表上 INSERT/UPDATE 時寫 history ═══
CREATE OR REPLACE FUNCTION public.trg_log_approval_step_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rt          TEXT;
  v_step_label  TEXT;
  v_target_type TEXT;
  v_action      TEXT;
BEGIN
  -- request_type 由 TG_TABLE_NAME 推
  v_rt := CASE TG_TABLE_NAME
    WHEN 'leave_requests'      THEN 'leave'
    WHEN 'overtime_requests'   THEN 'overtime'
    WHEN 'business_trips'      THEN 'trip'
    WHEN 'clock_corrections'   THEN 'correction'
    WHEN 'expenses'            THEN 'expense'
    WHEN 'expense_requests'    THEN 'expense_request'
    ELSE NULL
  END;
  IF v_rt IS NULL THEN RETURN NEW; END IF;

  -- ── INSERT：起手寫第一筆 entered ──
  IF TG_OP = 'INSERT' AND NEW.approval_chain_id IS NOT NULL THEN
    SELECT label, target_type INTO v_step_label, v_target_type
      FROM approval_chain_steps
     WHERE chain_id = NEW.approval_chain_id
       AND step_order = COALESCE(NEW.current_step, 0)
     LIMIT 1;

    INSERT INTO approval_step_history (
      request_type, request_id, organization_id, chain_id,
      step_order, step_label, target_type,
      entered_at, action
    ) VALUES (
      v_rt, NEW.id, NEW.organization_id, NEW.approval_chain_id,
      COALESCE(NEW.current_step, 0), v_step_label, v_target_type,
      now(), 'submitted'
    );
    RETURN NEW;
  END IF;

  -- ── UPDATE OF current_step：上一關 exit + 新關 entered ──
  IF TG_OP = 'UPDATE' AND NEW.current_step IS DISTINCT FROM OLD.current_step
     AND NEW.approval_chain_id IS NOT NULL THEN
    -- 1) 把上一關卡 exit + action='approved' (current_step 推進通常意味著前一關 approve)
    UPDATE approval_step_history
       SET exited_at = now(),
           action = CASE
             WHEN NEW.status IN ('已退回','已駁回') THEN 'rejected'
             ELSE 'approved'
           END,
           approver_name = COALESCE(NEW.approver, NEW.approved_by, approver_name)
     WHERE request_type = v_rt
       AND request_id = NEW.id
       AND step_order = OLD.current_step
       AND exited_at IS NULL;

    -- 2) 新關卡 entered
    SELECT label, target_type INTO v_step_label, v_target_type
      FROM approval_chain_steps
     WHERE chain_id = NEW.approval_chain_id
       AND step_order = NEW.current_step
     LIMIT 1;

    IF v_step_label IS NOT NULL THEN
      INSERT INTO approval_step_history (
        request_type, request_id, organization_id, chain_id,
        step_order, step_label, target_type,
        entered_at, action
      ) VALUES (
        v_rt, NEW.id, NEW.organization_id, NEW.approval_chain_id,
        NEW.current_step, v_step_label, v_target_type,
        now(), 'pending'
      );
    END IF;
    RETURN NEW;
  END IF;

  -- ── UPDATE OF status：終態（核准/駁回）關 exit ──
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('已核准','已核銷','已退回','已駁回','已拒絕') THEN
    v_action := CASE NEW.status
      WHEN '已核准' THEN 'approved'
      WHEN '已核銷' THEN 'approved'
      WHEN '已退回' THEN 'rejected'
      WHEN '已駁回' THEN 'rejected'
      WHEN '已拒絕' THEN 'rejected'
    END;
    UPDATE approval_step_history
       SET exited_at = now(),
           action = v_action,
           approver_name = COALESCE(NEW.approver, NEW.approved_by, approver_name)
     WHERE request_type = v_rt
       AND request_id = NEW.id
       AND exited_at IS NULL;
  END IF;

  RETURN NEW;
END $$;


-- ═══ 4. 掛 trigger 到 6 個單據表 ═══
DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'leave_requests','overtime_requests','business_trips',
    'clock_corrections','expenses','expense_requests'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_log_approval_step_history ON public.%I;
       CREATE TRIGGER trg_log_approval_step_history
         AFTER INSERT OR UPDATE OF current_step, status
         ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.trg_log_approval_step_history();',
      v_table, v_table
    );
  END LOOP;
END $$;


-- ═══ 5. 對外 RPC：給 LIFF/主系統 UI 拿時間軸用 ═══
CREATE OR REPLACE FUNCTION public.get_approval_timeline(
  p_request_type TEXT,
  p_request_id   INT
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN COALESCE((
    SELECT json_agg(json_build_object(
      'step_order', step_order,
      'step_label', step_label,
      'target_type', target_type,
      'entered_at', entered_at,
      'exited_at', exited_at,
      'duration_seconds', duration_seconds,
      'duration_text', CASE
        WHEN duration_seconds IS NULL THEN '進行中…'
        WHEN duration_seconds < 60 THEN duration_seconds || ' 秒'
        WHEN duration_seconds < 3600 THEN (duration_seconds / 60) || ' 分鐘'
        WHEN duration_seconds < 86400 THEN
          (duration_seconds / 3600) || ' 小時 ' ||
          ((duration_seconds % 3600) / 60) || ' 分'
        ELSE
          (duration_seconds / 86400) || ' 天 ' ||
          ((duration_seconds % 86400) / 3600) || ' 小時'
      END,
      'action', action,
      'approver_name', approver_name
    ) ORDER BY step_order, entered_at)
      FROM approval_step_history
     WHERE request_type = p_request_type
       AND request_id   = p_request_id
  ), '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.get_approval_timeline(TEXT, INT) TO authenticated, anon;


COMMIT;

NOTIFY pgrst, 'reload schema';

-- 驗證：拿 leave #25 的時間軸
-- SELECT public.get_approval_timeline('leave', 25);
