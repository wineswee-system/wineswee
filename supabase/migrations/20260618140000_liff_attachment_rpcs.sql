-- ════════════════════════════════════════════════════════════════════════════
-- LIFF 附件寫回 RPC：修「上傳收據但 DB attachments 永遠 null」的既有 bug
-- 2026-06-18
--
-- 背景：LIFF Leave/Expenses 上傳附件到 storage 後，用 anon 直接
--   `supabase.from('leave_requests'/'expenses').update({attachments}).eq('id',…)` 寫回。
--   但 (1) anon 對這些表沒有 table grant → update 被擋(靜默失敗)；
--      (2) 新增流程傳 Date.now() 假 id → 連對象都不對。
--   結果 storage 有檔、DB attachments 永遠 null → 審核人/申請人列表顯示「無附件」。
--
-- 修法：建 SECURITY DEFINER RPC(繞 RLS)，用 _liff_resolve_employee 驗證「這張單是本人的」
--   才更新 attachments。LIFF 改呼叫此 RPC，並接住 insert RPC 已回傳的真 id。
--   attachments 欄位為 jsonb(已驗)。
--
-- idempotent：CREATE OR REPLACE。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.liff_set_leave_attachments(p_line_user_id text, p_id int, p_urls jsonb)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;
  UPDATE public.leave_requests
     SET attachments = COALESCE(p_urls, '[]'::jsonb)
   WHERE id = p_id AND employee_id = emp.id;   -- 只能改本人的單
  IF NOT FOUND THEN RAISE EXCEPTION 'leave request % not found or not owned', p_id; END IF;
  RETURN json_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.liff_set_expense_attachments(p_line_user_id text, p_id int, p_urls jsonb)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;
  UPDATE public.expenses
     SET attachments = COALESCE(p_urls, '[]'::jsonb)
   WHERE id = p_id AND employee_id = emp.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'expense % not found or not owned', p_id; END IF;
  RETURN json_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_set_leave_attachments(text, int, jsonb)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_set_expense_attachments(text, int, jsonb) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
