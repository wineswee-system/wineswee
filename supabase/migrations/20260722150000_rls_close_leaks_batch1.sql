-- RLS 收斂 第一批(5 表) — 2026-07-22
-- ════════════════════════════════════════════════════════════════════════════
-- 依 _dump_table_security live 實況精準修(非瞎猜):
--  🔴 anon 可寫(policy 給 PUBLIC/含 anon,CHECK=true) → 改 TO authenticated + org 範圍:
--     company_memberships.cm_write / birthday_reward_config.brc_write / survey_questions.sq_write
--  🟠 登入者跨租戶(USING true) → 收斂:
--     members.auth_read_members(SELECT true) → DROP(已有 members_org_sel org_visible 接手)
--     store_bonus_custom_fields.sbcf_auth_all(ALL true,有 org 欄) → 換 org_visible
-- org_visible() 內含 service_role/super_admin 白名單 → provisioning/super_admin 不受影響。
-- 只動這幾條 policy,其餘(cm_sel/brc_sel/sq_sel/sq_public_sel/members_*/admin_write_*)不動。
-- Studio 無交易 → 全寫成 DROP IF EXISTS + CREATE(可重跑)。
-- ════════════════════════════════════════════════════════════════════════════

-- ── 🔴 company_memberships:anon 全寫 → authenticated + org ──
DROP POLICY IF EXISTS cm_write ON public.company_memberships;
CREATE POLICY cm_write ON public.company_memberships FOR ALL TO authenticated
  USING (org_visible(organization_id))
  WITH CHECK (org_visible(organization_id));

-- ── 🔴 birthday_reward_config:anon 全寫 → authenticated + org ──
DROP POLICY IF EXISTS brc_write ON public.birthday_reward_config;
CREATE POLICY brc_write ON public.birthday_reward_config FOR ALL TO authenticated
  USING (org_visible(organization_id))
  WITH CHECK (org_visible(organization_id));

-- ── 🔴 survey_questions:anon 全寫 → authenticated + 走 surveys.org(同 sq_sel) ──
DROP POLICY IF EXISTS sq_write ON public.survey_questions;
CREATE POLICY sq_write ON public.survey_questions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.surveys s
                  WHERE s.id = survey_questions.survey_id AND org_visible(s.organization_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.surveys s
                  WHERE s.id = survey_questions.survey_id AND org_visible(s.organization_id)));

-- ── 🟠 members:跨租戶全看 → DROP(members_org_sel org_visible + members_consumer_sel 已接手) ──
DROP POLICY IF EXISTS auth_read_members ON public.members;

-- ── 🟠 store_bonus_custom_fields:跨租戶全讀寫 → org_visible(有 org 欄) ──
DROP POLICY IF EXISTS sbcf_auth_all ON public.store_bonus_custom_fields;
CREATE POLICY sbcf_org_all ON public.store_bonus_custom_fields FOR ALL TO authenticated
  USING (org_visible(organization_id))
  WITH CHECK (org_visible(organization_id));

NOTIFY pgrst, 'reload schema';
