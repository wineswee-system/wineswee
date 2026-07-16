-- 行事曆活動「比照國定假日」接進計薪 — 2026-07-16
-- 需求:HR 在排班行事曆標一個活動(如週年慶)並綁 pay_class='national_holiday' →
--   該門市當天「有上班的人」比照國定假日算(國定出勤加給 + 加班費 holiday 倍率)。
-- 整合點:_is_national_holiday —— _ot_category('holiday' 分支) 與 _compute(國定加給) 都吃它,
--   改這一支兩邊同時生效(preview 與 generate 共用同引擎,一致)。
-- 做法:★ 逐字保留原本兩軌 CASE(兼職/行政看日曆、正職看班表國定標記),只在外層 OR 一個
--   store_events 的 EXISTS,不重寫既有邏輯(避免 partial rewrite 洗掉分支)。
-- 對象自然收斂:回 true 只是把當天「標成國定假日」,加給/加班費由 _compute 依實際工時給,
--   沒上班的人本來就拿不到 → 天然符合「當天有上班的人才比照」。idempotent。

CREATE OR REPLACE FUNCTION public._is_national_holiday(p_emp_id int, p_date date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    -- ① 行事曆活動綁「比照國定假日」→ 該員工所屬門市當天有此標記即比照
    EXISTS(
      SELECT 1
      FROM public.store_events se
      JOIN public.employees e ON e.id = p_emp_id
      WHERE se.date = p_date
        AND se.store_id = e.store_id
        AND se.pay_class = 'national_holiday'
    )
    -- ② 原本兩軌判定(逐字保留)
    OR CASE
      WHEN COALESCE((
        SELECT COALESCE(ss.salary_type,'')='hourly' OR COALESCE(ss.employment_category,'')='admin'
        FROM public.salary_structures ss WHERE ss.employee_id = p_emp_id LIMIT 1
      ), false)
      -- 時薪(兼職) 或 行政 → 看日曆(國定假=非工作日)
      THEN EXISTS(SELECT 1 FROM public.holidays h WHERE h.date = p_date AND h.is_workday IS FALSE)
      -- 其餘(正職門市) → 看班表標的「國定假」那天
      ELSE EXISTS(SELECT 1 FROM public.schedules sc
                  WHERE sc.employee_id = p_emp_id AND sc.date = p_date
                    AND COALESCE(sc.shift,'') LIKE '%國定%')
    END
$$;
GRANT EXECUTE ON FUNCTION public._is_national_holiday(int,date) TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
