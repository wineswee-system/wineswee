-- Phase 0 RPC 稽核:DEFINER 函式吃 id 卻沒比對 org → 跨租戶洩漏(薪資/PII/簽核鏈)。
-- 加共用守門 _same_org_or_super(),在函式撈到記錄後擋跨租戶(service_role/super_admin 放行)。
-- 已確認並修:calc_severance / _employee_avg_monthly_wage / get_employee_offboarding_items / get_expense_request_chain_full。

CREATE OR REPLACE FUNCTION public._same_org_or_super(p_target_org int) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $g$ SELECT p_target_org IS NULL OR auth.role()='service_role' OR public.is_super_admin() OR p_target_org = public.current_employee_org(); $g$;

-- ── _employee_avg_monthly_wage (已含 _same_org_or_super 守門) ──
CREATE OR REPLACE FUNCTION public._employee_avg_monthly_wage(p_emp_id integer, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v     numeric;
  v_emp public.employees;
BEGIN
  IF NOT public._same_org_or_super((SELECT organization_id FROM public.employees WHERE id=p_emp_id)) THEN RETURN NULL; END IF;
  -- ① salary_records 近6個月均(已發布實薪,最可靠;含主管/職務/伙食/交通,不含加班)
  SELECT AVG(COALESCE(base_salary,0) + COALESCE(role_allowance,0)
           + COALESCE(meal_allowance,0) + COALESCE(transport_allowance,0))
    INTO v
    FROM public.salary_records
   WHERE employee_id = p_emp_id
     AND base_salary > 0
     AND month >= to_char(p_as_of - INTERVAL '6 months', 'YYYY-MM')
     AND month <  to_char(p_as_of, 'YYYY-MM');
  IF v IS NOT NULL AND v > 0 THEN RETURN ROUND(v, 2); END IF;

  -- ② salary_structures 最新
  SELECT COALESCE(base_salary,0) + COALESCE(supervisor_allowance,0) + COALESCE(role_allowance,0)
       + COALESCE(meal_allowance,0) + COALESCE(transport_allowance,0)
    INTO v
    FROM public.salary_structures
   WHERE employee_id = p_emp_id
   ORDER BY effective_from DESC NULLS LAST, id DESC
   LIMIT 1;
  IF v IS NOT NULL AND v > 0 THEN RETURN ROUND(v, 2); END IF;

  -- ③ employees 主檔
  SELECT * INTO v_emp FROM public.employees WHERE id = p_emp_id;
  RETURN COALESCE(v_emp.base_salary,0) + COALESCE(v_emp.meal_allowance,0) + COALESCE(v_emp.transport_allowance,0);
END $function$
;

-- ── calc_severance (已含 _same_org_or_super 守門) ──
CREATE OR REPLACE FUNCTION public.calc_severance(p_employee_id integer, p_termination_date date, p_avg_wage_override numeric DEFAULT NULL::numeric)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp                employees;
  v_service_days       INT;
  v_service_years      NUMERIC;
  v_yy                 INT;
  v_mm                 INT;
  v_dd                 INT;
  v_avg_wage           NUMERIC;
  v_severance_months   NUMERIC;
  v_severance_amount   NUMERIC;
  v_notice_days        INT;
  v_notice_wage        NUMERIC;
  v_total              NUMERIC;
  v_payroll_avg        NUMERIC;
  v_struct_base        NUMERIC;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id;
  IF v_emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;
  IF NOT public._same_org_or_super(v_emp.organization_id) THEN RETURN json_build_object('ok',false,'error','CROSS_TENANT_DENIED'); END IF;
  IF v_emp.join_date IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_JOIN_DATE',
                             'message', '此員工沒設到職日，無法計算服務年資');
  END IF;
  IF p_termination_date <= v_emp.join_date THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_TERMINATION_DATE',
                             'message', '離職日不可早於到職日');
  END IF;

  -- 服務年資：年/月/天月曆分解（含到職當日 → age 用 離職日+1），對齊勞動部
  --   年資 = 年 + (月 + 天/30) / 12
  v_yy := EXTRACT(YEAR  FROM age(p_termination_date + 1, v_emp.join_date));
  v_mm := EXTRACT(MONTH FROM age(p_termination_date + 1, v_emp.join_date));
  v_dd := EXTRACT(DAY   FROM age(p_termination_date + 1, v_emp.join_date));
  v_service_days  := (p_termination_date - v_emp.join_date) + 1;   -- 含到職當日
  v_service_years := ROUND(v_yy + (v_mm + v_dd / 30.0) / 12.0, 6);

  -- 平均工資：撈離職前 6 個月 payroll_records.gross_salary 平均
  -- pay_period 格式 'YYYY-MM'
  IF p_avg_wage_override IS NOT NULL AND p_avg_wage_override > 0 THEN
    v_avg_wage := p_avg_wage_override;
  ELSE
    SELECT AVG(gross_salary) INTO v_payroll_avg
      FROM payroll_records
     WHERE employee_id = p_employee_id
       AND gross_salary > 0
       AND pay_period >= to_char(p_termination_date - INTERVAL '6 months', 'YYYY-MM')
       AND pay_period <  to_char(p_termination_date, 'YYYY-MM');

    IF v_payroll_avg IS NOT NULL AND v_payroll_avg > 0 THEN
      v_avg_wage := ROUND(v_payroll_avg, 2);
    ELSE
      -- fallback 到 salary_structures.base_salary
      SELECT base_salary INTO v_struct_base
        FROM salary_structures
       WHERE employee_id = p_employee_id
       ORDER BY effective_from DESC NULLS LAST, id DESC
       LIMIT 1;
      v_avg_wage := COALESCE(v_struct_base, 0);
    END IF;
  END IF;

  -- 資遣月數 = min(服務年資 × 0.5, 6)；資遣金無條件進位到整數
  v_severance_months := LEAST(v_service_years * 0.5, 6.0);
  v_severance_amount := CEIL(v_severance_months * v_avg_wage);

  -- 預告天數（勞基法 16 條）
  IF v_service_days < 90 THEN
    v_notice_days := 0;  -- 未滿 3 個月不需預告
  ELSIF v_service_years < 1 THEN
    v_notice_days := 10;
  ELSIF v_service_years < 3 THEN
    v_notice_days := 20;
  ELSE
    v_notice_days := 30;
  END IF;

  -- 預告工資（如未實際預告才付）：日薪 × 預告天數；無條件進位
  -- 日薪以「平均月薪 ÷ 30」估算
  v_notice_wage := CEIL(v_avg_wage / 30 * v_notice_days);

  v_total := v_severance_amount + v_notice_wage;

  RETURN json_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'employee_name', v_emp.name,
    'employee_number', v_emp.employee_number,
    'join_date', v_emp.join_date,
    'termination_date', p_termination_date,
    'service_days', v_service_days,
    'service_years', v_service_years,
    'service_label', v_yy::text || ' 年 ' || v_mm::text || ' 個月 ' || v_dd::text || ' 天',
    'average_monthly_wage', v_avg_wage,
    'avg_wage_source', CASE
      WHEN p_avg_wage_override IS NOT NULL THEN 'manual'
      WHEN v_payroll_avg IS NOT NULL THEN 'payroll_6m_avg'
      ELSE 'salary_structure'
    END,
    'severance_months', v_severance_months,
    'severance_amount', v_severance_amount,
    'notice_days', v_notice_days,
    'notice_wage', v_notice_wage,
    'total_amount', v_total
  );
