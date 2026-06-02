-- approval_chains.name unique constraint 改為 per-org（多租戶不該全域鎖名稱）
-- 順便允許 organization_id IS NULL 的全域 seed chain 同名不干擾

-- 移除舊的全域 unique(name)
ALTER TABLE public.approval_chains
  DROP CONSTRAINT IF EXISTS approval_chains_name_key;

-- 加 per-org unique（organization_id IS NULL 的全域 seed chain 不限制）
CREATE UNIQUE INDEX IF NOT EXISTS approval_chains_name_org_key
  ON public.approval_chains (name, organization_id)
  WHERE organization_id IS NOT NULL;
