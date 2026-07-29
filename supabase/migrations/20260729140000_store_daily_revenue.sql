-- 排班每日彙總:每店每日「預估業績」欄位(供人事成本比試算)— 2026-07-29
-- ════════════════════════════════════════════════════════════════════════════
-- 需求:班表下方彙總每日總工時、填每日預估業績、換算人事成本比(工時×均薪 / 業績)。
--   工時、比例都是前端即時算;唯一需要存的是「每日預估業績」→ 此表。
-- 一店一日一列(UNIQUE store_id,date),upsert 更新。
-- RLS:同 org 才看/寫,且需「能排該店的人」(排班可見範圍或看全公司)。
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.store_daily_revenue (
  id                bigserial PRIMARY KEY,
  organization_id   integer NOT NULL,
  store_id          integer NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  date              date NOT NULL,
  estimated_revenue numeric,
  updated_by        integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, date)
);

CREATE INDEX IF NOT EXISTS idx_store_daily_revenue_store_date
  ON public.store_daily_revenue (store_id, date);

ALTER TABLE public.store_daily_revenue ENABLE ROW LEVEL SECURITY;

-- 讀+寫:同 org 且能排該店(看全公司 或 該店在可見範圍)。service_role 自動放行。
DROP POLICY IF EXISTS store_daily_revenue_rw ON public.store_daily_revenue;
CREATE POLICY store_daily_revenue_rw ON public.store_daily_revenue
  FOR ALL
  USING (
    auth.role() = 'service_role'
    OR (organization_id = public.current_employee_org()
        AND (public._emp_sees_all_stores(public.current_employee_id())
             OR public._can_see_store_for_emp(public.current_employee_id()::bigint, store_id::bigint)))
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR (organization_id = public.current_employee_org()
        AND (public._emp_sees_all_stores(public.current_employee_id())
             OR public._can_see_store_for_emp(public.current_employee_id()::bigint, store_id::bigint)))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_daily_revenue TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.store_daily_revenue_id_seq TO authenticated;

NOTIFY pgrst, 'reload schema';
