-- ════════════════════════════════════════════════════════════
-- 代班 邀請式流程
-- ────────────────────────────────────────────────────────────
-- 流程：
--   主管發代班需求（指定缺勤者、日期、班別）
--      → status='招募中'，LINE 推給所有候選人（同店、那天有空）
--   候選人按「我可以接」→ 第一個搶到的成立（原子操作）
--      → 自動 upsert schedules，LINE 通知主管 + 通知其他候選人「已成立」
--   主管隨時可取消 → LINE 通知未搶的人
--   超過 expires_at → 視為過期（client 端過濾，DB 不主動標記）
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ── Section 1. 新表 shift_cover_requests ────────────────

CREATE TABLE IF NOT EXISTS public.shift_cover_requests (
  id              SERIAL PRIMARY KEY,
  organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  store           TEXT,
  store_id        INT REFERENCES public.stores(id) ON DELETE SET NULL,

  -- 發起人（通常是店長/主管）
  requester_id    INT REFERENCES public.employees(id) ON DELETE SET NULL,
  requester_name  TEXT,

  -- 缺勤者（要被代班的人）
  absent_emp_id   INT REFERENCES public.employees(id) ON DELETE SET NULL,
  absent_emp_name TEXT,

  -- 班別資訊（snapshot）
  shift_date      DATE NOT NULL,
  shift_label     TEXT,                       -- 例如 11~20 或 早班
  actual_start    TIME,
  actual_end      TIME,
  actual_hours    NUMERIC,

  -- 邀請的候選人（同店、當天有空，client 端依此推 LINE）
  invited_emp_ids INT[] DEFAULT '{}',

  reason          TEXT,
  status          TEXT NOT NULL DEFAULT '招募中',  -- 招募中 / 已成立 / 已取消
  expires_at      TIMESTAMPTZ,

  -- 認領者
  claimed_by_emp_id INT REFERENCES public.employees(id) ON DELETE SET NULL,
  claimed_by_name   TEXT,
  claimed_at        TIMESTAMPTZ,

  cancel_reason   TEXT,
  cancelled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cover_open
  ON public.shift_cover_requests(store_id, shift_date) WHERE status = '招募中';
CREATE INDEX IF NOT EXISTS idx_cover_org_status
  ON public.shift_cover_requests(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_cover_invited_gin
  ON public.shift_cover_requests USING GIN(invited_emp_ids);


-- ── Section 2. RPC: 列當日同店、有空的候選人 ─────────────

DROP FUNCTION IF EXISTS public.liff_list_eligible_cover_candidates(text, text, date);
CREATE OR REPLACE FUNCTION public.liff_list_eligible_cover_candidates(
  p_line_user_id text,
  p_store        text,
  p_date         date
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::jsonb; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('emp_id', e.id, 'name', e.name) ORDER BY e.name)
    FROM public.employees e
   WHERE e.organization_id = emp.organization_id
     AND e.status = '在職'
     AND COALESCE(e.store, '') = p_store
     AND NOT EXISTS (
       SELECT 1 FROM public.schedules s
        WHERE s.date = p_date
          AND (s.employee_id = e.id OR s.employee = e.name)
          AND s.shift IS NOT NULL AND s.shift <> ''
     )
  ), '[]'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_eligible_cover_candidates(text, text, date)
  TO authenticated, anon;


-- ── Section 3. RPC: 主管發代班需求 ───────────────────────

DROP FUNCTION IF EXISTS public.liff_post_cover_request(text, jsonb);
CREATE OR REPLACE FUNCTION public.liff_post_cover_request(
  p_line_user_id text,
  p_payload      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp           employees;
  v_absent      employees;
  v_date        DATE;
  v_a_sched     record;
  v_store       TEXT;
  v_store_id    INT;
  v_invited     INT[];
  v_expires     TIMESTAMPTZ;
  new_id        INT;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  v_date := (p_payload->>'shift_date')::date;
  IF v_date IS NULL OR v_date < CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_DATE');
  END IF;

  SELECT * INTO v_absent FROM public.employees WHERE id = (p_payload->>'absent_emp_id')::int;
  IF v_absent.id IS NULL OR v_absent.organization_id <> emp.organization_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ABSENT_EMP_NOT_FOUND');
  END IF;

  -- 抓缺勤者的班別 snapshot
  SELECT shift, store, actual_start, actual_end, actual_hours INTO v_a_sched
    FROM public.schedules
   WHERE date = v_date
     AND (employee_id = v_absent.id OR employee = v_absent.name)
   LIMIT 1;
  IF v_a_sched.shift IS NULL OR v_a_sched.shift = '休' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ABSENT_NO_SHIFT');
  END IF;

  v_store := COALESCE(v_a_sched.store, v_absent.store);
  SELECT id INTO v_store_id FROM public.stores
   WHERE name = v_store AND organization_id = emp.organization_id LIMIT 1;

  -- 主管權限（店長 OR schedule.edit/approve）
  IF NOT (
    EXISTS (SELECT 1 FROM public.stores WHERE id = v_store_id AND manager_id = emp.id)
    OR public.liff_employee_has_permission(emp.id, 'schedule.edit')
    OR public.liff_employee_has_permission(emp.id, 'schedule.approve')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  -- 找候選人（同店、當天無班、不是缺勤者本人）
  SELECT array_agg(e.id) INTO v_invited
    FROM public.employees e
   WHERE e.organization_id = emp.organization_id
     AND e.status = '在職'
     AND COALESCE(e.store, '') = v_store
     AND e.id <> v_absent.id
     AND NOT EXISTS (
       SELECT 1 FROM public.schedules s
        WHERE s.date = v_date
          AND (s.employee_id = e.id OR s.employee = e.name)
          AND s.shift IS NOT NULL AND s.shift <> ''
     );

  IF v_invited IS NULL OR array_length(v_invited, 1) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_CANDIDATES');
  END IF;

  -- 預設過期時間 24h
  v_expires := COALESCE(
    NULLIF(p_payload->>'expires_at','')::timestamptz,
    now() + interval '24 hours'
  );

  INSERT INTO public.shift_cover_requests (
    organization_id, store, store_id,
    requester_id, requester_name,
    absent_emp_id, absent_emp_name,
    shift_date, shift_label, actual_start, actual_end, actual_hours,
    invited_emp_ids, reason, status, expires_at
  )
  VALUES (
    emp.organization_id, v_store, v_store_id,
    emp.id, emp.name,
    v_absent.id, v_absent.name,
    v_date, v_a_sched.shift, v_a_sched.actual_start, v_a_sched.actual_end, v_a_sched.actual_hours,
    v_invited, NULLIF(p_payload->>'reason',''), '招募中', v_expires
  )
  RETURNING id INTO new_id;

  RETURN jsonb_build_object(
    'ok', true,
    'id', new_id,
    'invited_emp_ids', to_jsonb(v_invited),
    'shift_label', v_a_sched.shift,
    'shift_date', v_date,
    'absent_emp_name', v_absent.name
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_post_cover_request(text, jsonb) TO authenticated, anon;


-- ── Section 4. RPC: 候選人列出可接的代班 ────────────────

DROP FUNCTION IF EXISTS public.liff_list_open_cover_requests(text);
CREATE OR REPLACE FUNCTION public.liff_list_open_cover_requests(p_line_user_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::jsonb; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(cr.*) ORDER BY cr.shift_date ASC, cr.created_at DESC)
    FROM public.shift_cover_requests cr
   WHERE cr.organization_id = emp.organization_id
     AND cr.status = '招募中'
     AND emp.id = ANY(cr.invited_emp_ids)
     AND cr.shift_date >= CURRENT_DATE
     AND (cr.expires_at IS NULL OR cr.expires_at > now())
  ), '[]'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_open_cover_requests(text) TO authenticated, anon;


-- ── Section 5. RPC: 認領（原子操作） ────────────────────

DROP FUNCTION IF EXISTS public.liff_claim_cover_request(text, int);
CREATE OR REPLACE FUNCTION public.liff_claim_cover_request(
  p_line_user_id text,
  p_id           int
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp        employees;
  v_claimed  record;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 雙保險：同一筆只能成立一次（原子）
  UPDATE public.shift_cover_requests
     SET status = '已成立',
         claimed_by_emp_id = emp.id,
         claimed_by_name = emp.name,
         claimed_at = now()
   WHERE id = p_id
     AND status = '招募中'
     AND emp.id = ANY(invited_emp_ids)
     AND (expires_at IS NULL OR expires_at > now())
   RETURNING * INTO v_claimed;

  IF v_claimed.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TOO_LATE_OR_NOT_ELIGIBLE');
  END IF;

  -- 認領者是否當天已有班？(雙重檢查)
  IF EXISTS (
    SELECT 1 FROM public.schedules
     WHERE date = v_claimed.shift_date
       AND (employee_id = emp.id OR employee = emp.name)
       AND shift IS NOT NULL AND shift <> '' AND shift <> '休'
  ) THEN
    -- rollback 認領
    UPDATE public.shift_cover_requests
       SET status = '招募中', claimed_by_emp_id = NULL, claimed_by_name = NULL, claimed_at = NULL
     WHERE id = p_id;
    RETURN jsonb_build_object('ok', false, 'error', 'YOU_ALREADY_HAVE_SHIFT');
  END IF;

  -- 寫入/覆蓋認領者的 schedules
  -- 用 UPSERT 處理「原本是 休 / 沒排班」兩種情況
  INSERT INTO public.schedules (
    employee, employee_id, date, shift, store,
    actual_start, actual_end, actual_hours, organization_id
  )
  VALUES (
    emp.name, emp.id, v_claimed.shift_date, v_claimed.shift_label, v_claimed.store,
    v_claimed.actual_start, v_claimed.actual_end, v_claimed.actual_hours,
    v_claimed.organization_id
  )
  ON CONFLICT (employee, date) DO UPDATE SET
    shift = EXCLUDED.shift,
    actual_start = EXCLUDED.actual_start,
    actual_end = EXCLUDED.actual_end,
    actual_hours = EXCLUDED.actual_hours,
    employee_id = EXCLUDED.employee_id,
    store = COALESCE(public.schedules.store, EXCLUDED.store);

  RETURN jsonb_build_object(
    'ok', true,
    'requester_emp_id', v_claimed.requester_id,
    'absent_emp_name', v_claimed.absent_emp_name,
    'shift_date', v_claimed.shift_date,
    'shift_label', v_claimed.shift_label,
    'invited_emp_ids', to_jsonb(v_claimed.invited_emp_ids),
    'claimer_name', emp.name
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_claim_cover_request(text, int) TO authenticated, anon;


-- ── Section 6. RPC: 主管 取消 ───────────────────────────

DROP FUNCTION IF EXISTS public.liff_cancel_cover_request(text, int, text);
CREATE OR REPLACE FUNCTION public.liff_cancel_cover_request(
  p_line_user_id text,
  p_id           int,
  p_reason       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp     employees;
  v_cr    record;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO v_cr FROM public.shift_cover_requests WHERE id = p_id;
  IF v_cr.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;

  IF v_cr.status <> '招募中' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_CLOSED');
  END IF;

  -- 必須是 發起人 OR 店長 OR 有 schedule.edit
  IF NOT (
    v_cr.requester_id = emp.id
    OR EXISTS (SELECT 1 FROM public.stores WHERE id = v_cr.store_id AND manager_id = emp.id)
    OR public.liff_employee_has_permission(emp.id, 'schedule.edit')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  UPDATE public.shift_cover_requests
     SET status = '已取消',
         cancel_reason = NULLIF(btrim(p_reason),''),
         cancelled_at = now()
   WHERE id = p_id;

  RETURN jsonb_build_object(
    'ok', true,
    'invited_emp_ids', to_jsonb(v_cr.invited_emp_ids),
    'shift_date', v_cr.shift_date,
    'shift_label', v_cr.shift_label
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_cancel_cover_request(text, int, text) TO authenticated, anon;


-- ── Section 7. RPC: 主管 列我發的代班 ───────────────────

DROP FUNCTION IF EXISTS public.liff_list_my_cover_requests(text);
CREATE OR REPLACE FUNCTION public.liff_list_my_cover_requests(p_line_user_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::jsonb; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(cr.*) ORDER BY cr.created_at DESC)
    FROM public.shift_cover_requests cr
   WHERE cr.organization_id = emp.organization_id
     AND cr.requester_id = emp.id
  ), '[]'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_my_cover_requests(text) TO authenticated, anon;

COMMIT;
