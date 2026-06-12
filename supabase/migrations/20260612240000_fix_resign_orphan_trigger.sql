-- ════════════════════════════════════════════════════════════════════════════
-- 修 _trg_emp_resign_chain_warn：audit_logs."user" 是 NOT NULL，
-- 但這個「離職孤兒鏈警告」trigger 的 INSERT 沒填 user → 任何員工轉離職都 23502 爆掉。
--
-- 修法：
--   1. INSERT 補 "user" = 'system'（不再違反 NOT NULL）
--   2. 同時把 trigger 改成「只在繞過 RPC 時才警告」其實做不到（trigger 無法知道來源），
--      所以維持原行為但不再 crash。resign_employee 正常交接時 chain 已轉走，
--      v_chain_count=0 就不會 INSERT。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._trg_emp_resign_chain_warn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_chain_count INT;
BEGIN
  IF NEW.status IN ('離職', '留職停薪')
     AND (OLD.status IS DISTINCT FROM NEW.status) THEN

    SELECT COUNT(*) INTO v_chain_count
    FROM public.approval_chain_steps
    WHERE target_type = 'fixed_emp' AND target_emp_id = NEW.id;

    IF v_chain_count > 0 THEN
      INSERT INTO public.audit_logs ("user", action, target, target_table, target_id, old_value, new_value)
      VALUES (
        'system',                              -- ★ 補 NOT NULL 的 user
        'resign_chain_orphan_warning',
        NEW.name, 'employees', NEW.id,
        'status: ' || COALESCE(OLD.status, ''),
        'status: ' || NEW.status
          || ' | chain_steps_still_pointing: ' || v_chain_count
          || ' | WARNING: 仍有寫死簽核關卡指向離職者，請確認是否走交接'
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
