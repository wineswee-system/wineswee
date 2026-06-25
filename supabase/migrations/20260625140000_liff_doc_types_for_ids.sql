-- ════════════════════════════════════════════════════════════════════════════
-- LIFF 簽核中心拆叫貨：additive 小 RPC 補 doc_type
-- 2026-06-25
--
-- liff_list_pending_approvals 的「申請段」expense_requests 用明確欄位清單組 json，
-- 沒帶 doc_type（驗收段用 to_jsonb 本來就有）。為了在 LIFF 把費用 / 叫貨拆 tab，
-- 不去重 paste 那支大 RPC（有踩雷史），改用這支「給一批 id 回 doc_type」的小函式。
-- 純讀、SECURITY DEFINER 繞 anon RLS（LIFF 是 anon），只回 id + doc_type。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.liff_doc_types_for_ids(p_ids int[])
RETURNS TABLE (id int, doc_type text)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT er.id, COALESCE(er.doc_type, 'expense')
  FROM public.expense_requests er
  WHERE er.id = ANY(p_ids)
$$;

GRANT EXECUTE ON FUNCTION public.liff_doc_types_for_ids(int[]) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
