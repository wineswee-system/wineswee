-- ════════════════════════════════════════════════════════════════════════════
-- 資安 線A：補 2 支 RPC，讓 LIFF 不必再 anon 直查 approval_extra_steps /
--   expense_request_attachments（守門員最後 2 個 🔴 致命公網洞）
--
-- ⚠️ 本檔「只加新 RPC」，不撤任何 anon grant/policy → 零破壞。
--    撤 anon 的收尾 migration 等 LIFF 改完並 deploy 生效後再出（順序安全：
--    舊版 LIFF（使用者快取）還靠 anon 直查，先撤會壞）。
--
-- RPC 1：liff_get_pending_extra_step — 取代 Approve.jsx 4 處 .from('approval_extra_steps')
--          綁定 LINE 員工才回（擋純 anon），回該單 pending 加簽 1 筆。
-- RPC 2：liff_list_request_attachments_for_card — 取代 approvalNotify.js 組卡片那處
--          組推播卡片是 anon context、無「檢視者」身分，故不做 eligible gate；
--          只回 file_name/storage_path/file_type（storage bucket 本就 public），
--          surface 從「整表 RW」收斂成「唯讀 3 欄 by id」。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── RPC 1：pending 加簽（綁定員工才回）─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_get_pending_extra_step(
  p_line_user_id text,
  p_source_table text,
  p_source_id    int
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN NULL; END IF;   -- 純 anon / 未綁定 → 不回

  RETURN (
    SELECT row_to_json(x)
    FROM (
      SELECT es.id, es.source_id, es.insert_before_step,
             es.assignee_id, es.requested_by_id, es.reason, es.status
      FROM public.approval_extra_steps es
      WHERE es.source_table = p_source_table
        AND es.source_id    = p_source_id
        AND es.status       = 'pending'
      ORDER BY es.id DESC
      LIMIT 1
    ) x
  );
END $$;

REVOKE ALL ON FUNCTION public.liff_get_pending_extra_step(text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.liff_get_pending_extra_step(text, text, int) TO authenticated, anon;


-- ─── RPC 2：組推播卡片用的附件清單（窄唯讀）────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_request_attachments_for_card(
  p_request_id int
)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT json_agg(json_build_object(
             'file_name',    a.file_name,
             'storage_path', a.storage_path,
             'file_type',    a.file_type
           ) ORDER BY a.created_at)
    FROM public.expense_request_attachments a
    WHERE a.request_id = p_request_id
  ), '[]'::json);
$$;

REVOKE ALL ON FUNCTION public.liff_list_request_attachments_for_card(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.liff_list_request_attachments_for_card(int) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
