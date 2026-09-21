-- loa 留停:補簽核鏈設定(比照離職/異動) — 2026-07-21
-- ════════════════════════════════════════════════════════════════════════════
-- loa 在 form_chain_configs 完全沒設定 → 送留停單時 _auto_apply_hr_form_chain 查無鏈
--   → approval_chain_id 留 NULL → 卡在無鏈狀態(在飛 0 筆,尚未爆但遲早)。
-- 比照 resignation/transfer:manager→#31 主管、staff→#32 行政、store_staff→#45 門市。
-- 冪等:NOT EXISTS guard,可重複跑;org=1。
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.form_chain_configs (form_type, organization_id, chain_id, applicant_type, is_active)
SELECT v.form_type, v.org, v.chain_id, v.applicant_type, true
  FROM (VALUES
    ('loa', 1, 31, 'manager'),
    ('loa', 1, 32, 'staff'),
    ('loa', 1, 45, 'store_staff')
  ) AS v(form_type, org, chain_id, applicant_type)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.form_chain_configs f
    WHERE f.form_type = v.form_type
      AND f.organization_id = v.org
      AND f.applicant_type = v.applicant_type
 );

NOTIFY pgrst, 'reload schema';
