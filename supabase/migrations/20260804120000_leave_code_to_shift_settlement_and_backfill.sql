-- 請假假別→班表 shift 對照:認得「特休假XXXX結算 / 舊系統結算應休」+ 補標未同步的整天假 — 2026-08-04
-- ════════════════════════════════════════════════════════════════════════════
-- 症狀:張庭瑋「特休假2025結算」#258(2026-08-14 整天)核准後,班表格子沒標「特休」。
-- 根因:核准同步 trigger _trg_leave_approval_sync_schedule 第一步
--         v_shift := _leave_code_to_shift(NEW.type);  IF v_shift IS NULL THEN RETURN;
--       而 _leave_code_to_shift 用「精確比對」,非標準字串(特休假2025結算 / 特休假 / 舊系統
--       結算應休)一律回 NULL → trigger 直接放棄 → 不寫 schedules 列 → 格子空白。
--
-- 修法:
--   (1) _leave_code_to_shift 加 pattern fallback(既有精確比對全保留,只多接原本回 NULL 的):
--         特休%  → 特休(特休假 / 特休假2025結算 / 特休假XXXX結算…)
--         %應休% → 特休(舊系統結算應休)
--       ⇒ 修好「未來」核准的同步。
--   (2) Backfill 已核准但沒同步到班表的假 —— 僅限「單日 + 整天(days>=1)+ 該格全空」,
--       避免覆蓋任何既有班次(潘胤傑時數假/有班的日子、張庭瑋半天假、陳佩璇0.1天 全部排除)。
--       實際只會補 #258(張庭瑋 2026-08-14 空格)。
--
-- 影響:_leave_code_to_shift 僅 _trg_leave_approval_sync_schedule(核准/撤回兩分支)使用;
--   本次為純增量(只改變原本回 NULL 的輸入),既有假別行為不變。低風險。
-- ════════════════════════════════════════════════════════════════════════════

-- ── (1) 對照函式:精確比對優先,加 pattern fallback ──
CREATE OR REPLACE FUNCTION public._leave_code_to_shift(p_code text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    -- 既有精確比對(原封不動)
    CASE p_code
      WHEN 'annual'        THEN '特休'
      WHEN '特休'          THEN '特休'
      WHEN 'sick'          THEN '病'
      WHEN '病假'          THEN '病'
      WHEN 'personal'      THEN '事'
      WHEN '事假'          THEN '事'
      WHEN 'official'      THEN '公'
      WHEN '公假'          THEN '公'
      WHEN 'maternity'     THEN '產'
      WHEN '產假'          THEN '產'
      WHEN 'paternity'     THEN '陪產'
      WHEN '陪產假'        THEN '陪產'
      WHEN 'menstrual'     THEN '生'
      WHEN '生理假'        THEN '生'
      WHEN 'marriage'      THEN '婚'
      WHEN '婚假'          THEN '婚'
      WHEN 'bereavement'   THEN '喪'
      WHEN '喪假'          THEN '喪'
      WHEN 'occupational'  THEN '工傷'
      WHEN '公傷病假'      THEN '工傷'
      WHEN 'family_care'   THEN '家'
      WHEN '家庭照顧假'    THEN '家'
      WHEN 'mental_health' THEN '心'
      WHEN '心理假'        THEN '心'
      WHEN 'prenatal'      THEN '產檢'
      WHEN '產檢假'        THEN '產檢'
      WHEN 'parental'      THEN '育嬰'
      WHEN '育嬰假'        THEN '育嬰'
      WHEN 'comp_time'     THEN '補休'
      WHEN '補休'          THEN '補休'
      ELSE NULL
    END,
    -- 新增:非標準字串 pattern fallback(只接上面回 NULL 的)
    CASE
      WHEN p_code LIKE '特休%'  THEN '特休'   -- 特休假 / 特休假2025結算 / 特休假XXXX結算
      WHEN p_code LIKE '%應休%' THEN '特休'   -- 舊系統結算應休
      ELSE NULL
    END
  )
$function$;

-- ── (2) Backfill:僅「單日 + 整天 + 該格全空」的已核准假,補寫 schedules 列 ──
INSERT INTO public.schedules (employee, employee_id, date, shift, organization_id, leave_request_id)
SELECT lr.employee, lr.employee_id, lr.start_date,
       public._leave_code_to_shift(lr.type), lr.organization_id, lr.id
FROM public.leave_requests lr
WHERE lr.status = '已核准'
  AND lr.deleted_at IS NULL
  AND lr.unit = 'day'
  AND COALESCE(lr.days, 1) >= 1                 -- 排除半天/部分假(0.5/0.1)
  AND lr.start_date = lr.end_date               -- 只處理單日(避開跨日/跨午夜複雜度)
  AND public._leave_code_to_shift(lr.type) IS NOT NULL
  AND NOT EXISTS (                              -- 該格全空才補,絕不覆蓋任何既有班次
    SELECT 1 FROM public.schedules s
     WHERE s.employee_id = lr.employee_id AND s.date = lr.start_date
  )
ON CONFLICT (employee, date) DO NOTHING;

-- 驗證:張庭瑋 08-14 應出現一列 shift=特休
-- SELECT employee, date, shift, leave_request_id FROM public.schedules
--  WHERE employee='張庭瑋' AND date='2026-08-14';
