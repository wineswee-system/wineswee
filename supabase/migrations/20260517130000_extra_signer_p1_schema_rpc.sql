-- ════════════════════════════════════════════════════════════════════════════
-- 加簽功能 P1 — schema + state machine RPC
--
-- 為 4 套簽核鏈（HR forms / HR 異動 / expense_requests / task_chain）提供
-- 「臨時插入額外簽核人」的 runtime layer。
--
-- 設計重點：
--   1. 完全獨立的 table，不動既有 chain template (approval_chain_steps)
--   2. per-instance 插隊，不回寫 template（一次性）
--   3. 4 套 chain trigger 共用 lookup function (get_pending_extra_step)
--   4. P1 只做純 state machine：建立/撤銷/處理 加簽紀錄
--      → LINE push 與 source row 狀態同步在 P2 各 chain integration 處理
--      （在 4 套 chain 的 trigger 內 lookup pending extra → 推 LINE / 改 status）
--
-- 對齊現有規範：
--   - SECURITY DEFINER + SET search_path（防 search_path 注入）
--   - GRANT 給 authenticated/service_role/anon（LIFF 需要 anon）
--   - 表名白名單集中在 _extra_step_allowed_tables() 一個地方
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Schema ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.approval_extra_steps (
  id                  serial PRIMARY KEY,
  source_table        text NOT NULL,
  source_id           integer NOT NULL,
  insert_before_step  integer NOT NULL CHECK (insert_before_step >= 0),
  assignee_id         integer NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  requested_by_id     integer NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  reason              text,
  status              text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected','cancelled')),
  reject_reason       text,
  approved_at         timestamptz,
  cancelled_at        timestamptz,
  organization_id     integer NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT extra_step_reject_reason_required
    CHECK (status <> 'rejected' OR (reject_reason IS NOT NULL AND length(trim(reject_reason)) > 0)),
  CONSTRAINT extra_step_no_self_signing
    CHECK (assignee_id <> requested_by_id)
);

CREATE INDEX IF NOT EXISTS idx_extra_steps_lookup
  ON public.approval_extra_steps(source_table, source_id, status, insert_before_step);
CREATE INDEX IF NOT EXISTS idx_extra_steps_assignee
  ON public.approval_extra_steps(assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_extra_steps_requester
  ON public.approval_extra_steps(requested_by_id, status);

COMMENT ON TABLE public.approval_extra_steps IS
  '加簽 runtime layer — 跨 4 套簽核鏈共用，per-instance 插隊紀錄（不回寫 chain template）';
COMMENT ON COLUMN public.approval_extra_steps.source_table IS
  '來源表名（白名單見 _extra_step_allowed_tables）：leave_requests / overtime_requests / business_trips / clock_corrections / expenses / resignation_requests / personnel_transfer_requests / leave_of_absence_requests / expense_requests / tasks';
COMMENT ON COLUMN public.approval_extra_steps.insert_before_step IS
  '插在原 chain 的第 N 步「之前」，視覺上顯示為 N - 0.5 步';
COMMENT ON COLUMN public.approval_extra_steps.status IS
  'pending（等加簽人處理）/ approved（加簽通過，原 chain 繼續）/ rejected（整單退回）/ cancelled（發起人撤銷）';

-- ─── updated_at trigger ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._extra_steps_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_extra_steps_touch_updated_at ON public.approval_extra_steps;
CREATE TRIGGER trg_extra_steps_touch_updated_at
  BEFORE UPDATE ON public.approval_extra_steps
  FOR EACH ROW EXECUTE FUNCTION public._extra_steps_touch_updated_at();

-- ─── 表名白名單（集中管理，要加新 chain 改一個地方）──────────────────────────
CREATE OR REPLACE FUNCTION public._extra_step_allowed_tables()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    -- HR Forms (5)
    'leave_requests',
    'overtime_requests',
    'business_trips',
    'clock_corrections',
    'expenses',
    -- HR Personnel Changes (3)
    'resignation_requests',
    'personnel_transfer_requests',
    'leave_of_absence_requests',
    -- Expense Applications
    'expense_requests',
    -- Task Chain Unified
    'tasks'
  ]::text[]
