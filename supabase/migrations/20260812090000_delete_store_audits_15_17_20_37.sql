-- ════════════════════════════════════════════════════════════════════════════
-- 依老闆指示刪除門市稽核單 #15 #17 #20 #37(皆威耀總部/劉雅玲/已核准)— 2026-08-12
--   一般 UI 只能刪草稿(delete_store_audit_draft 擋 status<>'草稿'),已核准無刪除鈕;
--   本次為老闆明確指定清除這四張,直接連子表刪。已於 2026-08-12 經 Management API 執行完成,
--   此檔留檔記錄(idempotent:再跑=無事可刪)。
--   刪除量:store_audits 4、store_audit_items 580(143+143+143+151)、store_audit_on_duty 4。
-- ════════════════════════════════════════════════════════════════════════════

DELETE FROM public.store_audit_items   WHERE audit_id IN (15, 17, 20, 37);
DELETE FROM public.store_audit_on_duty WHERE audit_id IN (15, 17, 20, 37);
DELETE FROM public.store_audits        WHERE id       IN (15, 17, 20, 37);
