-- ════════════════════════════════════════════════════════════════════════════
-- form_submissions 全面切到 chain snapshot
-- 2026-06-01
--
-- 背景：
--   - 20260528200000 已建好 request_chain_snapshots + 通用 helper
--   - 20260528210000 已對 form_submissions AFTER INSERT 自動快照（trigger 已在）
--   - 但 form_submission_chain_approve / _notify_form_submission_step 還讀 live chain
--   - _guard_chain_steps_in_flight 也還無腦擋所有在飛 form_submissions
--
-- 這個 migration：
--   1. form_submission_chain_approve → 有快照優先讀快照，沒快照才 fallback live
--   2. _notify_form_submission_step → 同上
--   3. _guard_chain_steps_in_flight → expense_requests + form_submissions 已切快照，
--      只擋「沒快照的在飛單」；其他 HR 表還沒切讀路徑，繼續整批擋
--   4. liff_get_form_submission_chain_steps_batch → 新 RPC，前端列表批次拿快照步驟
--
-- 效果：
--   - 在飛單 #5 #10 已有快照 → 改 chain 不影響它們
--   - 簽核設定可以改了（guard 放行）
--   - 新單繼續吃改完的 chain（trigger 在送出當下快照）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. form_submission_chain_approve — 快照優先
--    ⚠️ DEFAULT 必須保留（PG 42P13），p_reason / p_reject_attachments 都帶
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.form_submission_chain_approve(
  p_id integer,
  p_approver_id integer,
  p_action text,
  p_reason text DEFAULT NULL,
  p_reject_attachments jsonb DEFAULT '[]'::jsonb
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub             form_submissions;
  v_template        form_templates;
  v_chain_id        INT;
  v_has_snapshot    BOOLEAN;
  v_snap            request_chain_snapshots;
  v_step            approval_chain_steps;
  v_matches         BOOLEAN;
  v_total_steps     INT;
  v_is_last         BOOLEAN;
  v_next_label      TEXT;
  v_new_current     INT;
BEGIN
  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO v_sub FROM form_submissions
   WHERE id = p_id AND deleted_at IS NULL;
  IF v_sub.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_sub.status <> '申請中' THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_PROCESSED');
  END IF;

  SELECT * INTO v_template FROM form_templates WHERE id = v_sub.template_id;
  v_chain_id := v_template.approval_chain_id;

  -- 沒綁 chain → 維持舊行為（直接核准/駁回）
  IF v_chain_id IS NULL THEN
    IF p_action = 'approve' THEN
      UPDATE form_submissions
         SET status = '已核准', approver_id = p_approver_id, approved_at = NOW()
       WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved_no_chain');
    ELSE
      UPDATE form_submissions
         SET status = '已駁回',
             reject_reason = btrim(p_reason),
             reject_attachments = COALESCE(p_reject_attachments, '[]'::jsonb),
             approver_id = p_approver_id, approved_at = NOW()
       WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected_no_chain');
    END IF;
  END IF;

  -- ── 加簽 guard（不分快照/live，獨立檢查）──
  IF EXISTS (
    SELECT 1 FROM approval_extra_steps
     WHERE source_table = 'form_submissions'
       AND source_id = p_id
       AND insert_before_step = COALESCE(v_sub.current_step, 0)
       AND status = 'pending'
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'PENDING_EXTRA_SIGNER',
      'message', '此單據有加簽請求進行中，請等加簽人完成後再簽核');
  END IF;

  -- ── 快照優先 ──
  SELECT EXISTS (
    SELECT 1 FROM public.request_chain_snapshots
     WHERE request_type = 'form_submission' AND request_id = p_id
  ) INTO v_has_snapshot;

  IF v_has_snapshot THEN
    SELECT * INTO v_snap
      FROM public.request_chain_snapshots
     WHERE request_type = 'form_submission'
       AND request_id   = p_id
       AND step_order   = COALESCE(v_sub.current_step, 0);
    IF v_snap.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND',
        'source', 'snapshot', 'current_step', v_sub.current_step);
    END IF;

    SELECT public._employee_matches_snapshot_step(
      p_approver_id, 'form_submission', p_id,
      COALESCE(v_sub.current_step, 0), v_sub.applicant_id
    ) INTO v_matches;

    SELECT COUNT(*) INTO v_total_steps
      FROM public.request_chain_snapshots
     WHERE request_type = 'form_submission' AND request_id = p_id;

  ELSE
    -- fallback：live chain（舊單沒快照）
    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = v_chain_id AND step_order = COALESCE(v_sub.current_step, 0);
    IF v_step.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND',
        'source', 'live_chain', 'current_step', v_sub.current_step);
    END IF;

    SELECT public._employee_matches_chain_step(p_approver_id, v_step.id, v_sub.applicant_id)
      INTO v_matches;

    SELECT COUNT(*) INTO v_total_steps
      FROM approval_chain_steps WHERE chain_id = v_chain_id;
  END IF;

  IF NOT v_matches THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  -- ── reject ──
  IF p_action = 'reject' THEN
    UPDATE form_submissions
       SET status = '已駁回',
           reject_reason = btrim(p_reason),
           reject_attachments = COALESCE(p_reject_attachments, '[]'::jsonb),
           approver_id = p_approver_id, approved_at = NOW()
     WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected',
      'rejected_at_step', v_sub.current_step);
  END IF;

  -- ── approve ──
  v_new_current := COALESCE(v_sub.current_step, 0) + 1;
  v_is_last     := (v_new_current >= v_total_steps);

  IF v_is_last THEN
    UPDATE form_submissions
       SET status = '已核准', approver_id = p_approver_id, approved_at = NOW(),
           current_step = v_total_steps - 1
     WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved', 'is_last_step', true);
  ELSE
    UPDATE form_submissions SET current_step = v_new_current WHERE id = p_id;

    -- 下一關 label（快照優先）
    IF v_has_snapshot THEN
      SELECT COALESCE(label, role_name) INTO v_next_label
        FROM public.request_chain_snapshots
       WHERE request_type = 'form_submission' AND request_id = p_id
         AND step_order = v_new_current;
    ELSE
      SELECT COALESCE(label, role_name) INTO v_next_label
        FROM approval_chain_steps
       WHERE chain_id = v_chain_id AND step_order = v_new_current;
    END IF;

    RETURN json_build_object(
      'ok', true, 'status', '簽核中', 'event', 'advanced',
      'advanced_to_step', v_new_current, 'is_last_step', false,
      'next_step_label', v_next_label
    );
  END IF;
