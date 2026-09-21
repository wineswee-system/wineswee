-- ════════════════════════════════════════════════════════════════
-- R3 — Salary Adjustment RPC 套件
--
-- 純新增 RPC：
--   - save_salary_adjustment        : 新增/取代調整（自動版本化）
--   - delete_salary_adjustment      : 軟刪除
--   - get_active_salary_adjustments : 查 record/employee 下 active 調整
--   - delete_salary_draft_month     : 整月 draft 砍掉（org + month）
--   - finalize_salary_draft_month   : 整月 draft 鎖定為 finalized
--   - get_salary_audit_log          : 稽核儀表板
--
-- 不動：salary_records / secure_upsert_salary_v2 / payroll.js
-- 全部 RPC 都檢查 salary_records.status — 只有 'draft' 可動
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 1. save_salary_adjustment
--    同 (salary_record_id, source_type, source_id, field) 已有 active → 自動 supersede
--    manual_bonus / manual_deduction（source_id IS NULL）：用 p_replace_id 顯式取代
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_salary_adjustment(
  p_salary_record_id INT,
  p_source_type      TEXT,
  p_source_id        INT,
  p_field            TEXT,
  p_original_value   JSONB,
  p_new_value        JSONB,
  p_reason           TEXT DEFAULT NULL,
  p_created_by       INT  DEFAULT NULL,
  p_replace_id       INT  DEFAULT NULL
) RETURNS public.salary_adjustments
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rec_status  TEXT;
  v_emp_id      INT;
  v_existing_id INT;
  v_new         public.salary_adjustments;
BEGIN
  -- 取 salary_record 的 status + employee_id
  SELECT status, employee_id INTO v_rec_status, v_emp_id
  FROM public.salary_records
  WHERE id = p_salary_record_id
  FOR UPDATE;

  IF v_rec_status IS NULL THEN
    RAISE EXCEPTION '找不到 salary_record id=%', p_salary_record_id;
  END IF;
  IF v_rec_status <> 'draft' THEN
    RAISE EXCEPTION 'salary_record % 狀態為 %，無法新增/修改調整（必須是 draft）', p_salary_record_id, v_rec_status;
  END IF;

  -- 找要被 supersede 的舊 active 列
  IF p_replace_id IS NOT NULL THEN
    v_existing_id := p_replace_id;
  ELSIF p_source_id IS NOT NULL THEN
    SELECT sa.id INTO v_existing_id
    FROM public.salary_adjustments sa
    WHERE sa.salary_record_id = p_salary_record_id
      AND sa.source_type      = p_source_type
      AND sa.source_id        = p_source_id
      AND sa.field            = p_field
      AND sa.superseded_at    IS NULL
    FOR UPDATE;
  END IF;

  -- 先 supersede 舊的（避免 unique partial index 衝突）
  IF v_existing_id IS NOT NULL THEN
    UPDATE public.salary_adjustments
       SET superseded_at = now()
     WHERE id = v_existing_id
       AND superseded_at IS NULL;
  END IF;

  -- INSERT 新 row
  INSERT INTO public.salary_adjustments (
    salary_record_id, employee_id, source_type, source_id, field,
    original_value, new_value, reason, created_by
  ) VALUES (
    p_salary_record_id, v_emp_id, p_source_type, p_source_id, p_field,
    p_original_value, p_new_value, p_reason, p_created_by
  )
  RETURNING * INTO v_new;

  -- 補回 superseded_by_id
  IF v_existing_id IS NOT NULL THEN
    UPDATE public.salary_adjustments
       SET superseded_by_id = v_new.id
     WHERE id = v_existing_id;
  END IF;

  RETURN v_new;
END
$$;

COMMENT ON FUNCTION public.save_salary_adjustment(
  INT, TEXT, INT, TEXT, JSONB, JSONB, TEXT, INT, INT
) IS 'R3：新增或取代薪資調整。同源已有 active 列會自動 supersede。';


