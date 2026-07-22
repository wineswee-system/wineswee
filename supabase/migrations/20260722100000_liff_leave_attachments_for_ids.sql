-- LIFF 簽核方讀請假附件(加法式,不動大 pending RPC)— 2026-07-22
-- 問題:liff_list_pending_approvals 的 leaves 段用明確欄位清單,沒回 attachments →
--   主管審病假/喪假看不到證明。比照 liff_doc_types_for_ids 加法小 RPC 補,前端 merge。
-- attachments = URL 字串陣列(存 leave-attachments public bucket)。加 staff 閘(證明較敏感)。

CREATE OR REPLACE FUNCTION public.liff_leave_attachments_for_ids(p_line_user_id text, p_ids int[])
RETURNS TABLE(id int, attachments jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lr.id, to_jsonb(lr.attachments)
  FROM public.leave_requests lr
  WHERE lr.id = ANY(p_ids)
    AND lr.attachments IS NOT NULL
    AND EXISTS (SELECT 1 FROM public._liff_resolve_employee(p_line_user_id) e WHERE e.id IS NOT NULL)
$$;

GRANT EXECUTE ON FUNCTION public.liff_leave_attachments_for_ids(text, int[]) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
