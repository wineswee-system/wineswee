-- ============================================================
-- 把 org chart 打勾的部門/課別人員 store 改到 威士威企業總部 (id=20)
-- 2026-05-28
--
-- 名單 (21人)：
--   劉雅玲、林巧玉、韓德森、詹健如、張庭瑋、陳虹
--   游如梅、張啟達、李英顯、徐其祥、張開翔、林襄
--   陳佩瑢、尤致皓、楊學文、楊家謙、黃蘊珊、羅紹輝
--   朱紹蕾、洪伯嘉、Snow
--
-- store_id 改 20 後，trigger tg_sync_fk_text 會自動同步
-- employees.store 文字欄，不需手動改 store text column。
-- ============================================================

BEGIN;

UPDATE public.employees
SET store_id = 20
WHERE name IN (
  '劉雅玲',
  '林巧玉',
  '韓德森',
  '詹健如',
  '張庭瑋',
  '陳虹',
  '游如梅',
  '張啟達',
  '李英顯',
  '徐其祥',
  '張開翔',
  '林襄',
  '陳佩瑢',
  '尤致皓',
  '楊學文',
  '楊家謙',
  '黃蘊珊',
  '羅紹輝',
  '朱紹蕾',
  '洪伯嘉',
  'Snow'
);

-- 驗證：確認全部都改到了
DO $$
DECLARE
  v_count INT;
  v_names TEXT[] := ARRAY[
    '劉雅玲','林巧玉','韓德森','詹健如','張庭瑋','陳虹',
    '游如梅','張啟達','李英顯','徐其祥','張開翔','林襄',
    '陳佩瑢','尤致皓','楊學文','楊家謙','黃蘊珊','羅紹輝',
    '朱紹蕾','洪伯嘉','Snow'
  ];
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.employees
  WHERE name = ANY(v_names) AND store_id <> 20;

  IF v_count > 0 THEN
    RAISE WARNING '仍有 % 人 store_id 不是 20（可能 DB 名字拼法不同）', v_count;
  ELSE
    RAISE NOTICE 'OK：全部 % 人已指到威士威企業總部',
      (SELECT COUNT(*) FROM public.employees WHERE name = ANY(v_names));
  END IF;
END $$;

COMMIT;
