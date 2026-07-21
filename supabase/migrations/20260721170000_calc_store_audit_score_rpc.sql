-- 門市稽核評分計算 RPC(單一來源)— 2026-07-21
-- 稽核分數(avg_score/total_deducted/total_max_score)原本 web + LIFF 各用 JS .reduce() 算 → 重複。
-- 搬後端:從 store_audit_items 重算,寫回 store_audits。web/LIFF/未來手機 submit 時呼叫這支即可。
-- 公式逐字對齊 LIFF StoreAudit.jsx:
--   itemDeduct = input_type='bonus' ? -deduct_score : deduct_score
--   每群組(category_code,relation_group):allot=group_allot(取一),groupDeduct=Σ itemDeduct
--   每類別:catMax=Σ group allot,catDeduct=Σ groupDeduct,catScore=min(catMax,max(0,catMax-catDeduct))
--   avg_score = 有配分類別(catMax>0)的 catScore 平均,round 2 位
--   total_deducted = Σ 非bonus 項的 deduct_score
-- 已對真實 audit(9=舊格式avg0/20=v2 avg75.5)驗證 JS↔SQL parity 一致。

CREATE OR REPLACE FUNCTION public.calc_store_audit_score(p_audit_id int)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_avg     numeric;
  v_tot_ded numeric;
  v_tot_max numeric;
BEGIN
  -- avg_score:類別分數平均
  WITH grp AS (
    SELECT category_code, relation_group,
           MAX(COALESCE(group_allot, 0)) AS allot,
           SUM(CASE WHEN input_type = 'bonus' THEN -COALESCE(deduct_score,0)
                    ELSE COALESCE(deduct_score,0) END) AS grp_ded
    FROM public.store_audit_items
    WHERE audit_id = p_audit_id
    GROUP BY category_code, relation_group
  ),
  cat AS (
    SELECT category_code, SUM(allot) AS cmax, SUM(grp_ded) AS cded
    FROM grp GROUP BY category_code
  ),
  scored AS (
    SELECT LEAST(cmax, GREATEST(0, cmax - cded)) AS score
    FROM cat WHERE cmax > 0
  )
  SELECT ROUND(COALESCE(AVG(score), 0), 2) INTO v_avg FROM scored;

  -- total_deducted:非 bonus 項扣分加總
  SELECT COALESCE(SUM(CASE WHEN input_type = 'bonus' THEN 0 ELSE COALESCE(deduct_score,0) END), 0)
    INTO v_tot_ded
  FROM public.store_audit_items WHERE audit_id = p_audit_id;

  -- total_max_score:各 distinct 群組 allot 加總
  SELECT COALESCE(SUM(allot), 0) INTO v_tot_max
  FROM (
    SELECT MAX(COALESCE(group_allot,0)) AS allot
    FROM public.store_audit_items WHERE audit_id = p_audit_id
    GROUP BY category_code, relation_group
  ) g;

  UPDATE public.store_audits
     SET avg_score = v_avg, total_deducted = v_tot_ded, total_max_score = v_tot_max, updated_at = now()
   WHERE id = p_audit_id;

  RETURN json_build_object('avg_score', v_avg, 'total_deducted', v_tot_ded, 'total_max_score', v_tot_max);
END $$;

GRANT EXECUTE ON FUNCTION public.calc_store_audit_score(int) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
