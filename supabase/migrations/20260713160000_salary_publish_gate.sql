-- 薪資「發布給員工」閘門 — 2026-07-13
-- 問題:員工 LINE 薪資卡讀 salary_records「最新月」且不看狀態 → 批次算完的草稿(如六月)
--   立刻外洩給員工。治本:改成「只顯示已發布(finalized)月份」,草稿留著不外洩,不刪資料。
-- 做法:
--   ① publish_salary_month / unpublish_salary_month:整月 bulk 設 status(admin 限定)。
--   ② liff_card_my_salary_brief / _unlock:讀取加 status='finalized' 閘門(草稿看不到)。
--   ③ 現有四月先設為已發布(員工維持看得到四月);六月維持 draft → 自動隱藏。
-- 皆 idempotent。UPDATE 不觸發 salary_records 的 BEFORE INSERT 鎖/稽核。

-- ① 發布整月（admin/super_admin 限定）
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
     SET status = 'finalized', finalized_at = now(), finalized_by = current_employee_id()
   WHERE month = p_month AND organization_id = v_org;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  RETURN json_build_object('ok', true, 'published', v_cnt, 'month', p_month);
END $$;

-- ② 取消發布（改回草稿，員工端立即隱藏）
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
     SET status = 'draft', finalized_at = NULL, finalized_by = NULL
   WHERE month = p_month AND organization_id = v_org;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  RETURN json_build_object('ok', true, 'unpublished', v_cnt, 'month', p_month);
END $$;

GRANT EXECUTE ON FUNCTION public.publish_salary_month(text, int)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.unpublish_salary_month(text, int) TO authenticated;

-- ③ 員工薪資卡（摘要）：只顯示已發布月份
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
     AND status = 'finalized'            -- ★ 只看已發布月份（草稿不外洩）
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

-- ④ 員工薪資卡（解鎖完整）：只顯示已發布月份
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
     AND status = 'finalized'            -- ★ 只看已發布月份（草稿不外洩）
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

-- ⑤ 現有四月設為已發布（員工維持看得到四月）；六月維持 draft → 自動隱藏
UPDATE public.salary_records
   SET status = 'finalized', finalized_at = now()
 WHERE month = '2026-04' AND organization_id = 1 AND status <> 'finalized';

NOTIFY pgrst, 'reload schema';