END $$;

COMMENT ON FUNCTION public.form_submission_chain_approve(int, int, text, text, jsonb) IS
  '自訂表單簽核 — 快照優先（form_submissions.deleted_at IS NULL）';


-- ══════════════════════════════════════════════════════════════════════════
-- 2. _notify_form_submission_step — 快照優先解 approver
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._notify_form_submission_step(
  p_sub_id     int,
  p_step_order int
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_url        CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_anon       CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';

  v_sub          form_submissions;
  v_template     form_templates;
  v_chain_id     int;
  v_has_snapshot boolean;
  v_snap         request_chain_snapshots;
  v_step         approval_chain_steps;
  v_total        int;
  v_app_name     text;
  v_summary      jsonb;
  v_step_label   text;
  v_count        int := 0;
  v_approver     record;
  v_liff_url     text;
  v_payload      jsonb;
BEGIN
  SELECT * INTO v_sub FROM form_submissions WHERE id = p_sub_id;
  IF v_sub.id IS NULL THEN RETURN 0; END IF;

  SELECT * INTO v_template FROM form_templates WHERE id = v_sub.template_id;
  v_chain_id := v_template.approval_chain_id;
  IF v_chain_id IS NULL THEN RETURN 0; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.request_chain_snapshots
     WHERE request_type = 'form_submission' AND request_id = p_sub_id
  ) INTO v_has_snapshot;

  IF v_has_snapshot THEN
    SELECT * INTO v_snap
      FROM public.request_chain_snapshots
     WHERE request_type = 'form_submission' AND request_id = p_sub_id
       AND step_order = p_step_order;
    IF v_snap.id IS NULL THEN RETURN 0; END IF;

    SELECT COUNT(*) INTO v_total
      FROM public.request_chain_snapshots
     WHERE request_type = 'form_submission' AND request_id = p_sub_id;

    v_step_label := COALESCE(v_snap.label, v_snap.role_name, '第' || (p_step_order + 1) || '關');
  ELSE
    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = v_chain_id AND step_order = p_step_order;
    IF v_step.id IS NULL THEN RETURN 0; END IF;

    SELECT COUNT(*) INTO v_total FROM approval_chain_steps WHERE chain_id = v_chain_id;
    v_step_label := COALESCE(v_step.label, v_step.role_name, '第' || (p_step_order + 1) || '關');
  END IF;

  SELECT name INTO v_app_name FROM employees WHERE id = v_sub.applicant_id;
  v_summary := public._form_submission_summary_fields(p_sub_id);

  -- 解 approver + 推 LINE flex（快照 / live 兩條分支，body 一樣）
  IF v_has_snapshot THEN
    FOR v_approver IN
      SELECT a.emp_id, v.line_user_id, v.liff_id
        FROM public.resolve_snapshot_step_approvers(
               'form_submission', p_sub_id, p_step_order, v_sub.applicant_id
             ) a
        JOIN public.v_employee_line_resolved v
          ON v.employee_id = a.emp_id AND v.line_user_id = a.line_user_id
       WHERE v.line_user_id IS NOT NULL
         AND a.emp_id IS DISTINCT FROM v_sub.applicant_id
    LOOP
      v_liff_url := CASE
        WHEN v_approver.liff_id IS NULL OR v_approver.liff_id = '' THEN NULL
        ELSE 'https://liff.line.me/' || v_approver.liff_id || '?to=' ||
             replace(replace('/Approve', '/', '%2F'), '?', '%3F')
      END;

      v_payload := jsonb_build_object(
        'employee_id', v_approver.emp_id,
        'type', 'form_submission_step_assigned',
        'details', jsonb_build_object(
          'submission_id', p_sub_id,
          'template_name', COALESCE(v_template.name, '自訂表單'),
          'applicant_name', COALESCE(v_app_name, '—'),
          'current_step_label', v_step_label,
          'current_step_index', p_step_order,
          'total_steps', v_total,
          'summary_fields', v_summary,
          'liff_url', v_liff_url
        )
      );

      PERFORM net.http_post(
        url     := v_url,
        body    := v_payload,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_anon
        ),
        timeout_milliseconds := 5000
      );
      v_count := v_count + 1;
    END LOOP;
  ELSE
    FOR v_approver IN
      SELECT a.emp_id, v.line_user_id, v.liff_id
        FROM public.resolve_chain_step_approvers(v_step.id, v_sub.applicant_id) a
        JOIN public.v_employee_line_resolved v
          ON v.employee_id = a.emp_id AND v.line_user_id = a.line_user_id
       WHERE v.line_user_id IS NOT NULL
         AND a.emp_id IS DISTINCT FROM v_sub.applicant_id
    LOOP
      v_liff_url := CASE
        WHEN v_approver.liff_id IS NULL OR v_approver.liff_id = '' THEN NULL
        ELSE 'https://liff.line.me/' || v_approver.liff_id || '?to=' ||
             replace(replace('/Approve', '/', '%2F'), '?', '%3F')
      END;

      v_payload := jsonb_build_object(
        'employee_id', v_approver.emp_id,
        'type', 'form_submission_step_assigned',
        'details', jsonb_build_object(
          'submission_id', p_sub_id,
          'template_name', COALESCE(v_template.name, '自訂表單'),
          'applicant_name', COALESCE(v_app_name, '—'),
          'current_step_label', v_step_label,
          'current_step_index', p_step_order,
          'total_steps', v_total,
          'summary_fields', v_summary,
          'liff_url', v_liff_url
        )
      );

      PERFORM net.http_post(
        url     := v_url,
        body    := v_payload,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_anon
        ),
        timeout_milliseconds := 5000
      );
      v_count := v_count + 1;
    END LOOP;
  END IF;

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public._notify_form_submission_step(int, int) TO service_role;

