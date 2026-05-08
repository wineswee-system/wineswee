-- ============================================================
-- HR 表單簽核鏈：動態目標 + per-form per-org 配置
--
-- 1. approval_chain_steps 加 target_type / target_store_id / target_section_id
-- 2. backfill 既有資料（empty target_type → 從 target_*_id 推 fixed_emp/role/dept）
-- 3. 新表 form_chain_configs：每張表（leave/overtime/...）每組織自己的 chain
-- 4. RPC resolve_chain_step_approvers(step_id, applicant_emp_id) → 解出該關該員工的實際簽核者列表
--
-- target_type 10 種（涵蓋你舉的所有 chain 範例）：
--   fixed_emp / fixed_role / fixed_dept                 — 寫死
--   applicant_supervisor / _dept_manager / _store_manager / _section_supervisor — 申請人連動
--   specific_dept_manager / _store_manager / _section_supervisor                — 指定單位的主管
-- ============================================================

BEGIN;

-- ═══ 1. 擴充 approval_chain_steps ═══
ALTER TABLE public.approval_chain_steps
  ADD COLUMN IF NOT EXISTS target_type TEXT,
  ADD COLUMN IF NOT EXISTS target_store_id INT REFERENCES public.stores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_section_id INT REFERENCES public.department_sections(id) ON DELETE SET NULL;

-- backfill：既有資料按舊 target_*_id 推 type
UPDATE public.approval_chain_steps SET target_type =
  CASE
    WHEN target_emp_id  IS NOT NULL THEN 'fixed_emp'
    WHEN target_role_id IS NOT NULL THEN 'fixed_role'
    WHEN target_dept_id IS NOT NULL THEN 'fixed_dept'
    ELSE 'fixed_emp'   -- 沒設過任何 target 的舊 row 預設成 fixed_emp（後台再補）
  END
WHERE target_type IS NULL;

ALTER TABLE public.approval_chain_steps
  ALTER COLUMN target_type SET NOT NULL,
  ALTER COLUMN target_type SET DEFAULT 'fixed_emp';

-- 加 CHECK
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.constraint_column_usage
                  WHERE table_name='approval_chain_steps' AND constraint_name='chk_approval_chain_steps_target_type') THEN
    ALTER TABLE public.approval_chain_steps
      ADD CONSTRAINT chk_approval_chain_steps_target_type
      CHECK (target_type IN (
        'fixed_emp','fixed_role','fixed_dept',
        'applicant_supervisor','applicant_dept_manager','applicant_store_manager','applicant_section_supervisor',
        'specific_dept_manager','specific_store_manager','specific_section_supervisor'
      ));
  END IF;
END $$;


