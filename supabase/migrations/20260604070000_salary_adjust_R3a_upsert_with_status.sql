-- ════════════════════════════════════════════════════════════════
-- R3a — secure_upsert_salary_v2_with_status wrapper
--
-- 純新增 wrapper RPC：呼叫 secure_upsert_salary_v2 後依 p_status 設定狀態。
-- secure_upsert_salary_v2 一個字都不動 — 仍然向下相容（NULL/不傳 = 'finalized'）。
--
-- 用途：BatchPayrollModal 想以 'draft' 狀態建立薪資紀錄時呼叫本 wrapper。
-- ════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.secure_upsert_salary_v2_with_status(
  p_data   JSONB,
  p_status TEXT DEFAULT 'finalized'
) RETURNS public.salary_records
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result public.salary_records;
BEGIN
  IF p_status NOT IN ('draft', 'finalized') THEN
    RAISE EXCEPTION 'invalid p_status: % (must be draft / finalized)', p_status;
  END IF;

  -- 走既有 v2 邏輯 INSERT/UPSERT
  v_result := public.secure_upsert_salary_v2(p_data);

  -- 套用指定 status（finalized 不動 finalized_by；draft 清掉相關欄）
  UPDATE public.salary_records
     SET status       = p_status,
         finalized_at = CASE WHEN p_status = 'finalized' THEN COALESCE(finalized_at, now()) ELSE NULL END,
         finalized_by = CASE WHEN p_status = 'finalized' THEN finalized_by ELSE NULL END
   WHERE id = v_result.id
  RETURNING * INTO v_result;

  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.secure_upsert_salary_v2_with_status(JSONB, TEXT) TO authenticated;

COMMENT ON FUNCTION public.secure_upsert_salary_v2_with_status(JSONB, TEXT) IS
  'R3a：包裝 secure_upsert_salary_v2 並依 p_status 設定 draft / finalized。';

COMMIT;

NOTIFY pgrst, 'reload schema';

DO $$ BEGIN
  RAISE NOTICE 'R3a: secure_upsert_salary_v2_with_status 已建立';
END $$;