COMMENT ON FUNCTION public._notify_form_submission_step(int, int) IS
  'form_submission chain LINE 通知 — 快照優先（2026-06-01）';


-- ══════════════════════════════════════════════════════════════════════════
-- 3. _guard_chain_steps_in_flight — 已切快照的表，放行有快照的在飛單
--
--   讀路徑已切快照的表（可放行 snapshotted 在飛單）：
--     expense_requests, form_submissions
--   讀路徑還在 live chain 的表（繼續整批擋）：
--     leave_requests, overtime_requests, business_trips, clock_corrections,
--     resignation_requests, leave_of_absence_requests,
--     personnel_transfer_requests, headcount_requests
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._guard_chain_steps_in_flight()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_count INT;
BEGIN
  -- ─── 已切快照（放行 snapshotted）───

  -- expense_requests（讀路徑已切快照 → 只擋沒快照的）
  SELECT COUNT(*) INTO v_count
    FROM public.expense_requests T
   WHERE T.approval_chain_id = OLD.chain_id
     AND T.status IN ('申請中', '待審')
     AND NOT EXISTS (
       SELECT 1 FROM public.request_chain_snapshots rcs
        WHERE rcs.request_type = 'expense_request' AND rcs.request_id = T.id
     );
  IF v_count > 0 THEN
    RAISE EXCEPTION
      'Chain % 有 % 張無快照的在飛 expense_requests，請先等完成或補快照',
      OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  -- form_submissions（讀路徑已切快照 → 只擋沒快照的）
  SELECT COUNT(*) INTO v_count
    FROM public.form_submissions fs
    JOIN public.form_templates ft ON ft.id = fs.template_id
   WHERE ft.approval_chain_id = OLD.chain_id
     AND fs.status IN ('申請中', '待審', '待審核', 'pending')
     AND NOT EXISTS (
       SELECT 1 FROM public.request_chain_snapshots rcs
        WHERE rcs.request_type = 'form_submission' AND rcs.request_id = fs.id
     );
  IF v_count > 0 THEN
    RAISE EXCEPTION
      'Chain % 有 % 張無快照的在飛 form_submissions，請先等完成或補快照',
      OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  -- ─── 讀路徑尚未切（整批擋）───

  -- leave_requests
  SELECT COUNT(*) INTO v_count
    FROM public.leave_requests T
   WHERE T.approval_chain_id = OLD.chain_id
     AND T.status IN ('申請中', '待審', '待審核');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張在飛 leave_requests，請先等完成', OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  -- overtime_requests
  SELECT COUNT(*) INTO v_count
    FROM public.overtime_requests T
   WHERE T.approval_chain_id = OLD.chain_id
     AND T.status IN ('申請中', '待審', '待審核');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張在飛 overtime_requests，請先等完成', OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  -- business_trips
  SELECT COUNT(*) INTO v_count
    FROM public.business_trips T
   WHERE T.approval_chain_id = OLD.chain_id
     AND T.status IN ('申請中', '待審', '待審核');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張在飛 business_trips，請先等完成', OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  -- clock_corrections
  SELECT COUNT(*) INTO v_count
    FROM public.clock_corrections T
   WHERE T.approval_chain_id = OLD.chain_id
     AND T.status IN ('申請中', '待審', '待審核');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張在飛 clock_corrections，請先等完成', OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  -- resignation_requests
  SELECT COUNT(*) INTO v_count
    FROM public.resignation_requests T
   WHERE T.approval_chain_id = OLD.chain_id
     AND T.status IN ('申請中', '待審', '待審核');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張在飛 resignation_requests，請先等完成', OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  -- leave_of_absence_requests
  SELECT COUNT(*) INTO v_count
    FROM public.leave_of_absence_requests T
   WHERE T.approval_chain_id = OLD.chain_id
     AND T.status IN ('申請中', '待審', '待審核');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張在飛 leave_of_absence_requests，請先等完成', OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  -- personnel_transfer_requests
  SELECT COUNT(*) INTO v_count
    FROM public.personnel_transfer_requests T
   WHERE T.approval_chain_id = OLD.chain_id
     AND T.status IN ('申請中', '待審', '待審核');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張在飛 personnel_transfer_requests，請先等完成', OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  -- headcount_requests
  SELECT COUNT(*) INTO v_count
    FROM public.headcount_requests T
   WHERE T.approval_chain_id = OLD.chain_id
     AND T.status IN ('申請中', '待審', '待審核');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Chain % 有 % 張在飛 headcount_requests，請先等完成', OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  RETURN OLD;
