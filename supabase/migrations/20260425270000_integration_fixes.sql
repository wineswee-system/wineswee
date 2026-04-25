-- ============================================================
-- Integration Audit 修補包（DB 部分）
--
-- 1. workflow_instances 加 trigger_depth + triggered_by_instance_id
--    防止「A 完成觸發 B、B 完成觸發 A」無限迴圈
--
-- 2. task_confirmations + approval_forms 加 organization_id
--    多租戶資料隔離
--
-- 3. secure_update_leave_status RPC 升級
--    核准時自動 UPDATE leave_balances.used_days
--    （之前完全沒做，員工看到的剩餘天數會錯）
--
-- 4. Trigger：task_confirmations 全部回應後自動更新 task.confirmation_status
--    （之前 UI 顯示已回應但 task 本身狀態沒動）
--
-- 5. liff_list_team_leaves_in_month / liff_list_my_leaves_in_range
--    改用 employee_id 而非 employee text name 比對
--    （之前同名員工跨租戶會撞）
-- ============================================================


-- ═══ 1. workflow_instances 加迴圈防護欄位 ═══
ALTER TABLE public.workflow_instances
  ADD COLUMN IF NOT EXISTS trigger_depth          INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS triggered_by_instance_id INT REFERENCES public.workflow_instances(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wf_inst_triggered_by
  ON public.workflow_instances(triggered_by_instance_id)
  WHERE triggered_by_instance_id IS NOT NULL;

COMMENT ON COLUMN public.workflow_instances.trigger_depth IS
  '此實例由「完成時觸發 SOP」連鎖建立的深度。0=手動部署，1=被別人觸發，2=被觸發者再觸發... 上限 5。';


-- ═══ 2. task_confirmations + approval_forms 加 organization_id ═══
ALTER TABLE public.task_confirmations
  ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL;

ALTER TABLE public.approval_forms
  ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL;

-- backfill via task / employee FK
UPDATE public.task_confirmations tc
SET organization_id = t.organization_id
FROM public.tasks t
WHERE tc.task_id = t.id
  AND tc.organization_id IS NULL
  AND t.organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_conf_org ON public.task_confirmations(organization_id);
CREATE INDEX IF NOT EXISTS idx_approval_forms_org ON public.approval_forms(organization_id);


-- ═══ 3. secure_update_leave_status RPC 升級：核准時更新 leave_balances ═══
CREATE OR REPLACE FUNCTION public.secure_update_leave_status(
  p_id            INT,
  p_status        TEXT,
  p_approver      TEXT,
  p_reject_reason TEXT DEFAULT NULL
) RETURNS leave_requests
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid     INT;
  v_current leave_requests;
  v_result  leave_requests;
  v_year    INT;
  v_used_delta NUMERIC;
  v_lb_type TEXT;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '未設定租戶'; END IF;

  SELECT * INTO v_current FROM leave_requests WHERE id = p_id AND organization_id = v_tid;
  IF NOT FOUND THEN RAISE EXCEPTION '假單不存在或無權限：%', p_id; END IF;

  IF v_current.status <> '待審核' THEN
    RAISE EXCEPTION '此假單已為「%」狀態，不可再變更', v_current.status;
  END IF;
  IF p_status NOT IN ('已核准', '已駁回', '已拒絕') THEN
    RAISE EXCEPTION '狀態只可為「已核准」/「已駁回」/「已拒絕」';
  END IF;
  IF p_status IN ('已駁回', '已拒絕') AND (p_reject_reason IS NULL OR p_reject_reason = '') THEN
    RAISE EXCEPTION '駁回時必須填寫原因';
  END IF;

  UPDATE leave_requests SET
    status        = p_status,
    approver      = p_approver,
    reject_reason = CASE WHEN p_status IN ('已駁回', '已拒絕') THEN p_reject_reason ELSE NULL END
  WHERE id = p_id
  RETURNING * INTO v_result;

  -- ★ 核准時：更新 leave_balances.used_days
  --   leave_requests.type 存的是 shortName（特休/病假/事假...）
  --   leave_balances.leave_type 應與其一致；若客戶用 code (annual/sick) 也試 fallback
  IF p_status = '已核准' AND v_result.employee_id IS NOT NULL AND v_result.days IS NOT NULL THEN
    v_year := EXTRACT(YEAR FROM v_result.start_date)::INT;
    v_used_delta := v_result.days;
    -- 嘗試直接用 type 比對（shortName 路徑）
    UPDATE leave_balances
       SET used_days = COALESCE(used_days, 0) + v_used_delta,
           updated_at = NOW()
     WHERE employee_id = v_result.employee_id
       AND year = v_year
       AND leave_type = v_result.type;
    -- 若沒命中，試 mapping 到 code（demo 環境若用 code 種子資料）
    IF NOT FOUND THEN
      v_lb_type := CASE v_result.type
        WHEN '特休' THEN 'annual'
        WHEN '病假' THEN 'sick'
        WHEN '事假' THEN 'personal'
        WHEN '婚假' THEN 'marriage'
        WHEN '喪假' THEN 'bereavement'
        WHEN '產假' THEN 'maternity'
        WHEN '陪產假' THEN 'paternity'
        WHEN '生理假' THEN 'menstrual'
        WHEN '家庭照顧假' THEN 'family'
        WHEN '公假' THEN 'official'
        WHEN '公傷假' THEN 'injury'
        ELSE v_result.type
      END;
      UPDATE leave_balances
         SET used_days = COALESCE(used_days, 0) + v_used_delta,
             updated_at = NOW()
       WHERE employee_id = v_result.employee_id
         AND year = v_year
         AND leave_type = v_lb_type;
    END IF;
  END IF;

  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.secure_update_leave_status(INT, TEXT, TEXT, TEXT) TO authenticated;


-- ═══ 4. Trigger：task_confirmations 全部回應後自動更新 task.confirmation_status ═══
CREATE OR REPLACE FUNCTION public.trg_sync_task_confirmation_status()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total      INT;
  v_done       INT;
  v_rejected   INT;
  v_new_status TEXT;
BEGIN
  -- 算該 task 所有確認的回應狀態
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status IN ('approved','rejected')),
         COUNT(*) FILTER (WHERE status = 'rejected')
    INTO v_total, v_done, v_rejected
    FROM task_confirmations
   WHERE task_id = NEW.task_id;

  IF v_total = 0 THEN RETURN NEW; END IF;
  IF v_done < v_total THEN RETURN NEW; END IF;

  -- 全部回應完才更新 task：有人 reject 即 rejected，否則 approved
  v_new_status := CASE WHEN v_rejected > 0 THEN 'rejected' ELSE 'approved' END;

  UPDATE tasks SET
    confirmation_status = v_new_status,
    confirmation_responded_at = NOW()
  WHERE id = NEW.task_id;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS task_confirmation_sync ON public.task_confirmations;
