-- Complete accounts org-scoping + reseed.
-- The prior migration (20260508160000) was tracked as applied by --include-all
-- but its SQL never ran. This migration does the full job safely.

-- 1. Add organization_id if it doesn't exist yet
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES organizations(id);

-- 2. Drop FK on expense_requests that depends on the old single-column unique index,
--    then drop the constraint itself (code is no longer unique across orgs)
ALTER TABLE expense_requests DROP CONSTRAINT IF EXISTS expense_requests_account_code_fkey;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_code_key;

-- 3. Seed accounts for every org that currently has none
INSERT INTO accounts (code, name, type, parent_code, description, organization_id)
SELECT
  t.code, t.name, t.type, t.parent_code, t.description,
  o.id AS organization_id
FROM (
  VALUES
    ('001',   '租金費用',                 '費用',    NULL,  '門市及辦公室租金'),
    ('002',   '員工薪資',                 '費用',    NULL,  '員工薪資'),
    ('003',   '水電煤',                   '費用',    NULL,  '水費、電費、瓦斯費'),
    ('004',   '易耗品支出',               '費用',    NULL,  '日常消耗品'),
    ('009',   '雜項購置',                 '費用',    NULL,  '零星採購'),
    ('S001',  '文具用品',                 '費用',    '009', '文具、辦公用品'),
    ('S003',  '包材',                     '費用',    '009', '包裝材料'),
    ('S005',  '五金及修繕',               '費用',    '009', '五金工具及維修費'),
    ('S999',  '其他',                     '費用',    '009', '其他雜項'),
    ('010',   '行銷廣告',                 '費用',    NULL,  '廣告、行銷推廣費用'),
    ('011',   '營業費用',                 '費用',    NULL,  '一般營業費用'),
    ('012',   '前期進貨',                 '費用',    NULL,  '前期進貨成本'),
    ('013',   '門市營收',                 '收入',    NULL,  '門市銷售營收'),
    ('014',   '股東往來',                 '週轉金',  NULL,  '股東往來款項'),
    ('015',   '建置費用',                 '費用',    NULL,  '設備建置與安裝費'),
    ('016',   '運費',                     '費用',    NULL,  '物流運輸費'),
    ('017',   '關稅稅金',                 '費用',    NULL,  '進口關稅及稅金'),
    ('018',   '食材樣品',                 '費用',    NULL,  '食材樣品費用'),
    ('019',   '存出保證金',               '資產',    NULL,  '存出保證金'),
    ('020',   '郵電費',                   '費用',    NULL,  '郵資及電信費'),
    ('021',   '進口費用',                 '費用',    NULL,  '進口相關費用'),
    ('022',   '清潔費',                   '費用',    NULL,  '清潔費用'),
    ('023',   '差旅費',                   '費用',    NULL,  '出差交通住宿費'),
    ('024',   '職工福利',                 '費用',    NULL,  '員工福利支出'),
    ('025',   '雜費',                     '費用',    NULL,  '其他雜費'),
    ('027',   '交通費',                   '費用',    NULL,  '交通費用'),
    ('099',   '顧問服務',                 '費用',    NULL,  '顧問諮詢服務費'),
    ('A01',   '零用金退回',               '週轉金',  NULL,  '零用金退回'),
    ('A02',   '前期損益',                 '週轉金',  NULL,  '前期損益結轉'),
    ('00101', '代收-租賃稅',              '代收代付',NULL,  '代收租賃所得稅'),
    ('00102', '代收-二代健保補充保費',    '代收代付',NULL,  '代收二代健保補充保費'),
    ('00201', '代收-員工健保費',          '代收代付',NULL,  '代收員工健保費'),
    ('00202', '代收-員工勞保費',          '代收代付',NULL,  '代收員工勞保費'),
    ('00203', '代收-員工勞退自提',        '代收代付',NULL,  '代收員工勞退自提'),
    ('00204', '保險費-健保',              '代收代付',NULL,  '公司負擔健保費'),
    ('00205', '保險費-勞保',              '代收代付',NULL,  '公司負擔勞保費'),
    ('00206', '勞退自提',                 '代收代付',NULL,  '勞退自提'),
    ('00207', '代收-執行業務所得稅',      '代收代付',NULL,  '代收執行業務所得稅'),
    ('00208', '代收-法院執行',            '代收代付',NULL,  '代收法院強制執行扣款')
) AS t (code, name, type, parent_code, description)
CROSS JOIN organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM accounts WHERE organization_id = o.id
)
ON CONFLICT DO NOTHING;

-- 4. Delete any leftover template rows (no org) if they still exist
DELETE FROM accounts WHERE organization_id IS NULL;

-- 5. Enforce NOT NULL now that every row has an org
ALTER TABLE accounts ALTER COLUMN organization_id SET NOT NULL;

-- 6. Composite unique constraint (idempotent)
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_code_org_key;
ALTER TABLE accounts ADD CONSTRAINT accounts_code_org_key UNIQUE (code, organization_id);

-- 7. Index
CREATE INDEX IF NOT EXISTS idx_accounts_organization_id ON accounts(organization_id);
