-- ════════════════════════════════════════════════════════════════════════════
-- 非經常性費用申請:加「核銷(驗收)單位」
-- 2026-06-24
--
-- 申請人 ≠ 核銷人。申請建立時指定「核銷(驗收)單位」:
--   選部門 → 該部門 manager_id;選營運部 → 再選門市 → 門市 manager_id(店長)。
-- 申請簽核「通過(→已核准)」後,由 trigger 解析出核銷人(settle_assignee_id)
-- 並推 LINE 卡提醒他去送核銷(驗收)單。(trigger 另支 migration)
--
-- 純加欄位、idempotent。
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.expense_requests
  ADD COLUMN IF NOT EXISTS settle_department_id INT REFERENCES departments(id),
  ADD COLUMN IF NOT EXISTS settle_store_id      INT REFERENCES stores(id),
  ADD COLUMN IF NOT EXISTS settle_assignee_id   INT REFERENCES employees(id);

COMMENT ON COLUMN public.expense_requests.settle_department_id IS '核銷(驗收)單位 — 部門(申請時選);非營運部時核銷人=該部門 manager_id';
COMMENT ON COLUMN public.expense_requests.settle_store_id      IS '核銷(驗收)單位 — 門市(僅選營運部時);核銷人=該門市 manager_id(店長)';
COMMENT ON COLUMN public.expense_requests.settle_assignee_id   IS '核銷人 — 申請通過(→已核准)時由 trigger 依上面兩欄解析寫入';
