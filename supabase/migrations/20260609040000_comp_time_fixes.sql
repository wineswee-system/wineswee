-- ════════════════════════════════════════════════════════════════════════════
-- 補休系統修補 — 處理上線後發現的 6 個問題
--
-- 1. type 存值不一致 — 主系統 Leave.jsx 因為 selectedPolicy 沒宣告，存 'comp_time'
--    （code）；LIFF 存 '補休'（中文）。Backfill 統一成 '補休'。
--
-- 2. 補休假被駁回不退 ledger — 加 trigger，status 改成「駁回 / 已拒絕 / 已撤回 /
--    已取消」或 deleted_at 從 NULL 變非 NULL 時，把 comp_time_usages 退回 ledger。
--
-- 3. （由前端 Leave.jsx 處理）— 不在 PG 層擋
--
-- 4. deduct_comp_time race condition — 加 pg_advisory_xact_lock(employee_id)
--    序列化同員工的並發呼叫，並對 ledger row SELECT FOR UPDATE。
--
-- 5. RLS USING (true) 太寬 — 改成「super_admin/admin/manager 看全部、其他人只看
--    自己 employee_id 的」。
--
-- 6. Admin 改 approved OT 的 ot_type 沒擋 — 加 trigger，已核准的 OT 不准改
--    ot_type（避免 ledger 已建但 ot_type 變成 'pay' 導致 double pay）。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Backfill type ─────────────────────────────────────────────────────
-- 把存成 'comp_time' code 的紀錄改成 '補休'，跟 LIFF 一致
UPDATE public.leave_requests
   SET type = '補休'
 WHERE type = 'comp_time';


-- ─── 2. Refund trigger ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_refund_comp_time_on_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_should_refund BOOLEAN := false;
  v_n             INT;
BEGIN
  -- 只處理 type='補休' 的 leave_request（也接受老資料的 'comp_time'）
  -- 用 OLD.type 判斷（誰原本扣 ledger 才退誰）— 防 type 被改掉
  IF OLD.type NOT IN ('補休', 'comp_time') THEN
    RETURN NEW;
  END IF;

  -- 條件 1：status 從非取消類 → 取消類
  IF OLD.status NOT IN ('駁回', '已拒絕', '已撤回', '已取消')
     AND NEW.status IN ('駁回', '已拒絕', '已撤回', '已取消') THEN
    v_should_refund := true;
  END IF;

  -- 條件 2：deleted_at 從 NULL → NOT NULL（soft delete）
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    v_should_refund := true;
  END IF;

  IF NOT v_should_refund THEN
    RETURN NEW;
  END IF;

  -- 退還 ledger：把 usage 加回去
  UPDATE public.comp_time_ledger l
     SET hours_used = GREATEST(l.hours_used - u.hours_used, 0),
         status = CASE
                    WHEN l.status = 'exhausted' AND (l.hours_used - u.hours_used) < l.hours
                    THEN 'active' ELSE l.status
                  END
    FROM public.comp_time_usages u
   WHERE u.leave_request_id = NEW.id AND l.id = u.comp_time_ledger_id;

  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n > 0 THEN
    DELETE FROM public.comp_time_usages WHERE leave_request_id = NEW.id;
    RAISE NOTICE 'comp_time refund: leave_request_id=% rows=%', NEW.id, v_n;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_leave_refund_comp_time ON public.leave_requests;
