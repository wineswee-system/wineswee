-- ════════════════════════════════════════════════════════════════════════════
-- 診斷：tk-538 為什麼沒收到「任務通知（含需填表單）」這張卡
-- ----------------------------------------------------------------------------
-- 在 Supabase Studio 跑這支，把結果貼回來
-- ════════════════════════════════════════════════════════════════════════════

-- 1) trigger 有沒有掛上 task_form_bindings
SELECT
  tgname               AS trigger_name,
  tgrelid::regclass    AS on_table,
  proname              AS function_name,
  tgenabled            AS enabled
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE tgrelid = 'public.task_form_bindings'::regclass
  AND NOT tgisinternal
ORDER BY tgname;

-- 2) function 本體存不存在
SELECT
  proname,
  pg_get_function_identity_arguments(oid) AS args,
  CASE WHEN prosrc IS NOT NULL THEN '✓ exists' ELSE '✗' END AS body
FROM pg_proc
WHERE proname IN ('_trg_task_binding_first_notify', '_notify_task_bindings_assigned')
ORDER BY proname;

-- 3) tasks 有沒有 bindings_notified_at 欄位
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tasks'
  AND column_name = 'bindings_notified_at';

-- 4) tk-538 的狀態：assignee_id 有沒有、bindings_notified_at 是不是已被 claim 過
SELECT id, title, assignee, assignee_id, status, bindings_notified_at, created_at
FROM public.tasks
WHERE id = 538;

-- 5) tk-538 binding 有沒有真的進 task_form_bindings
SELECT id, task_id, form_type, form_label, status, form_id, created_at
FROM public.task_form_bindings
WHERE task_id = 538
ORDER BY id;

-- 6) v_employee_line_resolved 對 tk-538 的負責人有沒有 line_user_id
SELECT v.employee_id, v.employee_name, v.line_user_id, v.liff_id, v.channel_code, v.is_primary
FROM public.v_employee_line_resolved v
JOIN public.tasks t ON t.id = 538
WHERE v.employee_id = COALESCE(
        t.assignee_id,
        (SELECT id FROM employees WHERE name = t.assignee AND organization_id = t.organization_id LIMIT 1)
      )
ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST;

-- 7) 手動跑一次通知（如果一切都對應該會收到一張卡）
-- SELECT public._notify_task_bindings_assigned(538);
