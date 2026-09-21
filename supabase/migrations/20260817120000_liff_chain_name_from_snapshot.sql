-- ════════════════════════════════════════════════════════════════════════════
-- LIFF「我的簽核進度」關卡名字改用「指派/凍結的簽核人」(與 WEB 同源) — 2026-08-17
-- ════════════════════════════════════════════════════════════════════════════
-- 問題:liff_get_request_chain 的 name 是 COALESCE(h.approver_name, resolver),
--   先信 approval_step_history.approver_name。但費用單(expense_requests)只有單一
--   approved_by 文字欄,ASH trigger 推鏈時把它抄到每一關 → 中間關被覆蓋成同一人。
--   例:#490 總經理關指派韓德森(emp 48),卻被寫成陳虹(emp 52) → LIFF 顯示陳虹。
--   WEB 從不看 ASH 名字,只用快照指派人(韓德森) → 兩邊不一致。
--
-- 修法:把 COALESCE 順序反過來 —— resolver(指派/凍結簽核人)優先,
--   h.approver_name 只當「無快照的舊單」fallback。
--   → 有快照的單:兩邊都顯示指派人(代簽走 label「(X代)」,不受影響)。
--   → 舊單(無 request_chain_snapshots):維持原本用歷史名字,不退化。
--
-- 只動 name 一個欄位的取法;status / reject_reason / 其餘邏輯與 live 完全相同。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.liff_get_request_chain(p_type text, p_id integer)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_snap_type text;
  v_applicant int;
  v_status    text;
  v_approved  boolean;
  v_result json;
BEGIN
  -- snapshot 的 request_type(長名)
  v_snap_type := CASE p_type
    WHEN 'leave'    THEN 'leave_request'
    WHEN 'overtime' THEN 'overtime_request'
    ELSE p_type
  END;

  -- 申請人 employee_id + 單子最終狀態(依 request_type 對應表)
  CASE p_type
    WHEN 'leave'           THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.leave_requests     WHERE id = p_id;
    WHEN 'overtime'        THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.overtime_requests  WHERE id = p_id;
    WHEN 'correction'      THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.clock_corrections  WHERE id = p_id;
    WHEN 'trip'            THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.business_trips      WHERE id = p_id;
    WHEN 'expense_request' THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.expense_requests   WHERE id = p_id;
    WHEN 'expense'         THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.expenses           WHERE id = p_id;
    WHEN 'form_submission' THEN SELECT applicant_id, status INTO v_applicant, v_status FROM public.form_submissions  WHERE id = p_id;
    WHEN 'resignation'     THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.resignation_requests        WHERE id = p_id;
    WHEN 'loa'             THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.leave_of_absence_requests   WHERE id = p_id;
    WHEN 'transfer'        THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.personnel_transfer_requests WHERE id = p_id;
    WHEN 'headcount'       THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.headcount_requests          WHERE id = p_id;
    ELSE v_applicant := NULL;
  END CASE;

  -- 已核准/通過 → 所有關卡視為 completed(current_step 舊單不可靠,只信最終狀態)
  -- 'approved' 為 headcount 英文狀態
  v_approved := v_status IN ('已核准', '已通過', '已核銷', '已結案', 'approved');

  SELECT json_agg(row_to_json(x) ORDER BY x.step_order) INTO v_result FROM (
    SELECT
      s.step_order,
      s.label,
      -- ★ 指派/凍結的簽核人優先(與 WEB 同源);ASH approver_name 只當無快照舊單 fallback。
      --   原本先信 h.approver_name → 費用單中間關被單一 approved_by 覆蓋成同一人(髒值)。
      COALESCE(
        (SELECT string_agg(r.emp_name, '、')
           FROM public.resolve_snapshot_step_approvers(v_snap_type, p_id, s.step_order, v_applicant) r),
        h.approver_name
      ) AS name,
      CASE
        WHEN v_approved THEN 'completed'
        WHEN h.action IN ('rejected','returned','退回','駁回') THEN 'rejected'
        WHEN h.exited_at IS NOT NULL THEN 'completed'
        WHEN h.entered_at IS NOT NULL THEN 'current'
        ELSE 'pending'
      END AS status,
      h.notes AS reject_reason
    FROM public.request_chain_snapshots s
    LEFT JOIN LATERAL (
      SELECT hh.* FROM public.approval_step_history hh
       WHERE hh.request_type = p_type AND hh.request_id = p_id AND hh.step_order = s.step_order
       ORDER BY hh.entered_at DESC LIMIT 1   -- 取最新一筆(重工/退回會有多筆)
    ) h ON true
    WHERE s.request_type = v_snap_type AND s.request_id = p_id
      AND COALESCE(s.auto_skipped, false) = false
  ) x;

  RETURN COALESCE(v_result, '[]'::json);
END $function$;

GRANT EXECUTE ON FUNCTION public.liff_get_request_chain(text, integer) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
