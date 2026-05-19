-- ════════════════════════════════════════════════════════════════════════════
-- 門市業績獎金：自動讀取補卡次數
-- ────────────────────────────────────────────────────────────────────────────
-- 目前 store_bonus_employee.punch_correction_count 是「主管自己填」，
-- 但這資料本身就在 clock_corrections 裡 (status='已核准' 的當月件數)。
-- 加一個 sync RPC，按下「🔄 同步」自動 fill，不動現有 initialize/recalculate 流程。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. helper：計算某員工某月已核准補卡次數 ─────────────────────────────
CREATE OR REPLACE FUNCTION public._count_approved_clock_corrections(
  p_emp_id     INT,
  p_year_month TEXT          -- 'YYYY-MM'
) RETURNS INT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_start DATE;
  v_end   DATE;
  v_cnt   INT;
BEGIN
  v_start := (p_year_month || '-01')::DATE;
  v_end   := (v_start + INTERVAL '1 month')::DATE;
  SELECT COUNT(*) INTO v_cnt
    FROM clock_corrections
   WHERE employee_id = p_emp_id
     AND status = '已核准'
     AND date >= v_start AND date < v_end;
  RETURN COALESCE(v_cnt, 0);
END $$;

GRANT EXECUTE ON FUNCTION public._count_approved_clock_corrections(INT, TEXT)
  TO authenticated;


-- ─── 2. RPC：同步該月 store_bonus_employee 補卡次數 ──────────────────────
-- 跑完後自動 recalculate；回傳更新筆數
CREATE OR REPLACE FUNCTION public.sync_store_bonus_punch_counts(
  p_monthly_id INT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_monthly      store_bonus_monthly;
  v_emp          RECORD;
  v_count        INT;
  v_updated      INT := 0;
  v_details      JSON;
BEGIN
  SELECT * INTO v_monthly FROM store_bonus_monthly WHERE id = p_monthly_id;
  IF v_monthly.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_monthly.status = 'finalized' THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_FINALIZED');
  END IF;

  -- 走每個員工 row → fill count → 累計變動
  WITH counted AS (
    SELECT sbe.id, sbe.employee_id, sbe.employee_name, sbe.punch_correction_count AS old_count,
           public._count_approved_clock_corrections(sbe.employee_id, v_monthly.year_month) AS new_count
      FROM store_bonus_employee sbe
     WHERE sbe.monthly_id = p_monthly_id
  ),
  upd AS (
    UPDATE store_bonus_employee sbe
       SET punch_correction_count = c.new_count
      FROM counted c
     WHERE sbe.id = c.id AND sbe.punch_correction_count IS DISTINCT FROM c.new_count
     RETURNING sbe.id
  )
  SELECT (SELECT COUNT(*) FROM upd),
         (SELECT json_agg(json_build_object(
           'employee_name', employee_name,
           'old', old_count,
           'new', new_count
         )) FROM counted WHERE old_count IS DISTINCT FROM new_count)
    INTO v_updated, v_details;

  -- 自動 recalculate（補卡次數變動 → 扣項變動）
  PERFORM public.recalculate_store_bonus(p_monthly_id);

  RETURN json_build_object('ok', true, 'updated', v_updated, 'details', COALESCE(v_details, '[]'::json));
END $$;

GRANT EXECUTE ON FUNCTION public.sync_store_bonus_punch_counts(INT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
