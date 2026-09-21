-- ============================================================================
-- 複製到新專案後：把 DB 內嵌的「舊專案 URL + 舊 ref + 舊 anon key」就地全換成新專案的。
--
-- ⚠️ 這【不是】自動 migration。只在【新專案】的 SQL editor 手動跑一次。
--    絕對不要在舊專案 / 廠商專案跑（會把原本正常的網址改壞）。
--
-- 原理：pg_get_functiondef 掃出所有 body 內含舊字串的函式/程序 → CREATE OR REPLACE
--       就地替換；連老闆 Studio 改出來、migration 檔沒有的 drift 也一起抓。
--       cron.job.command 也一併換。idempotent：換完再跑就 no-op。
--
-- 實測(2026-07-23，對線上舊專案)：24 支活函式內嵌舊 URL、20 支內嵌舊 anon。
-- 你只要改下面兩個 v_new_* 的值，其餘（舊值/舊 ref）已填好。
-- ============================================================================

DO $$
DECLARE
  -- ── 舊值（已填好，不用動）──────────────────────────────────────────────
  v_old_url  text := 'https://mvkvnuxeamahhfahclmi.supabase.co';
  v_old_ref  text := 'mvkvnuxeamahhfahclmi';
  v_old_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';

  -- ── 新值（★★ 改這兩個 ★★）────────────────────────────────────────────
  v_new_url  text := 'https://uoernfpfieurtjqwbnii.supabase.co';   -- ✅ 已填(新專案 ref)
  v_new_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvZXJuZnBmaWV1cnRqcXdibmlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3Nzg0NDUsImV4cCI6MjEwMDM1NDQ0NX0.jubKj63U9L4GiosFbu0p530zepbcdVTG86XSua1SnsU';   -- ✅ 已填(新專案 anon)

  -- ── 安全確認：你人在【新專案】的 SQL editor，才改成 true ──────────────
  v_on_new_project boolean := false;

  v_new_ref  text;
  r    record;
  v_def text;
  v_fn_cnt   int := 0;
  v_err_cnt  int := 0;
  v_cron_cnt int := 0;
BEGIN
  -- 從新 URL 解出新 ref（給「裸 ref」置換用，例如 storage 公開網址）
  v_new_ref := regexp_replace(v_new_url, '^https://([^.]+)\.supabase\.co/?$', '\1');

  -- 護欄 1：一定要填好新值
  IF v_new_url  LIKE '%__新REF__%'
  OR v_new_anon LIKE '%__新專案%'
  OR v_new_url  = v_old_url
  OR v_new_anon = v_old_anon
  OR v_new_ref  = v_new_url THEN   -- regexp 沒解出 ref = URL 格式不對
    RAISE EXCEPTION '請先把 v_new_url / v_new_anon 換成【新專案】的實際值（URL 需為 https://xxx.supabase.co）';
  END IF;

  -- 護欄 2：確認在新專案（避免誤在舊/廠商專案執行把網址改壞）
  IF NOT v_on_new_project THEN
    RAISE EXCEPTION '請確認你正在【新專案】的 SQL editor，然後把 v_on_new_project 改成 true 再跑';
  END IF;

  -- ── 1) 重寫所有 body 內含舊 URL / 舊 ref / 舊 anon 的函式與程序 ──────────
  --    prokind f=函式 p=程序；每支獨立 try，壞一支不中斷其他支
  FOR r IN
    SELECT p.oid, n.nspname, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN (
            'pg_catalog','information_schema','extensions','graphql','graphql_public',
            'pgbouncer','realtime','storage','vault','net','cron','supabase_functions',
            'pgsodium','pgsodium_masks','auth'
          )
      AND p.prokind IN ('f','p')
      AND pg_get_functiondef(p.oid) LIKE '%' || v_old_ref || '%'   -- 含 URL 與 ref 兩種情形
  LOOP
    BEGIN
      v_def := pg_get_functiondef(r.oid);
      v_def := replace(v_def, v_old_url,  v_new_url);
      v_def := replace(v_def, v_old_anon, v_new_anon);
      v_def := replace(v_def, v_old_ref,  v_new_ref);   -- 收尾：裸 ref（storage 公開網址等）
      EXECUTE v_def;
      v_fn_cnt := v_fn_cnt + 1;
    EXCEPTION WHEN OTHERS THEN
      v_err_cnt := v_err_cnt + 1;
      RAISE WARNING '⚠️ 重寫失敗：%.% — %', r.nspname, r.proname, SQLERRM;
    END;
  END LOOP;

  -- ── 2) pg_cron 排程指令內嵌的 URL / anon / ref ────────────────────────
  UPDATE cron.job
  SET command = replace(replace(replace(command, v_old_url, v_new_url), v_old_anon, v_new_anon), v_old_ref, v_new_ref)
  WHERE command LIKE '%' || v_old_ref || '%';
  GET DIAGNOSTICS v_cron_cnt = ROW_COUNT;

  RAISE NOTICE '✅ 重寫函式/程序 % 支（失敗 %）、更新 cron 排程 % 筆', v_fn_cnt, v_err_cnt, v_cron_cnt;
  IF v_err_cnt > 0 THEN
    RAISE NOTICE '有失敗的請把上面 WARNING 貼給我處理';
  END IF;
END $$;

-- ── 3) 驗證：跑完應該【一筆都查不到】舊字串 ────────────────────────────────
-- 還有殘留就是漏抓（例如在被排除的 schema），把結果貼給我。
SELECT n.nspname AS schema, p.proname AS still_has_old_ref
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE pg_get_functiondef(p.oid) LIKE '%mvkvnuxeamahhfahclmi%'
ORDER BY 1, 2;

SELECT jobid, jobname, 'cron 仍含舊字串' AS flag
FROM cron.job
WHERE command LIKE '%mvkvnuxeamahhfahclmi%';
