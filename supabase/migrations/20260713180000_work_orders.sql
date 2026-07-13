-- 跨部門工單（cross-dept work order）— 2026-07-13
-- 場景:營運部開單請行銷部做事,需可見度(透明)+可排程。純流程,不走簽核鏈。
-- 狀態機:待受理 →(受理:指派承辦+填排定完成日)→ 處理中 →(回報)→ 已完成 →(申請人確認)→ 已結案
--         任何時候可 退回(留原因)。
-- 兩個日期:expected_due_date(申請人填,唯讀) / scheduled_due_date(被申請方受理時填/可改)。
-- 可見性:申請人 / 承辦人 / 目標部門成員 / 申請部門成員 / admin。寫入全走 SECURITY DEFINER RPC。

-- ── 表 ──
CREATE TABLE IF NOT EXISTS public.work_orders (
  id                        serial PRIMARY KEY,
  organization_id           int  NOT NULL,
  requester_id              int  NOT NULL REFERENCES public.employees(id),
  requester_name            text,
  requester_department_id   int,
  requester_department_name text,
  target_department_id      int  NOT NULL REFERENCES public.departments(id),
  target_department_name    text,
  assignee_id               int  REFERENCES public.employees(id) ON DELETE SET NULL,   -- 受理時指派
  assignee_name             text,
  title                     text NOT NULL,
  description               text NOT NULL,
  store_id                  int  REFERENCES public.stores(id) ON DELETE SET NULL,       -- 關聯門市(選填)
  priority                  text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  expected_due_date         date NOT NULL,                                              -- 期望完成日(申請人)
  scheduled_due_date        date,                                                       -- 排定完成日(被申請方)
  status                    text NOT NULL DEFAULT '待受理'
                              CHECK (status IN ('待受理','處理中','已完成','已結案','已退回')),
  reject_reason             text,
  attachments               jsonb DEFAULT '[]'::jsonb,
  accepted_at               timestamptz,
  completed_at              timestamptz,
  confirmed_at              timestamptz,
  created_at                timestamptz DEFAULT now(),
  updated_at                timestamptz DEFAULT now(),
  deleted_at                timestamptz
);
CREATE INDEX IF NOT EXISTS idx_work_orders_org        ON public.work_orders (organization_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_target     ON public.work_orders (target_department_id, status);
CREATE INDEX IF NOT EXISTS idx_work_orders_requester  ON public.work_orders (requester_id, status);
CREATE INDEX IF NOT EXISTS idx_work_orders_assignee   ON public.work_orders (assignee_id);

-- ── RLS ──
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._work_order_visible(p_id int)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me int; v_role text; v_dept int; v_wo public.work_orders;
BEGIN
  SELECT e.id, r.name, e.department_id INTO v_me, v_role, v_dept
    FROM public.employees e LEFT JOIN public.roles r ON r.id = e.role_id
   WHERE e.auth_user_id = auth.uid() LIMIT 1;
  IF v_me IS NULL THEN RETURN false; END IF;
  IF v_role IN ('super_admin','admin') THEN RETURN true; END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_id;
  IF v_wo.id IS NULL THEN RETURN false; END IF;
  RETURN v_wo.requester_id = v_me
      OR v_wo.assignee_id  = v_me
      OR (v_dept IS NOT NULL AND v_wo.target_department_id    = v_dept)
      OR (v_dept IS NOT NULL AND v_wo.requester_department_id = v_dept);
END $$;

DROP POLICY IF EXISTS work_orders_select ON public.work_orders;
CREATE POLICY work_orders_select ON public.work_orders
  FOR SELECT USING (public._work_order_visible(id));

-- ── 小工具:取 caller 部門(SECURITY DEFINER 避開 employees RLS) ──
CREATE OR REPLACE FUNCTION public._current_employee_dept()
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT department_id FROM public.employees WHERE id = public.current_employee_id();
$$;

-- ── RPC ①:開單 ──
CREATE OR REPLACE FUNCTION public.create_work_order(
  p_target_department_id int,
  p_title                text,
  p_description          text,
  p_priority             text DEFAULT 'medium',
  p_expected_due_date    date DEFAULT NULL,
  p_store_id             int  DEFAULT NULL,
  p_assignee_id          int  DEFAULT NULL,
  p_attachments          jsonb DEFAULT '[]'::jsonb
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me int := current_employee_id();
  v_emp public.employees;
  v_row public.work_orders;
  v_dept text; v_tdept text; v_aname text;
BEGIN
  IF v_me IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  IF p_target_department_id IS NULL OR COALESCE(btrim(p_title),'') = '' THEN
    RETURN json_build_object('ok', false, 'error', 'MISSING_FIELDS');
  END IF;
  SELECT * INTO v_emp FROM public.employees WHERE id = v_me;
  SELECT name INTO v_dept  FROM public.departments WHERE id = v_emp.department_id;
  SELECT name INTO v_tdept FROM public.departments WHERE id = p_target_department_id;
  IF p_assignee_id IS NOT NULL THEN SELECT name INTO v_aname FROM public.employees WHERE id = p_assignee_id; END IF;

  INSERT INTO public.work_orders (
    organization_id, requester_id, requester_name, requester_department_id, requester_department_name,
    target_department_id, target_department_name, assignee_id, assignee_name,
    title, description, store_id, priority, expected_due_date, status, attachments
  ) VALUES (
    v_emp.organization_id, v_me, v_emp.name, v_emp.department_id, v_dept,
    p_target_department_id, v_tdept, p_assignee_id, v_aname,
    btrim(p_title), COALESCE(p_description,''), p_store_id,
    COALESCE(NULLIF(p_priority,''), 'medium'), p_expected_due_date, '待受理', COALESCE(p_attachments, '[]'::jsonb)
  ) RETURNING * INTO v_row;

  RETURN json_build_object('ok', true, 'id', v_row.id);
END $$;

-- ── RPC ②:受理(指派承辦 + 填排定完成日 → 處理中) ──
CREATE OR REPLACE FUNCTION public.accept_work_order(
  p_id int,
  p_assignee_id int DEFAULT NULL,
  p_scheduled_due_date date DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me int := current_employee_id();
  v_wo public.work_orders;
  v_assignee int; v_aname text;
BEGIN
  IF v_me IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_id;
  IF v_wo.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT (is_admin() OR _current_employee_dept() = v_wo.target_department_id) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  IF v_wo.status <> '待受理' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_PENDING');
  END IF;
  v_assignee := COALESCE(p_assignee_id, v_wo.assignee_id, v_me);
  SELECT name INTO v_aname FROM public.employees WHERE id = v_assignee;

  UPDATE public.work_orders
     SET assignee_id = v_assignee, assignee_name = v_aname,
         scheduled_due_date = COALESCE(p_scheduled_due_date, scheduled_due_date, expected_due_date),
         status = '處理中', accepted_at = now(), updated_at = now()
   WHERE id = p_id;
  RETURN json_build_object('ok', true, 'status', '處理中');
END $$;

-- ── RPC ③:承辦回報完成 ──
CREATE OR REPLACE FUNCTION public.complete_work_order(p_id int)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me int := current_employee_id(); v_wo public.work_orders;
BEGIN
  IF v_me IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_id;
  IF v_wo.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT (is_admin() OR v_wo.assignee_id = v_me OR _current_employee_dept() = v_wo.target_department_id) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  IF v_wo.status <> '處理中' THEN RETURN json_build_object('ok', false, 'error', 'NOT_IN_PROGRESS'); END IF;
  UPDATE public.work_orders SET status = '已完成', completed_at = now(), updated_at = now() WHERE id = p_id;
  RETURN json_build_object('ok', true, 'status', '已完成');
END $$;

-- ── RPC ④:申請人確認結案 ──
CREATE OR REPLACE FUNCTION public.confirm_work_order(p_id int)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me int := current_employee_id(); v_wo public.work_orders;
BEGIN
  IF v_me IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_id;
  IF v_wo.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT (is_admin() OR v_wo.requester_id = v_me) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  IF v_wo.status <> '已完成' THEN RETURN json_build_object('ok', false, 'error', 'NOT_COMPLETED'); END IF;
  UPDATE public.work_orders SET status = '已結案', confirmed_at = now(), updated_at = now() WHERE id = p_id;
  RETURN json_build_object('ok', true, 'status', '已結案');
END $$;

-- ── RPC ⑤:退回(目標部門) ──
CREATE OR REPLACE FUNCTION public.reject_work_order(p_id int, p_reason text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me int := current_employee_id(); v_wo public.work_orders;
BEGIN
  IF v_me IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_id;
  IF v_wo.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT (is_admin() OR _current_employee_dept() = v_wo.target_department_id OR v_wo.assignee_id = v_me) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  IF v_wo.status NOT IN ('待受理','處理中') THEN RETURN json_build_object('ok', false, 'error', 'BAD_STATUS'); END IF;
  UPDATE public.work_orders
     SET status = '已退回', reject_reason = COALESCE(NULLIF(btrim(p_reason),''), '(未填原因)'), updated_at = now()
   WHERE id = p_id;
  RETURN json_build_object('ok', true, 'status', '已退回');
END $$;

-- ── RPC ⑥:申請人撤單(軟刪,限待受理/已退回) ──
CREATE OR REPLACE FUNCTION public.delete_work_order(p_id int)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me int := current_employee_id(); v_wo public.work_orders;
BEGIN
  IF v_me IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_id;
  IF v_wo.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT (is_admin() OR v_wo.requester_id = v_me) THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF v_wo.status NOT IN ('待受理','已退回') THEN RETURN json_build_object('ok', false, 'error', 'BAD_STATUS'); END IF;
  UPDATE public.work_orders SET deleted_at = now(), updated_at = now() WHERE id = p_id;
  RETURN json_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.create_work_order(int, text, text, text, date, int, int, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_work_order(int, int, date)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_work_order(int)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_work_order(int)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_work_order(int, text)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_work_order(int)             TO authenticated;

NOTIFY pgrst, 'reload schema';
