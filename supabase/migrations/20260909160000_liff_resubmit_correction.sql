-- 補打卡被駁回 → LIFF「編輯重送」— 2026-09-09
-- ════════════════════════════════════════════════════════════════════════════
-- 背景:其他 HR 單(請假/加班/出差…)被駁回後可在 LIFF「編輯並重送」,由
--   20260727160000 的 trg_hr_reset_step_on_resubmit(current_step 歸0)+
--   trg_hr_resubmit_reject_notify(重推關0)處理。但那組 trigger 只掛 7 張表,
--   ★不含 clock_corrections★,且 ApprovalStatus 前端把 corrections 從重送鈕排除、
--   ClockCorrection 頁也沒吃 ?resubmit=,故補打卡被駁回後「編輯無法重新送」。
--
-- 通知模型(補打卡自己的 trigger):
--   * 新單 INSERT(status=待審核)→ _trg_notify_correction_inserted → _notify_hr_request_approvers 推第一關。
--   * _trg_notify_correction_updated 只在 current_step「遞增」時推下一關;
--     status 從已駁回「回」待審核 + current_step「歸0(遞減)」→ 兩支通知 trigger 都不推。
--   ∴ 重送必須「顯式重推第一關」。
--
-- 設計(對齊 [feedback_minimize_touching_existing]):純新增一支 DEFINER RPC,
--   不改任何現有 function/trigger。RPC 內原子完成:套用編輯欄位 + status 回待審核 +
--   current_step 歸0 + 清 approver/reject_reason + 顯式重推第一關(對齊 INSERT 路徑)。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.liff_resubmit_correction(
  p_line_user_id text,
  p_id           integer,
  p_payload      jsonb DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  emp   public.employees;
  v_cnt int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_EMPLOYEE');
  END IF;

  -- 只有「本人 + 被駁回」的補打卡可重送;順便套用使用者這次的編輯(type/時間/原因)
  UPDATE public.clock_corrections SET
    type            = COALESCE(NULLIF(p_payload->>'type',''), type),
    correction_time = CASE
                        WHEN COALESCE(p_payload->>'correction_time','') <> ''
                          THEN (p_payload->>'correction_time')::time
                        ELSE correction_time
                      END,
    reason          = COALESCE(NULLIF(p_payload->>'reason',''), reason),
    status          = '待審核',
    reject_reason   = NULL,
    approver        = NULL,
    current_step    = 0              -- 整條鏈從關0 重跑(對齊 HR 重送慣例)
  WHERE id = p_id
    AND employee_id = emp.id
    AND status IN ('已退回', '已駁回')
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_NOT_REJECTED');
  END IF;

  -- 顯式重推第一關 approver:status 回待審核 + current_step 歸0(遞減)不會觸發
  -- _trg_notify_correction_updated / _trg_notify_hr_step_advanced(兩者只在遞增時推)。
  PERFORM public._notify_hr_request_approvers('correction', p_id, emp.id);

  RETURN json_build_object('ok', true, 'id', p_id);
END $function$;

REVOKE ALL ON FUNCTION public.liff_resubmit_correction(text, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.liff_resubmit_correction(text, integer, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
