-- ════════════════════════════════════════════════════════════════════════════
-- 新增 hr_form.delete_all 權限記錄
-- 2026-05-20
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.permissions (code, name, module)
VALUES ('hr_form.delete_all', '刪除自訂表單申請', 'HR 表單')
ON CONFLICT (code) DO NOTHING;

COMMIT;
