-- ════════════════════════════════════════════════════════════════════════════
-- Soft Delete — Apple 相簿模式（60 天保留，自動清理）
--
-- 適用表（申請 / 流程類）：
--   leave_requests, overtime_requests, clock_corrections,
--   business_trips, headcount_requests, expense_requests,
--   form_submissions, shift_swaps, off_requests
--
-- 機制：
--   1. deleted_at + deleted_by 欄位（NULL = 正常記錄）
--   2. soft_delete_request(table, id, deleted_by)  — 軟刪除 RPC
--   3. restore_request(table, id)                  — 復原 RPC
--   4. v_recently_deleted                          — 最近刪除 view（60 天內）
--   5. pg_cron: 每月 1 日 03:00 台灣（19:00 UTC 前日）永久清理 >60 天
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 加欄位 ────────────────────────────────────────────────────────────

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by INT REFERENCES public.employees(id) ON DELETE SET NULL;

ALTER TABLE public.overtime_requests
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by INT REFERENCES public.employees(id) ON DELETE SET NULL;

ALTER TABLE public.clock_corrections
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by INT REFERENCES public.employees(id) ON DELETE SET NULL;

ALTER TABLE public.business_trips
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by INT REFERENCES public.employees(id) ON DELETE SET NULL;

ALTER TABLE public.headcount_requests
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by INT REFERENCES public.employees(id) ON DELETE SET NULL;

ALTER TABLE public.expense_requests
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by INT REFERENCES public.employees(id) ON DELETE SET NULL;

ALTER TABLE public.form_submissions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by INT REFERENCES public.employees(id) ON DELETE SET NULL;

ALTER TABLE public.shift_swaps
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by INT REFERENCES public.employees(id) ON DELETE SET NULL;

ALTER TABLE public.off_requests
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by INT REFERENCES public.employees(id) ON DELETE SET NULL;


-- ─── 2. Partial indexes（只索引已刪除的列，保持查詢效率）────────────────