-- ═══ 2. form_chain_configs：每張表每組織的 chain 設定 ═══
CREATE TABLE IF NOT EXISTS public.form_chain_configs (
  id              SERIAL PRIMARY KEY,
  form_type       TEXT NOT NULL,    -- leave / overtime / trip / expense / expense_request / punch / resignation / transfer / severance / custom:<id>
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


-- ═══ 3. RPC：解 chain step 該關的實際簽核者列表 ═══
-- 回傳該關「應該由哪些員工簽」（依 target_type 動態 / 靜態解）
-- 給前端：
--   - 設定畫面預覽 (target_type 選好後即時顯示「會由誰簽」)
--   - 申請送出時建第一關 task_confirmations
--   - chain 推進時建下一關 task_confirmations
CREATE OR REPLACE FUNCTION public.resolve_chain_step_approvers(
  p_chain_step_id    INT,
  p_applicant_emp_id INT
)
RETURNS TABLE (emp_id INT, emp_name TEXT, line_user_id TEXT, channel_code TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_step      approval_chain_steps;
  v_app       employees;
  v_target_emp_id INT;
  v_section_id    INT;
BEGIN
  SELECT * INTO v_step FROM approval_chain_steps WHERE id = p_chain_step_id;
  IF v_step.id IS NULL THEN RETURN; END IF;

  SELECT * INTO v_app FROM employees WHERE id = p_applicant_emp_id;

  -- 1. 寫死：特定員工
  IF v_step.target_type = 'fixed_emp' AND v_step.target_emp_id IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, e.name,
             COALESCE((SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1), NULL),
             COALESCE((SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1), NULL)
        FROM employees e WHERE e.id = v_step.target_emp_id AND e.status = '在職';
    RETURN;
  END IF;

  -- 2. 寫死：特定角色
  IF v_step.target_type = 'fixed_role' AND v_step.target_role_id IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, e.name,
             (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
             (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e
       WHERE e.role_id = v_step.target_role_id
         AND e.status = '在職'
         AND (v_app.organization_id IS NULL OR e.organization_id = v_app.organization_id);
    RETURN;
  END IF;

  -- 3. 寫死：特定部門全部員工
  IF v_step.target_type = 'fixed_dept' AND v_step.target_dept_id IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, e.name,
             (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
             (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e
       WHERE e.department_id = v_step.target_dept_id
         AND e.status = '在職';
    RETURN;
  END IF;

  -- ── 動態：申請人連動 ──
  IF v_app.id IS NULL THEN RETURN; END IF;

  -- 4. 申請人直屬主管 (employees.reporting_to)
  IF v_step.target_type = 'applicant_supervisor' AND v_app.reporting_to IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, e.name,
             (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
             (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_app.reporting_to AND e.status = '在職';
    RETURN;
  END IF;

  -- 5. 申請人部門的主管 (departments.manager_id)
  IF v_step.target_type = 'applicant_dept_manager' AND v_app.department_id IS NOT NULL THEN
    SELECT d.manager_id INTO v_target_emp_id FROM departments d WHERE d.id = v_app.department_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
               (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
               (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
          FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  -- 6. 申請人門市的店長 (stores.manager_id)
  IF v_step.target_type = 'applicant_store_manager' AND v_app.store_id IS NOT NULL THEN
    SELECT s.manager_id INTO v_target_emp_id FROM stores s WHERE s.id = v_app.store_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
               (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
               (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
          FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  -- 7. 申請人課別的督導：employees → store → store.section_id → section.supervisor_id
  IF v_step.target_type = 'applicant_section_supervisor' AND v_app.store_id IS NOT NULL THEN
    SELECT s.section_id INTO v_section_id FROM stores s WHERE s.id = v_app.store_id;
    IF v_section_id IS NOT NULL THEN
      SELECT ds.supervisor_id INTO v_target_emp_id FROM department_sections ds WHERE ds.id = v_section_id;
      IF v_target_emp_id IS NOT NULL THEN
        RETURN QUERY
          SELECT e.id, e.name,
                 (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
                 (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
            FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
      END IF;
    END IF;
    RETURN;
  END IF;

  -- 8. 指定特定部門的主管
  IF v_step.target_type = 'specific_dept_manager' AND v_step.target_dept_id IS NOT NULL THEN
    SELECT d.manager_id INTO v_target_emp_id FROM departments d WHERE d.id = v_step.target_dept_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
               (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
               (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
          FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  -- 9. 指定特定門市的店長
  IF v_step.target_type = 'specific_store_manager' AND v_step.target_store_id IS NOT NULL THEN
    SELECT s.manager_id INTO v_target_emp_id FROM stores s WHERE s.id = v_step.target_store_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
               (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
               (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
          FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  -- 10. 指定特定課別的督導
  IF v_step.target_type = 'specific_section_supervisor' AND v_step.target_section_id IS NOT NULL THEN
    SELECT ds.supervisor_id INTO v_target_emp_id FROM department_sections ds WHERE ds.id = v_step.target_section_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
               (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
               (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
          FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  -- 都不符合 → 回空集（前端要 alert「該關解不出任何簽核者」）
  RETURN;
END $$;

GRANT EXECUTE ON FUNCTION public.resolve_chain_step_approvers(INT, INT) TO authenticated;


-- ═══ 4. 便利 RPC：給設定畫面預覽用 — 不指定 applicant，只解 fixed_* 類型 ═══
-- 動態類型回 'DYNAMIC'，前端就知道要等申請人才能解
CREATE OR REPLACE FUNCTION public.preview_chain_step_target(
  p_chain_step_id INT
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_step approval_chain_steps;
  v_emp  TEXT;
  v_dept TEXT;
  v_store TEXT;
  v_section TEXT;
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
      RETURN json_build_object('mode','dynamic','desc', '申請人的直屬主管（reporting_to）');
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
