-- 回填舊加班單為「淨工時」(自動扣休息) — 2026-07-20
-- 對齊新規則 computeOvertimeHours:毛時數 <5h 扣0、5~9h 扣30、≥9h 扣60分,扣後湊各店 step。
-- 範圍:所有未刪、有起訖時間的 overtime_requests(含已核准、含匯入例外單 is_exception)。
--   ⚠️ 使用者明確選 C=全回填,包含匯入例外單(其時數原以廠商 PDF 為準,此處一律改用起訖重算)。
-- 手法:DO block 內 DISABLE TRIGGER USER(繞 block_edit_after_signed 守衛 + 各種 guard),
--   直接寫 hours + ot_hours(不靠 sync trigger),做完 ENABLE。block 原子性→失敗全 rollback。
-- idempotent:重算=淨值,第二次跑 net==hours 直接略過,重跑安全。

DO $$
DECLARE
  r RECORD;
  v_gross_min int;
  v_rest      int;
  v_step      numeric;
  v_net       numeric;
  v_cnt       int := 0;
BEGIN
  ALTER TABLE public.overtime_requests DISABLE TRIGGER USER;

  FOR r IN
    SELECT id, date, start_time, end_time, hours, store, organization_id
    FROM public.overtime_requests
    WHERE deleted_at IS NULL
      AND start_time IS NOT NULL
      AND end_time IS NOT NULL
  LOOP
    -- 毛時數(分);跨日 end<=start 自動 +24h
    v_gross_min := (EXTRACT(HOUR FROM r.end_time)::int * 60 + EXTRACT(MINUTE FROM r.end_time)::int)
                 - (EXTRACT(HOUR FROM r.start_time)::int * 60 + EXTRACT(MINUTE FROM r.start_time)::int);
    IF v_gross_min <= 0 THEN v_gross_min := v_gross_min + 1440; END IF;

    -- 休息階梯(同全系統)
    v_rest := CASE WHEN v_gross_min < 300 THEN 0
                   WHEN v_gross_min < 540 THEN 30
                   ELSE 60 END;

    -- 各店最小單位 step(依門市名對 stores.overtime_step_hours;查不到 fallback 0.5)
    v_step := (SELECT overtime_step_hours FROM public.stores
               WHERE name = r.store AND organization_id = r.organization_id LIMIT 1);
    IF v_step IS NULL OR v_step <= 0 THEN v_step := 0.5; END IF;

    -- 扣休息後湊 step(四捨五入,對齊 JS Math.round)
    v_net := ROUND( ((v_gross_min - v_rest)::numeric / 60.0) / v_step ) * v_step;
    IF v_net < 0 THEN v_net := 0; END IF;

    IF v_net IS DISTINCT FROM r.hours THEN
      UPDATE public.overtime_requests
        SET hours = v_net, ot_hours = v_net
        WHERE id = r.id;
      v_cnt := v_cnt + 1;
    END IF;
  END LOOP;

  ALTER TABLE public.overtime_requests ENABLE TRIGGER USER;
  RAISE NOTICE '加班淨工時回填完成:% 筆已更新', v_cnt;
END $$;

NOTIFY pgrst, 'reload schema';
