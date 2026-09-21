-- 修:加簽人核准後沒通知回原發起簽核人(只 HR 表單中招)。
-- _trg_extra_signer_updated 原本只有 expense_requests / goods_transfer_requests 分支,
-- 其他 source_table(人事異動 personnel_transfer_requests、離職等 HR 表單)落到 fallthrough RETURN NEW → 加簽人 approved/rejected 後不通知回發起人。
-- 補 generic 分支:approved/rejected 通知回 requested_by_id、cancelled 通知 assignee_id(走 _push_extra_signer_generic_flex)。expense/goods 分支不動。

CREATE OR REPLACE FUNCTION public._trg_extra_signer_updated()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req_exp expense_requests;
  v_req_gt  goods_transfer_requests;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  -- expense_request 流程（保持既有邏輯）
  IF NEW.source_table = 'expense_requests' THEN
    IF OLD.status = 'pending' AND NEW.status = 'approved' THEN
      PERFORM public._notify_extra_signer(NEW.id, NEW.requested_by_id, 'extra_approved_back');
    ELSIF OLD.status = 'pending' AND NEW.status = 'rejected' THEN
      SELECT * INTO v_req_exp FROM expense_requests WHERE id = NEW.source_id;
      IF v_req_exp.id IS NOT NULL AND v_req_exp.status IN ('申請中', '待審') THEN
        UPDATE expense_requests
        SET status = '已駁回',
            reject_reason = '加簽人 ' || COALESCE(
              (SELECT name FROM employees WHERE id = NEW.assignee_id), '未知'
            ) || ' 退回：' || COALESCE(NEW.reject_reason, ''),
            approved_at = NOW()
        WHERE id = NEW.source_id;
      END IF;
      PERFORM public._notify_extra_signer(NEW.id, NEW.requested_by_id, 'extra_rejected_back');
    ELSIF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
      PERFORM public._notify_extra_signer(NEW.id, NEW.assignee_id, 'extra_cancelled_info');
    END IF;
    RETURN NEW;
  END IF;

  -- 商品調撥流程
  IF NEW.source_table = 'goods_transfer_requests' THEN
    IF OLD.status = 'pending' AND NEW.status = 'approved' THEN
      PERFORM public._gt_post_notify(
        'goods_transfer_extra_approved_back', NEW.requested_by_id,
        public._gt_build_details(
          NEW.source_id,
          jsonb_build_object(
            'assignee_name', (SELECT name FROM employees WHERE id = NEW.assignee_id)
          )
        )
      );
    ELSIF OLD.status = 'pending' AND NEW.status = 'rejected' THEN
      SELECT * INTO v_req_gt FROM goods_transfer_requests WHERE id = NEW.source_id;
      IF v_req_gt.id IS NOT NULL AND v_req_gt.status IN ('申請審核中', '驗收審核中') THEN
        UPDATE goods_transfer_requests
        SET status = '已駁回',
            reject_reason = '加簽人 ' || COALESCE(
              (SELECT name FROM employees WHERE id = NEW.assignee_id), '未知'
            ) || ' 退回：' || COALESCE(NEW.reject_reason, ''),
            rejected_at = NOW(),
            current_chain_id = NULL, current_step = 0, current_stage = NULL
        WHERE id = NEW.source_id;
      END IF;
      PERFORM public._gt_post_notify(
        'goods_transfer_extra_rejected_back', NEW.requested_by_id,
        public._gt_build_details(
          NEW.source_id,
          jsonb_build_object('rejection_reason', COALESCE(NEW.reject_reason, ''))
        )
      );
    ELSIF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
      PERFORM public._gt_post_notify(
        'goods_transfer_extra_cancelled_info', NEW.assignee_id,
        public._gt_build_details(NEW.source_id)
      );
    END IF;
    RETURN NEW;
  END IF;

  -- 其他表單(HR:人事異動/離職等)generic:加簽人核准/退回/取消 → 通知回原發起簽核人(補漏,原本只有 expense/goods)
  IF OLD.status = 'pending' AND NEW.status = 'approved' THEN
    PERFORM public._notify_extra_signer(NEW.id, NEW.requested_by_id, 'extra_approved_back');
  ELSIF OLD.status = 'pending' AND NEW.status = 'rejected' THEN
    PERFORM public._notify_extra_signer(NEW.id, NEW.requested_by_id, 'extra_rejected_back');
  ELSIF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
    PERFORM public._notify_extra_signer(NEW.id, NEW.assignee_id, 'extra_cancelled_info');
  END IF;
  RETURN NEW;
END
$function$;
