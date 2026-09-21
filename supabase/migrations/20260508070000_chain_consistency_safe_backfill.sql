-- ============================================================
-- Hotfix：060000 把 'label' 那些沒 target_*_id 的 row 一律設成 'fixed_emp'，
-- 但 fixed_emp 要求 target_emp_id NOT NULL → 違反新 consistency CHECK。
--
-- 修正策略：依「該 row 有哪個 *_id」反推 target_type；
-- 完全沒 *_id 的 row → 設成 'applicant_supervisor'（動態類，不需任何 *_id）。
-- 之後 admin 可從 UI 改成想要的 target type。
-- ============================================================

BEGIN;

-- 1. 先確保 target_store_id / target_section_id 欄位存在（060000 可能 partial fail）
ALTER TABLE public.approval_chain_steps
  ADD COLUMN IF NOT EXISTS target_type TEXT,
  ADD COLUMN IF NOT EXISTS target_store_id INT REFERENCES public.stores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_section_id INT REFERENCES public.department_sections(id) ON DELETE SET NULL;

-- 2. 砍所有相關 CHECK（重新建）
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.approval_chain_steps'::regclass
      AND contype = 'c'
      AND (conname LIKE '%target_type%' OR conname LIKE '%target_consistency%')
  LOOP
    EXECUTE format('ALTER TABLE public.approval_chain_steps DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- 3. ★ 安全 backfill：完全依「現有 *_id 是否存在」反推 type
--    保證 target_type 跟 target_*_id 一致，永遠不會違反 consistency
UPDATE public.approval_chain_steps SET target_type =
  CASE
    WHEN target_emp_id  IS NOT NULL THEN 'fixed_emp'
    WHEN target_role_id IS NOT NULL THEN 'fixed_role'
    WHEN target_dept_id IS NOT NULL THEN 'fixed_dept'
    -- 沒任何 *_id（含 'label' 殘留 + NULL + 任何不識別的舊值）→ 動態，不需 target
    ELSE 'applicant_supervisor'
  END
WHERE target_type IS NULL
   OR target_type IN ('employee','role','department','label')
   OR (target_type = 'fixed_emp'   AND target_emp_id   IS NULL)
   OR (target_type = 'fixed_role'  AND target_role_id  IS NULL)
   OR (target_type = 'fixed_dept'  AND target_dept_id  IS NULL)
   OR (target_type = 'specific_dept_manager'    AND target_dept_id    IS NULL)
   OR (target_type = 'specific_store_manager'   AND target_store_id   IS NULL)
   OR (target_type = 'specific_section_supervisor' AND target_section_id IS NULL);

-- 4. NOT NULL + DEFAULT
ALTER TABLE public.approval_chain_steps
  ALTER COLUMN target_type SET NOT NULL,
  ALTER COLUMN target_type SET DEFAULT 'applicant_supervisor';

-- 5. 新 type CHECK
ALTER TABLE public.approval_chain_steps
  ADD CONSTRAINT chk_approval_chain_steps_target_type
  CHECK (target_type IN (
    'fixed_emp','fixed_role','fixed_dept',
    'applicant_supervisor','applicant_dept_manager','applicant_store_manager','applicant_section_supervisor',
    'specific_dept_manager','specific_store_manager','specific_section_supervisor'
  ));

-- 6. 新 consistency CHECK
ALTER TABLE public.approval_chain_steps
  ADD CONSTRAINT chk_approval_chain_steps_target_consistency
  CHECK (
    (target_type = 'fixed_emp'  AND target_emp_id  IS NOT NULL)
    OR (target_type = 'fixed_role' AND target_role_id IS NOT NULL)
    OR (target_type = 'fixed_dept' AND target_dept_id IS NOT NULL)
    OR (target_type IN ('applicant_supervisor','applicant_dept_manager',
                        'applicant_store_manager','applicant_section_supervisor'))
    OR (target_type = 'specific_dept_manager'    AND target_dept_id    IS NOT NULL)
    OR (target_type = 'specific_store_manager'   AND target_store_id   IS NOT NULL)
    OR (target_type = 'specific_section_supervisor' AND target_section_id IS NOT NULL)
  );

-- 7. form_chain_configs 表（IF NOT EXISTS）
CREATE TABLE IF NOT EXISTS public.form_chain_configs (
  id              SERIAL PRIMARY KEY,
  form_type       TEXT NOT NULL,
  organization_id INT REFERENCES public.organizations(id) ON DELETE CASCADE,
  chain_id        INT NOT NULL REFERENCES public.approval_chains(id) ON DELETE CASCADE,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  created_by      TEXT,
  UNIQUE (form_type, organization_id)
);
CREATE INDEX IF NOT EXISTS idx_form_chain_configs_form ON public.form_chain_configs(form_type, organization_id);

ALTER TABLE public.form_chain_configs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='form_chain_configs' AND policyname='allow_all_form_chain_configs') THEN
    CREATE POLICY allow_all_form_chain_configs ON public.form_chain_configs FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 8. RPCs（CREATE OR REPLACE）— 從 060000 複製過來
