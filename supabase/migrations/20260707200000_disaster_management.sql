-- 天災管理（颱風假等）：宣告 + 津貼匯入
-- 2026-07-07
-- 需求：
--   - HR 宣告天災停班日（分門市，全公司適用時 store_ids 留空）
--   - 沒來上班的處理由 HR 決定（照給 / 扣特休 / 不支薪），套用該日全員
--   - 天災津貼採「匯入制」（員工編號對應），同員工同日重匯覆蓋
-- 兩張表：disaster_days（宣告）、disaster_allowances（津貼）

BEGIN;

-- ── 1. 天災宣告 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.disaster_days (
  id               serial PRIMARY KEY,
  organization_id  int  NOT NULL,
  disaster_type    text NOT NULL DEFAULT '颱風',              -- 颱風 / 地震 / 其他
  date             date NOT NULL,
  store_ids        int[],                                     -- NULL/空 = 全部門市；否則只該幾家
  no_show_handling text NOT NULL DEFAULT 'paid'
                     CHECK (no_show_handling IN ('paid', 'annual_leave', 'unpaid')),  -- 照給/扣特休/不支薪
  note             text,
  created_by       int,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_disaster_days_org_date
  ON public.disaster_days (organization_id, date);

-- ── 2. 天災津貼（匯入） ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.disaster_allowances (
  id               serial PRIMARY KEY,
  organization_id  int NOT NULL,
  employee_id      int NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  date             date NOT NULL,                             -- 對應的天災日
  amount           numeric(10,2) NOT NULL DEFAULT 0,
  source           text DEFAULT 'import',
  imported_at      timestamptz DEFAULT now(),
  imported_by      int,
  UNIQUE (employee_id, date)                                  -- 同員工同日唯一 → 重匯覆蓋
);
CREATE INDEX IF NOT EXISTS idx_disaster_allowances_org_date
  ON public.disaster_allowances (organization_id, date);

-- ── 3. RLS ───────────────────────────────────────────────────
ALTER TABLE public.disaster_days       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disaster_allowances ENABLE ROW LEVEL SECURITY;

-- 宣告：同組織可讀；admin/super_admin 可寫
DROP POLICY IF EXISTS disaster_days_read  ON public.disaster_days;
CREATE POLICY disaster_days_read ON public.disaster_days
  FOR SELECT TO authenticated
  USING (organization_id = public.current_employee_org()
         OR public.current_employee_role() IN ('admin', 'super_admin'));

DROP POLICY IF EXISTS disaster_days_write ON public.disaster_days;
CREATE POLICY disaster_days_write ON public.disaster_days
  FOR ALL TO authenticated
  USING (public.current_employee_role() IN ('admin', 'super_admin'))
  WITH CHECK (public.current_employee_role() IN ('admin', 'super_admin'));

-- 津貼：本人可看自己、admin 全看；admin/super_admin 可寫
DROP POLICY IF EXISTS disaster_allowances_read ON public.disaster_allowances;
CREATE POLICY disaster_allowances_read ON public.disaster_allowances
  FOR SELECT TO authenticated
  USING (public.current_employee_role() IN ('admin', 'super_admin')
         OR employee_id = public.current_employee_id());

DROP POLICY IF EXISTS disaster_allowances_write ON public.disaster_allowances;
CREATE POLICY disaster_allowances_write ON public.disaster_allowances
  FOR ALL TO authenticated
  USING (public.current_employee_role() IN ('admin', 'super_admin'))
  WITH CHECK (public.current_employee_role() IN ('admin', 'super_admin'));

COMMIT;
NOTIFY pgrst, 'reload schema';
