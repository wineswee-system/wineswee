-- 資料修正:清掉「已核准」卻仍殘留 reject_reason 的矛盾記錄。
-- 起因:強制通過蓋過駁回時沒清退回原因,畫面出現「已核准 + 退回原因」並存(如補打卡#373、加班#1751)。
-- 核准後本就不該有退回原因;駁回歷史仍完整保留在 approval_step_history。idempotent。
UPDATE leave_requests               SET reject_reason = NULL WHERE status = '已核准' AND reject_reason IS NOT NULL;
UPDATE overtime_requests            SET reject_reason = NULL WHERE status = '已核准' AND reject_reason IS NOT NULL;
UPDATE business_trips               SET reject_reason = NULL WHERE status = '已核准' AND reject_reason IS NOT NULL;
UPDATE clock_corrections            SET reject_reason = NULL WHERE status = '已核准' AND reject_reason IS NOT NULL;
UPDATE resignation_requests         SET reject_reason = NULL WHERE status = '已核准' AND reject_reason IS NOT NULL;
UPDATE leave_of_absence_requests    SET reject_reason = NULL WHERE status = '已核准' AND reject_reason IS NOT NULL;
UPDATE personnel_transfer_requests  SET reject_reason = NULL WHERE status = '已核准' AND reject_reason IS NOT NULL;
UPDATE headcount_requests           SET reject_reason = NULL WHERE status = '已核准' AND reject_reason IS NOT NULL;
