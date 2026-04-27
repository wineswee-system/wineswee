-- ============================================================
-- liff_card_clear_pending
--
-- LIFF 駁回 popup 用：在 LIFF 內呼叫 liff_approve_request reject 完成後，
-- 也要清掉 line_users.pending_action（不然使用者下次打字會被當「駁回原因」
-- 再次去呼 liff_approve_request 同一張單，回 NOT_FOUND_OR_ALREADY_PROCESSED）。
--
-- 為什麼用 RPC：anon key 直接 UPDATE line_users 會被 RLS 擋，所以走 SECURITY DEFINER。
-- 用 line_user_id 當 key（公開資訊，不敏感）。
-- ============================================================

CREATE OR REPLACE FUNCTION public.liff_card_clear_pending(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_line_user_id IS NULL OR btrim(p_line_user_id) = '' THEN
    RETURN json_build_object('ok', false, 'error', 'MISSING_LINE_USER_ID');
  END IF;

  UPDATE public.line_users
     SET pending_action = NULL
   WHERE line_user_id = p_line_user_id;

  RETURN json_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_card_clear_pending(text) TO anon, authenticated;
