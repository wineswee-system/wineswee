-- 招募狀態值遷移（階段1b）— 2026-07-21
-- 舊 stage+hire_status → 新 11 態單一狀態機(存在 candidates.stage)。hire_status 停用(欄保留)。
-- 現網只有 2 筆(面試 / 已錄取+已核准),但寫穩健涵蓋所有舊值。idempotent(舊值跑完就沒了)。
-- ⚠️ 需與前端新版(STAGES 11 態 + recruit_transition)一起上;單獨跑會讓舊前端的看板找不到欄位。

UPDATE public.candidates SET stage = '篩選中'     WHERE stage = '篩選';
UPDATE public.candidates SET stage = '面試中'     WHERE stage = '面試';
-- 錄取決定:已送簽(hire_status=待審)→錄取簽核中;否則→待錄取決定
UPDATE public.candidates SET stage = '錄取簽核中' WHERE stage = '錄取決定' AND hire_status = '待審';
UPDATE public.candidates SET stage = '待錄取決定' WHERE stage = '錄取決定';
-- 投遞 / 已錄取 / 淘汰 值不變

NOTIFY pgrst, 'reload schema';
