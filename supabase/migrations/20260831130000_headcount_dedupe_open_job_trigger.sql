-- 人力需求單核准開職缺:表上同時存在兩個「已核准 → INSERT recruitment_jobs」的 AFTER UPDATE trigger,
-- 兩者都會在同一次 status→'已核准' 觸發,而先跑的 auto_open_job 不回寫 job_id、後跑的 create_job 看到
-- NEW.job_id 仍為 NULL → 又插一筆 → 一次核准開「兩個職缺」(其中一個是 position_title 空→「未命名職缺」)。
--
-- 保留較完整的 _trg_headcount_create_job_on_approve(2026-05-24):用 job_title、回寫 job_id、帶
-- type/created_by/description、雙欄名 fallback;移除較新但較陽春的 auto_open_job(2026-07-21)。
-- headcount_requests 目前 0 筆,無既有髒資料需清。
DROP TRIGGER IF EXISTS trg_headcount_auto_open_job ON public.headcount_requests;
DROP FUNCTION IF EXISTS public._trg_headcount_auto_open_job();
