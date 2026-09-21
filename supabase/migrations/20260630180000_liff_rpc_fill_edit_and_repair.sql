-- ════════════════════════════════════════════════════════════════════════════
-- 補齊 LIFF 編輯 + 門市報修
--
-- 1. liff_update_clock_correction        補打卡（待審核 時可改）
-- 2. liff_update_expense_request         費用申請編輯（申請中 時可改）
-- 3. liff_delete_expense_request         費用申請撤回
-- 4. liff_insert_resignation_request     離職申請 新增
-- 5. liff_update_resignation_request     離職申請 編輯
-- 6. liff_delete_resignation_request     離職申請 撤回
-- 7. liff_insert_personnel_transfer_request  人事異動 新增
-- 8. liff_update_personnel_transfer_request  人事異動 編輯
-- 9. liff_delete_personnel_transfer_request  人事異動 撤回
-- 10. store_repair_requests TABLE
-- 11. liff_list/insert/update/delete_store_repair_request
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. liff_update_clock_correction ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_update_clock_correction(
  p_line_user_id text,
  p_id           int,
  p_payload      json
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  UPDATE public.clock_corrections SET
    type            = COALESCE(p_payload->>'type', type),
    correction_time = CASE WHEN p_payload->>'correction_time' IS NOT NULL
                           THEN NULLIF(p_payload->>'correction_time', '')::time
                           ELSE correction_time END,
    reason          = COALESCE(NULLIF(p_payload->>'reason', ''), reason)
  WHERE id = p_id AND employee_id = emp.id AND status = '待審核';

  IF NOT FOUND THEN RAISE EXCEPTION '找不到可編輯的補打卡紀錄'; END IF;
  RETURN json_build_object('id', p_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[liff_update_clock_correction] %', SQLERRM; RAISE;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_update_clock_correction(text, int, json) TO authenticated, anon;

-- ── 2. liff_update_expense_request ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_update_expense_request(
  p_line_user_id text,
  p_id           int,
  p_payload      json
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  UPDATE public.expense_requests SET
    title            = COALESCE(NULLIF(p_payload->>'title', ''),            title),
    description      = COALESCE(NULLIF(p_payload->>'description', ''),      description),
    estimated_amount = COALESCE(NULLIF(p_payload->>'estimated_amount', '')::numeric, estimated_amount),
    account_code     = COALESCE(NULLIF(p_payload->>'account_code', ''),     account_code),
    notes            = COALESCE(NULLIF(p_payload->>'notes', ''),            notes),
    store            = COALESCE(NULLIF(p_payload->>'store', ''),            store),
    updated_at       = now()
  WHERE id = p_id AND employee_id = emp.id AND status = '申請中';

  IF NOT FOUND THEN RAISE EXCEPTION '找不到可編輯的費用申請'; END IF;
  RETURN json_build_object('id', p_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[liff_update_expense_request] %', SQLERRM; RAISE;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_update_expense_request(text, int, json) TO authenticated, anon;

-- ── 3. liff_delete_expense_request（撤回）────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_delete_expense_request(
  p_line_user_id text,
  p_id           int
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  UPDATE public.expense_requests SET status = '已撤回', updated_at = now()
  WHERE id = p_id AND employee_id = emp.id AND status = '申請中';

  IF NOT FOUND THEN RAISE EXCEPTION '找不到可撤回的費用申請'; END IF;
  RETURN json_build_object('id', p_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[liff_delete_expense_request] %', SQLERRM; RAISE;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_delete_expense_request(text, int) TO authenticated, anon;

-- ── 4. liff_insert_resignation_request ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_insert_resignation_request(
  p_line_user_id text,
  p_payload      json
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp      employees;
  v_chain  int;
  new_id   int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  SELECT id INTO v_chain FROM public.approval_chains
   WHERE category = '離職申請' AND organization_id = emp.organization_id
     AND COALESCE(is_active, true) = true
   ORDER BY id DESC LIMIT 1;

  INSERT INTO public.resignation_requests (
    employee_id, organization_id,
    planned_resign_date, reason, reason_detail, handover_notes,
    status, approval_chain_id, current_step
  ) VALUES (
    emp.id, emp.organization_id,
    (p_payload->>'planned_resign_date')::date,
    p_payload->>'reason',
    NULLIF(p_payload->>'reason_detail', ''),
    NULLIF(p_payload->>'handover_notes', ''),
    '申請中', v_chain, 0
  ) RETURNING id INTO new_id;

  RETURN json_build_object('id', new_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[liff_insert_resignation_request] %', SQLERRM; RAISE;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_insert_resignation_request(text, json) TO authenticated, anon;

-- ── 5. liff_update_resignation_request ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_update_resignation_request(
  p_line_user_id text,
  p_id           int,
  p_payload      json
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  UPDATE public.resignation_requests SET
    planned_resign_date = COALESCE((p_payload->>'planned_resign_date')::date, planned_resign_date),
    reason              = COALESCE(NULLIF(p_payload->>'reason', ''),         reason),
    reason_detail       = COALESCE(NULLIF(p_payload->>'reason_detail', ''),  reason_detail),
    handover_notes      = COALESCE(NULLIF(p_payload->>'handover_notes', ''), handover_notes),
    reject_reason       = NULL,
    status              = '申請中',
    current_step        = 0,
    updated_at          = now()
  WHERE id = p_id AND employee_id = emp.id AND status IN ('申請中', '已駁回');

  IF NOT FOUND THEN RAISE EXCEPTION '找不到可編輯的離職申請'; END IF;
  RETURN json_build_object('id', p_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[liff_update_resignation_request] %', SQLERRM; RAISE;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_update_resignation_request(text, int, json) TO authenticated, anon;

-- ── 6. liff_delete_resignation_request（撤回）────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_delete_resignation_request(
  p_line_user_id text,
  p_id           int
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  UPDATE public.resignation_requests SET status = '已撤回', updated_at = now()
  WHERE id = p_id AND employee_id = emp.id AND status = '申請中';

  IF NOT FOUND THEN RAISE EXCEPTION '找不到可撤回的離職申請'; END IF;
  RETURN json_build_object('id', p_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[liff_delete_resignation_request] %', SQLERRM; RAISE;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_delete_resignation_request(text, int) TO authenticated, anon;

-- ── 7. liff_insert_personnel_transfer_request ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_insert_personnel_transfer_request(
  p_line_user_id text,
  p_payload      json
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp      employees;
  v_chain  int;
  new_id   int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  SELECT id INTO v_chain FROM public.approval_chains
   WHERE category = '人事異動' AND organization_id = emp.organization_id
     AND COALESCE(is_active, true) = true
   ORDER BY id DESC LIMIT 1;

  INSERT INTO public.personnel_transfer_requests (
    employee_id, organization_id,
    transfer_type, effective_date,
    new_position, new_role,
    new_department_id, new_store_id,
    new_base_salary,
    reason,
    status, approval_chain_id, current_step
  ) VALUES (
    emp.id, emp.organization_id,
    COALESCE(p_payload->>'transfer_type', '調職'),
    (p_payload->>'effective_date')::date,
    NULLIF(p_payload->>'new_position', ''),
    NULLIF(p_payload->>'new_role', ''),
    NULLIF(p_payload->>'new_department_id', '')::int,
    NULLIF(p_payload->>'new_store_id', '')::int,
    NULLIF(p_payload->>'new_base_salary', '')::numeric,
    NULLIF(p_payload->>'reason', ''),
    '申請中', v_chain, 0
  ) RETURNING id INTO new_id;

  RETURN json_build_object('id', new_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[liff_insert_personnel_transfer_request] %', SQLERRM; RAISE;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_insert_personnel_transfer_request(text, json) TO authenticated, anon;

-- ── 8. liff_update_personnel_transfer_request ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_update_personnel_transfer_request(
  p_line_user_id text,
  p_id           int,
  p_payload      json
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  UPDATE public.personnel_transfer_requests SET
    transfer_type    = COALESCE(NULLIF(p_payload->>'transfer_type', ''),       transfer_type),
    effective_date   = COALESCE((p_payload->>'effective_date')::date,           effective_date),
    new_position     = COALESCE(NULLIF(p_payload->>'new_position', ''),         new_position),
    new_role         = COALESCE(NULLIF(p_payload->>'new_role', ''),             new_role),
    new_department_id = COALESCE(NULLIF(p_payload->>'new_department_id','')::int, new_department_id),
    new_store_id     = COALESCE(NULLIF(p_payload->>'new_store_id', '')::int,    new_store_id),
    new_base_salary  = COALESCE(NULLIF(p_payload->>'new_base_salary','')::numeric, new_base_salary),
    reason           = COALESCE(NULLIF(p_payload->>'reason', ''),               reason),
    reject_reason    = NULL,
    status           = '申請中',
    current_step     = 0,
    updated_at       = now()
  WHERE id = p_id AND employee_id = emp.id AND status IN ('申請中', '已駁回');

  IF NOT FOUND THEN RAISE EXCEPTION '找不到可編輯的人事異動申請'; END IF;
  RETURN json_build_object('id', p_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[liff_update_personnel_transfer_request] %', SQLERRM; RAISE;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_update_personnel_transfer_request(text, int, json) TO authenticated, anon;

-- ── 9. liff_delete_personnel_transfer_request（撤回）─────────────────────────
CREATE OR REPLACE FUNCTION public.liff_delete_personnel_transfer_request(
  p_line_user_id text,
  p_id           int
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  UPDATE public.personnel_transfer_requests SET status = '已撤回', updated_at = now()
  WHERE id = p_id AND employee_id = emp.id AND status = '申請中';

  IF NOT FOUND THEN RAISE EXCEPTION '找不到可撤回的人事異動申請'; END IF;
  RETURN json_build_object('id', p_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[liff_delete_personnel_transfer_request] %', SQLERRM; RAISE;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_delete_personnel_transfer_request(text, int) TO authenticated, anon;

-- ── 10. store_repair_requests TABLE ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_repair_requests (
  id              SERIAL PRIMARY KEY,
  organization_id INT         NOT NULL REFERENCES public.organizations(id),
  store_id        INT         NOT NULL REFERENCES public.stores(id),
  employee_id     INT         NOT NULL REFERENCES public.employees(id),
  category        TEXT        NOT NULL DEFAULT '其他',
  title           TEXT        NOT NULL,
  description     TEXT,
  location        TEXT,
  urgency         TEXT        NOT NULL DEFAULT '一般'
                              CHECK (urgency IN ('緊急', '一般', '低')),
  attachment_url  TEXT,
  status          TEXT        NOT NULL DEFAULT '待處理'
                              CHECK (status IN ('待處理', '處理中', '已完成', '已關閉')),
  approval_chain_id INT       REFERENCES public.approval_chains(id),
  current_step    INT         DEFAULT 0,
  resolved_at     TIMESTAMPTZ,
  resolved_by     INT         REFERENCES public.employees(id),
  resolve_notes   TEXT,
  reject_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_repair_store   ON public.store_repair_requests(store_id, status);
CREATE INDEX IF NOT EXISTS idx_store_repair_emp     ON public.store_repair_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_store_repair_org     ON public.store_repair_requests(organization_id);

ALTER TABLE public.store_repair_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff" ON public.store_repair_requests;
CREATE POLICY "staff" ON public.store_repair_requests
  FOR ALL TO authenticated
  USING (organization_id = (
    SELECT organization_id FROM public.employees
     WHERE auth_user_id = auth.uid() LIMIT 1
  ));

-- ── 11a. liff_list_store_repair_requests ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_store_repair_requests(p_line_user_id text)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(row_to_json(r.*) ORDER BY r.created_at DESC), '[]'::json)
  FROM public.store_repair_requests r
  WHERE r.employee_id = (SELECT id FROM public._liff_resolve_employee(p_line_user_id))
$$;

GRANT EXECUTE ON FUNCTION public.liff_list_store_repair_requests(text) TO authenticated, anon;

-- ── 11b. liff_insert_store_repair_request ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_insert_store_repair_request(
  p_line_user_id text,
  p_payload      json
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp      employees;
  v_chain  int;
  new_id   int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;
  IF emp.store_id IS NULL THEN RAISE EXCEPTION '員工未設定門市'; END IF;

  SELECT id INTO v_chain FROM public.approval_chains
   WHERE category = '門市報修' AND organization_id = emp.organization_id
     AND COALESCE(is_active, true) = true
   ORDER BY id DESC LIMIT 1;

  INSERT INTO public.store_repair_requests (
    organization_id, store_id, employee_id,
    category, title, description, location, urgency, attachment_url,
    status, approval_chain_id, current_step
  ) VALUES (
    emp.organization_id,
    COALESCE(NULLIF(p_payload->>'store_id','')::int, emp.store_id),
    emp.id,
    COALESCE(NULLIF(p_payload->>'category',''), '其他'),
    p_payload->>'title',
    NULLIF(p_payload->>'description', ''),
    NULLIF(p_payload->>'location', ''),
    COALESCE(NULLIF(p_payload->>'urgency',''), '一般'),
    NULLIF(p_payload->>'attachment_url', ''),
    '待處理', v_chain, 0
  ) RETURNING id INTO new_id;

  RETURN json_build_object('id', new_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[liff_insert_store_repair_request] %', SQLERRM; RAISE;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_insert_store_repair_request(text, json) TO authenticated, anon;

-- ── 11c. liff_update_store_repair_request ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_update_store_repair_request(
  p_line_user_id text,
  p_id           int,
  p_payload      json
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  UPDATE public.store_repair_requests SET
    category       = COALESCE(NULLIF(p_payload->>'category', ''),       category),
    title          = COALESCE(NULLIF(p_payload->>'title', ''),           title),
    description    = COALESCE(NULLIF(p_payload->>'description', ''),     description),
    location       = COALESCE(NULLIF(p_payload->>'location', ''),        location),
    urgency        = COALESCE(NULLIF(p_payload->>'urgency', ''),         urgency),
    attachment_url = COALESCE(NULLIF(p_payload->>'attachment_url', ''),  attachment_url),
    updated_at     = now()
  WHERE id = p_id AND employee_id = emp.id AND status = '待處理';

  IF NOT FOUND THEN RAISE EXCEPTION '找不到可編輯的報修單'; END IF;
  RETURN json_build_object('id', p_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[liff_update_store_repair_request] %', SQLERRM; RAISE;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_update_store_repair_request(text, int, json) TO authenticated, anon;

-- ── 11d. liff_delete_store_repair_request（關閉）─────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_delete_store_repair_request(
  p_line_user_id text,
  p_id           int
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  UPDATE public.store_repair_requests SET status = '已關閉', updated_at = now()
  WHERE id = p_id AND employee_id = emp.id AND status = '待處理';

  IF NOT FOUND THEN RAISE EXCEPTION '找不到可關閉的報修單'; END IF;
  RETURN json_build_object('id', p_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[liff_delete_store_repair_request] %', SQLERRM; RAISE;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_delete_store_repair_request(text, int) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