$$;

COMMENT ON FUNCTION public._extra_step_allowed_tables() IS
  '加簽支援的 source_table 白名單。新增 chain 類型時擴充這裡';

-- ═══════════════════════════════════════════════════════════════════════════
-- Lookup Helper（4 套 chain trigger 推進前都要呼叫）
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_pending_extra_step(
  p_source_table text,
  p_source_id    integer,
  p_current_step integer
) RETURNS public.approval_extra_steps
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT *
  FROM public.approval_extra_steps
  WHERE source_table = p_source_table
    AND source_id = p_source_id
    AND status = 'pending'
    AND insert_before_step = p_current_step
  ORDER BY created_at ASC
  LIMIT 1
$$;

COMMENT ON FUNCTION public.get_pending_extra_step(text, integer, integer) IS
  '查指定單據在指定 step 的 pending 加簽（4 套 chain trigger 推進前都要呼叫）';

GRANT EXECUTE ON FUNCTION public.get_pending_extra_step(text, integer, integer)
  TO authenticated, service_role, anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC 1: request_extra_signer（發起加簽）
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.request_extra_signer(
  p_source_table       text,
  p_source_id          integer,
  p_insert_before_step integer,
  p_assignee_id        integer,
  p_requested_by_id    integer,
  p_reason             text DEFAULT NULL
) RETURNS public.approval_extra_steps
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id integer;
  v_existing_id integer;
  v_inserted public.approval_extra_steps;
BEGIN
  -- 1. source_table 白名單檢查
  IF NOT (p_source_table = ANY(public._extra_step_allowed_tables())) THEN
    RAISE EXCEPTION '加簽不支援此單據類型：%', p_source_table
      USING ERRCODE = '22023';
  END IF;

  -- 2. assignee / requester 不能同一人（schema CHECK 也擋，這裡是友善訊息）
  IF p_assignee_id = p_requested_by_id THEN
    RAISE EXCEPTION '不能對自己加簽'
      USING ERRCODE = '22023';
  END IF;

  -- 3. 同單同 step 不能有重複 pending
  SELECT id INTO v_existing_id
  FROM public.approval_extra_steps
  WHERE source_table = p_source_table
    AND source_id = p_source_id
    AND insert_before_step = p_insert_before_step
    AND status = 'pending'
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RAISE EXCEPTION '此步驟已有 pending 加簽（id=%）', v_existing_id
      USING ERRCODE = '23505';
  END IF;

  -- 4. 取 organization_id（從 requester；source row 端的 org 由 trigger / 前端確保一致）
  SELECT organization_id INTO v_org_id
  FROM public.employees
  WHERE id = p_requested_by_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION '無法取得發起人 organization_id (requested_by_id=%)', p_requested_by_id;
  END IF;

  -- 5. INSERT
  INSERT INTO public.approval_extra_steps (
    source_table, source_id, insert_before_step,
    assignee_id, requested_by_id, reason,
    status, organization_id
  ) VALUES (
    p_source_table, p_source_id, p_insert_before_step,
    p_assignee_id, p_requested_by_id, p_reason,
    'pending', v_org_id
  )
  RETURNING * INTO v_inserted;

  RETURN v_inserted;
END
$$;

COMMENT ON FUNCTION public.request_extra_signer(text, integer, integer, integer, integer, text) IS
  '發起加簽（P1 不含 LINE push；P2 各 chain trigger 內接 AFTER INSERT 補推）';

