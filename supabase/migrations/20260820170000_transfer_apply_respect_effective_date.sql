-- 根因修:人事異動一核准就立刻套用到 employees 主檔,完全沒看 effective_date。
-- 後果:生效日填未來(如 9/1)的異動,核准當下就把員工轉走 → 連帶觸發「換門市刪未來排班」把班表刪了。
-- 修:①trigger 只有 effective_date <= 今天才立刻套主檔;未來生效日只記 position_history,等 cron 到日再套。
--    ②新增 process_effective_transfers() + 每日 cron,到生效日才把當日生效的 position_history 套進 employees。

-- ── ① trigger 加生效日閘門 ──
CREATE OR REPLACE FUNCTION public.trg_transfer_apply_on_approve()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = '已核准' AND (OLD.status IS DISTINCT FROM '已核准') THEN
    -- 結束舊 position_history 紀錄(到生效日前一天)
    UPDATE position_history
       SET end_date = NEW.effective_date - INTERVAL '1 day'
     WHERE employee_id = NEW.employee_id
       AND end_date IS NULL;

    -- 記新 position_history(含未來生效日;這是「排定的異動」紀錄)
    INSERT INTO position_history(
      employee_id, organization_id, effective_date, end_date,
      department_id, store_id, position, base_salary, role,
      change_type, reason, source_request_id, changed_by
    ) VALUES (
      NEW.employee_id, NEW.organization_id, NEW.effective_date, NULL,
      COALESCE(NEW.new_department_id, NEW.old_department_id),
      COALESCE(NEW.new_store_id, NEW.old_store_id),
      COALESCE(NEW.new_position, NEW.old_position),
      COALESCE(NEW.new_base_salary, NEW.old_base_salary),
      COALESCE(NEW.new_role, NEW.old_role),
      NEW.transfer_type, NEW.reason, NEW.id, NEW.approver_id
    );

    -- ★ 只有生效日「今天或已過」才立刻套主檔;未來生效日等 process_effective_transfers cron 到日再套
    IF NEW.effective_date <= CURRENT_DATE THEN
      UPDATE employees SET
        department_id = COALESCE(NEW.new_department_id, department_id),
        store_id      = COALESCE(NEW.new_store_id, store_id),
        position      = COALESCE(NEW.new_position, position),
        base_salary   = COALESCE(NEW.new_base_salary, base_salary)
      WHERE id = NEW.employee_id;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- ── ② 生效日到才套用的 processor ──
CREATE OR REPLACE FUNCTION public.process_effective_transfers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; n int := 0;
BEGIN
  -- 今天正式生效的排定異動 → 套進 employees 主檔(此時改門市才會、也應該連動未來排班)
  FOR r IN
    SELECT ph.* FROM position_history ph
     WHERE ph.effective_date = CURRENT_DATE
       AND ph.source_request_id IS NOT NULL
  LOOP
    UPDATE employees SET
      department_id = COALESCE(r.department_id, department_id),
      store_id      = COALESCE(r.store_id, store_id),
      position      = COALESCE(r.position, position),
      base_salary   = COALESCE(r.base_salary, base_salary)
    WHERE id = r.employee_id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $function$;

-- 每日 08:05(台灣)跑一次(冪等:先解除舊排程)
DO $$ BEGIN PERFORM cron.unschedule('process-effective-transfers'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('process-effective-transfers', '5 0 * * *', 'SELECT public.process_effective_transfers()');