END $function$
;

-- ── get_employee_offboarding_items (已含 _same_org_or_super 守門) ──
CREATE OR REPLACE FUNCTION public.get_employee_offboarding_items(p_emp_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp        public.employees;
  v_steps      JSONB;
  v_snapshots  JSONB;
  v_stores     JSONB;
  v_depts      JSONB;
  v_sections   JSONB;
  v_extras     INT;
  v_tasks      INT;
  v_subs       JSONB;
  v_shifts     INT;
BEGIN
  SELECT * INTO v_emp FROM public.employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL THEN RETURN NULL; END IF;
  IF NOT public._same_org_or_super(v_emp.organization_id) THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', cs.id, 'chain_id', cs.chain_id, 'chain_name', ac.name,
    'label', COALESCE(cs.label, cs.role_name, '第' || (cs.step_order + 1) || '關'),
    'step_order', cs.step_order
  ) ORDER BY ac.name, cs.step_order), '[]'::jsonb)
  INTO v_steps
  FROM public.approval_chain_steps cs
  JOIN public.approval_chains ac ON ac.id = cs.chain_id
  WHERE cs.target_type = 'fixed_emp' AND cs.target_emp_id = p_emp_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'request_type', s.request_type, 'request_id', s.request_id,
    'step_order', s.step_order, 'label', COALESCE(s.label, s.role_name)
  ) ORDER BY s.snapshotted_at DESC), '[]'::jsonb)
  INTO v_snapshots
  FROM public.request_chain_snapshots s
  WHERE s.target_emp_id = p_emp_id AND s.target_type = 'fixed_emp'
    AND s.snapshotted_at > NOW() - INTERVAL '90 days';

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name)), '[]'::jsonb)
  INTO v_stores FROM public.stores s WHERE s.manager_id = p_emp_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name)), '[]'::jsonb)
  INTO v_depts FROM public.departments d WHERE d.manager_id = p_emp_id;

  -- ★ 新增：課別督導
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', ds.id, 'name', ds.name)), '[]'::jsonb)
  INTO v_sections FROM public.department_sections ds WHERE ds.supervisor_id = p_emp_id;

  -- ★ 新增：待他處理的加簽
  SELECT COUNT(*) INTO v_extras
  FROM public.approval_extra_steps WHERE assignee_id = p_emp_id AND status = 'pending';

  -- ★ 新增：名下未完成任務
  SELECT COUNT(*) INTO v_tasks
  FROM public.tasks WHERE assignee_id = p_emp_id AND status IN ('進行中','待簽核','待確認');

  -- ★ 新增：直屬下屬
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name)), '[]'::jsonb)
  INTO v_subs FROM public.employees e
  WHERE e.status = '在職' AND (e.supervisor_id = p_emp_id OR e.reporting_to = p_emp_id);

  SELECT COUNT(*) INTO v_shifts
  FROM public.schedules WHERE employee = v_emp.name AND date >= CURRENT_DATE;

  RETURN jsonb_build_object(
    'employee',          jsonb_build_object('id', v_emp.id, 'name', v_emp.name),
    'chain_steps',       v_steps,
    'snapshots',         v_snapshots,
    'managed_stores',    v_stores,
    'managed_depts',     v_depts,
    'managed_sections',  v_sections,       -- ★
    'extra_signs',       v_extras,         -- ★
    'tasks',             v_tasks,          -- ★
    'subordinates',      v_subs,           -- ★
    'upcoming_shifts',   v_shifts
  );
