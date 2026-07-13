-- 薪資「發布給員工」閘門 — 2026-07-13
-- 問題:員工 LINE 薪資卡讀 salary_records「最新月」且不看狀態 → 批次算完的草稿(如六月)
--   立刻外洩給員工。治本:改成「只顯示已發布月份」,草稿留著不外洩,不刪資料。
-- ⚠️ 不可借用 status='finalized' 當發布旗標:enforce_salary_requires_locked_schedule 這道
--    BEFORE INSERT OR UPDATE guard 把 status='finalized' 當「正式結算」,要求該店該月班表已鎖定
--    → 借用會撞鎖(威耀總部四月未鎖)。故「結算狀態(status)」與「對員工發布(published_at)」拆成兩件事。
-- 做法:
--   ① salary_records 加 published_at(獨立可見性旗標,與 status/鎖定無關)。
--   ② guard 微調:已是 finalized 的 row 再被 UPDATE(如只改 published_at) 不重驗鎖定(只擋轉為 finalized 當下)。
--   ③ publish_salary_month / unpublish_salary_month:整月設/清 published_at(不動 status,admin 限定)。
--   ④ liff_card_my_salary_brief / _unlock:讀取加 published_at IS NOT NULL 閘門。
--   ⑤ 四月設為已發布(員工維持看得到);六月 published_at 為 NULL → 自動隱藏。
-- 皆 idempotent。

-- ① 獨立的「對員工發布」旗標
ALTER TABLE public.salary_records ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- ② guard 微調:只擋「轉為 finalized」當下;已 finalized 的 row 再 UPDATE 放行(避免改 published_at 撞鎖)
CREATE OR REPLACE FUNCTION public.enforce_salary_requires_locked_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_store_id   INT;
  v_store_name TEXT;
  v_cat        TEXT;
BEGIN
  -- 只擋正式結算;草稿放行
  IF COALESCE(NEW.status, 'finalized') <> 'finalized' THEN
    RETURN NEW;
  END IF;

  -- ★ 已是 finalized 的 row 再被 UPDATE(非轉態,如只改 published_at) → 放行,不重驗鎖定
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'finalized' THEN
    RETURN NEW;
  END IF;

  -- 行政/計件(固定薪、無變動班表)→ 放行
  SELECT ss.employment_category INTO v_cat
    FROM salary_structures ss WHERE ss.employee_id = NEW.employee_id;
  IF COALESCE(v_cat, '') IN ('admin', 'piece') THEN
    RETURN NEW;
  END IF;

  SELECT e.store_id INTO v_store_id FROM employees e WHERE e.id = NEW.employee_id;

  -- 沒門市 → 放行
  IF v_store_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 有門市 → 該月班表必須已鎖定
  IF NOT EXISTS (
    SELECT 1 FROM schedule_month_locks l
    WHERE l.store_id = v_store_id AND l.month = NEW.month
  ) THEN
    SELECT name INTO v_store_name FROM stores WHERE id = v_store_id;
    RAISE EXCEPTION '「%」% 班表尚未鎖定，無法結算薪資',
      COALESCE(v_store_name, '門市#' || v_store_id), NEW.month
      USING HINT = '請先到排班頁鎖定此門市的該月份，再結算薪資';
  END IF;

  RETURN NEW;
END $function$;

