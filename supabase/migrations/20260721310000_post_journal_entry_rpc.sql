-- 會計分錄過帳 RPC(單一原子+根治race) — 2026-07-21
-- ════════════════════════════════════════════════════════════════════════════
-- 前端 postJournalEntry(src/lib/accounting/transactions.js)過帳:更新狀態→逐筆 read-then-write
--   科目餘額。三個問題:
--   1. 非原子 — 狀態改了、餘額只過一半就斷 → 帳目永久錯亂
--   2. race — 餘額「讀出+delta 寫回」,兩筆同時過帳互蓋(程式碼自己標 TODO)
--   3. ★已壞★ — JS 寫 posted_at,但 journal_entries 無此欄(Studio drift)→ PostgREST 報錯
--      → 過帳自 2026-04 起必失敗(最後成功過帳 4/9)。
-- 修:post_journal_entry RPC 單一 transaction:驗借貸平衡→更新狀態→原子 UPDATE accounts
--   SET balance = balance + delta(根治 race)。借貸方向按 code 第一碼判類型(忠實複刻 getAccountType:
--   1資產/2負債/3權益/4收入/5銷貨成本/6營業費用/7營業外;資產+營業費用+銷貨成本為借增,其餘貸增)。
--   補防雙重過帳 guard(已過帳再點→擋,避免餘額被加兩次)。account 更新按 entry 的 org scope。
-- 備:accounts.balance 是快取(權威餘額由 journal_lines 彙總,見 getAccountBalance);仍須正確+原子。
-- ════════════════════════════════════════════════════════════════════════════

-- 補回 posted_at 欄(被 drop / 從未建;過帳審計時間戳)
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS posted_at timestamptz;

CREATE OR REPLACE FUNCTION public.post_journal_entry(
  p_entry_id integer,
  p_actor_id integer DEFAULT NULL   -- auth.uid() 優先;解不到才用(service/測試),前端無法冒名
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller   employees;
  v_entry    journal_entries;
  v_debit    numeric;
  v_credit   numeric;
  v_cnt      int;
  v_line     record;
  v_type     text;
  v_change   numeric;
  v_updated  int := 0;
  v_missing  int := 0;
BEGIN
  -- ── 呼叫者 ──
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL AND p_actor_id IS NOT NULL THEN
    SELECT * INTO v_caller FROM employees WHERE id = p_actor_id;
  END IF;
  IF v_caller.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CALLER_NOT_FOUND');
  END IF;

  SELECT * INTO v_entry FROM journal_entries WHERE id = p_entry_id;
  IF v_entry.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ENTRY_NOT_FOUND');
  END IF;
  -- ★ 防雙重過帳(否則餘額被加兩次)
  IF v_entry.status = '已過帳' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_POSTED');
  END IF;

  -- ── 驗借貸平衡(以 journal_lines 為準,不信前端) ──
  SELECT COALESCE(SUM(ROUND(COALESCE(debit,0)::numeric, 2)), 0),
         COALESCE(SUM(ROUND(COALESCE(credit,0)::numeric, 2)), 0),
         COUNT(*)
    INTO v_debit, v_credit, v_cnt
    FROM journal_lines WHERE entry_id = p_entry_id;
  IF v_cnt = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_LINES');
  END IF;
  IF ROUND(v_debit, 2) <> ROUND(v_credit, 2) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_BALANCED',
                             'total_debit', v_debit, 'total_credit', v_credit);
  END IF;

  -- ── 過帳:更新狀態 ──
  UPDATE journal_entries
     SET status = '已過帳', posted_at = now()
   WHERE id = p_entry_id;

  -- ── 更新科目餘額(原子加法,根治 race) ──
  FOR v_line IN
    SELECT account_code,
           COALESCE(debit,0)::numeric  AS d,
           COALESCE(credit,0)::numeric AS c
      FROM journal_lines WHERE entry_id = p_entry_id
  LOOP
    v_type := CASE substring(v_line.account_code FROM 1 FOR 1)
      WHEN '1' THEN '資產'  WHEN '2' THEN '負債'  WHEN '3' THEN '權益'
      WHEN '4' THEN '收入'  WHEN '5' THEN '銷貨成本'  WHEN '6' THEN '營業費用'
      WHEN '7' THEN '營業外收入/支出'  ELSE '未知'
    END;
    -- 資產/營業費用/銷貨成本:借增貸減;其餘(負債/權益/收入/營業外/未知):貸增借減
    v_change := CASE WHEN v_type IN ('資產','營業費用','銷貨成本')
                     THEN v_line.d - v_line.c ELSE v_line.c - v_line.d END;

    UPDATE accounts
       SET balance = COALESCE(balance,0) + v_change
     WHERE code = v_line.account_code
       AND organization_id = v_entry.organization_id;
    IF FOUND THEN v_updated := v_updated + 1; ELSE v_missing := v_missing + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'entry_id', p_entry_id, 'status', '已過帳',
    'updated_accounts', v_updated, 'missing_accounts', v_missing,
    'total_debit', v_debit, 'total_credit', v_credit
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.post_journal_entry(integer, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
