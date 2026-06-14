-- ════════════════════════════════════════════════════════════════════════════
-- 受控的噪音 log 清理（防 Supabase 表爆 + 變慢）
--
-- 只清「純噪音 log」，法規/薪資憑證（audit_logs/approval_step_history/
-- attendance_records/schedules/payroll）一律保留不動。
--
-- 治理規則（避免 cron 怪物）：
--   • 分批刪（每批 5000，用 ctid，不鎖整表）
--   • advisory lock 防重疊（上一輪沒跑完就跳過）
--   • 每次記一筆到 audit_logs（清了哪表幾列，看得到）
--   • 離峰跑（20:00 UTC = 台灣 04:00）
--   • 一支 cron 一個 run_log_cleanup() 調度器，不散開成 N 支
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 分批刪 helper（where 子句由本檔內部寫死，非外部輸入，無注入風險）──
CREATE OR REPLACE FUNCTION public._cleanup_batch(
  p_table TEXT,
  p_where TEXT,
  p_batch INT DEFAULT 5000,
  p_max_batches INT DEFAULT 500   -- runaway 上限：最多 250 萬列/表/次
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total BIGINT := 0; v_n INT; v_i INT := 0;
BEGIN
  LOOP
    EXECUTE format(
      'WITH d AS (SELECT ctid FROM public.%I WHERE %s LIMIT %s) '
      'DELETE FROM public.%I t USING d WHERE t.ctid = d.ctid',
      p_table, p_where, p_batch, p_table);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
    v_i := v_i + 1;
    EXIT WHEN v_n < p_batch OR v_i >= p_max_batches;
  END LOOP;
  RETURN v_total;
END $$;


-- ─── 2. 清理調度器 ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.run_log_cleanup()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSONB := '{}'::jsonb; v_n BIGINT;
BEGIN
  -- 防重疊：上一輪還在跑就直接跳過
  IF NOT pg_try_advisory_lock(778899001122) THEN RETURN; END IF;

  -- LINE 訊息/指令/錯誤 log：90 天
  v_n := public._cleanup_batch('line_messages',      'created_at < now() - interval ''90 days''');
  v_result := v_result || jsonb_build_object('line_messages', v_n);
  v_n := public._cleanup_batch('line_command_logs',  'created_at < now() - interval ''90 days''');
  v_result := v_result || jsonb_build_object('line_command_logs', v_n);
  v_n := public._cleanup_batch('line_error_logs',    'created_at < now() - interval ''90 days''');
  v_result := v_result || jsonb_build_object('line_error_logs', v_n);

  -- 簡訊/通訊 log：90 天
  v_n := public._cleanup_batch('message_logs',       'sent_at < now() - interval ''90 days''');
  v_result := v_result || jsonb_build_object('message_logs', v_n);

  -- 事件流 business_events：30 天（純事件 log）
  v_n := public._cleanup_batch('business_events',    'created_at < now() - interval ''30 days''');
  v_result := v_result || jsonb_build_object('business_events', v_n);

  -- outbox：已送出的 7 天後清（未送的留著）
  v_n := public._cleanup_batch('event_outbox',       'status IN (''sent'',''processed'',''published'') AND created_at < now() - interval ''7 days''');
  v_result := v_result || jsonb_build_object('event_outbox', v_n);

  -- DLQ：已解決/已忽略的 90 天後清（pending 失敗的留著等處理）
  v_n := public._cleanup_batch('dead_letter_queue',  'status IN (''resolved'',''ignored'') AND created_at < now() - interval ''90 days''');
  v_result := v_result || jsonb_build_object('dead_letter_queue', v_n);

  -- 記一筆（看得到每次清了什麼，異常可追）
  INSERT INTO public.audit_logs ("user", action, target, target_table, new_value)
  VALUES ('system', 'log_cleanup', 'noise_logs', 'multiple', v_result::text);

  PERFORM pg_advisory_unlock(778899001122);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(778899001122);  -- 出錯也要放鎖，否則永遠跳過
  RAISE;
END $$;

GRANT EXECUTE ON FUNCTION public.run_log_cleanup() TO service_role;


-- ─── 3. 排程：每天 20:00 UTC（台灣 04:00 離峰）──────────────────────────────
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('nightly-log-cleanup'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('nightly-log-cleanup', '0 20 * * *', $$SELECT public.run_log_cleanup()$$);
  END IF;
END $outer$;

COMMIT;

NOTIFY pgrst, 'reload schema';
