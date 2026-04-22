-- ================================================
-- LIFF RPC 套件 — 讓 anon key 的 LIFF 可以存取自己員工的資料
--
-- 背景：LIFF 用 anon key 呼叫 Supabase，但大多數表有 org-scoped RLS
-- （`TO authenticated`），anon 一律被擋。結果：LIFF 幾乎所有頁都抓不到
-- 資料（門市、排班、請假紀錄…都回空）。
--
-- 解法：提供一組 SECURITY DEFINER RPC，每支都以 p_line_user_id 當作身份
-- 憑證，內部查到對應 employee_id 後回傳該員工的資料，繞過 RLS。
--
-- 所有 RPC 都 GRANT EXECUTE TO anon, authenticated。
-- ================================================

-- ── helper: line_user_id → employee 完整物件 ─────────────────────
CREATE OR REPLACE FUNCTION public._liff_resolve_employee(p_line_user_id text)
RETURNS employees
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT e.*
  FROM employees e
  JOIN employee_line_accounts ela ON ela.employee_id = e.id
  WHERE ela.line_user_id = p_line_user_id
    AND e.status = '在職'
  ORDER BY ela.is_primary DESC, ela.id ASC
  LIMIT 1
$$;

-- ── 1. 員工的門市（打卡用 GPS/WiFi 設定） ─────────────────────
CREATE OR REPLACE FUNCTION public.liff_get_store_for_employee(p_employee_id int)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT json_build_object(
    'id',                     s.id,
    'name',                   s.name,
    'lat',                    s.lat,
    'lng',                    s.lng,
    'clock_radius',           s.clock_radius,
    'allowed_wifi',           s.allowed_wifi,
    'late_tolerance_minutes', s.late_tolerance_minutes,
    'early_clock_minutes',    s.early_clock_minutes,
    'clock_in_method',        s.clock_in_method
  )
  FROM public.stores s
  JOIN public.employees e ON e.store_id = s.id
  WHERE e.id = p_employee_id
  LIMIT 1
$$;

-- ── 2. LIFF 可見的 active stores（下拉用） ────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_stores_for_line_user(p_line_user_id text)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(
    json_build_object(
      'id',   s.id,
      'name', s.name,
      'code', s.store_code,
      'city', s.city
    ) ORDER BY s.name
  ), '[]'::json)
  FROM public.stores s
  WHERE s.status = '營運中'
    AND s.organization_id = (
      SELECT e.organization_id FROM public._liff_resolve_employee(p_line_user_id) e
    )
$$;

-- ── 3. 員工今天的出勤紀錄 ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_get_attendance_today(p_line_user_id text)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT row_to_json(a.*)
  FROM public.attendance_records a
  WHERE a.employee_id = (SELECT id FROM public._liff_resolve_employee(p_line_user_id))
    AND a.date = CURRENT_DATE
  LIMIT 1
$$;

-- ── 4. 員工本月排班（MySchedule 用） ─────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_schedules(p_line_user_id text, p_month text DEFAULT NULL)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(s.*) ORDER BY s.date), '[]'::json)
  FROM public.schedules s
  WHERE s.employee = (SELECT name FROM public._liff_resolve_employee(p_line_user_id))
    AND (p_month IS NULL OR to_char(s.date, 'YYYY-MM') = p_month)
$$;

-- ── 5. 班別定義（依員工 store 拿；fallback 到 global 無 store_id 的班別） ──
CREATE OR REPLACE FUNCTION public.liff_list_shift_definitions(p_line_user_id text)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(sd.*) ORDER BY sd.sort_order, sd.id), '[]'::json)
  FROM public.shift_definitions sd
  WHERE sd.store_id = (SELECT store_id FROM public._liff_resolve_employee(p_line_user_id))
     OR sd.store_id IS NULL
$$;

-- ── 6. 國定假日（全員可見） ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_holidays()
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(json_build_object('date', date, 'name', name) ORDER BY date), '[]'::json)
  FROM public.holidays
$$;

-- ── 7. 員工的請假紀錄 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_leave_requests(p_line_user_id text)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(lr.*) ORDER BY lr.start_date DESC), '[]'::json)
  FROM public.leave_requests lr
  WHERE lr.employee = (SELECT name FROM public._liff_resolve_employee(p_line_user_id))
$$;

