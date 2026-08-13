-- 修:核准「舊人資系統補休結算」等補休類假別,排班沒被蓋成假(仍顯示上班),工時多算。
-- 根因:_trg_leave_approval_sync_schedule 開頭 v_shift := _leave_code_to_shift(NEW.type);
--       若回 NULL 就 RETURN(不蓋)。而 _leave_code_to_shift('舊人資系統補休結算')=NULL
--       —— 它有補「特休%」「%應休%」fallback,獨漏補休類結算。
-- 修法:①加 '%補休%' → '補休' fallback(純新增,只影響現在回 NULL 的字串,既有對應原封不動)
--       ②回填:trigger 只在「狀態轉成已核准的當下」跑,早已核准的舊單不會自動補 → 手動回填。

-- ① 補 fallback(逐字沿用現行定義,只在 pattern fallback 段多一條 '%補休%')
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
      WHEN 'comp_time'     THEN '補休'
      WHEN '補休'          THEN '補休'
      ELSE NULL
    END,
    -- 非標準字串 pattern fallback(只接上面回 NULL 的)
    CASE
      WHEN p_code LIKE '特休%'  THEN '特休'   -- 特休假 / 特休假2025結算 / 特休假XXXX結算
      WHEN p_code LIKE '%應休%' THEN '特休'   -- 舊系統結算應休
      WHEN p_code LIKE '%補休%' THEN '補休'   -- 舊人資系統補休結算 等補休類匯入/結算
      ELSE NULL
    END
  )
$function$;

-- ② 回填:已核准 / 未刪 / 整天假(非時數) / 現在能對應到假別 / 但排班還沒連上此單 → 補蓋
--    以 leave_request_id 是否已連為冪等守門;僅限這次新接的補休類('%補休%'),不動其他假別。
INSERT INTO public.schedules (employee, employee_id, date, shift, organization_id, leave_request_id)
SELECT lr.employee, lr.employee_id, gs.d::date, public._leave_code_to_shift(lr.type), lr.organization_id, lr.id
FROM public.leave_requests lr
CROSS JOIN LATERAL generate_series(lr.start_date, lr.end_date, interval '1 day') gs(d)
WHERE lr.status = '已核准'
  AND lr.deleted_at IS NULL
  AND lr.unit IS DISTINCT FROM 'hour'
  AND (lr.days IS NULL OR lr.days >= 1)
  AND lr.type LIKE '%補休%'
  AND public._leave_code_to_shift(lr.type) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.schedules s WHERE s.leave_request_id = lr.id)
ON CONFLICT (employee, date) DO UPDATE SET
  shift            = EXCLUDED.shift,
  leave_request_id = EXCLUDED.leave_request_id;