END $$;

COMMENT ON FUNCTION public._guard_chain_steps_in_flight() IS
  '改 approval_chain_steps 前 guard — expense_request/form_submission 已切快照，可放行 snapshotted 在飛單（2026-06-01）';


-- ══════════════════════════════════════════════════════════════════════════
-- 4. 前端列表用 batch RPC：拿多筆 form_submission 的快照 chain steps
--    回傳 [{ submission_id, total_steps, steps: [{step_order, label, role_name}] }]
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_form_submission_chain_steps_batch(
  p_submission_ids INT[]
) RETURNS JSON
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH snap AS (
    SELECT
      rcs.request_id  AS submission_id,
      rcs.step_order,
      rcs.label,
      rcs.role_name
    FROM public.request_chain_snapshots rcs
    WHERE rcs.request_type = 'form_submission'
      AND rcs.request_id = ANY(p_submission_ids)
  ),
  agg AS (
    SELECT
      submission_id,
      COUNT(*)              AS total_steps,
      json_agg(
        json_build_object(
          'step_order', step_order,
          'label',      label,
          'role_name',  role_name
        ) ORDER BY step_order
      ) AS steps
    FROM snap
    GROUP BY submission_id
  )
  SELECT COALESCE(json_agg(
    json_build_object(
      'submission_id', submission_id,
      'total_steps',   total_steps,
      'steps',         steps
    )
  ), '[]'::json)
  FROM agg;
$$;

GRANT EXECUTE ON FUNCTION public.get_form_submission_chain_steps_batch(INT[])
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_form_submission_chain_steps_batch(INT[]) IS
  '前端 FormSubmissions 列表 batch 拿快照 chain steps（2026-06-01）';


COMMIT;
NOTIFY pgrst, 'reload schema';
