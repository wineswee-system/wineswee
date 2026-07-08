-- ② 例假加班 >8h 分段（preview / _ot_pay_zh）
-- 2026-07-08  老闆規則：正職(月薪)例假出勤 前 8h ×1.0、超過 8h 部分 ×2.0
--   (原本月薪例假全程 ×1.0)。時薪(PT)例假維持全程 ×2.0 不變。
-- 只改 _ot_pay_zh(preview 用)；入帳 generate_payroll 用 _compute_ot_pay(另一支)，待另辦。
-- 只動 weekly_off 的 ELSE(非時薪)那一行。idempotent。

CREATE OR REPLACE FUNCTION public._ot_pay_zh(p_hours numeric, p_hourly numeric, p_category text, p_is_hourly boolean)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE p_category
    WHEN 'weekday' THEN
      CASE WHEN p_hours <= 2 THEN ceil(p_hours * p_hourly * 1.34)
           ELSE ceil(2 * p_hourly * 1.34 + (p_hours - 2) * p_hourly * 1.67) END
    WHEN 'restday' THEN
      CASE WHEN p_is_hourly THEN ceil(p_hours * p_hourly * 2)
           ELSE ceil(least(public._ot_deem_hours(p_hours), 2) * p_hourly * 1.34
                   + least(greatest(public._ot_deem_hours(p_hours) - 2, 0), 6) * p_hourly * 1.67
                   + greatest(public._ot_deem_hours(p_hours) - 8, 0) * p_hourly * 2.67) END
    WHEN 'holiday' THEN
      CASE WHEN p_is_hourly THEN ceil(p_hours * p_hourly * 2)
           WHEN p_hours <= 0 THEN 0
           ELSE ceil(8 * p_hourly
                   + least(greatest(p_hours - 8, 0), 2) * p_hourly * 1.34
                   + greatest(p_hours - 10, 0) * p_hourly * 1.67) END
    WHEN 'weekly_off' THEN
      CASE WHEN p_is_hourly THEN ceil(p_hours * p_hourly * 2)
           ELSE ceil(least(p_hours, 8) * p_hourly + greatest(p_hours - 8, 0) * p_hourly * 2) END
    ELSE 0 END
$function$;

NOTIFY pgrst, 'reload schema';
