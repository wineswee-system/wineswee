-- ════════════════════════════════════════════════════════════════════════════
-- LIFF 稽核 RLS 修補 — 補 anon 在以下情境的權限：
--   1. 評核項目 inline 更新（合格/不合格 / 責任人）→ 走 RPC
--   2. Storage 上傳簽名 → policy 開給 anon
-- ────────────────────────────────────────────────────────────────────────────
-- 慘案參考：feedback_liff_anon_rls — 凡 LIFF 動作必走 SECURITY DEFINER RPC
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. RPC：LIFF 更新評核項目 ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_update_store_audit_item(
  p_line_user_id text,
  p_item_id      int,
  p_passed       boolean DEFAULT NULL,
  p_responsible_employee_id int DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp        employees;
  v_item     store_audit_items;
  v_audit    store_audits;
  v_resp_name text;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO v_item FROM store_audit_items WHERE id = p_item_id;
  IF v_item.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'ITEM_NOT_FOUND');
  END IF;

  SELECT * INTO v_audit FROM store_audits WHERE id = v_item.audit_id;
  IF v_audit.status <> '草稿' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_DRAFT', 'status', v_audit.status);
  END IF;
  IF v_audit.auditor_id IS DISTINCT FROM emp.id THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUDITOR');
  END IF;

  IF p_responsible_employee_id IS NOT NULL THEN
    SELECT name INTO v_resp_name FROM employees WHERE id = p_responsible_employee_id;
  END IF;

  UPDATE store_audit_items SET
    passed = COALESCE(p_passed, passed),
    responsible_employee_id = CASE WHEN p_responsible_employee_id IS NOT NULL THEN p_responsible_employee_id ELSE responsible_employee_id END,
    responsible_employee_name = CASE WHEN p_responsible_employee_id IS NOT NULL THEN v_resp_name ELSE responsible_employee_name END
  WHERE id = p_item_id;

  -- 若改成合格 → 清掉責任人
  IF p_passed = TRUE THEN
    UPDATE store_audit_items SET
      responsible_employee_id = NULL,
      responsible_employee_name = NULL
    WHERE id = p_item_id;
  END IF;

  RETURN json_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_update_store_audit_item(text, int, boolean, int) TO authenticated, anon;


-- ─── 2. Storage policy 補 anon ────────────────────────────────────────────
DROP POLICY IF EXISTS "audit_sig_upload" ON storage.objects;
CREATE POLICY "audit_sig_upload" ON storage.objects
  FOR INSERT TO authenticated, anon
  WITH CHECK (bucket_id = 'audit-signatures');

DROP POLICY IF EXISTS "audit_sig_update" ON storage.objects;
CREATE POLICY "audit_sig_update" ON storage.objects
  FOR UPDATE TO authenticated, anon
  USING (bucket_id = 'audit-signatures');

COMMIT;

NOTIFY pgrst, 'reload schema';
