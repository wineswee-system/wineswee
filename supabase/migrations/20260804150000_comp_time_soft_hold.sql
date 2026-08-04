-- 補休改「軟扣(預留)」:送出=預留、核准才實扣 — 2026-08-04
-- ════════════════════════════════════════════════════════════════════════════
-- 需求(老闆):補休申請送出當下不該把餘額硬扣掉;待審核=預留(佔額防超額),核准才真扣。
--   餘額顯示要能分「已休(核准)」vs「簽核中(待審預留)」。
-- 設計:
--   comp_time_ledger 加 hours_reserved(預留);comp_time_usages 加 status(reserved/confirmed)。
--   deduct_comp_time(送出時 5 支 RPC 都呼叫)→ 改成「軟扣」:扣進 hours_reserved、usage=reserved,
--     餘額檢查=hours − hours_used − hours_reserved(仍防超額)。★不用改那 5 支 RPC。
--   核准 trigger:補休 status→已核准 → confirm_comp_time:reserved→confirmed、hours_reserved→hours_used。
--   退還 trigger:reserved 退 hours_reserved、confirmed 退 hours_used。
--   餘額 = hours − hours_used;可申請 = hours − hours_used − hours_reserved。
-- 回補:現況待審核補休的 usages 目前在 hours_used(舊硬扣)→ 搬回 hours_reserved+標 reserved。
--   (張庭瑋 #395:已休 18.5→10.5、簽核中 0→8、剩 2.5→10.5)。idempotent。
-- ════════════════════════════════════════════════════════════════════════════

-- ── (1) 欄位 ──
ALTER TABLE public.comp_time_ledger ADD COLUMN IF NOT EXISTS hours_reserved numeric NOT NULL DEFAULT 0;
ALTER TABLE public.comp_time_usages ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'confirmed';

-- ── (2) deduct_comp_time → 軟扣(預留) ──
CREATE OR REPLACE FUNCTION public.deduct_comp_time(p_leave_request_id integer, p_employee_id integer, p_hours numeric)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_remaining NUMERIC := p_hours;
  v_available NUMERIC;
  v_take      NUMERIC;
  v_used      JSON[] := ARRAY[]::JSON[];
  rec         RECORD;
  v_confirmed BOOLEAN;   -- 該假單是否「已核准」(已核准→直接實扣;否則預留)
BEGIN
  IF p_hours IS NULL OR p_hours <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_hours');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('comp_time:' || p_employee_id));

  -- 建立時就已核准的補休(如國定假日補休 auto-approve)→ 直接 confirmed;一般待審 → reserved
  SELECT (status = '已核准') INTO v_confirmed FROM public.leave_requests WHERE id = p_leave_request_id;
  v_confirmed := COALESCE(v_confirmed, false);

  SELECT COALESCE(SUM(hours - hours_used - hours_reserved), 0) INTO v_available
    FROM comp_time_ledger
   WHERE employee_id = p_employee_id AND status = 'active';

  IF v_available < p_hours THEN
    RETURN json_build_object('ok', false, 'error', 'insufficient_balance',
                             'available', v_available, 'requested', p_hours);
  END IF;

  FOR rec IN
    SELECT id, (hours - hours_used - hours_reserved) AS remaining
      FROM comp_time_ledger
     WHERE employee_id = p_employee_id
       AND status = 'active'
       AND (hours - hours_used - hours_reserved) > 0
     ORDER BY expires_at ASC, id ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(rec.remaining, v_remaining);

    IF v_confirmed THEN
      UPDATE comp_time_ledger
         SET hours_used = hours_used + v_take,
             status = CASE WHEN (hours_used + v_take) >= hours THEN 'exhausted' ELSE status END
       WHERE id = rec.id;
    ELSE
      UPDATE comp_time_ledger SET hours_reserved = hours_reserved + v_take WHERE id = rec.id;
    END IF;

    INSERT INTO comp_time_usages (leave_request_id, comp_time_ledger_id, hours_used, status)
    VALUES (p_leave_request_id, rec.id, v_take, CASE WHEN v_confirmed THEN 'confirmed' ELSE 'reserved' END);

    v_used := v_used || json_build_object('ledger_id', rec.id, 'hours', v_take);
    v_remaining := v_remaining - v_take;
  END LOOP;

  RETURN json_build_object('ok', true, 'confirmed', v_confirmed, 'items', array_to_json(v_used));
END $function$;

-- ── (3) confirm_comp_time:reserved → confirmed(hours_reserved → hours_used) ──
CREATE OR REPLACE FUNCTION public.confirm_comp_time(p_leave_request_id integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.comp_time_ledger l SET
    hours_reserved = GREATEST(l.hours_reserved - u.h, 0),
    hours_used     = l.hours_used + u.h,
    status         = CASE WHEN (l.hours_used + u.h) >= l.hours THEN 'exhausted' ELSE l.status END
  FROM (
    SELECT comp_time_ledger_id, SUM(hours_used) AS h
      FROM public.comp_time_usages
     WHERE leave_request_id = p_leave_request_id AND status = 'reserved'
     GROUP BY comp_time_ledger_id
  ) u
  WHERE l.id = u.comp_time_ledger_id;

  UPDATE public.comp_time_usages SET status = 'confirmed'
   WHERE leave_request_id = p_leave_request_id AND status = 'reserved';
END $function$;

-- ── (4) 核准 trigger:補休轉已核准 → confirm ──
CREATE OR REPLACE FUNCTION public.trg_confirm_comp_time_on_approve()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.type IN ('補休', 'comp_time') AND NEW.status = '已核准'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM '已核准') THEN
    PERFORM public.confirm_comp_time(NEW.id);
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_confirm_comp_time ON public.leave_requests;
CREATE TRIGGER trg_confirm_comp_time
  AFTER INSERT OR UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_confirm_comp_time_on_approve();

-- ── (5) 退還 trigger:reserved 退 hours_reserved、confirmed 退 hours_used ──
CREATE OR REPLACE FUNCTION public.trg_refund_comp_time_on_cancel()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_should_refund BOOLEAN := false; v_n INT;
BEGIN
  IF OLD.type NOT IN ('補休', 'comp_time') THEN RETURN NEW; END IF;
  IF OLD.status NOT IN ('駁回','已拒絕','已撤回','已取消')
     AND NEW.status IN ('駁回','已拒絕','已撤回','已取消') THEN v_should_refund := true; END IF;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN v_should_refund := true; END IF;
  IF NOT v_should_refund THEN RETURN NEW; END IF;

  -- 退 reserved（待審預留）
  UPDATE public.comp_time_ledger l
     SET hours_reserved = GREATEST(l.hours_reserved - u.h, 0)
    FROM (SELECT comp_time_ledger_id, SUM(hours_used) h FROM public.comp_time_usages
           WHERE leave_request_id = NEW.id AND status = 'reserved' GROUP BY comp_time_ledger_id) u
   WHERE l.id = u.comp_time_ledger_id;
  -- 退 confirmed（已核准實扣）
  UPDATE public.comp_time_ledger l
     SET hours_used = GREATEST(l.hours_used - u.h, 0),
         status = CASE WHEN l.status='exhausted' AND (l.hours_used - u.h) < l.hours THEN 'active' ELSE l.status END
    FROM (SELECT comp_time_ledger_id, SUM(hours_used) h FROM public.comp_time_usages
           WHERE leave_request_id = NEW.id AND status = 'confirmed' GROUP BY comp_time_ledger_id) u
   WHERE l.id = u.comp_time_ledger_id;

  DELETE FROM public.comp_time_usages WHERE leave_request_id = NEW.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN RAISE NOTICE 'comp_time refund: leave_request_id=% rows=%', NEW.id, v_n; END IF;
  RETURN NEW;
END $function$;

-- ── (6) 回補:待審核(未核准)補休的 usages 從 hours_used 搬回 hours_reserved + 標 reserved ──
UPDATE public.comp_time_ledger l SET
  hours_used     = GREATEST(l.hours_used - u.h, 0),
  hours_reserved = l.hours_reserved + u.h,
  status         = CASE WHEN l.status='exhausted' AND (l.hours_used - u.h) < l.hours THEN 'active' ELSE l.status END
FROM (
  SELECT cu.comp_time_ledger_id, SUM(cu.hours_used) AS h
    FROM public.comp_time_usages cu
    JOIN public.leave_requests lr ON lr.id = cu.leave_request_id
   WHERE lr.type IN ('補休','comp_time') AND lr.status <> '已核准' AND lr.deleted_at IS NULL
     AND cu.status = 'confirmed'
   GROUP BY cu.comp_time_ledger_id
) u
WHERE l.id = u.comp_time_ledger_id;

UPDATE public.comp_time_usages cu SET status = 'reserved'
FROM public.leave_requests lr
WHERE lr.id = cu.leave_request_id
  AND lr.type IN ('補休','comp_time') AND lr.status <> '已核准' AND lr.deleted_at IS NULL
  AND cu.status = 'confirmed';

NOTIFY pgrst, 'reload schema';
