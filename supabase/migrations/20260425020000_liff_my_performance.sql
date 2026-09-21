-- ============================================================
-- LIFF：我的績效
--
-- 員工自助場景：
--   1. liff_list_my_reviews：列出我的歷次考核紀錄
--   2. liff_list_my_goals：列出我的目標清單
--   3. liff_update_goal_progress：員工自己回報目標進度
--                                 （只能更新「自己的」+「進行中」狀態的目標）
--
-- 注意：performance_goals 真實 schema 是 (id, employee, title, target, progress, status, created_at)
-- 主系統 Performance.jsx 寫入了 category/current/unit/deadline/note 等欄位（不在 schema 中），
-- 那些欄位若 DB 有 ALTER 加上去就會 work，沒有就會被 Supabase 靜默 drop。
-- 這支 RPC 只用 schema 內保證存在的欄位，避免讀到 NULL；如果你之後 ALTER TABLE 加欄位，
-- 改這裡的 SELECT 就好。
-- ============================================================

-- ═══ 1. liff_list_my_reviews ═══
CREATE OR REPLACE FUNCTION public.liff_list_my_reviews(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'reviews', (
      SELECT COALESCE(json_agg(json_build_object(
        'id',              r.id,
        'period',          r.period,
        'overall_score',   r.overall_score,
        'goals',           r.goals,
        'goals_completed', r.goals_completed,
        'rating',          r.rating,
        'reviewer',        r.reviewer,
        'status',          r.status,
        'created_at',      r.created_at
      ) ORDER BY r.created_at DESC NULLS LAST, r.id DESC), '[]'::json)
      FROM public.performance_reviews r
      WHERE r.employee = emp.name
    ),
    'latest', (
      SELECT row_to_json(r)
      FROM public.performance_reviews r
      WHERE r.employee = emp.name
        AND r.status = '已完成'
      ORDER BY r.created_at DESC NULLS LAST, r.id DESC
      LIMIT 1
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_my_reviews(text) TO anon, authenticated;


-- ═══ 2. liff_list_my_goals ═══
CREATE OR REPLACE FUNCTION public.liff_list_my_goals(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'goals', (
      SELECT COALESCE(json_agg(json_build_object(
        'id',         g.id,
        'title',      g.title,
        'target',     g.target,
        'progress',   g.progress,
        'status',     g.status,
        'created_at', g.created_at
      ) ORDER BY
        CASE g.status WHEN '進行中' THEN 1 WHEN '已完成' THEN 2 ELSE 3 END,
        g.created_at DESC NULLS LAST, g.id DESC
      ), '[]'::json)
      FROM public.performance_goals g
      WHERE g.employee = emp.name
    ),
    'summary', (
      SELECT json_build_object(
        'total',       count(*),
        'in_progress', count(*) FILTER (WHERE status = '進行中'),
        'completed',   count(*) FILTER (WHERE status = '已完成'),
        'avg_progress', COALESCE(round(avg(progress) FILTER (WHERE status = '進行中'), 1), 0)
      )
      FROM public.performance_goals
      WHERE employee = emp.name
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_my_goals(text) TO anon, authenticated;


-- ═══ 3. liff_update_goal_progress ═══
-- 員工自己回報進度（0~100）
-- 達 100 自動標記「已完成」
CREATE OR REPLACE FUNCTION public.liff_update_goal_progress(
  p_line_user_id text,
  p_goal_id      int,
  p_progress     numeric
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp        employees;
  goal       performance_goals;
  new_status text;
  clamped    numeric;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO goal FROM public.performance_goals
   WHERE id = p_goal_id AND employee = emp.name;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'GOAL_NOT_FOUND');
  END IF;

  IF goal.status NOT IN ('進行中', '已完成') THEN
    RETURN json_build_object('ok', false, 'error', 'CANNOT_UPDATE');
  END IF;

  -- clamp 0~100
  clamped := GREATEST(0, LEAST(100, COALESCE(p_progress, 0)));
  new_status := CASE WHEN clamped >= 100 THEN '已完成' ELSE '進行中' END;

  UPDATE public.performance_goals
     SET progress = clamped,
         status   = new_status
   WHERE id = p_goal_id;

  RETURN json_build_object(
    'ok',       true,
    'progress', clamped,
    'status',   new_status
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_update_goal_progress(text, int, numeric) TO anon, authenticated;
