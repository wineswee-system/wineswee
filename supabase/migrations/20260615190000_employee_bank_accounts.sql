-- ════════════════════════════════════════════════════════════════════════════
-- employee_bank_accounts：員工銀行帳號（敏感個資隔離表）
-- 2026-06-15
--
-- 為什麼獨立一張表：
--   員工帳號是高度敏感個資。現行 employees 的 SELECT policy 是
--   employees_select_same_org（同公司任何 authenticated 都能讀整列）→ RLS 只有
--   列級、無欄位級保護，若把帳號塞進 employees，等於全公司店員都能用 API 撈到
--   所有人帳號。故獨立成表，RLS 只放行 admin / super_admin（發薪的人）。
--
-- 存取：
--   - 讀寫：authenticated 且 current_employee_role() ∈ (admin, super_admin) 且同 org
--   - anon：完全無 grant（碰不到）
--   - service_role：全權（後台匯入 / 產代發薪匯款檔用）
--
-- idempotent。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.employee_bank_accounts (
  id              SERIAL PRIMARY KEY,
  employee_id     INT  NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  organization_id INT,
  bank_code       TEXT,           -- 銀行代碼（中信=822）
  bank_account    TEXT,           -- 帳號
  bank_name       TEXT,           -- 銀行名稱
  bank_branch     TEXT,           -- 分行
  account_holder  TEXT,           -- 戶名（與員工姓名不同時用；代發薪核對用）
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id)
);

CREATE INDEX IF NOT EXISTS idx_emp_bank_org ON public.employee_bank_accounts (organization_id);

COMMENT ON TABLE public.employee_bank_accounts IS
  '員工銀行帳號（敏感個資）。RLS 只放行 admin/super_admin 同 org；給代發薪用。';

-- ── 自動補 organization_id（從 employee）+ updated_at ──
CREATE OR REPLACE FUNCTION public._trg_emp_bank_fill()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT organization_id INTO NEW.organization_id FROM public.employees WHERE id = NEW.employee_id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_emp_bank_fill ON public.employee_bank_accounts;
CREATE TRIGGER trg_emp_bank_fill
  BEFORE INSERT OR UPDATE ON public.employee_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public._trg_emp_bank_fill();

-- ── RLS：只 admin / super_admin（同 org）──
-- 註：本專案 service_role 也受 RLS 約束（見慘案記憶）。故：
--   匯入帳號 → 走 Studio（superuser 繞 RLS）或 service_role 直插（service_role 有 GRANT + 下方 policy 不含它→走 DEFINER RPC）；
--   產代發薪匯款檔 → 用 SECURITY DEFINER RPC（definer 繞 RLS 讀本表）。
ALTER TABLE public.employee_bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS emp_bank_admin_select ON public.employee_bank_accounts;
CREATE POLICY emp_bank_admin_select ON public.employee_bank_accounts
  FOR SELECT TO authenticated
  USING (
    current_employee_role() IN ('admin','super_admin')
    AND organization_id = current_user_org_id()
  );

DROP POLICY IF EXISTS emp_bank_admin_write ON public.employee_bank_accounts;
CREATE POLICY emp_bank_admin_write ON public.employee_bank_accounts
  FOR ALL TO authenticated
  USING (
    current_employee_role() IN ('admin','super_admin')
    AND organization_id = current_user_org_id()
  )
  WITH CHECK (
    current_employee_role() IN ('admin','super_admin')
    AND organization_id = current_user_org_id()
  );

-- ── Grants：authenticated（RLS 把關）+ service_role；anon 完全不給 ──
REVOKE ALL ON public.employee_bank_accounts FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_bank_accounts TO authenticated;
GRANT ALL ON public.employee_bank_accounts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.employee_bank_accounts_id_seq TO authenticated, service_role;


-- ── 匯入 RPC（給 scripts/import_bank.mjs 用；service_role 受 RLS 擋，故走 DEFINER）──
-- 只 GRANT 給 service_role（本機管理者用服務金鑰跑），不給 authenticated，避免任何登入者亂寫帳號。
CREATE OR REPLACE FUNCTION public.import_employee_bank_account(
  p_employee_number TEXT,
  p_name            TEXT,
  p_bank_code       TEXT,
  p_bank_branch     TEXT,
  p_bank_account    TEXT
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp employees; v_by TEXT;
BEGIN
  -- 先用員工編號比對，找不到再用姓名
  IF p_employee_number IS NOT NULL AND btrim(p_employee_number) <> '' THEN
    SELECT * INTO v_emp FROM employees WHERE employee_number = btrim(p_employee_number) LIMIT 1;
    IF v_emp.id IS NOT NULL THEN v_by := 'employee_number'; END IF;
  END IF;
  IF v_emp.id IS NULL AND p_name IS NOT NULL AND btrim(p_name) <> '' THEN
    SELECT * INTO v_emp FROM employees WHERE name = btrim(p_name) LIMIT 1;
    IF v_emp.id IS NOT NULL THEN v_by := 'name'; END IF;
  END IF;
  IF v_emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND',
      'employee_number', p_employee_number, 'name', p_name);
  END IF;

  INSERT INTO employee_bank_accounts
    (employee_id, organization_id, bank_code, bank_branch, bank_account, account_holder)
  VALUES
    (v_emp.id, v_emp.organization_id,
     NULLIF(btrim(p_bank_code),''), NULLIF(btrim(p_bank_branch),''),
     NULLIF(btrim(p_bank_account),''), NULLIF(btrim(p_name),''))
  ON CONFLICT (employee_id) DO UPDATE SET
    bank_code      = EXCLUDED.bank_code,
    bank_branch    = EXCLUDED.bank_branch,
    bank_account   = EXCLUDED.bank_account,
    account_holder = COALESCE(EXCLUDED.account_holder, employee_bank_accounts.account_holder),
    updated_at     = now();

  RETURN jsonb_build_object('ok', true, 'employee_id', v_emp.id, 'name', v_emp.name, 'matched_by', v_by);
END $$;

REVOKE ALL ON FUNCTION public.import_employee_bank_account(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_employee_bank_account(TEXT,TEXT,TEXT,TEXT,TEXT) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