-- ────────────────────────────────────────────────────────────────
-- 2. delete_salary_adjustment（軟刪除）
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_salary_adjustment(
  p_adjustment_id INT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rec_id     INT;
  v_rec_status TEXT;
BEGIN
  SELECT sa.salary_record_id INTO v_rec_id
  FROM public.salary_adjustments sa
  WHERE sa.id = p_adjustment_id;
  IF v_rec_id IS NULL THEN
    RAISE EXCEPTION '找不到 salary_adjustment id=%', p_adjustment_id;
  END IF;

  SELECT sr.status INTO v_rec_status FROM public.salary_records sr WHERE sr.id = v_rec_id;
  IF v_rec_status <> 'draft' THEN
    RAISE EXCEPTION 'salary_record % 狀態為 %，無法刪除調整', v_rec_id, v_rec_status;
  END IF;

  UPDATE public.salary_adjustments
     SET superseded_at = now()
   WHERE id = p_adjustment_id
     AND superseded_at IS NULL;

  RETURN FOUND;
END
$$;


-- ────────────────────────────────────────────────────────────────
-- 3. get_active_salary_adjustments
--    UI 開員工 accordion 時用
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_active_salary_adjustments(
  p_salary_record_id INT  DEFAULT NULL,
  p_organization_id  INT  DEFAULT NULL,
  p_month            TEXT DEFAULT NULL,
  p_employee_id      INT  DEFAULT NULL
) RETURNS SETOF public.salary_adjustments
LANGUAGE sql
AS $$
  SELECT sa.*
  FROM public.salary_adjustments sa
  JOIN public.salary_records sr ON sr.id = sa.salary_record_id
  WHERE (p_salary_record_id IS NULL OR sa.salary_record_id  = p_salary_record_id)
    AND (p_organization_id  IS NULL OR sr.organization_id   = p_organization_id)
    AND (p_month            IS NULL OR sr.month             = p_month)
    AND (p_employee_id      IS NULL OR sa.employee_id       = p_employee_id)
    AND sa.superseded_at IS NULL
  ORDER BY sa.created_at;
$$;


-- ────────────────────────────────────────────────────────────────
-- 4. delete_salary_draft_month
--    刪掉指定 organization+month 的所有 draft salary_records
--    CASCADE 自動清掉對應的 salary_adjustments
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_salary_draft_month(
  p_organization_id INT,
  p_month           TEXT
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cnt INT;
BEGIN
  DELETE FROM public.salary_records
   WHERE organization_id = p_organization_id
     AND month           = p_month
     AND status          = 'draft';
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  RETURN v_cnt;
END
$$;


-- ────────────────────────────────────────────────────────────────
-- 5. finalize_salary_draft_month
--    把 (org, month) 所有 draft 鎖成 finalized
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_salary_draft_month(
  p_organization_id INT,
  p_month           TEXT,
  p_finalized_by    INT DEFAULT NULL
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cnt INT;
BEGIN
  UPDATE public.salary_records
     SET status        = 'finalized',
         finalized_at  = now(),
         finalized_by  = p_finalized_by
   WHERE organization_id = p_organization_id
     AND month           = p_month
     AND status          = 'draft';
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  RETURN v_cnt;
END
$$;


-- ────────────────────────────────────────────────────────────────
-- 6. get_salary_audit_log
--    稽核儀表板用，含篩選；金額影響 client-side 算
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_salary_audit_log(
  p_month              TEXT    DEFAULT NULL,
  p_organization_id    INT     DEFAULT NULL,
  p_creator_id         INT     DEFAULT NULL,
  p_employee_id        INT     DEFAULT NULL,
  p_source_type        TEXT    DEFAULT NULL,
  p_include_superseded BOOLEAN DEFAULT false,
  p_limit              INT     DEFAULT 500
) RETURNS TABLE (
  adjustment_id    INT,
  created_at       TIMESTAMPTZ,
  created_by_id    INT,
  created_by_name  TEXT,
  employee_id      INT,
  employee_name    TEXT,
  salary_record_id INT,
  month            TEXT,
  organization_id  INT,
  status           TEXT,
  source_type      TEXT,
  source_id        INT,
  field            TEXT,
  original_value   JSONB,
  new_value        JSONB,
  reason           TEXT,
  superseded_at    TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    sa.id            AS adjustment_id,
    sa.created_at,
    sa.created_by    AS created_by_id,
    creator.name     AS created_by_name,
    sa.employee_id,
    emp.name         AS employee_name,
    sa.salary_record_id,
    sr.month,
    sr.organization_id,
    sr.status,
    sa.source_type,
    sa.source_id,
    sa.field,
    sa.original_value,
    sa.new_value,
    sa.reason,
    sa.superseded_at
  FROM public.salary_adjustments sa
  JOIN public.salary_records sr      ON sr.id = sa.salary_record_id
  LEFT JOIN public.employees emp     ON emp.id = sa.employee_id
  LEFT JOIN public.employees creator ON creator.id = sa.created_by
  WHERE (p_month             IS NULL OR sr.month           = p_month)
    AND (p_organization_id   IS NULL OR sr.organization_id = p_organization_id)
    AND (p_creator_id        IS NULL OR sa.created_by      = p_creator_id)
    AND (p_employee_id       IS NULL OR sa.employee_id     = p_employee_id)
    AND (p_source_type       IS NULL OR sa.source_type     = p_source_type)
    AND (p_include_superseded OR sa.superseded_at IS NULL)
  ORDER BY sa.created_at DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.get_salary_audit_log(
  TEXT, INT, INT, INT, TEXT, BOOLEAN, INT
) IS 'R3：稽核儀表板查詢，預設只回 active 調整。';

COMMIT;

NOTIFY pgrst, 'reload schema';

DO $$ BEGIN
  RAISE NOTICE 'R3: 6 支 salary_adjustment RPC 已建立';
END $$;