-- ③ 發布 / 取消發布整月（只動 published_at，不碰 status；admin/super_admin 限定）
CREATE OR REPLACE FUNCTION public.publish_salary_month(p_month text, p_org int DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org int; v_cnt int;
BEGIN
  IF current_employee_role() NOT IN ('admin', 'super_admin') THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  v_org := COALESCE(p_org, current_employee_org());
  UPDATE public.salary_records
     SET published_at = now()
   WHERE month = p_month AND organization_id = v_org AND published_at IS NULL;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  RETURN json_build_object('ok', true, 'published', v_cnt, 'month', p_month);
END $$;

CREATE OR REPLACE FUNCTION public.unpublish_salary_month(p_month text, p_org int DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org int; v_cnt int;
BEGIN
  IF current_employee_role() NOT IN ('admin', 'super_admin') THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  v_org := COALESCE(p_org, current_employee_org());
  UPDATE public.salary_records
     SET published_at = NULL
   WHERE month = p_month AND organization_id = v_org AND published_at IS NOT NULL;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  RETURN json_build_object('ok', true, 'unpublished', v_cnt, 'month', p_month);
END $$;

GRANT EXECUTE ON FUNCTION public.publish_salary_month(text, int)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.unpublish_salary_month(text, int) TO authenticated;

-- ④ 員工薪資卡（摘要）：只顯示已發布月份
CREATE OR REPLACE FUNCTION public.liff_card_my_salary_brief(p_line_user_id text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  emp  employees;
  rec  salary_records;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO rec FROM public.salary_records
   WHERE employee_id = emp.id
     AND published_at IS NOT NULL          -- ★ 只看已發布月份（草稿不外洩）
   ORDER BY month DESC, created_at DESC LIMIT 1;

  RETURN json_build_object(
    'ok',               true,
    'employee_name',    emp.name,
    'has_pin',          (emp.line_pin_hash IS NOT NULL OR emp.id_number IS NOT NULL),
    'using_default_pin', (emp.line_pin_hash IS NULL AND emp.id_number IS NOT NULL),
    'has_record',       rec.id IS NOT NULL,
    'month',            rec.month,
    'net_salary_masked', CASE WHEN rec.net_salary IS NOT NULL THEN '$ ***,***' ELSE NULL END
  );
END $function$;

-- ⑤ 員工薪資卡（解鎖完整）：只顯示已發布月份
CREATE OR REPLACE FUNCTION public.liff_card_my_salary_unlock(p_line_user_id text, p_pin text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  emp  employees;
  rec  record;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 驗 PIN：自訂 hash 優先；沒有 hash 就對比身分證後4碼
  IF emp.line_pin_hash IS NOT NULL THEN
    IF emp.line_pin_hash <> extensions.crypt(p_pin, emp.line_pin_hash) THEN
      RETURN json_build_object('ok', false, 'error', 'WRONG_PIN');
    END IF;
  ELSIF emp.id_number IS NOT NULL THEN
    IF p_pin <> RIGHT(emp.id_number, 4) THEN
      RETURN json_build_object('ok', false, 'error', 'WRONG_PIN');
    END IF;
  ELSE
    RETURN json_build_object('ok', false, 'error', 'PIN_NOT_SET');
  END IF;

  SELECT *
    INTO rec
    FROM public.salary_records
   WHERE employee_id = emp.id
     AND published_at IS NOT NULL          -- ★ 只看已發布月份（草稿不外洩）
   ORDER BY month DESC, created_at DESC
   LIMIT 1;

  IF rec.id IS NULL THEN
    RETURN json_build_object('ok', true, 'has_record', false, 'employee_name', emp.name);
  END IF;

  RETURN json_build_object(
    'ok', true,
    'has_record', true,
    'employee_name',      emp.name,
    'month',              rec.month,
    'base_salary',        rec.base_salary,
    'role_allowance',     COALESCE(rec.role_allowance, 0),
    'meal_allowance',     COALESCE(rec.meal_allowance, 0),
    'transport_allowance',COALESCE(rec.transport_allowance, 0),
    'attendance_bonus',   COALESCE(rec.attendance_bonus, 0),
    'overtime_pay',       COALESCE(rec.overtime_pay, COALESCE(rec.overtime, 0)),
    'bonus',              COALESCE(rec.bonus, 0),
    'allowance_legacy',   COALESCE(rec.allowance, 0),
    'absence_deduction',  COALESCE(rec.absence_deduction, 0),
    'late_deduction',     COALESCE(rec.late_deduction, 0),
    'other_deduction',    COALESCE(rec.other_deduction, 0),
    'other_deduction_note', rec.other_deduction_note,
    'insurance',          rec.insurance,
    'deductions_legacy',  rec.deductions,
    'net_salary',         rec.net_salary,
    'created_at',         rec.created_at
  );
END $function$;

-- ⑥ 員工 LIFF 歷史薪資列表：只列已發布月份（LIFF /salary 頁走這支）
CREATE OR REPLACE FUNCTION public.liff_list_my_salary(p_line_user_id text)
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(json_agg(row_to_json(s.*) ORDER BY s.month DESC), '[]'::json)
  FROM public.salary_records s
  WHERE s.employee_id = (SELECT id FROM public._liff_resolve_employee(p_line_user_id))
    AND s.published_at IS NOT NULL          -- ★ 只列已發布月份（草稿不外洩）
$function$;

-- ⑦ 現有四月設為已發布（員工維持看得到四月）；六月 published_at 為 NULL → 自動隱藏
UPDATE public.salary_records
   SET published_at = now()
 WHERE month = '2026-04' AND organization_id = 1 AND published_at IS NULL;

NOTIFY pgrst, 'reload schema';
