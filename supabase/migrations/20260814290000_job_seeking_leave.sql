-- 2026-08-14 新增謀職假(勞基法 §16):資遣預告期間為另謀工作得請,每星期不超過二日之工作時間,工資照給(有薪不扣)。
--   後台/前端可選;event-based 無額度;計薪不進扣款CASE=照給(paid);核准後蓋班表(加 _leave_code_to_shift 對應)。idempotent。

INSERT INTO public.leave_types
  (code, name, short_name, law, paid, unit, min_unit, allow_hourly, max_days, gender, require_balance, salary_note, description, sort_order, is_active)
VALUES
  ('job_seeking', '謀職假', '謀職假', '勞基法 §16', true, 'hour', 0.5, true, NULL, NULL, false, '照給',
   '資遣預告期間為另謀工作得請謀職假;每星期不得超過二日之工作時間,工資照給;以小時計。', 90, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, short_name = EXCLUDED.short_name, law = EXCLUDED.law, paid = EXCLUDED.paid,
  unit = EXCLUDED.unit, min_unit = EXCLUDED.min_unit, allow_hourly = EXCLUDED.allow_hourly, salary_note = EXCLUDED.salary_note,
  description = EXCLUDED.description, is_active = true;

-- 核准後蓋班表:加謀職假對應(對應不到會靜默不蓋→工時多算,見既有教訓)
CREATE OR REPLACE FUNCTION public._leave_code_to_shift(p_code text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
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
      WHEN 'job_seeking'   THEN '謀職'
      WHEN '謀職假'        THEN '謀職'
      ELSE NULL
    END,
    CASE
      WHEN p_code LIKE '特休%'  THEN '特休'
      WHEN p_code LIKE '%應休%' THEN '特休'
      WHEN p_code LIKE '%補休%' THEN '補休'
      ELSE NULL
    END
  )
$function$;
