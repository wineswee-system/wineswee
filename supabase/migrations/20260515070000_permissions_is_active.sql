-- ════════════════════════════════════════════════════════════
-- permissions 加 is_active 欄位 + 隱藏未交付模組
-- 2026-05-15
--
-- 廠商需求：admin 進「員工個別權限」頁不應該看到未交付的功能
--   （CRM / 財務 / 倉儲 還沒上線交貨）
--
-- 做法：
--   1. permissions 表加 is_active BOOLEAN DEFAULT true
--   2. UPDATE 把未交付的 3 個 module 設為 false
--   3. get_employee_effective_permissions RPC 加 is_active 過濾
--
-- 廠商之後要開放某個模組：
--   UPDATE permissions SET is_active = true WHERE module = '財務';
--   ↑ 一行 SQL 就讓 admin 那邊立刻看得到該模組所有權限可設定
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. 加欄位 ═══
ALTER TABLE public.permissions
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.permissions.is_active IS
  'false → 廠商尚未交付，admin 權限頁不顯示。預設 true（已交付）。';


-- ═══ 2. 隱藏未交付模組 ═══
-- 目前未交付：CRM / 財務 / 倉儲
-- 已交付（保持 true）：人資 / 採購 / 系統
UPDATE public.permissions
   SET is_active = false
 WHERE module IN ('CRM', '財務', '倉儲');


-- ═══ 3. get_employee_effective_permissions：依角色決定是否含未交付權限 ═══
-- super_admin（廠商）→ 看全部（含 is_active=false 的未交付權限，除錯用）
-- admin / self      → 只看 is_active=true（已交付的）
CREATE OR REPLACE FUNCTION public.get_employee_effective_permissions(p_emp_id int)
RETURNS TABLE (
  permission_id   INT,
  code            TEXT,
  name            TEXT,
  module          TEXT,
  source          TEXT,
  effective       BOOLEAN,
  override_reason TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp           employees;
  v_caller        employees;
  v_caller_role   TEXT;
BEGIN
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL THEN RETURN; END IF;

  SELECT name INTO v_caller_role FROM roles WHERE id = v_caller.role_id;

  IF NOT (
    v_caller_role IN ('super_admin','admin')
    OR v_caller.id = p_emp_id
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      p.id AS permission_id,
      p.code,
      p.name,
      p.module,
      CASE
        WHEN ep.mode = 'grant'   THEN 'grant'
        WHEN ep.mode = 'revoke'  THEN 'role_revoke'
        WHEN rp.role_id IS NOT NULL THEN 'role'
        ELSE 'none'
      END AS source,
      CASE
        WHEN ep.mode = 'grant'  THEN TRUE
        WHEN ep.mode = 'revoke' THEN FALSE
        WHEN rp.role_id IS NOT NULL THEN TRUE
        ELSE FALSE
      END AS effective,
      ep.reason AS override_reason
    FROM permissions p
    LEFT JOIN role_permissions rp
      ON rp.permission_id = p.id AND rp.role_id = v_emp.role_id
    LEFT JOIN employee_permissions ep
      ON ep.permission_id = p.id AND ep.employee_id = p_emp_id
   -- ★ super_admin 看全部；admin / self 只看已交付（is_active=true）
   WHERE (v_caller_role = 'super_admin' OR p.is_active = true)
    ORDER BY p.module, p.id;
END $$;


COMMIT;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════
-- 之後交付模組時用這個：
--   UPDATE permissions SET is_active = true WHERE module = '財務';
--
-- 查看目前狀態：
--   SELECT id, code, name, module, is_active FROM permissions ORDER BY module, id;
-- ════════════════════════════════════════════════════════════
