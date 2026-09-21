-- 全系統函式健檢:啟用 plpgsql_check + 一鍵驗證所有函式 — 2026-07-08
-- 目的:深度驗證每支 plpgsql 函式，抓出「引用不存在的欄位 / 型別錯 / SQL 錯」——
--       就是今天 _trg_leave_approval_sync_schedule(SELECT user_id) 這種「執行才炸」的雷，
--       但用工具全系統一次抓，不靠猜、無欄名雜訊。
-- 若 Supabase 不允許 plpgsql_check → CREATE EXTENSION 會報錯，跟我說改別的方法。

CREATE EXTENSION IF NOT EXISTS plpgsql_check;

CREATE OR REPLACE FUNCTION public._lint_all_functions()
RETURNS TABLE(fn_name text, issue text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE
  r   record;
  msg text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n   ON n.oid = p.pronamespace
    JOIN pg_language lang ON lang.oid = p.prolang
    WHERE n.nspname = 'public'
      AND lang.lanname = 'plpgsql'
      AND p.prokind = 'f'
  LOOP
    BEGIN
      FOR msg IN
        SELECT * FROM plpgsql_check_function(r.oid, fatal_errors := false)
      LOOP
        -- 只收真正的問題（欄位不存在 / 型別 / error），略過 warning/notice 雜訊
        IF msg ~* '(does not exist|column|type|error:)' THEN
          fn_name := r.proname;
          issue   := msg;
          RETURN NEXT;
        END IF;
      END LOOP;
    EXCEPTION WHEN others THEN
      fn_name := r.proname;
      issue   := 'lint_failed: ' || SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public._lint_all_functions() TO service_role;
