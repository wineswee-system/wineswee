-- 修正陳苡慧(emp 402)薪資型別:誤設 hourly → 應為 monthly(正職)
-- 2026-07-09  當初設定錯誤把她設成 PT(hourly),導致 _compute 走 PT 分支:
--   津貼(伙食)不按在職比例(月薪分支才有 ×v_sal_ratio),且底薪吃時薪而非月薪比例。
--   她 6/1 到職、6/12 離職(不滿月),PT 分支津貼給全額 3000 而非按 12/30 比例。
--   正職慣例:salary_type='monthly'、hourly_rate=0(同其他 72 位月薪員工)。
--   只此一人;idempotent(WHERE 綁 hourly,再跑不重複)。

UPDATE public.salary_structures
SET salary_type = 'monthly',
    hourly_rate = 0,
    updated_at  = now()
WHERE employee_id = 402
  AND salary_type = 'hourly';

NOTIFY pgrst, 'reload schema';
