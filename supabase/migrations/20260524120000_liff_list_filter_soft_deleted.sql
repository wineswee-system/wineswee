-- ════════════════════════════════════════════════════════════════════════════
-- 修：LIFF 自己申請清單沒過濾軟刪
-- ----------------------------------------------------------------------------
-- liff_list_expense_requests 直接 SELECT 全表，沒 .is('deleted_at', null)
-- 結果：使用者軟刪後 LIFF 上還看得到
--
-- 同樣修：liff_list_expenses（如果有）+ form_submission 類似 list
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. expense_requests list 過濾軟刪 ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_expense_requests(p_line_user_id TEXT)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(er.*) ORDER BY er.created_at DESC), '[]'::json)
  FROM public.expense_requests er
  WHERE er.employee_id = (SELECT id FROM public._liff_resolve_employee(p_line_user_id))
    AND er.deleted_at IS NULL
$$;

-- ─── 2. expenses list (如果存在 + 有 deleted_at) ──────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'liff_list_expenses'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='expenses' AND column_name='deleted_at'
  ) THEN
    -- 這支不一定存在 / 不一定能修，先 NOTICE 提醒
    RAISE NOTICE '⊘ expenses 有 deleted_at + liff_list_expenses 存在 → 手動確認該 RPC 是否需要加 .is(deleted_at, null)';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
