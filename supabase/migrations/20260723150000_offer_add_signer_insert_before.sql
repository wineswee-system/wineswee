-- 錄取簽核「加簽」改為插在當前關【之前】(對齊一般加簽:邀第三人先審) — 2026-07-23
-- ────────────────────────────────────────────────────────────────────────────
-- 原設計:加簽插在當前關「之後」(v_new_ord = p_after_step + 1),current_step 不動,
--   輪到才發卡。使用者要的是跟一般加簽一致:加簽人排在「當前簽核人之前」先審,
--   簽完再回到原簽核人(例:第2關尤致皓加簽 → 新人變第2關、尤致皓被推到第3關)。
-- 修法:新關佔當前關位置(v_cur),當前簽核人及其後全部 step_order +1;current_step 指向
--   新關(=v_cur)並立即發「輪到你」卡給加簽人;新人簽完由 advance 推進回原簽核人。
--   p_after_step 參數保留(LIFF 仍傳,簽名相容)但不再用於定位——一律插在當前關之前。
-- 影響:僅改 _offer_add_signer 內部定位邏輯;wrapper(add_offer_approval_signer/
--   liff_add_offer_signer)與通知函式 _notify_offer_approval 皆不動。基底=live(無漂移)。

CREATE OR REPLACE FUNCTION public._offer_add_signer(
  p_offer_id int, p_caller_id int, p_privileged bool, p_approver_id int, p_after_step int
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ol      offer_letters;
  v_cur     int;
  v_total   int;
  v_new_ord int;
  v_is_step_approver bool;
BEGIN
  IF p_approver_id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_APPROVER'); END IF;

  SELECT * INTO v_ol FROM offer_letters WHERE id = p_offer_id;
  IF v_ol.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_ol.status <> '待審' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_PENDING', 'status', v_ol.status);
  END IF;

  v_cur := COALESCE(v_ol.current_step, 1);
  SELECT count(*) INTO v_total FROM offer_approval_steps WHERE offer_id = p_offer_id;

  -- 把關:當關簽核人 或 privileged
  SELECT EXISTS(
    SELECT 1 FROM offer_approval_steps
     WHERE offer_id = p_offer_id AND step_order = v_cur AND status = '待審' AND approver_id = p_caller_id
  ) INTO v_is_step_approver;
  IF NOT (v_is_step_approver OR p_privileged) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  -- 插在「當前關之前」:新關佔當前位置,當前簽核人及其後全部 +1(同一 UPDATE,沿用原騰位寫法)
  v_new_ord := v_cur;
  UPDATE offer_approval_steps
     SET step_order = step_order + 1
   WHERE offer_id = p_offer_id AND step_order >= v_new_ord;

  INSERT INTO offer_approval_steps (offer_id, step_order, approver_id, status, organization_id)
  VALUES (p_offer_id, v_new_ord, p_approver_id, '待審', v_ol.organization_id);

  -- 新關 = 當前關 → 指標指向它,並立即發「輪到你」卡給加簽人(原設計靠 advance 發,此處提前)
  UPDATE offer_letters SET current_step = v_new_ord WHERE id = p_offer_id;
  PERFORM public._notify_offer_approval(p_offer_id, 'pending', p_approver_id);

  RETURN json_build_object('ok', true, 'new_step', v_new_ord, 'total_steps', v_total + 1);
END $$;

GRANT EXECUTE ON FUNCTION public._offer_add_signer(int,int,bool,int,int) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
