-- 強制 PostgREST 重載 schema cache，認到新加的 liff_complete_task_v2 / _create_task_confirmations_for_step / liff_get_task_next_approvers
NOTIFY pgrst, 'reload schema';