CREATE OR REPLACE FUNCTION public.resolve_chain_step_approvers(
  p_chain_step_id    INT,
  p_applicant_emp_id INT
)
RETURNS TABLE (emp_id INT, emp_name TEXT, line_user_id TEXT, channel_code TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_step          approval_chain_steps;
  v_app           employees;
  v_target_emp_id INT;
  v_section_id    INT;
BEGIN
  SELECT * INTO v_step FROM approval_chain_steps WHERE id = p_chain_step_id;
  IF v_step.id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_app FROM employees WHERE id = p_applicant_emp_id;

  IF v_step.target_type = 'fixed_emp' AND v_step.target_emp_id IS NOT NULL THEN
    RETURN QUERY SELECT e.id, e.name,
      (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
      (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e WHERE e.id = v_step.target_emp_id AND e.status = '在職';
    RETURN;
  END IF;

  IF v_step.target_type = 'fixed_role' AND v_step.target_role_id IS NOT NULL THEN
    RETURN QUERY SELECT e.id, e.name,
      (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
      (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e WHERE e.role_id = v_step.target_role_id AND e.status = '在職'
        AND (v_app.organization_id IS NULL OR e.organization_id = v_app.organization_id);
    RETURN;
  END IF;

  IF v_step.target_type = 'fixed_dept' AND v_step.target_dept_id IS NOT NULL THEN
    RETURN QUERY SELECT e.id, e.name,
      (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
      (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e WHERE e.department_id = v_step.target_dept_id AND e.status = '在職';
    RETURN;
  END IF;

  IF v_app.id IS NULL THEN RETURN; END IF;

  IF v_step.target_type = 'applicant_supervisor' AND v_app.reporting_to IS NOT NULL THEN
    RETURN QUERY SELECT e.id, e.name,
      (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
      (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e WHERE e.id = v_app.reporting_to AND e.status = '在職';
    RETURN;
  END IF;

  IF v_step.target_type = 'applicant_dept_manager' AND v_app.department_id IS NOT NULL THEN
    SELECT d.manager_id INTO v_target_emp_id FROM departments d WHERE d.id = v_app.department_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_step.target_type = 'applicant_store_manager' AND v_app.store_id IS NOT NULL THEN
    SELECT s.manager_id INTO v_target_emp_id FROM stores s WHERE s.id = v_app.store_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_step.target_type = 'applicant_section_supervisor' AND v_app.store_id IS NOT NULL THEN
    SELECT s.section_id INTO v_section_id FROM stores s WHERE s.id = v_app.store_id;
    IF v_section_id IS NOT NULL THEN
      SELECT ds.supervisor_id INTO v_target_emp_id FROM department_sections ds WHERE ds.id = v_section_id;
      IF v_target_emp_id IS NOT NULL THEN
        RETURN QUERY SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
          FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
      END IF;
    END IF;
    RETURN;
  END IF;

  IF v_step.target_type = 'specific_dept_manager' AND v_step.target_dept_id IS NOT NULL THEN
    SELECT d.manager_id INTO v_target_emp_id FROM departments d WHERE d.id = v_step.target_dept_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_step.target_type = 'specific_store_manager' AND v_step.target_store_id IS NOT NULL THEN
    SELECT s.manager_id INTO v_target_emp_id FROM stores s WHERE s.id = v_step.target_store_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_step.target_type = 'specific_section_supervisor' AND v_step.target_section_id IS NOT NULL THEN
    SELECT ds.supervisor_id INTO v_target_emp_id FROM department_sections ds WHERE ds.id = v_step.target_section_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  RETURN;
END $$;

GRANT EXECUTE ON FUNCTION public.resolve_chain_step_approvers(INT, INT) TO authenticated;


CREATE OR REPLACE FUNCTION public.preview_chain_step_target(
  p_chain_step_id INT
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_step approval_chain_steps;
  v_emp  TEXT; v_dept TEXT; v_store TEXT; v_section TEXT;
BEGIN
  SELECT * INTO v_step FROM approval_chain_steps WHERE id = p_chain_step_id;
  IF v_step.id IS NULL THEN RETURN '{}'::json; END IF;
  CASE v_step.target_type
    WHEN 'fixed_emp' THEN
      SELECT name INTO v_emp FROM employees WHERE id = v_step.target_emp_id;
      RETURN json_build_object('mode','fixed','desc', '指定員工：' || COALESCE(v_emp,'（未設定）'));
    WHEN 'fixed_role' THEN
      SELECT name INTO v_emp FROM roles WHERE id = v_step.target_role_id;
      RETURN json_build_object('mode','fixed','desc', '具備角色「' || COALESCE(v_emp,'（未設定）') || '」的所有員工');
    WHEN 'fixed_dept' THEN
      SELECT name INTO v_dept FROM departments WHERE id = v_step.target_dept_id;
      RETURN json_build_object('mode','fixed','desc', '部門「' || COALESCE(v_dept,'（未設定）') || '」全部員工');
    WHEN 'applicant_supervisor' THEN
      RETURN json_build_object('mode','dynamic','desc', '申請人的直屬主管');
    WHEN 'applicant_dept_manager' THEN
      RETURN json_build_object('mode','dynamic','desc', '申請人所在部門的主管');
    WHEN 'applicant_store_manager' THEN
      RETURN json_build_object('mode','dynamic','desc', '申請人所在門市的店長');
    WHEN 'applicant_section_supervisor' THEN
      RETURN json_build_object('mode','dynamic','desc', '申請人所在課別的督導');
    WHEN 'specific_dept_manager' THEN
      SELECT name INTO v_dept FROM departments WHERE id = v_step.target_dept_id;
      RETURN json_build_object('mode','semi','desc', '部門「' || COALESCE(v_dept,'（未設定）') || '」的主管');
    WHEN 'specific_store_manager' THEN
      SELECT name INTO v_store FROM stores WHERE id = v_step.target_store_id;
      RETURN json_build_object('mode','semi','desc', '門市「' || COALESCE(v_store,'（未設定）') || '」的店長');
    WHEN 'specific_section_supervisor' THEN
      SELECT name INTO v_section FROM department_sections WHERE id = v_step.target_section_id;
      RETURN json_build_object('mode','semi','desc', '課別「' || COALESCE(v_section,'（未設定）') || '」的督導');
    ELSE
      RETURN json_build_object('mode','unknown','desc', '未支援的類型：' || v_step.target_type);
  END CASE;
END $$;

GRANT EXECUTE ON FUNCTION public.preview_chain_step_target(INT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
