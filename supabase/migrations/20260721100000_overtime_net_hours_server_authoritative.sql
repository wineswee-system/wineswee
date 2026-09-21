-- 加班淨工時「後端單一來源」— 2026-07-21
-- 目標:把「起訖時間→扣休息→湊 step」的淨工時計算搬到後端,讓 web/LIFF/手機/Studio
--   不管誰建、送什麼 hours,一律以後端算的淨值為準 → 根治 web↔LIFF 重複、解鎖手機(不用重寫 Dart 算法)。
--   (對齊老闆 MOBILE_PLAN §8 的 create_overtime_request 需求,但改用「共用計算 RPC + enforce trigger」
--    這樣不用重刻整條建立流程(附件/workflow/快照都保留在既有路徑),風險最小。)
--
-- 兩部分:
--   ① overtime_net_hours(store,org,start,end) RPC — 純計算,給前端即時預覽 + trigger 共用(單一來源)。
--   ② BEFORE INSERT/UPDATE trigger — 建單/改起訖時,後端強制把 hours+ot_hours 設成淨值。
--
-- 小心處(踩過的雷):
--   * 匯入例外單(is_exception 或 source in import/104匯入)起訖是垃圾佔位 → 一律跳過不重算(保留廠商值)。
--   * UPDATE 只在「起訖時間有變」才重算 → 否則已簽核單被狀態更新會改到 hours → 撞 block_edit_after_signed。
--   * 同時設 hours+ot_hours,且 trigger 名 trg_a0_ 排最前 → 46h/勞基法 guard 看到正確淨值。
--   * net<=0 或 >12 一律不覆寫(留原值,讓既有 chk_ot_positive_hours(<=12) 自然把關,不硬塞爆 constraint)。
--   * 規則與 src/lib/scheduleUtils.js#getRestMinutes 同:<5h 0、5~9h 30、>=9h 60 分。

-- ═══ ① 淨工時計算 RPC(前端預覽 + trigger 共用)═══
CREATE OR REPLACE FUNCTION public.overtime_net_hours(
  p_store text, p_org bigint, p_start time, p_end time
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_gross_min int;
  v_rest      int;
  v_step      numeric;
  v_net       numeric;
BEGIN
  IF p_start IS NULL OR p_end IS NULL THEN RETURN NULL; END IF;

  v_gross_min := (EXTRACT(HOUR FROM p_end)::int * 60 + EXTRACT(MINUTE FROM p_end)::int)
               - (EXTRACT(HOUR FROM p_start)::int * 60 + EXTRACT(MINUTE FROM p_start)::int);
  IF v_gross_min <= 0 THEN v_gross_min := v_gross_min + 1440; END IF;  -- 跨日 +24h

  -- 休息階梯(同全系統)
  v_rest := CASE WHEN v_gross_min < 300 THEN 0
                 WHEN v_gross_min < 540 THEN 30
                 ELSE 60 END;

  -- 各店最小單位 step(依門市名對 stores.overtime_step_hours;查不到 fallback 0.5)
  v_step := (SELECT overtime_step_hours FROM public.stores
             WHERE name = p_store
               AND (p_org IS NULL OR organization_id = p_org)
             LIMIT 1);
  IF v_step IS NULL OR v_step <= 0 THEN v_step := 0.5; END IF;

  v_net := ROUND(((v_gross_min - v_rest)::numeric / 60.0) / v_step) * v_step;
  RETURN v_net;
END $$;

GRANT EXECUTE ON FUNCTION public.overtime_net_hours(text, bigint, time, time) TO anon, authenticated;

-- ═══ ② enforce trigger:後端強制淨工時 ═══
CREATE OR REPLACE FUNCTION public.tg_overtime_enforce_net_hours()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_net numeric;
BEGIN
  -- 匯入/例外單:起訖是佔位垃圾,時數以廠商值為準 → 不動
  IF COALESCE(NEW.is_exception, false)
     OR COALESCE(NEW.source, 'manual') IN ('import', '104匯入') THEN
    RETURN NEW;
  END IF;

  -- 沒起訖:算不了,不動
  IF NEW.start_time IS NULL OR NEW.end_time IS NULL THEN
    RETURN NEW;
  END IF;

  -- UPDATE 只在起訖時間有變才重算(否則狀態更新會改 hours → 撞 block_edit_after_signed)
  IF TG_OP = 'UPDATE'
     AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time
     AND NEW.end_time   IS NOT DISTINCT FROM OLD.end_time THEN
    RETURN NEW;
  END IF;

  v_net := public.overtime_net_hours(NEW.store, NEW.organization_id, NEW.start_time, NEW.end_time);

  -- 只在算得出且在法定合理範圍(0<net<=12)才覆寫;否則留原值讓既有 constraint/guard 把關
  IF v_net IS NOT NULL AND v_net > 0 AND v_net <= 12 THEN
    NEW.hours    := v_net;
    NEW.ot_hours := v_net;
  END IF;

  RETURN NEW;
END $$;

-- trg_a0_ 前綴 → BEFORE 觸發器字母序排最前,讓後面的 46h/勞基法 guard 看到正確淨值
DROP TRIGGER IF EXISTS trg_a0_overtime_net_hours ON public.overtime_requests;
CREATE TRIGGER trg_a0_overtime_net_hours
  BEFORE INSERT OR UPDATE ON public.overtime_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_overtime_enforce_net_hours();

NOTIFY pgrst, 'reload schema';
