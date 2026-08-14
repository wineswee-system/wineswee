-- 2026-08-14 產假情形分類 + 上限(性平法):分娩56 / 流產3月以上28 / 2~3月7 / 未滿2月5天。
ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS maternity_type text;
COMMENT ON COLUMN public.leave_requests.maternity_type IS '產假情形:childbirth(分娩56)/miscarriage_ge3m(流產3月+ 28)/miscarriage_2to3m(7)/miscarriage_lt2m(5)';

CREATE OR REPLACE FUNCTION public.maternity_max_days(p_type text)
 RETURNS integer LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE p_type
    WHEN 'childbirth'         THEN 56
    WHEN 'miscarriage_ge3m'   THEN 28
    WHEN 'miscarriage_2to3m'  THEN 7
    WHEN 'miscarriage_lt2m'   THEN 5
    ELSE 56   -- 未指定(舊單/預設)→ 分娩上限
  END;
$function$;
