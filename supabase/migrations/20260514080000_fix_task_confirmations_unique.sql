-- ════════════════════════════════════════════════════════════
-- 修 task_confirmations 的 unique 與 chain 多關場景脫節
-- 2026-05-14
--
-- 病灶：原 UNIQUE(task_id, approver) 是 4/26 單關時代設計。
--   chain 多關後，若同一人出現在多個 step，第二關 INSERT 撞 unique，
--   ON CONFLICT DO NOTHING 直接 skip → INSERT trigger 不觸發 → 沒推 LINE → 卡死。
--
-- 修法：
--   1. DROP 舊 UNIQUE(task_id, approver)
--   2. ADD  UNIQUE(task_id, approver, step_order)
--   3. _create_task_confirmations_for_step 的 ON CONFLICT 改三欄
--
-- 不做：自動 backfill 已 stuck 的 task 453「111」測試 task。
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. DROP 舊 unique（用 catalog 掃名字，避開命名 drift）═══
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.task_confirmations'::regclass
       AND contype = 'u'
       AND ARRAY(SELECT attname::text FROM pg_attribute
                  WHERE attrelid = conrelid AND attnum = ANY(conkey)
                  ORDER BY array_position(conkey, attnum))
           = ARRAY['task_id','approver']::text[]
  LOOP
    EXECUTE format('ALTER TABLE public.task_confirmations DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'Dropped old unique constraint: %', r.conname;
  END LOOP;
END $$;

-- ═══ 2. ADD 新 unique (task_id, approver, step_order)（若已存在則跳過）═══
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.task_confirmations'::regclass
       AND conname = 'task_confirmations_task_approver_step_key'
  ) THEN
    ALTER TABLE public.task_confirmations
      ADD CONSTRAINT task_confirmations_task_approver_step_key
      UNIQUE (task_id, approver, step_order);
  END IF;
END $$;

-- ═══ 3. _create_task_confirmations_for_step：ON CONFLICT 改三欄 ═══
CREATE OR REPLACE FUNCTION public._create_task_confirmations_for_step(
  p_task_id integer,
  p_chain_id integer,
  p_step_ord integer,
  p_org_id integer,
  p_applicant_emp_id integer DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_step approval_chain_steps;
  v_inserted json;
BEGIN
  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = p_chain_id AND step_order = p_step_ord;
  IF v_step.id IS NULL THEN RETURN '[]'::json; END IF;

  WITH approvers AS (
    SELECT e.id AS emp_id, e.name AS emp_name
      FROM employees e
     WHERE e.status = '在職'
       AND (p_org_id IS NULL OR e.organization_id = p_org_id)
       AND public._employee_matches_chain_step(e.id, v_step.id, p_applicant_emp_id)
  ), inserted AS (
    INSERT INTO task_confirmations (task_id, approver, status, step_order, organization_id)
    SELECT p_task_id, emp_name, 'pending', p_step_ord, p_org_id FROM approvers
    -- ★ 三欄 ON CONFLICT：同人在不同 step 各自獨立一筆
    ON CONFLICT (task_id, approver, step_order) DO NOTHING
    RETURNING approver
  )
  SELECT COALESCE(json_agg(json_build_object(
           'emp_id',       e.id,
           'name',         e.name,
           'line_user_id', t.line_user_id,
           'channel_code', t.channel_code
         )), '[]'::json)
    INTO v_inserted
    FROM approvers a
    JOIN employees e ON e.name = a.emp_name AND (p_org_id IS NULL OR e.organization_id = p_org_id)
    LEFT JOIN LATERAL public._employee_line_target(e.id) t ON true;

  RETURN v_inserted;
END $function$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 驗證：列出 task_confirmations 上的 unique constraints
SELECT conname,
       (SELECT array_agg(attname ORDER BY array_position(conkey, attnum))
          FROM pg_attribute
         WHERE attrelid = conrelid AND attnum = ANY(conkey)) AS cols
  FROM pg_constraint
 WHERE conrelid = 'public.task_confirmations'::regclass AND contype = 'u';
