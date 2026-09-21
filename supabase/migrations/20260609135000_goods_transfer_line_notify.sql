-- ════════════════════════════════════════════════════════════════════════════
-- 商品調撥 — LINE 通知 trigger
--
-- AFTER UPDATE on goods_transfer_requests，依 status / current_step 變動
-- POST 給 hr-notify edge function：
--   - chain 推進（current_step 變大、status 仍是 *審核中）→ step_assigned
--   - status → 待驗收  → receipt_pending（通知申請人去填驗收）
--   - status → 已完成  → approved（通知申請人）
--   - status → 已駁回  → rejected（通知申請人）
--
-- INSERT case：第一關 approver 也要通知 → 在 AFTER INSERT 補一個
--
-- 依 feedback_no_diy_flex_card：不在 PG hand-roll flex JSON，全交給 hr-notify
-- 依 feedback_pg_net_signature：用 public.net.http_post（pg_net 0.20.0）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._gt_post_notify(
  p_type    TEXT,
  p_emp_id  INT,
  p_details JSONB
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_url   CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_anon  CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
BEGIN
  IF p_emp_id IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url     := v_url,
    body    := jsonb_build_object(
      'type',        p_type,
      'employee_id', p_emp_id,
      'details',     p_details
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon
    ),
    timeout_milliseconds := 5000
  );
END $$;


-- ─── helper：組 details payload ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._gt_build_details(p_req_id INT, p_extras JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v RECORD;
  v_type_label TEXT;
  v_count INT;
BEGIN
  SELECT * INTO v FROM goods_transfer_requests WHERE id = p_req_id;
  IF v.id IS NULL THEN RETURN '{}'::jsonb; END IF;

  v_type_label := CASE v.transfer_type
    WHEN 'warehouse_to_store' THEN '總倉 → 門市'
    WHEN 'store_to_store'     THEN '門市 → 門市'
    WHEN 'store_to_warehouse' THEN '門市 → 總倉'
    ELSE v.transfer_type
  END;

  SELECT COUNT(*) INTO v_count FROM goods_transfer_items WHERE transfer_request_id = p_req_id;

  RETURN jsonb_build_object(
    'document_no',         v.document_no,
    'applicant_name',      v.applicant_name,
    'transfer_type_label', v_type_label,
    'from_label',          v.from_label,
    'to_label',            v.to_label,
    'items_count',         v_count
  ) || p_extras;
END $$;


-- ─── trigger 主邏輯：依 status / step 變動發通知 ─────────────────────────
CREATE OR REPLACE FUNCTION public.trg_goods_transfer_notify()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_req_type      TEXT;
  v_step_label    TEXT;
  v_approver      RECORD;
  v_details       JSONB;
BEGIN
  -- status 到取消類 → 通知申請人駁回
  IF NEW.status = '已駁回' AND OLD.status IS DISTINCT FROM '已駁回' THEN
    v_details := public._gt_build_details(NEW.id,
      jsonb_build_object('rejection_reason', COALESCE(NEW.reject_reason, '')));
    PERFORM public._gt_post_notify('goods_transfer_rejected', NEW.applicant_id, v_details);
    RETURN NEW;
  END IF;

  -- 申請鏈走完 → 通知申請人去填驗收
  IF NEW.status = '待驗收' AND OLD.status IS DISTINCT FROM '待驗收' THEN
    v_details := public._gt_build_details(NEW.id);
    PERFORM public._gt_post_notify('goods_transfer_receipt_pending', NEW.applicant_id, v_details);
    RETURN NEW;
  END IF;

  -- 驗收鏈走完 → 通知申請人完成
  IF NEW.status = '已完成' AND OLD.status IS DISTINCT FROM '已完成' THEN
    v_details := public._gt_build_details(NEW.id);
    PERFORM public._gt_post_notify('goods_transfer_approved', NEW.applicant_id, v_details);
    RETURN NEW;
  END IF;

  -- chain 推進到下一關（current_step 變大）→ 通知新 approver
  IF NEW.status IN ('申請審核中', '驗收審核中')
     AND NEW.current_chain_id IS NOT NULL
     AND (OLD.current_step IS DISTINCT FROM NEW.current_step OR OLD.status IS DISTINCT FROM NEW.status) THEN

    v_req_type := CASE NEW.current_stage WHEN 'apply' THEN 'goods_transfer_apply' ELSE 'goods_transfer_receipt' END;

    -- 取 step label
    SELECT label INTO v_step_label
      FROM request_chain_snapshots
     WHERE request_type = v_req_type AND request_id = NEW.id AND step_order = NEW.current_step;

    v_details := public._gt_build_details(NEW.id,
      jsonb_build_object('step_label', COALESCE(v_step_label, ''), 'stage', NEW.current_stage));

    -- 解析該 step 的 approvers，逐一發通知
    FOR v_approver IN
      SELECT emp_id FROM public.resolve_snapshot_step_approvers(
        v_req_type, NEW.id, NEW.current_step, NEW.applicant_id
      )
    LOOP
      PERFORM public._gt_post_notify('goods_transfer_step_assigned', v_approver.emp_id, v_details);
    END LOOP;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_goods_transfer_notify ON public.goods_transfer_requests;
CREATE TRIGGER trg_goods_transfer_notify
  AFTER INSERT OR UPDATE ON public.goods_transfer_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_goods_transfer_notify();

COMMIT;

NOTIFY pgrst, 'reload schema';
