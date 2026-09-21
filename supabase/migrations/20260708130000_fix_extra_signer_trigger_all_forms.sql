-- 🎯 真兇修復：加簽通知觸發器只對 expense/goods_transfer 發卡，其他表單靜默跳過 — 2026-07-08
-- 病根：_trg_extra_signer_inserted 內部只有
--         IF source_table='expense_requests' THEN 發卡
--         ELSIF source_table='goods_transfer_requests' THEN 發卡
--       其餘(請假/加班/補打卡/門市稽核/自訂表單/報帳/HR異動…)→ 沒有分支 → 不發卡。
--       (整個「加簽人沒收到」saga 的最底層原因。先前改 _notify_extra_signer 的通用 dispatch
--        根本沒被觸發器呼叫到，因為對非費用單它壓根沒 call。)
-- 修法：goods_transfer 維持專用路徑；其餘一律走 _notify_extra_signer
--       (內部已 dispatch：expense→expense_flex、其他→generic_flex 通用卡)。
-- 純改函式；觸發器綁定已在 20260708120000 補好。idempotent。

CREATE OR REPLACE FUNCTION public._trg_extra_signer_inserted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

  IF NEW.source_table = 'goods_transfer_requests' THEN
    -- 商品調撥：透過 _gt_post_notify 走 hr-notify 統一渲染 flex
    PERFORM public._gt_post_notify(
      'goods_transfer_extra_assigned',
      NEW.assignee_id,
      public._gt_build_details(
        NEW.source_id,
        jsonb_build_object(
          'extra_step_id', NEW.id,
          'reason', COALESCE(NEW.reason, ''),
          'requested_by_name', (SELECT name FROM employees WHERE id = NEW.requested_by_id)
        )
      )
    );
  ELSE
    -- 其餘所有表單（expense_requests + 請假/加班/補打卡/門市稽核/自訂表單/報帳/HR異動…）
    -- 一律走 _notify_extra_signer；它內部會 dispatch：
    --   expense_requests/expense_settles → _push_extra_signer_expense_flex
    --   其他                              → _push_extra_signer_generic_flex（通用卡）
    PERFORM public._notify_extra_signer(NEW.id, NEW.assignee_id, 'extra_assigned');
  END IF;

  RETURN NEW;
END
$function$;
