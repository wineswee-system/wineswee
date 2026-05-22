-- ════════════════════════════════════════════════════════════════════════════
-- 門市稽核簽名 — 改用 Supabase Storage（DB 只存 URL）
-- ────────────────────────────────────────────────────────────────────────────
-- 變更：
--   1. 建 audit-signatures bucket（公開讀取，路徑不易猜，安全可接受）
--   2. submit_store_audit 放寬 signature 驗證（接受 URL 或 base64）
--   3. 既有 base64 資料保留不動（向下相容）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 建 storage bucket（如果不存在）──────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'audit-signatures',
  'audit-signatures',
  TRUE,                                          -- 公開讀取（URL 不易猜）
  524288,                                        -- 上限 512 KB / 張
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 上傳權限：authenticated 都可寫（前端綁定 audit_id/employee_id 命名）
DROP POLICY IF EXISTS "audit_sig_upload" ON storage.objects;
CREATE POLICY "audit_sig_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'audit-signatures');

DROP POLICY IF EXISTS "audit_sig_update" ON storage.objects;
CREATE POLICY "audit_sig_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'audit-signatures');

-- 讀取已公開不需 policy；以防萬一補一條
DROP POLICY IF EXISTS "audit_sig_read" ON storage.objects;
CREATE POLICY "audit_sig_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'audit-signatures');


-- ─── 2. submit_store_audit 放寬 signature 驗證 ────────────────────────────
-- 接受 URL 或 base64（向下相容）
CREATE OR REPLACE FUNCTION public.submit_store_audit(
  p_audit_id  INT,
  p_on_duty   JSONB DEFAULT '[]'::jsonb
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_audit       store_audits;
  v_count       INT;
  r_staff       record;
  v_idx         INT := 0;
  v_has_chain   BOOLEAN;
  v_emp         employees;
  v_sig         TEXT;
BEGIN
  SELECT * INTO v_audit FROM store_audits WHERE id = p_audit_id;
  IF v_audit.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'AUDIT_NOT_FOUND');
  END IF;

  IF v_audit.status <> '草稿' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_DRAFT', 'status', v_audit.status);
  END IF;

  IF p_on_duty IS NULL OR jsonb_array_length(p_on_duty) = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'ON_DUTY_REQUIRED');
  END IF;

  SELECT COUNT(*) INTO v_count FROM store_audit_items WHERE audit_id = p_audit_id AND passed IS NULL;
  IF v_count > 0 THEN
    RETURN json_build_object('ok', false, 'error', 'ITEMS_NOT_EVALUATED', 'pending_count', v_count);
  END IF;

  -- 驗證每位都有簽名（URL 或 base64 皆可）
  FOR r_staff IN SELECT * FROM jsonb_array_elements(p_on_duty) AS x(d) LOOP
    v_sig := r_staff.d->>'signature';
    IF v_sig IS NULL OR btrim(v_sig) = '' THEN
      RETURN json_build_object('ok', false, 'error', 'SIGNATURE_REQUIRED',
        'employee_name', r_staff.d->>'employee_name');
    END IF;
  END LOOP;

  DELETE FROM store_audit_on_duty WHERE audit_id = p_audit_id;
  FOR r_staff IN SELECT * FROM jsonb_array_elements(p_on_duty) AS x(d) LOOP
    INSERT INTO store_audit_on_duty (audit_id, employee_id, employee_name, sort_order, confirmed, confirmed_at, signature_data_url)
    VALUES (
      p_audit_id,
      NULLIF((r_staff.d->>'employee_id'), '')::INT,
      r_staff.d->>'employee_name',
      v_idx,
      TRUE,
      NOW(),
      r_staff.d->>'signature'
    );
    v_idx := v_idx + 1;
  END LOOP;

  UPDATE store_audits SET
    total_deducted = COALESCE((SELECT SUM(deduct_score) FROM store_audit_items WHERE audit_id = p_audit_id AND passed = FALSE), 0),
    submitted_at   = NOW()
  WHERE id = p_audit_id;

  v_has_chain := v_audit.approval_chain_id IS NOT NULL
                 AND EXISTS (SELECT 1 FROM approval_chain_steps WHERE chain_id = v_audit.approval_chain_id);

  IF v_has_chain THEN
    UPDATE store_audits SET status = '申請中', current_step = 0 WHERE id = p_audit_id;
    RETURN json_build_object('ok', true, 'status', '申請中', 'event', 'submitted_to_chain');
  ELSE
    SELECT * INTO v_emp FROM employees WHERE id = v_audit.auditor_id;
    UPDATE store_audits SET status = '已核准', approved_at = NOW(), approver = v_emp.name WHERE id = p_audit_id;
    RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'auto_approved_no_chain');
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
