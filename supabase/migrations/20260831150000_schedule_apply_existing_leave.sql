-- 2026-08-31 治本:排班「新增格子」時,自動蓋上「當天已核准的假」
--
-- 問題:_trg_leave_approval_sync_schedule 只在「請假核准當下」蓋既有班表。
--   若「先請假核准、後排班」(例:8月班表今天才排),排班時不會回頭比對已核准的假
--   → 那天顯示成上班時間、沒連假單。實例:許亦翎 8/15 生理假顯示 10~19。
--   影響不只顯示:計薪會把那天當正常上班算本薪工時,法定假別(如生理假減半)沒吃到。
--
-- 治本:schedules BEFORE INSERT trigger — 任何來源(UI/演算法/RPC/匯入)新建班表格子時,
--   若當天已有已核准的假,就依 _leave_code_to_shift 蓋上(整天假整格蓋、部分假留班掛單)。
--   與核准端 _trg_leave_approval_sync_schedule 用同一套對應,兩個方向結果一致。
--
-- ★ 陷阱:「結算/折現」桶(舊人資系統補休結算、特休折現…)雖對得到代碼,但不是真的請一天假,
--   排除之,否則會把上班日誤蓋成請假 → 少算工資。

CREATE OR REPLACE FUNCTION public._trg_schedule_apply_existing_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lr    public.leave_requests%ROWTYPE;
  v_shift TEXT;
  v_days  NUMERIC;
BEGIN
  -- 只處理「新排上班班別、尚未連假單」的格子;休假日不蓋
  IF NEW.leave_request_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.shift IS NULL OR btrim(NEW.shift) = '' THEN RETURN NEW; END IF;
  IF NEW.shift IN ('休', '例', '例假', '休息') THEN RETURN NEW; END IF;
  IF NEW.employee_id IS NULL OR NEW.date IS NULL THEN RETURN NEW; END IF;

  -- 當天已核准、未刪、非時數假、非結算折現桶、且對得到班表代碼的假(整天假優先)
  SELECT * INTO v_lr
    FROM public.leave_requests lr
   WHERE lr.employee_id = NEW.employee_id
     AND lr.status = '已核准'
     AND lr.deleted_at IS NULL
     AND COALESCE(lr.unit, '') <> 'hour'
     AND lr.type NOT LIKE '%結算%'
     AND lr.type NOT LIKE '%折現%'
     AND NEW.date BETWEEN lr.start_date AND lr.end_date
     AND public._leave_code_to_shift(lr.type) IS NOT NULL
   ORDER BY (COALESCE(NULLIF(lr.days::text, '')::numeric, 1) >= 1) DESC, lr.id
   LIMIT 1;

  IF v_lr.id IS NULL THEN RETURN NEW; END IF;

  v_shift := public._leave_code_to_shift(v_lr.type);
  v_days  := COALESCE(NULLIF(v_lr.days::text, '')::numeric, 1);

  IF v_days < 1 THEN
    NEW.leave_request_id := v_lr.id;   -- 部分假:留原班,只掛 leave_request_id
  ELSE
    NEW.shift            := v_shift;    -- 整天假:整格蓋成假別
    NEW.leave_request_id := v_lr.id;
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_schedule_apply_existing_leave ON public.schedules;
CREATE TRIGGER trg_schedule_apply_existing_leave
  BEFORE INSERT ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public._trg_schedule_apply_existing_leave();

-- 回填當期(2026-08 起)已漏蓋的格子
WITH cand AS (
  SELECT s.id AS sid, lr.id AS lrid, public._leave_code_to_shift(lr.type) AS code,
         COALESCE(NULLIF(lr.days::text, '')::numeric, 1) AS days,
         row_number() OVER (PARTITION BY s.id
           ORDER BY (COALESCE(NULLIF(lr.days::text, '')::numeric, 1) >= 1) DESC, lr.id) AS rn
    FROM public.schedules s
    JOIN public.leave_requests lr
      ON lr.employee_id = s.employee_id
     AND lr.status = '已核准' AND lr.deleted_at IS NULL
     AND COALESCE(lr.unit, '') <> 'hour'
     AND lr.type NOT LIKE '%結算%' AND lr.type NOT LIKE '%折現%'
     AND s.date BETWEEN lr.start_date AND lr.end_date
     AND public._leave_code_to_shift(lr.type) IS NOT NULL
   WHERE s.date >= '2026-08-01'
     AND s.leave_request_id IS NULL
     AND s.shift IS NOT NULL AND btrim(s.shift) <> ''
     AND s.shift NOT IN ('休', '例', '例假', '休息')
)
UPDATE public.schedules s
   SET leave_request_id = c.lrid,
       shift = CASE WHEN c.days >= 1 THEN c.code ELSE s.shift END
  FROM cand c
 WHERE c.sid = s.id AND c.rn = 1;
