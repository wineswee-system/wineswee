-- Fix: _trg_snapshot_chain_generic 對非 form_submissions 的表使用 NEW.template_id
-- 直接欄位存取在 leave_requests 等無此欄位的表上會噴 "record new has no field template_id"
-- 改用 to_jsonb(NEW)->>'template_id' 安全地讀取，欄位不存在時回傳 NULL 而非 error

CREATE OR REPLACE FUNCTION public._trg_snapshot_chain_generic()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request_type TEXT;
  v_chain_id     INT;
BEGIN
  v_request_type := TG_ARGV[0];

  v_chain_id := CASE
    WHEN TG_TABLE_NAME = 'form_submissions' THEN
      (SELECT ft.approval_chain_id
         FROM public.form_templates ft
        WHERE ft.id = (to_jsonb(NEW)->>'template_id')::int)
    ELSE
      (to_jsonb(NEW)->>'approval_chain_id')::int
  END;

  IF v_chain_id IS NULL THEN RETURN NEW; END IF;

  PERFORM public._snapshot_chain_for_request(v_request_type, NEW.id, v_chain_id);
  RETURN NEW;
END $$;

GRANT EXECUTE ON FUNCTION public._trg_snapshot_chain_generic() TO authenticated, service_role;