CREATE TRIGGER task_confirmation_sync
  AFTER UPDATE OF status ON public.task_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_task_confirmation_status();

-- 確保 tasks 有相關欄位（若無則加，IF NOT EXISTS 安全跳過）
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS confirmation_status      TEXT,
  ADD COLUMN IF NOT EXISTS confirmation_responded_at TIMESTAMPTZ;


-- ═══ 5. liff_list_my_leaves_in_range 改用 employee_id ═══
CREATE OR REPLACE FUNCTION public.liff_list_my_leaves_in_range(
  p_line_user_id text,
  p_from         date,
  p_to           date
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  RETURN json_build_object(
    'ok',     true,
    'leaves', (
      SELECT COALESCE(json_agg(json_build_object(
        'id',            l.id,
        'type',          l.type,
        'start_date',    l.start_date,
        'end_date',      l.end_date,
        'days',          l.days,
        'hours',         l.hours,
        'reason',        l.reason,
        'status',        l.status,
        'approver',      l.approver,
        'reject_reason', l.reject_reason,
        'created_at',    l.created_at
      ) ORDER BY l.start_date DESC), '[]'::json)
      FROM public.leave_requests l
      -- ★ 用 employee_id（強型別 FK），fallback name（舊資料無 employee_id 時）
      WHERE (l.employee_id = emp.id OR (l.employee_id IS NULL AND l.employee = emp.name))
        AND l.start_date <= p_to
        AND l.end_date   >= p_from
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_my_leaves_in_range(text, date, date) TO anon, authenticated;


-- ═══ 5b. liff_list_team_leaves_in_month 也用 employee_id ═══
CREATE OR REPLACE FUNCTION public.liff_list_team_leaves_in_month(
  p_line_user_id text,
  p_year_month   text
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp         employees;
  month_start date;
  month_end   date;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  BEGIN
    month_start := (p_year_month || '-01')::date;
    month_end   := (month_start + INTERVAL '1 month - 1 day')::date;
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_MONTH_FORMAT');
  END;

  RETURN json_build_object(
    'ok',     true,
    'month',  p_year_month,
    'leaves', (
      SELECT COALESCE(json_agg(json_build_object(
        'employee',   l.employee,
        'type',       l.type,
        'start_date', l.start_date,
        'end_date',   l.end_date,
        'days',       l.days,
        -- ★ is_me 用 employee_id 比對
        'is_me',      (l.employee_id = emp.id)
      ) ORDER BY l.start_date, l.employee), '[]'::json)
      FROM public.leave_requests l
      WHERE l.status = '已核准'
        AND l.organization_id = emp.organization_id
        AND l.start_date <= month_end
        AND l.end_date   >= month_start
        -- ★ 同部門 / 同店 / 自己（用 employee_id 強型別比對；fallback 舊資料 name）
        AND (
          l.employee_id = emp.id
          OR EXISTS (
            SELECT 1 FROM public.employees e2
            WHERE (e2.id = l.employee_id OR (l.employee_id IS NULL AND e2.name = l.employee))
              AND e2.organization_id = emp.organization_id
              AND (e2.dept = emp.dept OR e2.store_id = emp.store_id)
          )
        )
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_team_leaves_in_month(text, text) TO anon, authenticated;