CREATE TRIGGER trg_leave_refund_comp_time
  AFTER UPDATE ON public.leave_requests
  FOR EACH ROW
  WHEN (
    (OLD.status IS DISTINCT FROM NEW.status)
    OR (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  )
  EXECUTE FUNCTION public.trg_refund_comp_time_on_cancel();


-- ─── 4. deduct_comp_time 加 advisory lock + FOR UPDATE ────────────────────
CREATE OR REPLACE FUNCTION public.deduct_comp_time(
  p_leave_request_id INT,
  p_employee_id      INT,
  p_hours            NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining NUMERIC := p_hours;
  v_available NUMERIC;
  v_take      NUMERIC;
  v_used      JSON[] := ARRAY[]::JSON[];
  rec         RECORD;
BEGIN
  IF p_hours IS NULL OR p_hours <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_hours');
  END IF;

  -- 序列化同員工的並發呼叫（避免 TOCTOU race）
  PERFORM pg_advisory_xact_lock(hashtext('comp_time:' || p_employee_id));

  SELECT COALESCE(SUM(hours - hours_used), 0) INTO v_available
    FROM comp_time_ledger
   WHERE employee_id = p_employee_id AND status = 'active';

  IF v_available < p_hours THEN
    RETURN json_build_object(
      'ok', false, 'error', 'insufficient_balance',
      'available', v_available, 'requested', p_hours
    );
  END IF;

  -- FOR UPDATE 鎖住要動的 ledger row（同 advisory lock 雙保險）
  FOR rec IN
    SELECT id, hours, hours_used, (hours - hours_used) AS remaining
      FROM comp_time_ledger
     WHERE employee_id = p_employee_id
       AND status = 'active'
       AND (hours - hours_used) > 0
     ORDER BY expires_at ASC, id ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_take := LEAST(rec.remaining, v_remaining);

    UPDATE comp_time_ledger
       SET hours_used = hours_used + v_take,
           status = CASE
             WHEN (hours_used + v_take) >= hours THEN 'exhausted'
             ELSE 'active'
           END
     WHERE id = rec.id;

    INSERT INTO comp_time_usages (leave_request_id, comp_time_ledger_id, hours_used)
    VALUES (p_leave_request_id, rec.id, v_take);

    v_used := v_used || json_build_object('ledger_id', rec.id, 'hours', v_take);
    v_remaining := v_remaining - v_take;
  END LOOP;

  RETURN json_build_object('ok', true, 'deductions', array_to_json(v_used));
END $$;

GRANT EXECUTE ON FUNCTION public.deduct_comp_time(INT, INT, NUMERIC) TO authenticated;


-- ─── 5. RLS：comp_time_ledger / comp_time_usages 收緊 ────────────────────
-- 規則：super_admin/admin/manager 看全部、其他人只看自己的（employee_id 比對）
-- service_role 經 SECURITY DEFINER RPC 進來，policy 不影響
DROP POLICY IF EXISTS comp_time_ledger_read ON public.comp_time_ledger;
CREATE POLICY comp_time_ledger_read ON public.comp_time_ledger
  FOR SELECT
  USING (
    public.current_employee_role() IN ('super_admin', 'admin', 'manager')
    OR employee_id = public.current_employee_id()
  );

DROP POLICY IF EXISTS comp_time_usages_read ON public.comp_time_usages;
CREATE POLICY comp_time_usages_read ON public.comp_time_usages
  FOR SELECT
  USING (
    public.current_employee_role() IN ('super_admin', 'admin', 'manager')
    OR EXISTS (
      SELECT 1 FROM public.leave_requests lr
       WHERE lr.id = leave_request_id
         AND lr.employee_id = public.current_employee_id()
    )
  );


-- ─── 6. OT ot_type 核准後鎖死 ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_lock_ot_type_after_approve()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- 已經核准的 OT 不准改 ot_type（避免 ledger 已建但 ot_type 變 'pay' → double pay）
  IF TG_OP = 'UPDATE'
     AND OLD.status = '已核准'
     AND NEW.ot_type IS DISTINCT FROM OLD.ot_type THEN
    RAISE EXCEPTION '加班申請核准後不能變更結算方式（加班費 / 補休）';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ot_type_immutable_after_approve ON public.overtime_requests;
CREATE TRIGGER trg_ot_type_immutable_after_approve
  BEFORE UPDATE OF ot_type, status ON public.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_lock_ot_type_after_approve();

COMMIT;

NOTIFY pgrst, 'reload schema';