GRANT EXECUTE ON FUNCTION public.request_extra_signer(text, integer, integer, integer, integer, text)
  TO authenticated, service_role, anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC 2: cancel_extra_signer（發起人撤銷 pending 加簽）
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cancel_extra_signer(
  p_extra_step_id integer,
  p_canceller_id  integer
) RETURNS public.approval_extra_steps
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_extra public.approval_extra_steps;
BEGIN
  SELECT * INTO v_extra
  FROM public.approval_extra_steps
  WHERE id = p_extra_step_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '加簽紀錄不存在（id=%）', p_extra_step_id
      USING ERRCODE = '22023';
  END IF;

  IF v_extra.status <> 'pending' THEN
    RAISE EXCEPTION '加簽狀態非 pending（目前=%），無法撤銷', v_extra.status
      USING ERRCODE = '22023';
  END IF;

  IF v_extra.requested_by_id <> p_canceller_id THEN
    RAISE EXCEPTION '只有發起人可以撤銷加簽（requester=%，canceller=%）',
      v_extra.requested_by_id, p_canceller_id
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.approval_extra_steps
  SET status = 'cancelled', cancelled_at = now()
  WHERE id = p_extra_step_id
  RETURNING * INTO v_extra;

  RETURN v_extra;
END
$$;

COMMENT ON FUNCTION public.cancel_extra_signer(integer, integer) IS
  '發起人撤銷 pending 加簽（P1 不含 LINE push）';

GRANT EXECUTE ON FUNCTION public.cancel_extra_signer(integer, integer)
  TO authenticated, service_role, anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC 3: process_extra_signer（加簽人 approve / reject）
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.process_extra_signer(
  p_extra_step_id  integer,
  p_processor_id   integer,
  p_action         text,     -- 'approve' | 'reject'
  p_reject_reason  text DEFAULT NULL
) RETURNS public.approval_extra_steps
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_extra public.approval_extra_steps;
BEGIN
  SELECT * INTO v_extra
  FROM public.approval_extra_steps
  WHERE id = p_extra_step_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '加簽紀錄不存在（id=%）', p_extra_step_id
      USING ERRCODE = '22023';
  END IF;

  IF v_extra.status <> 'pending' THEN
    RAISE EXCEPTION '加簽狀態非 pending（目前=%），無法處理', v_extra.status
      USING ERRCODE = '22023';
  END IF;

  IF v_extra.assignee_id <> p_processor_id THEN
    RAISE EXCEPTION '只有加簽人本人可以處理（assignee=%，processor=%）',
      v_extra.assignee_id, p_processor_id
      USING ERRCODE = '42501';
  END IF;

  IF p_action = 'approve' THEN
    UPDATE public.approval_extra_steps
    SET status = 'approved', approved_at = now()
    WHERE id = p_extra_step_id
    RETURNING * INTO v_extra;

  ELSIF p_action = 'reject' THEN
    IF p_reject_reason IS NULL OR length(trim(p_reject_reason)) = 0 THEN
      RAISE EXCEPTION '退回必須填原因'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.approval_extra_steps
    SET status = 'rejected', reject_reason = p_reject_reason
    WHERE id = p_extra_step_id
    RETURNING * INTO v_extra;

  ELSE
    RAISE EXCEPTION '無效的 action：%（必須是 approve 或 reject）', p_action
      USING ERRCODE = '22023';
  END IF;

  -- Note: P1 不處理 source row 狀態同步（reject 時把原單改成「已退回」）
  --       與 LINE push（推進、退回、撤銷）兩塊
  -- 這兩塊在 P2 各 chain integration 內補（透過 AFTER UPDATE trigger 或在源頭 trigger 內 lookup）

  RETURN v_extra;
END
$$;

COMMENT ON FUNCTION public.process_extra_signer(integer, integer, text, text) IS
  '加簽人 approve/reject（reject 必填 reason）；P1 不更新 source row 狀態 + 不推 LINE，留 P2 處理';

GRANT EXECUTE ON FUNCTION public.process_extra_signer(integer, integer, text, text)
  TO authenticated, service_role, anon;
