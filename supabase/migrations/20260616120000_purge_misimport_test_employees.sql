-- ════════════════════════════════════════════════════════════════════════════
-- 永久刪除「匯入讀錯」產生的 13 筆重複測試員工（皆為離職、真人另有在職帳號）
-- 2026-06-16
--
-- 對象（全部 status='離職'、為匯入髒資料；真人各自有另一個在職帳號）：
--   45 Alicia · 46 Anita · 47 Aska · 49 Ken · 51 Wang Xiao Ming · 54 營運
--   55 曠虎 · 144 Cherry · 147 Vicky · 154 花輪 · 155 阿謙 · 205 測試員工 · 383 TEST
--   53 學文(EMP-011) · 63 黃瑀珊(EMP-021) · 66 林冀(EMP-024)
--   ※ 注意：#69 楊學文(L2021100) 是真員工(有登入/薪資/加班)，不在刪除名單。
--
-- 安全做法：DO 區塊（單一交易，全成功或全失敗，不會刪一半）。
--   自動掃出所有「指向 public.employees 的外鍵」，逐表處理這 13 個 id：
--     - FK 欄位 NOT NULL（屬於該員工的資料：指派/薪資/打卡…）→ DELETE 子列
--     - FK 欄位可 NULL（稽核類：created_by/approved_by/actor_id…）→ SET NULL（保留該筆記錄）
--   最後 DELETE employees。idempotent：rows 已刪 → 重跑為 no-op。
--
-- 註：#205 測試員工有 auth 登入帳號（auth_user_id）。本 migration 只刪 employees 列；
--    對應的 auth.users 那筆登入帳號需到 Supabase Auth 後台另外刪（孤兒帳號無害）。
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_ids INT[] := ARRAY[45,46,47,49,51,53,54,55,63,66,144,147,154,155,205,383];
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conrelid::regclass::text AS tbl,
           att.attname                  AS col,
           att.attnotnull               AS notnull
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum   = ANY(con.conkey)
    WHERE con.confrelid = 'public.employees'::regclass
      AND con.contype   = 'f'
  LOOP
    IF r.notnull THEN
      EXECUTE format('DELETE FROM %s WHERE %I = ANY($1)', r.tbl, r.col) USING v_ids;
    ELSE
      EXECUTE format('UPDATE %s SET %I = NULL WHERE %I = ANY($1)', r.tbl, r.col, r.col) USING v_ids;
    END IF;
  END LOOP;

  DELETE FROM public.employees WHERE id = ANY(v_ids);
END $$;

NOTIFY pgrst, 'reload schema';