END $function$
;

-- ── get_expense_request_chain_full (已含 _same_org_or_super 守門) ──
CREATE OR REPLACE FUNCTION public.get_expense_request_chain_full(p_id integer, p_applicant_emp_id integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req            expense_requests;
  v_app_id         INT;
  v_status_eff     TEXT;              -- 主鏈用：待核銷→已核准（其餘照舊）
  v_chain          json;             -- 主鏈步驟（building block 解析過 names）
  v_timeline       json;             -- 主鏈 timeline
  v_total          INT;
  v_cur            INT;
  v_main           json := '[]'::json;
  v_sup            jsonb;
  -- 核銷
  v_in_settle      boolean;
  v_is_settled     boolean;
  v_settle_cur     INT;
  v_settle_tl      json;
  v_settle_chain   json;
  v_has_settle_snap boolean;
  v_settle_steps   json := '[]'::json;
  v_settle_start   TIMESTAMPTZ;
  v_interval       TEXT;
  v_diff           BIGINT;
  v_final          jsonb;
BEGIN
  SELECT * INTO v_req FROM expense_requests WHERE id = p_id;
  IF v_req.id IS NULL THEN RETURN '[]'::json; END IF;
  IF NOT public._same_org_or_super(v_req.organization_id) THEN RETURN '[]'::json; END IF;

  v_app_id     := COALESCE(p_applicant_emp_id, v_req.employee_id);
  v_status_eff := CASE WHEN v_req.status IN ('待核銷','核銷已退回') THEN '已核准' ELSE v_req.status END;

  -- ════════════════════════════════════════════════════════════════════════
  -- 1) 主鏈 baseSteps
  -- ════════════════════════════════════════════════════════════════════════
  IF v_req.approval_chain_id IS NULL THEN
    -- ── 無 chain fallback（buildChainBasedSteps 133-141）──
    IF v_status_eff IN ('已核准','已核銷') THEN
      v_sup := jsonb_build_object('label','主管核示','name',COALESCE(v_req.approved_by,''),
                                  'status','completed','completedAt', v_req.approved_at);
    ELSIF v_status_eff IN ('已駁回','已拒絕','已退回') THEN
      v_sup := jsonb_build_object('label','主管核示','name',COALESCE(v_req.approved_by,''),
                                  'status','rejected','rejectReason', v_req.reject_reason);
    ELSE
      v_sup := jsonb_build_object('label','主管核示','name','','status','current');
    END IF;

    v_main := (jsonb_build_array(
      jsonb_build_object('label','申請人','name',COALESCE(v_req.employee,'—'),
                         'status','completed','completedAt', v_req.created_at, 'isApplicant', true),
      v_sup
    ))::json;

  ELSE
    -- ── 有 chain：snapshot 優先，fallback live（buildChainBasedSteps 161-203）──
    v_chain := public.get_request_chain_display_names('expense_request', p_id, v_app_id);
    IF v_chain IS NULL OR json_array_length(v_chain) = 0 THEN
      v_chain := public.get_chain_step_display_names(v_req.approval_chain_id, v_app_id);
    END IF;
    IF v_chain IS NULL THEN v_chain := '[]'::json; END IF;

    v_total := json_array_length(v_chain);
    v_cur   := COALESCE(v_req.current_step, 0);
    IF v_cur < 0 THEN v_cur := 0;
    ELSIF v_cur > v_total + 1 THEN v_cur := v_total + 1; END IF;     -- clamp（buildChainBasedSteps 208-215）

    v_timeline := public.get_approval_timeline('expense_request', p_id);

    -- 申請人 cell + chain steps + 加簽 step，用 sort_key 排序（mergeExtraSteps 324-339）
    SELECT COALESCE(json_agg(obj ORDER BY sort_key, seq), '[]'::json)
      INTO v_main
    FROM (
      -- 申請人（order -1）
      SELECT (-1)::numeric AS sort_key, 0 AS seq,
        jsonb_build_object('label','申請人','name',COALESCE(v_req.employee,'—'),
                           'status','completed','completedAt', v_req.created_at, 'isApplicant', true) AS obj

      UNION ALL

      -- chain steps（order = step_order）
      SELECT cs.step_order::numeric, 0,
        jsonb_build_object(
          'label',         cs.label,
          'name',          cs.target_name,
          'target_emp_id', cs.target_emp_id,
          'role_name',     cs.role_name,
          'status',        cs.status,
          'completedAt',   cs.completed_at,
          'completedBy',   CASE WHEN cs.status = 'completed' THEN cs.target_name ELSE NULL END,
          'rejectReason',  CASE WHEN cs.status = 'rejected' THEN v_req.reject_reason ELSE '' END,
          'durationText',  cs.duration_text
        )
      FROM (
        SELECT
          c.step_order, c.label, c.role_name, c.target_emp_id, c.target_name, c.status,
          -- timeline 覆蓋（openDetail 443-452）：exited_at 有 + status completed/rejected
          CASE WHEN tl.exited_at IS NOT NULL AND c.status IN ('completed','rejected')
               THEN tl.duration_text ELSE NULL END AS duration_text,
          CASE WHEN tl.exited_at IS NOT NULL AND c.status IN ('completed','rejected')
               THEN tl.exited_at
               WHEN c.status = 'completed' AND c.step_order = v_total - 1
               THEN v_req.approved_at
               ELSE NULL END AS completed_at
        FROM (
          SELECT
            (e->>'step_order')::int AS step_order,
            e->>'label'             AS label,
            e->>'role_name'         AS role_name,
            NULLIF(e->>'target_emp_id','')::int AS target_emp_id,
            -- targetName = names || (target_emp_id ? approverMap : role_name)（buildChainBasedSteps 226）
            COALESCE(
              NULLIF(e->>'names',''),
              CASE WHEN NULLIF(e->>'target_emp_id','') IS NOT NULL
                   THEN COALESCE(emp.name,'') ELSE COALESCE(e->>'role_name','') END
            ) AS target_name,
            -- 狀態（buildChainBasedSteps 219-225）
            CASE
              WHEN v_status_eff IN ('已駁回','已拒絕','已退回') THEN
                CASE WHEN (e->>'step_order')::int = v_cur THEN 'rejected'
                     WHEN (e->>'step_order')::int < v_cur THEN 'completed'
                     ELSE 'pending' END
              WHEN v_status_eff IN ('已核准','已核銷') THEN 'completed'
              ELSE
                CASE WHEN (e->>'step_order')::int < v_cur THEN 'completed'
                     WHEN (e->>'step_order')::int = v_cur THEN 'current'
                     ELSE 'pending' END
            END AS status
          FROM json_array_elements(v_chain) e
          -- approverMap fallback：舊前端的 approverMap 是用「現行 chain」的 target_emp_id 建的，
          -- 故名字只能在現行 chain 的 target_emp_id 範圍內 resolve（快照若指向已不在現行 chain
          -- 的人，舊前端顯示空白——這裡忠實複製，見 openDetail 392-403）
          LEFT JOIN employees emp
            ON emp.id = NULLIF(e->>'target_emp_id','')::int
           AND emp.id IN (SELECT acs.target_emp_id FROM approval_chain_steps acs
                           WHERE acs.chain_id = v_req.approval_chain_id
                             AND acs.target_emp_id IS NOT NULL)
        ) c
        LEFT JOIN LATERAL (
          -- 同 step_order 可能多筆（駁回後重簽，甚至 entered_at 並列只差 exited_at）；
          -- 舊前端用 tlByStep[so]=t 依陣列順序覆蓋 → 取陣列「最後一筆」（用 ordinality 復刻，
          -- 比 entered_at 排序穩，因為並列時 entered_at 分不出先後）
          SELECT (te.elem->>'exited_at')::timestamptz AS exited_at,
                 te.elem->>'duration_text' AS duration_text
          FROM json_array_elements(v_timeline) WITH ORDINALITY AS te(elem, ord)
          WHERE (te.elem->>'step_order')::int = c.step_order
          ORDER BY te.ord DESC
          LIMIT 1
        ) tl ON true
      ) cs

      UNION ALL

      -- 加簽 step（order = insert_before_step - 0.5）（mergeExtraSteps 294-319）
      SELECT (x.insert_before_step - 0.5)::numeric, x.seq,
        jsonb_build_object(
          'kind',               'extra',
          'label',              '加簽',
          'name',               COALESCE(asg.name,''),
          'status',             CASE x.status WHEN 'pending'  THEN 'current'
                                              WHEN 'approved' THEN 'completed'
                                              WHEN 'rejected' THEN 'rejected'
                                              ELSE 'pending' END,
          'completedAt',        x.approved_at,
          'completedBy',        COALESCE(asg.name,''),
          'durationText',       public._fmt_duration_zh(x.created_at, x.approved_at),
          'rejectReason',       COALESCE(x.reject_reason,''),
          'extraReason',        COALESCE(x.reason,''),
          'extraRequesterName', COALESCE(rb.name,'')
        )
      FROM (
        SELECT *, row_number() OVER (ORDER BY created_at) AS seq
        FROM approval_extra_steps
        WHERE source_table = 'expense_requests' AND source_id = p_id
          AND status <> 'cancelled'
      ) x
      LEFT JOIN employees asg ON asg.id = x.assignee_id
      LEFT JOIN employees rb  ON rb.id  = x.requested_by_id
    ) q;
  END IF;

  -- ════════════════════════════════════════════════════════════════════════
  -- 2) 核銷階段（openDetail 457-581）
  -- ════════════════════════════════════════════════════════════════════════
  v_in_settle  := v_req.status IN ('待核銷','已核銷','核銷已退回');
  v_is_settled := v_req.status = '已核銷';

  IF NOT v_in_settle THEN
    v_final := v_main::jsonb;

  ELSIF v_req.settle_chain_id IS NULL THEN
    -- 無核銷鏈 → 單關「財務核章」佔位（openDetail 570-580）
    v_final := v_main::jsonb || jsonb_build_array(
      jsonb_build_object(
        'label',       '財務核章',
        'name',        CASE WHEN v_is_settled THEN COALESCE(NULLIF(v_req.settled_by,''),'') ELSE '' END,
        'status',      CASE WHEN v_is_settled THEN 'completed' WHEN v_req.status = '核銷已退回' THEN 'rejected' ELSE 'current' END,
        'completedAt', CASE WHEN v_is_settled THEN v_req.settled_at ELSE NULL END,
        'archival',    false,
        'isSettle',    true
      )
    );

  ELSE
    -- 有核銷鏈：snapshot（request_type='expense_settle'）優先，fallback live
    v_settle_cur := COALESCE(v_req.settle_current_step, 0);
    v_settle_tl  := public.get_approval_timeline('expense_settle', p_id);

    -- settleStartAt：snapshot 的 created_at 欄不存在（live 表是 snapshotted_at），
    -- 故舊前端該查必失敗 → 一律 fallback timeline step 0 entered_at（openDetail 547）
    SELECT t.entered_at INTO v_settle_start
    FROM json_to_recordset(v_settle_tl) AS t(step_order int, entered_at timestamptz)
    WHERE t.step_order = 0 LIMIT 1;

    -- 「核准後 N 天/小時/分鐘送核銷(驗收)」（openDetail 548-554）
    IF v_settle_start IS NOT NULL AND v_req.approved_at IS NOT NULL THEN
      v_diff := floor(EXTRACT(EPOCH FROM (v_settle_start - v_req.approved_at)))::BIGINT;
      v_interval := CASE
        WHEN v_diff < 3600  THEN '核准後 ' || (v_diff / 60)    || ' 分鐘送核銷(驗收)'
        WHEN v_diff < 86400 THEN '核准後 ' || (v_diff / 3600)  || ' 小時送核銷(驗收)'
        ELSE                     '核准後 ' || (v_diff / 86400) || ' 天送核銷(驗收)'
      END;
    ELSE
      v_interval := NULL;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM request_chain_snapshots
      WHERE request_type = 'expense_settle' AND request_id = p_id
    ) INTO v_has_settle_snap;

    IF v_has_settle_snap THEN
      -- 快照路徑：直接讀 request_chain_snapshots，names 只用 target_emp_id→name
      -- （openDetail 463-481，刻意不解動態 target，與舊前端一致）
      SELECT COALESCE(json_agg(
        jsonb_build_object(
          'label',  src.display_label,
          'name',   CASE WHEN v_is_settled AND src.step_order = src.total - 1
                         THEN COALESCE(NULLIF(v_req.settled_by,''), src.emp_name)
                         ELSE src.emp_name END,
          'status', src.status,
          'completedAt', CASE
            WHEN stl.exited_at IS NOT NULL AND src.status = 'completed'
            THEN COALESCE(CASE WHEN v_is_settled AND src.step_order = src.total - 1
                               THEN v_req.settled_at END, stl.exited_at)
            ELSE CASE WHEN v_is_settled AND src.step_order = src.total - 1
                      THEN v_req.settled_at END END,
          'durationText', CASE WHEN stl.exited_at IS NOT NULL AND src.status = 'completed'
                               THEN stl.duration_text ELSE NULL END,
          'rejectReason', CASE WHEN src.status = 'rejected' THEN v_req.settle_reject_reason ELSE NULL END,
          'archival', false,
          'isSettle', true
        ) ORDER BY src.step_order
      ), '[]'::json)
      INTO v_settle_steps
      FROM (
        SELECT
          s.step_order,
          COALESCE(NULLIF(s.label,''), NULLIF(s.role_name,''),
                   '核銷第 ' || (s.step_order + 1) || ' 關') AS display_label,
          CASE WHEN s.target_emp_id IS NOT NULL THEN COALESCE(emp.name,'')
               ELSE COALESCE(NULLIF(s.role_name,''), NULLIF(s.label,''), '') END AS emp_name,
          CASE WHEN v_is_settled THEN 'completed'
               WHEN s.step_order < v_settle_cur THEN 'completed'
               WHEN s.step_order = v_settle_cur AND v_req.status = '核銷已退回' THEN 'rejected'
               WHEN s.step_order = v_settle_cur THEN 'current'
               ELSE 'pending' END AS status,
          count(*) OVER () AS total
        FROM request_chain_snapshots s
        LEFT JOIN employees emp ON emp.id = s.target_emp_id
        WHERE s.request_type = 'expense_settle' AND s.request_id = p_id
      ) src
      LEFT JOIN LATERAL (
        SELECT (te.elem->>'exited_at')::timestamptz AS exited_at,
               te.elem->>'duration_text' AS duration_text
        FROM json_array_elements(v_settle_tl) WITH ORDINALITY AS te(elem, ord)
        WHERE (te.elem->>'step_order')::int = src.step_order ORDER BY te.ord DESC LIMIT 1
      ) stl ON true;

    ELSE
      -- live 路徑：get_chain_step_display_names（已解動態 names）（openDetail 482-489）
      v_settle_chain := public.get_chain_step_display_names(v_req.settle_chain_id, v_app_id);
      IF v_settle_chain IS NULL THEN v_settle_chain := '[]'::json; END IF;

      SELECT COALESCE(json_agg(
        jsonb_build_object(
          'label',  src.display_label,
          'name',   CASE WHEN v_is_settled AND src.step_order = src.total - 1
                         THEN COALESCE(NULLIF(v_req.settled_by,''), src.emp_name)
                         ELSE src.emp_name END,
          'status', src.status,
          'completedAt', CASE
            WHEN stl.exited_at IS NOT NULL AND src.status = 'completed'
            THEN COALESCE(CASE WHEN v_is_settled AND src.step_order = src.total - 1
                               THEN v_req.settled_at END, stl.exited_at)
            ELSE CASE WHEN v_is_settled AND src.step_order = src.total - 1
                      THEN v_req.settled_at END END,
          'durationText', CASE WHEN stl.exited_at IS NOT NULL AND src.status = 'completed'
                               THEN stl.duration_text ELSE NULL END,
          'rejectReason', CASE WHEN src.status = 'rejected' THEN v_req.settle_reject_reason ELSE NULL END,
          'archival', false,
          'isSettle', true
        ) ORDER BY src.step_order
      ), '[]'::json)
      INTO v_settle_steps
      FROM (
        SELECT
          (e->>'step_order')::int AS step_order,
          COALESCE(NULLIF(e->>'label',''), NULLIF(e->>'role_name',''),
                   '核銷第 ' || ((e->>'step_order')::int + 1) || ' 關') AS display_label,
          COALESCE(e->>'names','') AS emp_name,
          CASE WHEN v_is_settled THEN 'completed'
               WHEN (e->>'step_order')::int < v_settle_cur THEN 'completed'
               WHEN (e->>'step_order')::int = v_settle_cur AND v_req.status = '核銷已退回' THEN 'rejected'
               WHEN (e->>'step_order')::int = v_settle_cur THEN 'current'
               ELSE 'pending' END AS status,
          json_array_length(v_settle_chain) AS total
        FROM json_array_elements(v_settle_chain) e
      ) src
      LEFT JOIN LATERAL (
        SELECT (te.elem->>'exited_at')::timestamptz AS exited_at,
               te.elem->>'duration_text' AS duration_text
        FROM json_array_elements(v_settle_tl) WITH ORDINALITY AS te(elem, ord)
        WHERE (te.elem->>'step_order')::int = src.step_order ORDER BY te.ord DESC LIMIT 1
      ) stl ON true;
    END IF;

    -- baseSteps + 核銷分隔 + 核銷申請人 + 核銷各關（openDetail 564-569）
    v_final := v_main::jsonb
      || jsonb_build_array(
           jsonb_build_object('kind','settle_divider'),
           jsonb_build_object(
             -- 送核銷/驗收的人:有指定驗收單位(settle_assignee)且非申請人本人 → 顯示驗收負責人,否則申請人
             'label', CASE
                        WHEN v_req.settle_assignee_id IS NOT NULL AND v_req.settle_assignee_id <> v_req.employee_id
                          THEN '驗收負責人（送核銷/驗收）'
                        ELSE '申請人（送核銷/驗收）' END,
             'name', CASE
                        WHEN v_req.settle_assignee_id IS NOT NULL AND v_req.settle_assignee_id <> v_req.employee_id
                          THEN COALESCE((SELECT ee.name FROM employees ee WHERE ee.id = v_req.settle_assignee_id), v_req.employee)
                        ELSE v_req.employee END,
             'status','completed',
             'completedAt', v_settle_start,
             'noteText', v_interval,
             'isSettle', true,
             'isApplicant', (v_req.settle_assignee_id IS NULL OR v_req.settle_assignee_id = v_req.employee_id)
           )
         )
      || v_settle_steps::jsonb;
  END IF;

  RETURN COALESCE(v_final, '[]'::jsonb)::json;
END $function$
;

