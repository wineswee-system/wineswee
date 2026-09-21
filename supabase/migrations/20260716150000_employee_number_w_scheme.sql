-- 新員工編號制度:W + 到職西元年(4) + 當年度第幾個入職(3) — 2026-07-16
-- 例:陳虹 2021-10-13 入職、2021 年第 1 個 → W2021001。
-- 排序:年內依 join_date 升冪;同日則依 id(先建立=先)。
--   ① 重編既有(有到職日者);無到職日(測試帳號)留原值。
--   ② BEFORE INSERT trigger:新員工 employee_number 留空+有到職日 → 自動給該年下一號。
-- employee_number 非外鍵(重編不壞 DB),但匯入功能靠它對人,舊 CSV 需改用新號。idempotent。

-- ① 重編既有(單一 UPDATE,窗口函式算號,原子不撞 unique)
WITH numbered AS (
  SELECT id,
    'W' || to_char(join_date, 'YYYY')
      || lpad(row_number() OVER (
           PARTITION BY to_char(join_date, 'YYYY')
           ORDER BY join_date, id
         )::text, 3, '0') AS newno
  FROM public.employees
  WHERE join_date IS NOT NULL
)
UPDATE public.employees e
   SET employee_number = n.newno
  FROM numbered n
 WHERE e.id = n.id
   AND e.employee_number IS DISTINCT FROM n.newno;

-- ② 自動產生器:新增員工留空 employee_number + 有到職日 → W{年}{該年最大序+1}
CREATE OR REPLACE FUNCTION public._tg_gen_employee_number()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE v_year text; v_seq int;
BEGIN
  IF (NEW.employee_number IS NULL OR btrim(NEW.employee_number) = '')
     AND NEW.join_date IS NOT NULL THEN
    v_year := to_char(NEW.join_date::date, 'YYYY');
    SELECT COALESCE(MAX(substring(employee_number FROM 6 FOR 3)::int), 0) + 1
      INTO v_seq
      FROM public.employees
     WHERE employee_number ~ ('^W' || v_year || '[0-9]{3}$');
    NEW.employee_number := 'W' || v_year || lpad(v_seq::text, 3, '0');
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tg_gen_employee_number ON public.employees;
CREATE TRIGGER tg_gen_employee_number
  BEFORE INSERT ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public._tg_gen_employee_number();

NOTIFY pgrst, 'reload schema';
