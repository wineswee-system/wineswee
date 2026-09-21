-- 加簽 #2 擋關：有 pending 加簽時，主流程不能推進 — 2026-07-07
-- 作法：BEFORE UPDATE 觸發器(純加法，不動任何現有 approve RPC)。當某單「往核准方向推進」
--       (current_step 增加，或 status 變核准態)且該關前有 pending 加簽 → RAISE 擋下。
--       用 to_jsonb(NEW/OLD) 讀欄位 → 對「有/沒有 current_step」的表都通用、不會因缺欄編譯失敗。
--       退回/駁回不擋(可以在有加簽時照樣駁回)。加簽人簽完(status→approved)後，同一動作重按即放行。
-- 排除 expense_requests/expense_settles：它們在 liff_approve_request 內已有 PENDING_EXTRA_STEP 檢查。
-- idempotent：先 DROP 再建；跳過不存在的表。

CREATE OR REPLACE FUNCTION public._guard_pending_extra_step()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := to_jsonb(OLD);
  v_step_old int := NULLIF(v_old->>'current_step','')::int;
  v_step_new int := NULLIF(v_new->>'current_step','')::int;
  v_st_old   text := v_old->>'status';
  v_st_new   text := v_new->>'status';
  v_check_step int := COALESCE(v_step_old, 0);
  v_advancing boolean;
  v_pending int;
BEGIN
  -- 是否往「核准方向」推進：關數往前，或狀態變核准態
  v_advancing :=
    (v_step_new IS NOT NULL AND v_step_old IS NOT NULL AND v_step_new > v_step_old)
    OR (v_st_new IS DISTINCT FROM v_st_old
        AND v_st_new IN ('已核准','已核銷','已通過','已完成','approved'));
  IF NOT v_advancing THEN RETURN NEW; END IF;

  SELECT id INTO v_pending
  FROM public.approval_extra_steps
  WHERE source_table = TG_TABLE_NAME
    AND source_id = (v_new->>'id')::int
    AND insert_before_step = v_check_step
    AND status = 'pending'
  LIMIT 1;

  IF v_pending IS NOT NULL THEN
    RAISE EXCEPTION '此單第 % 關前有待會簽的加簽（#%），請先讓加簽人完成會簽再核准', v_check_step, v_pending
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;

-- 掛到所有支援加簽的表單表（不含 expense，跳過不存在的表）
DO $$
DECLARE
  t text;
  v_tables text[] := ARRAY[
    'leave_requests','overtime_requests','business_trips','clock_corrections','off_requests',
    'personnel_transfer_requests','resignation_requests','leave_of_absence_requests',
    'headcount_requests','goods_transfer_requests','shift_cover_requests','store_audits',
    'form_submissions'
  ];
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_guard_pending_extra ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_guard_pending_extra BEFORE UPDATE ON public.%I '
        'FOR EACH ROW EXECUTE FUNCTION public._guard_pending_extra_step()', t);
    END IF;
  END LOOP;
END $$;