CREATE OR REPLACE FUNCTION public.liff_insert_leave_request(p_line_user_id text, p_payload json)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  new_id int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  INSERT INTO public.leave_requests (
    employee_id, employee, type, start_date, end_date, days, hours,
    start_time, end_time, reason, status, organization_id
  )
  VALUES (
    emp.id, emp.name,
    p_payload->>'type',
    (p_payload->>'start_date')::date,
    COALESCE((p_payload->>'end_date')::date, (p_payload->>'start_date')::date),
    COALESCE((p_payload->>'days')::numeric, 1),
    NULLIF(p_payload->>'hours','')::numeric,
    NULLIF(p_payload->>'start_time','')::time,
    NULLIF(p_payload->>'end_time','')::time,
    p_payload->>'reason',
    COALESCE(p_payload->>'status', '待審核'),
    emp.organization_id
  )
  RETURNING id INTO new_id;

  RETURN json_build_object('id', new_id);
END $$;

CREATE OR REPLACE FUNCTION public.liff_update_leave_request(p_line_user_id text, p_id int, p_payload json)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees; n int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  UPDATE public.leave_requests SET
    type = p_payload->>'type',
    start_date = (p_payload->>'start_date')::date,
    end_date = COALESCE((p_payload->>'end_date')::date, (p_payload->>'start_date')::date),
    days = COALESCE((p_payload->>'days')::numeric, days),
    hours = NULLIF(p_payload->>'hours','')::numeric,
    start_time = NULLIF(p_payload->>'start_time','')::time,
    end_time = NULLIF(p_payload->>'end_time','')::time,
    reason = p_payload->>'reason'
  WHERE id = p_id AND employee_id = emp.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN json_build_object('updated', n);
END $$;

CREATE OR REPLACE FUNCTION public.liff_delete_leave_request(p_line_user_id text, p_id int)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees; n int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  DELETE FROM public.leave_requests WHERE id = p_id AND employee_id = emp.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ── 8. 員工的加班紀錄 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_overtime_requests(p_line_user_id text)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(o.*) ORDER BY o.date DESC), '[]'::json)
  FROM public.overtime_requests o
  WHERE o.employee = (SELECT name FROM public._liff_resolve_employee(p_line_user_id))
$$;

CREATE OR REPLACE FUNCTION public.liff_insert_overtime_request(p_line_user_id text, p_payload json)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  new_id int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  INSERT INTO public.overtime_requests (
    employee_id, employee, date, hours, reason, status, organization_id
  )
  VALUES (
    emp.id, emp.name,
    (p_payload->>'date')::date,
    (p_payload->>'hours')::numeric,
    p_payload->>'reason',
    COALESCE(p_payload->>'status', '待審核'),
    emp.organization_id
  )
  RETURNING id INTO new_id;

  RETURN json_build_object('id', new_id);
END $$;

-- ── 9. 員工的希望休（OffRequest） ────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_off_requests(p_line_user_id text, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(o.*) ORDER BY o.date), '[]'::json)
  FROM public.off_requests o
  WHERE o.employee_id = (SELECT id FROM public._liff_resolve_employee(p_line_user_id))
    AND (p_from IS NULL OR o.date >= p_from)
    AND (p_to   IS NULL OR o.date <= p_to)
$$;

CREATE OR REPLACE FUNCTION public.liff_insert_off_request(p_line_user_id text, p_date date, p_reason text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  new_id int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  INSERT INTO public.off_requests (employee_id, employee, date, reason, organization_id)
  VALUES (emp.id, emp.name, p_date, p_reason, emp.organization_id)
  RETURNING id INTO new_id;

  RETURN json_build_object('id', new_id);
END $$;

CREATE OR REPLACE FUNCTION public.liff_delete_off_request(p_line_user_id text, p_date date)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  n int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  DELETE FROM public.off_requests WHERE employee_id = emp.id AND date = p_date;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ── 10. 員工的出差單 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_business_trips(p_line_user_id text)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(b.*) ORDER BY b.start_date DESC), '[]'::json)
  FROM public.business_trips b
  WHERE b.employee_id = (SELECT id FROM public._liff_resolve_employee(p_line_user_id))
$$;

