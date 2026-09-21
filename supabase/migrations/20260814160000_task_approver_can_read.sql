-- 讓「被設定為某任務簽核人」的人能讀到那張任務(及其所屬工作流的步驟/明細),以便在流程管理看完整資訊並審批。
-- 現況:tasks / workflow_instances 的 SELECT 只給 super/admin/自己發起 → manager 簽核者讀不到 → 流程管理空、詳情全「—」。
-- 做法:加「簽核人可讀」判斷函式(SECURITY DEFINER,內部查詢繞 RLS 不遞迴),對相關表『新增』一條 SELECT policy,
--       與原本 policy OR 疊加(不改原本)。曝光最小:只看得到自己有份簽核的任務 + 同工作流的步驟。

-- ── 判斷:我(登入者)是不是這張任務、或同工作流內任一任務的簽核人 ──
CREATE OR REPLACE FUNCTION public._can_approve_see_task(p_task_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_name text;
  v_inst integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT name INTO v_name FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_name IS NULL THEN RETURN false; END IF;

  -- 你是這張任務的簽核人?
  IF EXISTS (SELECT 1 FROM task_confirmations tc WHERE tc.task_id = p_task_id AND tc.approver = v_name) THEN
    RETURN true;
  END IF;

  -- 你是同一工作流內任一任務的簽核人?(看得到完整流程的兄弟步驟)
  SELECT workflow_instance_id INTO v_inst FROM tasks WHERE id = p_task_id;
  IF v_inst IS NOT NULL AND EXISTS (
    SELECT 1 FROM task_confirmations tc
      JOIN tasks t ON t.id = tc.task_id
     WHERE t.workflow_instance_id = v_inst AND tc.approver = v_name
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END $function$;

-- ── 判斷:我是不是這個工作流實例內任一任務的簽核人 ──
CREATE OR REPLACE FUNCTION public._can_approve_see_instance(p_instance_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_name text;
BEGIN
  IF auth.uid() IS NULL OR p_instance_id IS NULL THEN RETURN false; END IF;
  SELECT name INTO v_name FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_name IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM task_confirmations tc
      JOIN tasks t ON t.id = tc.task_id
     WHERE t.workflow_instance_id = p_instance_id AND tc.approver = v_name
  );
END $function$;

REVOKE ALL ON FUNCTION public._can_approve_see_task(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._can_approve_see_instance(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._can_approve_see_task(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public._can_approve_see_instance(bigint) TO authenticated;

-- ── 主表:任務 + 工作流實例 ──
DROP POLICY IF EXISTS tasks_approver_read ON public.tasks;
CREATE POLICY tasks_approver_read ON public.tasks
  FOR SELECT TO authenticated USING (public._can_approve_see_task(id));

DROP POLICY IF EXISTS workflow_instances_approver_read ON public.workflow_instances;
CREATE POLICY workflow_instances_approver_read ON public.workflow_instances
  FOR SELECT TO authenticated USING (public._can_approve_see_instance(id));

-- ── 任務明細相關表(有 task_id 的才加):附件/留言/檢查清單/簽核/變更日誌/工時/關聯/表單綁定 ──
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'task_attachments','task_comments','task_checklist_items','task_checklists',
    'task_confirmations','task_activity','task_time_logs','task_dependencies','task_form_bindings'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name=t AND column_name='task_id') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_approver_read', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public._can_approve_see_task(task_id))',
                     t||'_approver_read', t);
    END IF;
  END LOOP;
END $do$;
