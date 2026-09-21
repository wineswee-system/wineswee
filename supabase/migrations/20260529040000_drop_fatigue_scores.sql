-- 砍 fatigue_scores 表 — 排班系統不再參考辛苦度評分
-- 跟用戶討論後決定：4 週變形工時下，辛苦度評分會干擾 hard rule 結果，且使用者不需要
-- 此 commit 一起砍：
--   - fatigueEngine.js (整支刪)
--   - scoring.js (整支刪)
--   - AnalyticsTab 公平性儀表板 → 改成班別分布
--   - 所有 fatigue 評分項目（Pass 1/2、history.js、stats.js、monthlySchedule、weeklySchedule、shiftAssigner）

DROP TABLE IF EXISTS fatigue_scores CASCADE;
