-- 修:選補休的加班(ot_type='comp_time')漏設 is_comp_leave → 引擎照發現金(雙重給付)— 2026-08-04
-- ════════════════════════════════════════════════════════════════════════════
-- 症狀:員工加班選「換補休」,系統建了 comp_time_ledger(補休帳),但 overtime_requests
--   的 is_comp_leave 沒設 true;而 _compute_payroll_for_employee 現金加班費是用
--   `AND NOT COALESCE(is_comp_leave,false)` 過濾 → 漏標的 comp_time 加班「補休照拿、
--   現金也照發」= 雙重給付。
--
-- 根因:is_comp_leave 欄位 2026-07-09 才加(當時只寫死 backfill 104 那 19 筆),而建補休帳的
--   trigger trg_create_comp_time_ledger(2026-06-09 建)比欄位還早,從不設 is_comp_leave。
--   → 07-09 之後每筆「選補休」的加班都漏標。
--   權威欄位是 ot_type='comp_time'(建單時選、核准後鎖 trg_ot_type_immutable_after_approve)。
--
-- ⚠️ 不可無腦「is_comp_leave = (ot_type='comp_time')」:104 匯入那 19 筆是 ot_type='pay' 卻
--   刻意 is_comp_leave=true(補休被匯成 pay),雙向同步會把它們洗回 false → 反而重付。
--   故只「單向補 true」,並只在「ot_type 由 comp_time 轉離」時才收回,絕不碰 104 那批。
-- ════════════════════════════════════════════════════════════════════════════

-- ── (1) Backfill:ot_type='comp_time' 卻沒 is_comp_leave 的,補成 true(含待審核,無害)──
UPDATE public.overtime_requests
   SET is_comp_leave = true
 WHERE ot_type = 'comp_time'
   AND COALESCE(is_comp_leave, false) = false
   AND deleted_at IS NULL;

-- ── (2) 常駐同步 trigger:選 comp_time 當下自動設 is_comp_leave;引擎與 104 批都不動 ──
CREATE OR REPLACE FUNCTION public.tg_sync_is_comp_leave_from_ot_type()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.ot_type = 'comp_time' THEN
    NEW.is_comp_leave := true;                       -- 選補休 → 一定標記(引擎不發現金)
  ELSIF TG_OP = 'UPDATE'
        AND COALESCE(OLD.ot_type,'') = 'comp_time'
        AND COALESCE(NEW.ot_type,'') <> 'comp_time' THEN
    NEW.is_comp_leave := false;                       -- 核准前把補休改回現金 → 收回標記
  END IF;
  -- 其餘情況(含 104 批 ot_type='pay' 卻 is_comp_leave=true)完全不碰
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_sync_is_comp_leave ON public.overtime_requests;
CREATE TRIGGER trg_sync_is_comp_leave
  BEFORE INSERT OR UPDATE ON public.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_is_comp_leave_from_ot_type();

NOTIFY pgrst, 'reload schema';

-- 驗證(應回 0):仍有 comp_time 漏標的
-- SELECT id, employee, ot_type, is_comp_leave FROM public.overtime_requests
--  WHERE ot_type='comp_time' AND COALESCE(is_comp_leave,false)=false AND deleted_at IS NULL;
