-- ════════════════════════════════════════════════════════════════════════════
-- 加班守門簡化版 — 只擋明顯異常（單筆 > 12hr）
--
-- 本企業採 §30-1 四週變形工時制，不存在「週六 = 休息日、週日 = 例假」的
-- 標準週制硬性結構：
--   - 每日正常工時可達 10hr（非 8hr）
--   - 單日總工時（含 OT）≤ 12hr
--   - 例假每 7 日至少 1 日（哪天彈性）
--   - 沒有所謂「平日 4hr 上限」「月 46hr 上限」這種標準週制框架
--
-- 因此 DB trigger 只做「防 typo」級的健檢，實際合規邏輯交給：
--   - 排班檢查（排班違規 modal）
--   - 應用層申請流程（前端表單校驗）
--
-- 本版規則：
--   單筆 OT > 12hr → 擋（明顯數值錯）
--   其餘全放
--
-- is_exception=true 仍然完全跳過
-- 錯誤訊息純中性，不出現任何法規條文 / 「勞基法」字眼
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.chk_overtime_labor_law()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_eff_hours NUMERIC;
BEGIN
  -- 例外旁路
  IF COALESCE(NEW.is_exception, false) THEN
    RETURN NEW;
  END IF;

  -- UPDATE 若關鍵欄沒變 → 跳過
  IF TG_OP = 'UPDATE' THEN
    IF NEW.ot_hours     IS NOT DISTINCT FROM OLD.ot_hours
      AND NEW.hours        IS NOT DISTINCT FROM OLD.hours
      AND NEW.employee_id  IS NOT DISTINCT FROM OLD.employee_id THEN
      RETURN NEW;
    END IF;
  END IF;

  v_eff_hours := COALESCE(NEW.ot_hours, NEW.hours);

  IF v_eff_hours IS NULL THEN
    RETURN NEW;
  END IF;

  -- 單筆 > 12hr 視為明顯異常（防 typo）
  IF v_eff_hours > 12 THEN
    RAISE EXCEPTION 'OT_HOURS_ABNORMAL: 單筆加班時數異常（最多 12 小時），本次 % 小時', v_eff_hours
      USING HINT = 'sanity_cap';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.chk_overtime_labor_law() IS
  '加班 sanity check：單筆 ≤12hr。實際合規由排班檢查 + 應用層管控。';

COMMIT;

NOTIFY pgrst, 'reload schema';
