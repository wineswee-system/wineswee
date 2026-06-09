-- ════════════════════════════════════════════════════════════════════════════
-- classify_ot_category_safe — SECURITY DEFINER wrapper for UI
--
-- 前端 OT 申請頁要依日期 + 員工算出 ot_category，藉此判斷是否為 FT 例假
-- 來鎖死「補休」radio。現成的 classify_overtime_category_v2 是 SECURITY
-- INVOKER 且讀 schedules / holidays 表 → anon 撞 RLS、authenticated 也可能
-- 撞權限問題。
--
-- 包一個 SECURITY DEFINER wrapper 給前端用，授權給 anon + authenticated。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.classify_ot_category_safe(
  p_date        DATE,
  p_employee_id INT
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.classify_overtime_category_v2(p_date, p_employee_id);
END $$;

GRANT EXECUTE ON FUNCTION public.classify_ot_category_safe(DATE, INT) TO anon, authenticated;


-- ─── Batch RPC：給前端查「哪些 request 有人 approved 過」── ─────────────
-- approval_step_history 表 RLS 鎖 same_org_can_read，anon（LIFF）讀不到
-- 包成 SECURITY DEFINER RPC，回傳 has-approved 的 request id 陣列
CREATE OR REPLACE FUNCTION public.list_request_ids_with_approved_step(
  p_request_type TEXT,
  p_request_ids  INT[]
)
RETURNS SETOF INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT request_id
    FROM approval_step_history
   WHERE request_type = p_request_type
     AND request_id   = ANY(p_request_ids)
     AND action       = 'approved'
     AND exited_at   IS NOT NULL
$$;

GRANT EXECUTE ON FUNCTION public.list_request_ids_with_approved_step(TEXT, INT[]) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
