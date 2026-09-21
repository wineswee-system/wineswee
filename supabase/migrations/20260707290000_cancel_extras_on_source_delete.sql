-- 加簽孤兒清理：刪單(軟刪/硬刪)時自動取消其 pending 加簽 + 回填現有孤兒 — 2026-07-07
-- 背景：刪掉來源單(deleted_at 軟刪 或 DELETE 硬刪)時，approval_extra_steps 的 pending 加簽
--       沒被連帶清掉 → 變孤兒還掛在加簽人「我的簽核」/LINE/LIFF。
-- 作法：(1) AFTER UPDATE(deleted_at 新設) OR DELETE 觸發器 → 取消該單 pending 加簽(status=cancelled)。
--            取消後自然從所有 pending 清單掉出(list RPC 都篩 status='pending')。
--       (2) 回填：把現有「來源已軟刪/硬刪」的 pending 加簽一次取消。
-- 純加法 + 資料校正；用 to_jsonb 相容有/無 deleted_at 的表；idempotent。

CREATE OR REPLACE FUNCTION public._cancel_extras_on_source_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_id := (to_jsonb(OLD)->>'id')::int;
    UPDATE public.approval_extra_steps
       SET status = 'cancelled', cancelled_at = now()
     WHERE source_table = TG_TABLE_NAME AND source_id = v_id AND status = 'pending';
    RETURN OLD;
  ELSE  -- UPDATE：deleted_at 由 NULL → 非 NULL（軟刪）
    IF (to_jsonb(OLD)->>'deleted_at') IS NULL AND (to_jsonb(NEW)->>'deleted_at') IS NOT NULL THEN
      UPDATE public.approval_extra_steps
         SET status = 'cancelled', cancelled_at = now()
       WHERE source_table = TG_TABLE_NAME AND source_id = (to_jsonb(NEW)->>'id')::int AND status = 'pending';
    END IF;
    RETURN NEW;
  END IF;
END $$;

-- 掛到所有支援加簽的表單表（含 expense；跳過不存在的表）
DO $$
DECLARE
  t text;
  v_tables text[] := ARRAY[
    'leave_requests','overtime_requests','business_trips','clock_corrections','off_requests',
    'personnel_transfer_requests','resignation_requests','leave_of_absence_requests',
    'headcount_requests','goods_transfer_requests','shift_cover_requests','store_audits',
    'form_submissions','expense_requests'
  ];
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_cancel_extras_on_delete ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_cancel_extras_on_delete AFTER UPDATE OR DELETE ON public.%I '
        'FOR EACH ROW EXECUTE FUNCTION public._cancel_extras_on_source_delete()', t);
    END IF;
  END LOOP;
END $$;

-- (2) 回填：現有 pending 加簽中，來源已「硬刪(不存在)或軟刪(deleted_at)」的 → 取消
DO $$
DECLARE
  r record;
  v_exists int;
  v_del timestamptz;
BEGIN
  FOR r IN SELECT id, source_table, source_id FROM public.approval_extra_steps WHERE status = 'pending' LOOP
    v_exists := NULL; v_del := NULL;
    BEGIN
      EXECUTE format('SELECT 1 FROM public.%I WHERE id = $1', r.source_table) INTO v_exists USING r.source_id;
    EXCEPTION WHEN undefined_table THEN CONTINUE;
    END;
    IF v_exists IS NULL THEN
      UPDATE public.approval_extra_steps SET status='cancelled', cancelled_at=now() WHERE id = r.id;
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE format('SELECT deleted_at FROM public.%I WHERE id = $1', r.source_table) INTO v_del USING r.source_id;
    EXCEPTION WHEN undefined_column THEN v_del := NULL;
    END;
    IF v_del IS NOT NULL THEN
      UPDATE public.approval_extra_steps SET status='cancelled', cancelled_at=now() WHERE id = r.id;
    END IF;
  END LOOP;
END $$;
