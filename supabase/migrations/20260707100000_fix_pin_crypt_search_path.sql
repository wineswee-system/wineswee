-- ─────────────────────────────────────────────────────────────────────────────
-- 修 pos_manager_pins 函式找不到 crypt()
--
-- Supabase 的 pgcrypto 安裝在 extensions schema；20260706220000 的
-- pos__verify_manager_pin / pos_set_manager_pin 設 search_path = public, pg_temp
-- → 函式內 crypt()/gen_salt() 解析失敗（42883），PIN 驗證必炸。
-- 此處以 search_path = public, extensions, pg_temp 重建兩函式（本體不變）。
--
-- 冪等：可重複執行。
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pos__verify_manager_pin(p_org INT, p_pin TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_label TEXT;
BEGIN
  IF p_pin IS NULL OR p_pin = '' THEN RETURN NULL; END IF;
  SELECT label INTO v_label
    FROM pos_manager_pins
   WHERE organization_id = p_org
     AND is_active
     AND pin_hash = crypt(p_pin, pin_hash)
   LIMIT 1;
  RETURN v_label;
END;
$$;
REVOKE ALL ON FUNCTION public.pos__verify_manager_pin(INT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pos_set_manager_pin(
  p_label       TEXT,
  p_pin         TEXT DEFAULT NULL,   -- NULL = 停用該 label
  p_current_pin TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tid INT;
  v_has_pins BOOLEAN;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;
  IF p_label IS NULL OR btrim(p_label) = '' THEN RAISE EXCEPTION 'PIN 標籤不可為空'; END IF;

  SELECT EXISTS (SELECT 1 FROM pos_manager_pins WHERE organization_id = v_tid AND is_active)
    INTO v_has_pins;

  IF v_has_pins AND pos__verify_manager_pin(v_tid, p_current_pin) IS NULL THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: 變更主管 PIN 需輸入現有有效 PIN';
  END IF;

  IF p_pin IS NULL OR p_pin = '' THEN
    UPDATE pos_manager_pins SET is_active = FALSE
     WHERE organization_id = v_tid AND label = btrim(p_label);
    RETURN jsonb_build_object('ok', true, 'label', btrim(p_label), 'deactivated', true);
  END IF;

  IF length(p_pin) < 4 THEN RAISE EXCEPTION 'PIN 至少 4 碼'; END IF;

  INSERT INTO pos_manager_pins (organization_id, label, pin_hash, is_active)
  VALUES (v_tid, btrim(p_label), crypt(p_pin, gen_salt('bf')), TRUE)
  ON CONFLICT (organization_id, label)
  DO UPDATE SET pin_hash = EXCLUDED.pin_hash, is_active = TRUE;

  RETURN jsonb_build_object('ok', true, 'label', btrim(p_label));
END;
$$;
GRANT EXECUTE ON FUNCTION public.pos_set_manager_pin(TEXT, TEXT, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.pos_set_manager_pin(TEXT, TEXT, TEXT) FROM anon;
