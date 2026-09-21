-- 2026-08-14 維修單(repair_orders):工務接到跨部門工單時的處理紀錄。
--   純狀態機不走簽核(Q3=A);獨立表單(Q1=B);自己/找廠商分流;串非經常性費用申請(自動綁定)。
--   角色:自己(need_purchase 決定要不要串費用) / 找廠商(報價→串費用)。費用走它自己的簽核鏈,維修單只讀狀態當閘門。

-- ── 表 ──
CREATE TABLE IF NOT EXISTS public.repair_orders (
  id                        serial PRIMARY KEY,
  organization_id           int  NOT NULL,
  requester_id              int  NOT NULL REFERENCES public.employees(id),
  requester_name            text,
  requester_department_id   int,
  requester_department_name text,
  handler_type              text NOT NULL DEFAULT 'self' CHECK (handler_type IN ('self','vendor')),  -- 自己 / 找廠商
  occur_time                timestamptz,          -- 時間
  location                  text,                 -- 地點(自由文字)
  store_id                  int  REFERENCES public.stores(id),  -- 可選:綁門市
  title                     text,                 -- 簡短標題(可選)
  description               text NOT NULL DEFAULT '',  -- 怎麼處理 / 問題描述
  need_purchase             boolean NOT NULL DEFAULT false,  -- 自己路徑:要不要買東西
  supplier                  text,                 -- 廠商
  quote_amount              numeric,              -- 報價
  linked_work_order_id      int  REFERENCES public.work_orders(id),  -- 可選:綁進來的跨部門工單
  status                    text NOT NULL DEFAULT '進行中'
                              CHECK (status IN ('進行中','待費用核准','已完工','已取消')),
  completed_at              timestamptz,          -- 完工時間
  completion_note           text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz
);
CREATE INDEX IF NOT EXISTS idx_repair_orders_org      ON public.repair_orders(organization_id);
CREATE INDEX IF NOT EXISTS idx_repair_orders_req      ON public.repair_orders(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_repair_orders_dept     ON public.repair_orders(requester_department_id, status);
CREATE INDEX IF NOT EXISTS idx_repair_orders_wo       ON public.repair_orders(linked_work_order_id);

-- 費用申請反向連結(比照 expense_requests.project_id 的做法)
ALTER TABLE public.expense_requests ADD COLUMN IF NOT EXISTS repair_order_id int REFERENCES public.repair_orders(id);
CREATE INDEX IF NOT EXISTS idx_expense_requests_repair ON public.expense_requests(repair_order_id);

-- ── 可見性(SELECT RLS):super_admin / admin(同org) / 開單人 / 開單人同部門(=工務部門) ──
CREATE OR REPLACE FUNCTION public._repair_order_visible(p_id integer)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_me int; v_role text; v_dept int; v_ro public.repair_orders;
BEGIN
  SELECT e.id, r.name, e.department_id INTO v_me, v_role, v_dept
    FROM public.employees e LEFT JOIN public.roles r ON r.id = e.role_id
   WHERE e.auth_user_id = auth.uid() LIMIT 1;
  IF v_me IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_ro FROM public.repair_orders WHERE id = p_id;
  IF v_ro.id IS NULL THEN RETURN false; END IF;
  IF v_role = 'super_admin' THEN RETURN true; END IF;
  IF v_role = 'admin' AND v_ro.organization_id = current_user_org_id() THEN RETURN true; END IF;
  RETURN v_ro.requester_id = v_me
      OR (v_dept IS NOT NULL AND v_ro.requester_department_id = v_dept);
END $function$;

ALTER TABLE public.repair_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS repair_orders_select ON public.repair_orders;
CREATE POLICY repair_orders_select ON public.repair_orders FOR SELECT
  USING (deleted_at IS NULL AND public._repair_order_visible(id));
-- 寫入一律走 SECURITY DEFINER RPC(不開放前端直寫)

-- ── 建立(actor 帶入;工務任何人可開) ──
CREATE OR REPLACE FUNCTION public._ro_create(
  p_actor int, p_handler_type text, p_occur_time timestamptz, p_location text,
  p_store_id int, p_title text, p_description text, p_need_purchase boolean,
  p_supplier text, p_quote_amount numeric, p_linked_work_order_id int
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_emp public.employees; v_dept text; v_row public.repair_orders;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  IF COALESCE(btrim(p_description),'') = '' THEN RETURN json_build_object('ok', false, 'error', 'MISSING_DESCRIPTION'); END IF;
  IF COALESCE(p_handler_type,'') NOT IN ('self','vendor') THEN RETURN json_build_object('ok', false, 'error', 'BAD_HANDLER_TYPE'); END IF;
  SELECT * INTO v_emp FROM public.employees WHERE id = p_actor;
  IF v_emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE'); END IF;
  SELECT name INTO v_dept FROM public.departments WHERE id = v_emp.department_id;
  INSERT INTO public.repair_orders (
    organization_id, requester_id, requester_name, requester_department_id, requester_department_name,
    handler_type, occur_time, location, store_id, title, description,
    need_purchase, supplier, quote_amount, linked_work_order_id, status
  ) VALUES (
    v_emp.organization_id, p_actor, v_emp.name, v_emp.department_id, v_dept,
    p_handler_type, p_occur_time, NULLIF(btrim(p_location),''), p_store_id, NULLIF(btrim(p_title),''), btrim(p_description),
    COALESCE(p_need_purchase,false), NULLIF(btrim(p_supplier),''), p_quote_amount, p_linked_work_order_id, '進行中'
  ) RETURNING * INTO v_row;
  RETURN json_build_object('ok', true, 'id', v_row.id);
END $function$;

-- ── 回報完工(閘門:有連到費用單且還在「申請中」→ 擋) ──
CREATE OR REPLACE FUNCTION public._ro_complete(
  p_id int, p_actor int, p_completed_at timestamptz, p_completion_note text
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ro public.repair_orders; v_pending int;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_ro FROM public.repair_orders WHERE id = p_id;
  IF v_ro.id IS NULL OR v_ro.deleted_at IS NOT NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT (_wo_actor_is_admin(p_actor) OR v_ro.requester_id = p_actor OR _wo_actor_dept(p_actor) = v_ro.requester_department_id) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF v_ro.status = '已完工' THEN RETURN json_build_object('ok', false, 'error', 'ALREADY_DONE'); END IF;
  IF v_ro.status = '已取消' THEN RETURN json_build_object('ok', false, 'error', 'CANCELLED'); END IF;
  -- 費用閘門:任一連到的費用單還在「申請中」→ 不能完工
  SELECT count(*) INTO v_pending FROM public.expense_requests
   WHERE repair_order_id = p_id AND deleted_at IS NULL AND status = '申請中';
  IF v_pending > 0 THEN RETURN json_build_object('ok', false, 'error', 'EXPENSE_PENDING'); END IF;
  UPDATE public.repair_orders
     SET status = '已完工', completed_at = COALESCE(p_completed_at, now()),
         completion_note = NULLIF(btrim(p_completion_note),''), updated_at = now()
   WHERE id = p_id;
  RETURN json_build_object('ok', true, 'status', '已完工');
END $function$;

-- ── 作廢 ──
CREATE OR REPLACE FUNCTION public._ro_cancel(p_id int, p_actor int)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_ro public.repair_orders;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_ro FROM public.repair_orders WHERE id = p_id;
  IF v_ro.id IS NULL OR v_ro.deleted_at IS NOT NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT (_wo_actor_is_admin(p_actor) OR v_ro.requester_id = p_actor) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF v_ro.status = '已完工' THEN RETURN json_build_object('ok', false, 'error', 'ALREADY_DONE'); END IF;
  UPDATE public.repair_orders SET status = '已取消', updated_at = now() WHERE id = p_id;
  RETURN json_build_object('ok', true, 'status', '已取消');
END $function$;

-- ── 費用單狀態 → 維修單狀態同步(只在 進行中↔待費用核准 間切,不碰 已完工/已取消) ──
CREATE OR REPLACE FUNCTION public._trg_sync_repair_from_expense()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_pending int; v_ro_status text; v_ro_id int;
BEGIN
  v_ro_id := COALESCE(NEW.repair_order_id, OLD.repair_order_id);
  IF v_ro_id IS NULL THEN RETURN NEW; END IF;
  SELECT status INTO v_ro_status FROM public.repair_orders WHERE id = v_ro_id;
  IF v_ro_status NOT IN ('進行中','待費用核准') THEN RETURN NEW; END IF;  -- 完工/取消不動
  SELECT count(*) INTO v_pending FROM public.expense_requests
   WHERE repair_order_id = v_ro_id AND deleted_at IS NULL AND status = '申請中';
  UPDATE public.repair_orders
     SET status = CASE WHEN v_pending > 0 THEN '待費用核准' ELSE '進行中' END, updated_at = now()
   WHERE id = v_ro_id AND status <> (CASE WHEN v_pending > 0 THEN '待費用核准' ELSE '進行中' END);
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_sync_repair_from_expense ON public.expense_requests;
CREATE TRIGGER trg_sync_repair_from_expense
  AFTER INSERT OR UPDATE OF status, repair_order_id, deleted_at ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_sync_repair_from_expense();

-- ── Web 薄殼(auth 走 current_employee_id) ──
CREATE OR REPLACE FUNCTION public.create_repair_order(
  p_handler_type text, p_occur_time timestamptz, p_location text, p_store_id int,
  p_title text, p_description text, p_need_purchase boolean, p_supplier text,
  p_quote_amount numeric, p_linked_work_order_id int
) RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public._ro_create(public.current_employee_id(), p_handler_type, p_occur_time, p_location,
    p_store_id, p_title, p_description, p_need_purchase, p_supplier, p_quote_amount, p_linked_work_order_id);
$function$;

CREATE OR REPLACE FUNCTION public.complete_repair_order(p_id int, p_completed_at timestamptz, p_completion_note text)
 RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT public._ro_complete(p_id, public.current_employee_id(), p_completed_at, p_completion_note); $function$;

CREATE OR REPLACE FUNCTION public.cancel_repair_order(p_id int)
 RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT public._ro_cancel(p_id, public.current_employee_id()); $function$;

REVOKE ALL ON FUNCTION public.create_repair_order(text,timestamptz,text,int,text,text,boolean,text,numeric,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_repair_order(int,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_repair_order(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_repair_order(text,timestamptz,text,int,text,text,boolean,text,numeric,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_repair_order(int,timestamptz,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_repair_order(int) TO authenticated;
