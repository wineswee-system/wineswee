-- 批次計薪門市篩選:離職/被清 store 的人用當月排班回補「原門市」— 2026-08-04
-- ════════════════════════════════════════════════════════════════════════════
-- 症狀:批次計薪選門市時,離職員工若 employees.store 被清成 null(如曲相澐/李建廷)→
--   preview_payroll 的 `e.store = p_store_filter` 對不到 → 該離職員工整個沒被算進去,
--   薪資漏記。
-- 修法:門市篩選加一條 —— store 為空的人,用「當月排班 source_store」補回任職時門市,
--   與匯出薪資報表(exportPayrollRegister 的 needStore 回補)完全對齊。
--
-- 影響:只擴大「原本 store 為空、被門市篩選漏掉」的人;store 有值者行為不變。
--   批次存檔(handleBatchSaveCore)直接用 preview 結果 → preview 修好 = 入帳也修好。
--   generate_payroll(記全公司、無門市篩選)不受影響。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.preview_payroll(p_period text, p_org integer, p_store_filter text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_year   INT  := split_part(p_period,'-',1)::int;
  v_month  INT  := split_part(p_period,'-',2)::int;
  v_mstart date := make_date(v_year, v_month, 1);
  v_mend   date := (make_date(v_year, v_month, 1) + interval '1 month - 1 day')::date;
  v_result json;
BEGIN
  SELECT COALESCE(json_agg(public._compute_payroll_for_employee(e.id, p_period) ORDER BY e.name), '[]'::json)
    INTO v_result
  FROM employees e
  WHERE e.organization_id = p_org
    AND (e.in_payroll IS NOT FALSE)   -- 編制外員工不納入薪資計算
    -- 到職<=月底 且 (在職 或 當月離職)，以計薪月份為準、非相對今天
    AND (e.join_date IS NULL OR e.join_date <= v_mend)
    AND (
      e.status = '在職'
      OR (e.status = '離職'
          AND e.resign_date IS NOT NULL
          AND e.resign_date >= v_mstart
          AND e.resign_date <= v_mend)
    )
    -- 門市篩選:本店(additional_stores 幾乎人人含全部店,不能拿來濾薪資);
    --   離職/被清 store 的人 → 用當月排班 source_store 補回「任職時的門市」(對齊匯出報表)
    AND (
      p_store_filter IS NULL
      OR e.store = p_store_filter
      OR (COALESCE(e.store,'') = '' AND EXISTS (
            SELECT 1 FROM public.schedules s
             WHERE s.employee_id = e.id
               AND s.date >= v_mstart AND s.date <= v_mend
               AND s.source_store = p_store_filter))
    );
  RETURN v_result;
END $function$;

NOTIFY pgrst, 'reload schema';
