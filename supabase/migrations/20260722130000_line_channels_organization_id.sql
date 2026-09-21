-- LINE 多租戶:line_channels 加 organization_id — 2026-07-22
-- ════════════════════════════════════════════════════════════════════════════
-- 問題:LINE 整合當初單租戶設計,line_channels/employee_line_accounts/line_groups/
--   line_messages/line_command_logs 全無 organization_id → 其他組織(Demo/org2)登入
--   看得到威士威(org1)的官方帳號/綁定/群組/訊息/指令。老闆多租戶 RLS 收斂救不到,
--   因為根本沒 org 欄可濾。
-- 做法(最小侵入):只給「根表」line_channels 加 organization_id;下游 4 表靠既有
--   channel_id FK 連動(前端用 channel_id IN 本組織channel 過濾),不動它們 schema、
--   不用改 webhook Edge Function、不加 RLS(避免踩 LINE RLS 舊雷)。
-- 回填:現有 2 個 channel + 全部 87 筆綁定經查證都屬 org1(威耀),org2 無任何 LINE
--   資料 → 全部歸 1。新 channel 由前端建立時帶 profile.organization_id。
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.line_channels
  ADD COLUMN IF NOT EXISTS organization_id bigint REFERENCES public.organizations(id);

-- 現有 channel 全屬 org1(威耀);查證:org2 無任何 LINE channel/綁定
UPDATE public.line_channels SET organization_id = 1 WHERE organization_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_line_channels_org ON public.line_channels(organization_id);

NOTIFY pgrst, 'reload schema';
