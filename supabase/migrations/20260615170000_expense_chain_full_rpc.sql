-- ════════════════════════════════════════════════════════════════════════════
-- get_expense_request_chain_full：費用申請「簽核流程」聚合 RPC（治本優化）
-- 2026-06-15
--
-- 目的：費用申請詳情 modal 右側「簽核流程」時間軸載入很慢——舊版 openDetail 在
--   前端串一長串序列 await（chain steps、employees、buildChainBasedSteps 內部又
--   呼叫 snapshot/live RPC + mergeExtraSteps、get_approval_timeline、核銷鏈再來
--   一輪）。本 RPC 把整段組裝搬到後端，一次回完整 finalSteps 陣列。
--
-- ★ 本函式「只組裝、不重寫解析」：動態 target（部門主管/店督導）名字解析全部
--   複用既有 building block（get_request_chain_display_names / get_chain_step_
--   display_names / get_approval_timeline），不重寫——降低「漏一個 case 顯示錯」
--   的高風險（見記憶 feedback_resolve_snapshot_rewrite_disaster）。
--
-- ★ 輸出 1:1 對齊舊前端 finalSteps（camelCase key），給 ApprovalDetailModal 的
--   ChainTimeline + exportExpenseRequestPdf 共用。切換前須逐單 diff 一致
--   （見 scripts/_diff_chain_full.mjs harness）。
--
-- 對應舊邏輯位置：
--   src/lib/buildChainSteps.js  buildChainBasedSteps(122-248) + mergeExtraSteps(267-340)
--   src/pages/workflow/ExpenseRequests.jsx  openDetail(380-586)
--
-- idempotent：CREATE OR REPLACE，無破壞性 DDL。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- helper：把兩時間差格式化成「X 天 Y 小時 Z 分」
-- 1:1 對齊 src/lib/buildChainSteps.js 的 fmtDuration（給加簽 step 停留時間用）
-- 注意：這跟 get_approval_timeline 的 duration_text 格式「不同」——加簽 step 走這支，
--       chain step 走 timeline 的 duration_text，兩者刻意分開不可混用。
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._fmt_duration_zh(
  p_start TIMESTAMPTZ,
  p_end   TIMESTAMPTZ
) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_ms    BIGINT;
  v_mins  BIGINT;
  v_days  BIGINT;
  v_hours BIGINT;
  v_parts TEXT[] := '{}';
BEGIN
  IF p_start IS NULL OR p_end IS NULL THEN RETURN NULL; END IF;
  v_ms := (EXTRACT(EPOCH FROM (p_end - p_start)) * 1000)::BIGINT;
  IF v_ms < 0 THEN RETURN NULL; END IF;
  v_mins := v_ms / 60000;                       -- floor（正值）
  IF v_mins < 1 THEN RETURN '不到 1 分'; END IF;
  v_days  := v_mins / 1440;  v_mins := v_mins - v_days * 1440;
  v_hours := v_mins / 60;    v_mins := v_mins - v_hours * 60;
  IF v_days  > 0 THEN v_parts := array_append(v_parts, v_days  || ' 天');   END IF;
  IF v_hours > 0 THEN v_parts := array_append(v_parts, v_hours || ' 小時'); END IF;
  IF v_mins  > 0 OR array_length(v_parts, 1) IS NULL THEN
    v_parts := array_append(v_parts, v_mins || ' 分');
  END IF;
  RETURN array_to_string(v_parts, ' ');
END $$;

GRANT EXECUTE ON FUNCTION public._fmt_duration_zh(TIMESTAMPTZ, TIMESTAMPTZ)
  TO authenticated, anon, service_role;


-- ──────────────────────────────────────────────────────────────────────────
-- get_expense_request_chain_full：一次回完整簽核步驟陣列
--   p_id                費用申請 id
--   p_applicant_emp_id  申請人 emp id（解動態 target 用；NULL 則用 row.employee_id）
-- 回傳 JSON 陣列，元素 = 舊前端 finalSteps 的 step 物件（camelCase）。
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_expense_request_chain_full(
  p_id               INT,
  p_applicant_emp_id INT DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
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

  v_app_id     := COALESCE(p_applicant_emp_id, v_req.employee_id);
  v_status_eff := CASE WHEN v_req.status = '待核銷' THEN '已核准' ELSE v_req.status END;

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
  v_in_settle  := v_req.status IN ('待核銷','已核銷');
  v_is_settled := v_req.status = '已核銷';

  IF NOT v_in_settle THEN
    v_final := v_main::jsonb;

  ELSIF v_req.settle_chain_id IS NULL THEN
    -- 無核銷鏈 → 單關「財務核章」佔位（openDetail 570-580）
    v_final := v_main::jsonb || jsonb_build_array(
      jsonb_build_object(
        'label',       '財務核章',
        'name',        CASE WHEN v_is_settled THEN COALESCE(NULLIF(v_req.settled_by,''),'') ELSE '' END,
        'status',      CASE WHEN v_is_settled THEN 'completed' ELSE 'current' END,
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
             'label','申請人（送核銷/驗收）',
             'name', v_req.employee,
             'status','completed',
             'completedAt', v_settle_start,
             'noteText', v_interval,
             'isSettle', true,
             'isApplicant', true
           )
         )
      || v_settle_steps::jsonb;
  END IF;

  RETURN COALESCE(v_final, '[]'::jsonb)::json;
END $$;

GRANT EXECUTE ON FUNCTION public.get_expense_request_chain_full(INT, INT)
  TO authenticated, anon, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
