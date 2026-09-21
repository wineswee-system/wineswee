-- 修 approval_chain_steps guard「RETURN OLD 靜默還原 UPDATE」潛伏 bug + 補 chain 27 直屬主管 — 2026-07-21
--
-- 病灶:_guard_chain_steps_in_flight()(掛 BEFORE UPDATE OF step_order,target_* / BEFORE DELETE)
--   意圖:有在飛單就 RAISE 擋掉,否則放行修改。
--   但結尾一律 RETURN OLD → 對 BEFORE UPDATE 而言 = 丟棄 NEW、還原舊值 → 即使沒在飛單、
--   該放行,任何對 step_order/target_type 的 UPDATE 都被「靜默還原」(改了等於沒改)。
--   自 2026-05-28 起壞著,因為從沒人用 UPDATE 改過鏈步驟(都靠 migration 重建)才沒爆。
--   實測:update chain27 step_order 3→103 回讀仍是 3 → 確認。
--   → 20260721270000 的 +100/-99 全變 no-op,rows 沒動,INSERT step_order=0 撞 unique(23505)。
--
-- 正解:BEFORE UPDATE 要 RETURN NEW(放行修改);BEFORE DELETE 才 RETURN OLD(放行刪除)。
--   對齊 [[feedback_migration_partial_overwrite_disaster]]:incremental 改,不整支洗掉在飛單保護邏輯。

CREATE OR REPLACE FUNCTION public._guard_chain_steps_in_flight()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_count INT;
  v_tables TEXT[] := ARRAY[
    'expense_requests', 'leave_requests', 'overtime_requests',
    'business_trips', 'clock_corrections', 'resignation_requests',
    'leave_of_absence_requests', 'personnel_transfer_requests', 'headcount_requests'
  ];
  v_table TEXT;
BEGIN
  -- 在飛單保護:任一 HR B 表有引用本 chain 的申請中/待審單 → 擋
  v_count := 0;
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format(
      'SELECT COUNT(*) FROM public.%I WHERE approval_chain_id = $1 AND status IN (''申請中'',''待審'',''待審核'')',
      v_table
    ) USING OLD.chain_id INTO v_count;
    IF v_count > 0 THEN
      RAISE EXCEPTION
        'Chain % 有 % 張在飛單（表：%），請先等這些單完成或手動處理後再修改簽核流程',
        OLD.chain_id, v_count, v_table
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- form_submissions 透過 form_templates.approval_chain_id
  SELECT COUNT(*) INTO v_count
    FROM public.form_submissions fs
    JOIN public.form_templates ft ON ft.id = fs.template_id
   WHERE ft.approval_chain_id = OLD.chain_id
     AND fs.status IN ('申請中','待審','待審核','pending');
  IF v_count > 0 THEN
    RAISE EXCEPTION
      'Chain % 有 % 張在飛的 form_submissions，請先等完成後再修改',
      OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  -- ★修正:DELETE 回 OLD(放行刪除);UPDATE 回 NEW(放行修改,不再靜默還原)
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END $$;


-- ── chain 27(人力需求)補首關「直屬主管」→ 直屬主管→部門主管→執行長→總經理→人資主管 ──
-- headcount_requests 目前 0 筆(無在飛單)→ guard 不會 RAISE。idempotent。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.approval_chain_steps
     WHERE chain_id = 27 AND target_type = 'applicant_supervisor'
  ) THEN
    -- 其餘關往後挪一位(先 +100 避開 UNIQUE(chain,step_order),再 -99 → 0..3 變 1..4)
    UPDATE public.approval_chain_steps SET step_order = step_order + 100 WHERE chain_id = 27;
    UPDATE public.approval_chain_steps SET step_order = step_order - 99  WHERE chain_id = 27;
    INSERT INTO public.approval_chain_steps
      (chain_id, step_order, label, role_name, target_type, organization_id, skip_if_no_approver)
    VALUES
      (27, 0, '直屬主管', '直屬主管', 'applicant_supervisor', 1, false);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