CREATE INDEX IF NOT EXISTS idx_leave_requests_deleted
  ON public.leave_requests(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_overtime_requests_deleted
  ON public.overtime_requests(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clock_corrections_deleted
  ON public.clock_corrections(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_trips_deleted
  ON public.business_trips(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_headcount_requests_deleted
  ON public.headcount_requests(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expense_requests_deleted
  ON public.expense_requests(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_form_submissions_deleted
  ON public.form_submissions(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shift_swaps_deleted
  ON public.shift_swaps(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_off_requests_deleted
  ON public.off_requests(deleted_at) WHERE deleted_at IS NOT NULL;


-- ─── 3. soft_delete_request() — 軟刪除 RPC ───────────────────────────────

CREATE OR REPLACE FUNCTION public.soft_delete_request(
  p_table      TEXT,
  p_id         INT,
  p_deleted_by INT DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  CASE p_table
    WHEN 'leave_requests' THEN
      UPDATE public.leave_requests
      SET deleted_at = NOW(), deleted_by = p_deleted_by
      WHERE id = p_id AND deleted_at IS NULL;

    WHEN 'overtime_requests' THEN
      UPDATE public.overtime_requests
      SET deleted_at = NOW(), deleted_by = p_deleted_by
      WHERE id = p_id AND deleted_at IS NULL;

    WHEN 'clock_corrections' THEN
      UPDATE public.clock_corrections
      SET deleted_at = NOW(), deleted_by = p_deleted_by
      WHERE id = p_id AND deleted_at IS NULL;

    WHEN 'business_trips' THEN
      UPDATE public.business_trips
      SET deleted_at = NOW(), deleted_by = p_deleted_by
      WHERE id = p_id AND deleted_at IS NULL;

    WHEN 'headcount_requests' THEN
      UPDATE public.headcount_requests
      SET deleted_at = NOW(), deleted_by = p_deleted_by
      WHERE id = p_id AND deleted_at IS NULL;

    WHEN 'expense_requests' THEN
      UPDATE public.expense_requests
      SET deleted_at = NOW(), deleted_by = p_deleted_by
      WHERE id = p_id AND deleted_at IS NULL;

    WHEN 'form_submissions' THEN
      UPDATE public.form_submissions
      SET deleted_at = NOW(), deleted_by = p_deleted_by
      WHERE id = p_id AND deleted_at IS NULL;

    WHEN 'shift_swaps' THEN
      UPDATE public.shift_swaps
      SET deleted_at = NOW(), deleted_by = p_deleted_by
      WHERE id = p_id AND deleted_at IS NULL;

    WHEN 'off_requests' THEN
      UPDATE public.off_requests
      SET deleted_at = NOW(), deleted_by = p_deleted_by
      WHERE id = p_id AND deleted_at IS NULL;

    ELSE
      RAISE EXCEPTION 'soft_delete_request: unknown table %', p_table;
  END CASE;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_request IS
  '軟刪除申請記錄（設 deleted_at），60 天後由 cron 永久清理。p_table 限定 9 張申請表。';


-- ─── 4. restore_request() — 復原 RPC ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.restore_request(
  p_table TEXT,
  p_id    INT
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  CASE p_table
    WHEN 'leave_requests' THEN
      UPDATE public.leave_requests
      SET deleted_at = NULL, deleted_by = NULL
      WHERE id = p_id;

    WHEN 'overtime_requests' THEN
      UPDATE public.overtime_requests
      SET deleted_at = NULL, deleted_by = NULL
      WHERE id = p_id;

    WHEN 'clock_corrections' THEN
      UPDATE public.clock_corrections
      SET deleted_at = NULL, deleted_by = NULL
      WHERE id = p_id;

    WHEN 'business_trips' THEN
      UPDATE public.business_trips
      SET deleted_at = NULL, deleted_by = NULL
      WHERE id = p_id;

    WHEN 'headcount_requests' THEN
      UPDATE public.headcount_requests
      SET deleted_at = NULL, deleted_by = NULL
      WHERE id = p_id;

    WHEN 'expense_requests' THEN
      UPDATE public.expense_requests
      SET deleted_at = NULL, deleted_by = NULL
      WHERE id = p_id;

    WHEN 'form_submissions' THEN
      UPDATE public.form_submissions
      SET deleted_at = NULL, deleted_by = NULL
      WHERE id = p_id;

    WHEN 'shift_swaps' THEN
      UPDATE public.shift_swaps
      SET deleted_at = NULL, deleted_by = NULL
      WHERE id = p_id;

    WHEN 'off_requests' THEN
      UPDATE public.off_requests
      SET deleted_at = NULL, deleted_by = NULL
      WHERE id = p_id;

    ELSE
      RAISE EXCEPTION 'restore_request: unknown table %', p_table;
  END CASE;
END;
$$;

COMMENT ON FUNCTION public.restore_request IS
  '復原軟刪除申請記錄（清除 deleted_at），60 天內有效。';


-- ─── 5. purge_old_deleted_requests() — 永久清理 ──────────────────────────

CREATE OR REPLACE FUNCTION public.purge_old_deleted_requests()
RETURNS TABLE(table_name TEXT, purged_count BIGINT) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_cutoff TIMESTAMPTZ := NOW() - INTERVAL '60 days';
  v_count  BIGINT;
BEGIN
  DELETE FROM public.leave_requests      WHERE deleted_at < v_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT 'leave_requests'::TEXT, v_count;

  DELETE FROM public.overtime_requests   WHERE deleted_at < v_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT 'overtime_requests'::TEXT, v_count;

  DELETE FROM public.clock_corrections   WHERE deleted_at < v_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT 'clock_corrections'::TEXT, v_count;

  DELETE FROM public.business_trips      WHERE deleted_at < v_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT 'business_trips'::TEXT, v_count;

  DELETE FROM public.headcount_requests  WHERE deleted_at < v_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT 'headcount_requests'::TEXT, v_count;

  DELETE FROM public.expense_requests    WHERE deleted_at < v_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT 'expense_requests'::TEXT, v_count;

  DELETE FROM public.form_submissions    WHERE deleted_at < v_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT 'form_submissions'::TEXT, v_count;

  DELETE FROM public.shift_swaps         WHERE deleted_at < v_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT 'shift_swaps'::TEXT, v_count;

  DELETE FROM public.off_requests        WHERE deleted_at < v_cutoff;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT 'off_requests'::TEXT, v_count;
END;
$$;

COMMENT ON FUNCTION public.purge_old_deleted_requests IS
  '永久刪除 60 天前軟刪除的申請記錄。由每月 cron 呼叫，傳回各表清理筆數。';


-- ─── 6. v_recently_deleted — 最近刪除 view ──────────────────────────────

CREATE OR REPLACE VIEW public.v_recently_deleted AS
  SELECT
    'leave_requests'                     AS source_table,
    lr.id                                AS record_id,
    lr.employee_id,
    e.name                               AS employee_name,
    NULL::INT                            AS organization_id,
    COALESCE(lr.type, '請假')             AS label,
    lr.deleted_at,
    lr.deleted_by,
    ((lr.deleted_at + INTERVAL '60 days')::DATE - CURRENT_DATE) AS days_remaining
  FROM public.leave_requests lr
  LEFT JOIN public.employees e ON e.id = lr.employee_id
  WHERE lr.deleted_at IS NOT NULL
    AND lr.deleted_at > NOW() - INTERVAL '60 days'

UNION ALL
  SELECT
    'overtime_requests',
    or2.id,
    or2.employee_id,
    e.name,
    NULL::INT,
    '加班申請',
    or2.deleted_at,
    or2.deleted_by,
    ((or2.deleted_at + INTERVAL '60 days')::DATE - CURRENT_DATE)
  FROM public.overtime_requests or2
  LEFT JOIN public.employees e ON e.id = or2.employee_id
  WHERE or2.deleted_at IS NOT NULL
    AND or2.deleted_at > NOW() - INTERVAL '60 days'

UNION ALL
  SELECT
    'clock_corrections',
    pc.id,
    pc.employee_id,
    e.name,
    NULL::INT,
    '打卡校正',
    pc.deleted_at,
    pc.deleted_by,
    ((pc.deleted_at + INTERVAL '60 days')::DATE - CURRENT_DATE)
  FROM public.clock_corrections pc
  LEFT JOIN public.employees e ON e.id = pc.employee_id
  WHERE pc.deleted_at IS NOT NULL
    AND pc.deleted_at > NOW() - INTERVAL '60 days'

UNION ALL
  SELECT
    'business_trips',
    bt.id,
    bt.employee_id,
    e.name,
    bt.organization_id,
    COALESCE(bt.destination, '出差申請'),
    bt.deleted_at,
    bt.deleted_by,
    ((bt.deleted_at + INTERVAL '60 days')::DATE - CURRENT_DATE)
  FROM public.business_trips bt
  LEFT JOIN public.employees e ON e.id = bt.employee_id
  WHERE bt.deleted_at IS NOT NULL
    AND bt.deleted_at > NOW() - INTERVAL '60 days'

UNION ALL
  SELECT
    'headcount_requests',
    hr2.id,
    hr2.employee_id,
    e.name,
    hr2.organization_id,
    COALESCE(hr2.job_title, '人力需求'),
    hr2.deleted_at,
    hr2.deleted_by,
    ((hr2.deleted_at + INTERVAL '60 days')::DATE - CURRENT_DATE)
  FROM public.headcount_requests hr2
  LEFT JOIN public.employees e ON e.id = hr2.employee_id
  WHERE hr2.deleted_at IS NOT NULL
    AND hr2.deleted_at > NOW() - INTERVAL '60 days'

UNION ALL
  SELECT
    'expense_requests',
    er.id,
    er.employee_id,
    e.name,
    er.organization_id,
    COALESCE(er.title, '費用申請'),
    er.deleted_at,
    er.deleted_by,
    ((er.deleted_at + INTERVAL '60 days')::DATE - CURRENT_DATE)
  FROM public.expense_requests er
  LEFT JOIN public.employees e ON e.id = er.employee_id
  WHERE er.deleted_at IS NOT NULL
    AND er.deleted_at > NOW() - INTERVAL '60 days'

UNION ALL
  SELECT
    'form_submissions',
    fs.id,
    fs.applicant_id,
    e.name,
    fs.organization_id,
    COALESCE(ft.name, '表單申請'),
    fs.deleted_at,
    fs.deleted_by,
    ((fs.deleted_at + INTERVAL '60 days')::DATE - CURRENT_DATE)
  FROM public.form_submissions fs
  LEFT JOIN public.employees e ON e.id = fs.applicant_id
  LEFT JOIN public.form_templates ft ON ft.id = fs.template_id
  WHERE fs.deleted_at IS NOT NULL
    AND fs.deleted_at > NOW() - INTERVAL '60 days'

UNION ALL
  SELECT
    'shift_swaps',
    ss.id,
    ss.requester_id,
    e.name,
    ss.organization_id,
    '換班申請',
    ss.deleted_at,
    ss.deleted_by,
    ((ss.deleted_at + INTERVAL '60 days')::DATE - CURRENT_DATE)
  FROM public.shift_swaps ss
  LEFT JOIN public.employees e ON e.id = ss.requester_id
  WHERE ss.deleted_at IS NOT NULL
    AND ss.deleted_at > NOW() - INTERVAL '60 days'

UNION ALL
  SELECT
    'off_requests',
    ofr.id,
    ofr.employee_id,
    e.name,
    ofr.organization_id,
    '休假申請',
    ofr.deleted_at,
    ofr.deleted_by,
    ((ofr.deleted_at + INTERVAL '60 days')::DATE - CURRENT_DATE)
  FROM public.off_requests ofr
  LEFT JOIN public.employees e ON e.id = ofr.employee_id
  WHERE ofr.deleted_at IS NOT NULL
    AND ofr.deleted_at > NOW() - INTERVAL '60 days';

COMMENT ON VIEW public.v_recently_deleted IS
  '最近 60 天內軟刪除的申請記錄。days_remaining <= 0 當日 cron 清除。';


-- ─── 7. pg_cron：每月 1 日 03:00 台灣（19:00 UTC 前一天）永久清理 ────────

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('purge-deleted-requests'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'purge-deleted-requests',
      '0 19 1 * *',   -- 每月 1 日 19:00 UTC（台灣 2 日 03:00）永久清理
      $$SELECT public.purge_old_deleted_requests()$$
    );
  END IF;
END $outer$;


COMMIT;

NOTIFY pgrst, 'reload schema';
