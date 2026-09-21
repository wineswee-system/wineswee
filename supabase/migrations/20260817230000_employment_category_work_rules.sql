-- 2026-08-17 員工身分工時規則(全公司一組,per employment_category)。
--   把「行政辦公時間+彈性」從門市打卡規則搬出來,改成跟「員工身分」走:
--   行政(admin)=固定辦公時間+彈性;正職(regular)/兼職(parttime)=走班表+寬限;計件(piece)=不算遲到早退。
--   引擎依員工 salary_structures.employment_category 讀這張(見隨後 engine migration)。

CREATE TABLE IF NOT EXISTS public.employment_category_work_rules (
  id              serial PRIMARY KEY,
  organization_id int  NOT NULL,
  category        text NOT NULL,            -- admin/regular/parttime/piece
  work_start      time,                     -- 固定上班(行政有;排班類 null=走班表)
  work_end        time,                     -- 固定下班
  grace_minutes   int  NOT NULL DEFAULT 0,  -- 彈性/遲到早退寬限(分);行政=雙向浮動幅度
  is_active       boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, category)
);

-- 種 org 1 的 4 身分(行政 09:00-18:00 ±30;其餘寬限 0、無固定時間)
INSERT INTO public.employment_category_work_rules (organization_id, category, work_start, work_end, grace_minutes) VALUES
  (1, 'admin',    '09:00', '18:00', 30),
  (1, 'regular',  NULL,    NULL,    0),
  (1, 'parttime', NULL,    NULL,    0),
  (1, 'piece',    NULL,    NULL,    0)
ON CONFLICT (organization_id, category) DO NOTHING;

-- RLS:同組織可讀;admin 以上可改
ALTER TABLE public.employment_category_work_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ecwr_sel ON public.employment_category_work_rules;
CREATE POLICY ecwr_sel ON public.employment_category_work_rules FOR SELECT
  USING (org_visible(organization_id));
DROP POLICY IF EXISTS ecwr_write ON public.employment_category_work_rules;
CREATE POLICY ecwr_write ON public.employment_category_work_rules FOR ALL
  USING (is_super_admin() OR (is_admin() AND organization_id = current_user_org_id()))
  WITH CHECK (is_super_admin() OR (is_admin() AND organization_id = current_user_org_id()));