CREATE OR REPLACE FUNCTION public.liff_upsert_business_trip(p_line_user_id text, p_id int, p_payload json)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  new_id int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.business_trips (
      employee_id, destination, start_date, end_date, purpose, organization_id
    )
    VALUES (
      emp.id,
      p_payload->>'destination',
      (p_payload->>'start_date')::date,
      (p_payload->>'end_date')::date,
      p_payload->>'purpose',
      emp.organization_id
    )
    RETURNING id INTO new_id;
  ELSE
    UPDATE public.business_trips SET
      destination = p_payload->>'destination',
      start_date  = (p_payload->>'start_date')::date,
      end_date    = (p_payload->>'end_date')::date,
      purpose     = p_payload->>'purpose'
    WHERE id = p_id AND employee_id = emp.id
    RETURNING id INTO new_id;
  END IF;

  RETURN json_build_object('id', new_id);
END $$;

-- ── 11. 員工的費用申請（ExpenseRequest） ────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_expense_requests(p_line_user_id text)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(er.*) ORDER BY er.created_at DESC), '[]'::json)
  FROM public.expense_requests er
  WHERE er.employee_id = (SELECT id FROM public._liff_resolve_employee(p_line_user_id))
$$;

CREATE OR REPLACE FUNCTION public.liff_insert_expense_request(p_line_user_id text, p_payload json)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees; new_id int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  INSERT INTO public.expense_requests (
    employee, employee_id, department, account_code, account_name,
    title, description, estimated_amount, store, status, organization_id
  )
  VALUES (
    emp.name, emp.id, emp.dept,
    p_payload->>'account_code',
    p_payload->>'account_name',
    p_payload->>'title',
    p_payload->>'description',
    (p_payload->>'estimated_amount')::numeric,
    COALESCE(p_payload->>'store', emp.store),
    '申請中',
    emp.organization_id
  )
  RETURNING id INTO new_id;

  RETURN json_build_object('id', new_id);
END $$;

CREATE OR REPLACE FUNCTION public.liff_settle_expense_request(p_line_user_id text, p_id int, p_payload json)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees; n int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  UPDATE public.expense_requests SET
    actual_amount = (p_payload->>'actual_amount')::numeric,
    notes = p_payload->>'notes',
    status = '待核銷'
  WHERE id = p_id AND employee_id = emp.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN json_build_object('updated', n);
END $$;

CREATE OR REPLACE FUNCTION public.liff_insert_expense_request_attachment(p_line_user_id text, p_payload json)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees; new_id int; req_id int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  req_id := (p_payload->>'request_id')::int;
  -- 確認那張申請單是這位員工的
  PERFORM 1 FROM public.expense_requests WHERE id = req_id AND employee_id = emp.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not your request'; END IF;

  INSERT INTO public.expense_request_attachments (
    request_id, file_name, storage_path, file_size, file_type, stage, uploaded_by
  )
  VALUES (
    req_id,
    p_payload->>'file_name',
    p_payload->>'storage_path',
    (p_payload->>'file_size')::bigint,
    p_payload->>'file_type',
    p_payload->>'stage',
    emp.name
  )
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.liff_list_expense_request_attachments(p_line_user_id text, p_request_id int)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(a.*) ORDER BY a.created_at), '[]'::json)
  FROM public.expense_request_attachments a
  JOIN public.expense_requests er ON er.id = a.request_id
  WHERE er.id = p_request_id
    AND er.employee_id = (SELECT id FROM public._liff_resolve_employee(p_line_user_id))
$$;

-- ── 12. 科目（accounts，唯讀） ──────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_accounts()
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(json_build_object(
    'code', code, 'name', name, 'type', type, 'parent_code', parent_code
  ) ORDER BY code), '[]'::json)
  FROM public.accounts
$$;

-- ── 13. 我的任務 ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_my_tasks(p_line_user_id text)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(t.*) ORDER BY t.due_date NULLS LAST, t.id), '[]'::json)
  FROM public.tasks t
  WHERE t.assignee_id = (SELECT id FROM public._liff_resolve_employee(p_line_user_id))
    AND t.status NOT IN ('已完成', '已取消')
$$;

-- ── 14. 福利政策（Leave 頁用） ──────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_benefit_policies(p_line_user_id text)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(bp.*)), '[]'::json)
  FROM public.benefit_policies bp
  WHERE bp.organization_id = (
    SELECT organization_id FROM public._liff_resolve_employee(p_line_user_id)
  )
$$;

-- ── 15. 打卡補登 ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_clock_corrections(p_line_user_id text)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(c.*) ORDER BY c.date DESC), '[]'::json)
  FROM public.clock_corrections c
  WHERE c.employee = (SELECT name FROM public._liff_resolve_employee(p_line_user_id))
