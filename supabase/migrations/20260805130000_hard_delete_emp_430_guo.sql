-- 硬刪員工 郭中亨(#430 / W2026066)— 2026-08-05
-- ════════════════════════════════════════════════════════════════════════════
-- 老闆要求:此人為誤建的假帳(到職=離職同為 2026-07-09,從未打卡),直接刪除
--   (不走離職軟刪)。比照 20260804180000_hard_delete_emp_475_cheng.sql。
--
-- 刪除前盤點(service-role 實查 2026-08-05):
--   schedules        = 7 筆(全 2026-07、店 MIa、published、actual_hours 全 null → 空排班)
--   leave_balances   = 4 筆(系統自動 seed 的假別額度,used_days 全 0)
--   salary_structures= 1 筆(建員工時自動產生)
--   line_users       = 1 筆(LINE 綁定 display_name="Pk")
--   薪資記錄/打卡/請假單/加班/任務/補休/資遣/逐筆調整 = 全 0;被當主管/店長 = 0
--
-- ⚠ 手動列表曾漏掉 line_users 的 FK → 改「動態掃 FK」:自動找出所有單欄 FK 指向
--    employees.id 的子表,逐一刪 =430 的列,最後刪本人。任何漏網 FK 一次收齊。
--    (排除 employees 自參照 supervisor_id/reporting_to,避免誤刪其他員工;已驗 0 筆)
-- ⚠ 2026-07 MIa 已鎖定 → 設 schedules.bypass_lock 旁路。schedules 的 a_歸檔 trigger
--    仍會先把 7 筆存進 schedule_deletions(可救援)。
-- 整段 DO block = 單一 transaction,任一步失敗即全 rollback,不留殘骸。冪等可重跑。
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_emp_id int := 430;
  r   record;
BEGIN
  -- 安全閘門:id 必須真的是 郭中亨 / W2026066,否則中止(冪等:已刪過→NOT FOUND→靜默結束)
  IF NOT EXISTS (
    SELECT 1 FROM public.employees
     WHERE id = v_emp_id AND employee_number = 'W2026066' AND name = '郭中亨'
  ) THEN
    RAISE NOTICE '員工 % 不存在或身分不符(可能已刪),略過。', v_emp_id;
    RETURN;
  END IF;

  -- 旁路排班鎖定(transaction-local,DO 內單一交易)
  PERFORM set_config('schedules.bypass_lock', 'on', true);

  -- 掃出所有「單欄 FK 指向 employees.id」的子表(排除 employees 自參照),逐一刪 =430
  FOR r IN
    SELECT c.conrelid::regclass::text AS child_table, a.attname AS child_col
    FROM pg_constraint c
    JOIN pg_attribute a  ON a.attrelid  = c.conrelid  AND a.attnum  = c.conkey[1]
    JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = c.confkey[1]
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.employees'::regclass
      AND fa.attname  = 'id'
      AND array_length(c.conkey, 1) = 1
      AND c.conrelid <> 'public.employees'::regclass   -- 不碰自參照,避免誤刪其他員工
  LOOP
    EXECUTE format('DELETE FROM %s WHERE %I = $1', r.child_table, r.child_col) USING v_emp_id;
    RAISE NOTICE '已刪子表 %(%s = %)', r.child_table, r.child_col, v_emp_id;
  END LOOP;

  -- 最後刪員工本人(三重把關)
  DELETE FROM public.employees
   WHERE id = v_emp_id AND employee_number = 'W2026066' AND name = '郭中亨';
  RAISE NOTICE '已刪員工 郭中亨(id=%)', v_emp_id;
END $$;

-- 驗證(應皆 0 筆):
-- SELECT count(*) FROM public.employees        WHERE id = 430;
-- SELECT count(*) FROM public.schedules        WHERE employee_id = 430;
-- SELECT count(*) FROM public.leave_balances   WHERE employee_id = 430;
-- SELECT count(*) FROM public.salary_structures WHERE employee_id = 430;
-- SELECT count(*) FROM public.line_users        WHERE employee_id = 430;
-- 救援(如需還原排班):
-- SELECT row_json FROM public.schedule_deletions WHERE employee_id = 430;
