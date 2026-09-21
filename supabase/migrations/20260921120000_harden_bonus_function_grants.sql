-- 安全收緊:獎金相關 DEFINER 函式的 EXECUTE 權限(REVOKE 需連 anon 直接 grant 一起收)
-- _competition_rows 是內部 helper(DEFINER 讀跨店營收、無 org 閘門)→ 完全不對外
REVOKE ALL ON FUNCTION public._competition_rows(int,int,text) FROM PUBLIC, anon, authenticated;
-- compute/settle 競賽:只 authenticated(內有 _same_org_or_super 閘門)
REVOKE ALL ON FUNCTION public.compute_store_competition(int,int,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compute_store_competition(int,int,text) TO authenticated;
REVOKE ALL ON FUNCTION public.settle_store_competition(int,int,text,int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.settle_store_competition(int,int,text,int) TO authenticated;
-- recalc(DEFINER 寫入):只 authenticated(前端重算用;內部 DEFINER 呼叫以 owner 身分不受影響)
REVOKE ALL ON FUNCTION public.recalculate_store_bonus(int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.recalculate_store_bonus(int) TO authenticated;