$$;

CREATE OR REPLACE FUNCTION public.liff_insert_clock_correction(p_line_user_id text, p_payload json)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  new_id int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  INSERT INTO public.clock_corrections (
    employee, date, type, correction_time, reason, status
  )
  VALUES (
    emp.name,
    (p_payload->>'date')::date,
    COALESCE(p_payload->>'type', '上班打卡'),
    NULLIF(p_payload->>'correction_time', '')::time,
    p_payload->>'reason',
    '待審核'
  )
  RETURNING id INTO new_id;

  RETURN json_build_object('id', new_id);
END $$;

-- ── 16. 員工自己的薪資（Salary 頁用） ──────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_my_salary(p_line_user_id text)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(s.*) ORDER BY s.month DESC), '[]'::json)
  FROM public.salary_records s
  WHERE s.employee_id = (SELECT id FROM public._liff_resolve_employee(p_line_user_id))
$$;

-- ── 補：加班 update / delete ───────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_update_overtime_request(p_line_user_id text, p_id int, p_payload json)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees; n int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  UPDATE public.overtime_requests SET
    date = (p_payload->>'date')::date,
    hours = (p_payload->>'hours')::numeric,
    reason = p_payload->>'reason'
  WHERE id = p_id AND employee_id = emp.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN json_build_object('updated', n);
END $$;

CREATE OR REPLACE FUNCTION public.liff_delete_overtime_request(p_line_user_id text, p_id int)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees; n int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  DELETE FROM public.overtime_requests WHERE id = p_id AND employee_id = emp.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ── 補：出差 delete ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_delete_business_trip(p_line_user_id text, p_id int)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees; n int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  DELETE FROM public.business_trips WHERE id = p_id AND employee_id = emp.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ── 補：費用 upsert / delete ───────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_upsert_expense(p_line_user_id text, p_id int, p_payload json)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees; new_id int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.expenses (
      employee, date, category, amount, description, status, organization_id
    ) VALUES (
      emp.name,
      (p_payload->>'date')::date,
      p_payload->>'category',
      (p_payload->>'amount')::numeric,
      p_payload->>'description',
      COALESCE(p_payload->>'status', '待核銷'),
      emp.organization_id
    ) RETURNING id INTO new_id;
  ELSE
    UPDATE public.expenses SET
      date = (p_payload->>'date')::date,
      category = p_payload->>'category',
      amount = (p_payload->>'amount')::numeric,
      description = p_payload->>'description'
    WHERE id = p_id AND employee = emp.name
    RETURNING id INTO new_id;
  END IF;
  RETURN json_build_object('id', new_id);
END $$;

CREATE OR REPLACE FUNCTION public.liff_delete_expense(p_line_user_id text, p_id int)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees; n int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  DELETE FROM public.expenses WHERE id = p_id AND employee = emp.name;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ── 17. 員工的費用（Expenses 頁用） ────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_my_expenses(p_line_user_id text)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(e.*) ORDER BY e.date DESC), '[]'::json)
  FROM public.expenses e
  WHERE e.employee = (SELECT name FROM public._liff_resolve_employee(p_line_user_id))
$$;

-- ── 批次 GRANT ─────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.liff_get_store_for_employee(int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_list_stores_for_line_user(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_get_attendance_today(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_list_schedules(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_list_shift_definitions(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_list_holidays() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_list_leave_requests(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_insert_leave_request(text, json) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_list_overtime_requests(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_insert_overtime_request(text, json) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_list_off_requests(text, date, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_insert_off_request(text, date, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_delete_off_request(text, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_list_business_trips(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_upsert_business_trip(text, int, json) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_list_expense_requests(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_list_accounts() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_list_my_tasks(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_list_benefit_policies(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_list_clock_corrections(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_insert_clock_correction(text, json) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_list_my_salary(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_list_my_expenses(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_update_overtime_request(text, int, json) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_delete_overtime_request(text, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_delete_business_trip(text, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_upsert_expense(text, int, json) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_delete_expense(text, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_update_leave_request(text, int, json) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_delete_leave_request(text, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_insert_expense_request(text, json) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_settle_expense_request(text, int, json) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_list_expense_request_attachments(text, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_insert_expense_request_attachment(text, json) TO anon, authenticated;
