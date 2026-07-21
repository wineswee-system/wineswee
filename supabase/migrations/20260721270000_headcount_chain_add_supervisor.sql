-- 人力需求單簽核鏈補「直屬主管」為首關 — 2026-07-21
-- 現況 chain 27(人力需求 form_chain_configs applicant_type='all' 用的)為 4 關:
--   部門主管 → 陳虹(執行長,fixed_emp 52) → 韓德森(總經理,fixed_emp 48) → 人資主管(specific_dept_manager dept 26)
-- 使用者定案 5 關:直屬主管 → 部門主管 → 陳虹 → 韓德森 → 人資主管。差首關「直屬主管」。
-- headcount_requests 目前 0 筆(無在飛單)→ 安全。idempotent(已有 applicant_supervisor 步驟就不動)。

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.approval_chain_steps
     WHERE chain_id = 27 AND target_type = 'applicant_supervisor'
  ) THEN
    -- 其餘關往後挪一位(先 +100 避免 UNIQUE(chain,step_order) 撞,再 -99 → 0..3 變 1..4)
    UPDATE public.approval_chain_steps SET step_order = step_order + 100 WHERE chain_id = 27;
    UPDATE public.approval_chain_steps SET step_order = step_order - 99  WHERE chain_id = 27;
    -- 插入首關:直屬主管
    INSERT INTO public.approval_chain_steps
      (chain_id, step_order, label, role_name, target_type, organization_id, skip_if_no_approver)
    VALUES
      (27, 0, '直屬主管', '直屬主管', 'applicant_supervisor', 1, false);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
