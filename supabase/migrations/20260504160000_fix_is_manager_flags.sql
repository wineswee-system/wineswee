-- =============================================
-- 修正 is_manager 標記 + 游如梅 position
-- - 7 位部門主管 / 督導 / 區域店長 補上 is_manager=true
-- - 游如梅 (副主管) → 部員 + is_manager=false（圖上她是部員，不該進主管框）
-- =============================================

BEGIN;

-- 部門主管 / 督導 / 區域店長 → is_manager=true
UPDATE employees SET is_manager = true
WHERE id IN (
  48,   -- 韓虎   (財務部主管)
  60,   -- 林巧玉 (加盟事業部主管)
  62,   -- 張庭瑋 (營運部主管)
  68,   -- 劉雅玲 (稽核室主管)
  72,   -- 楊家謙 (倉儲物流部主管)
  141,  -- 陳嘉益 (區域店長)
  210   -- 羅紹輝 (督導)
);

-- 游如梅：副主管 → 部員，is_manager=false
UPDATE employees SET position = '部員', is_manager = false WHERE id = 151;

COMMIT;
