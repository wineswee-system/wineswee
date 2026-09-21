-- 修：菜單分類每個都出現兩次（pos_menu_categories 重複列）
-- 2026-07-06
-- 現象：菜單管理 / 客人掃碼菜單，每個分類顯示 2 份。
-- 查證：全庫 105 組 (store_id, name) 重複、涉及 15 店，每組最多 2 份；
--   每組通常「一份有品項、一份空(0品)」。品項本身沒重複(720 筆, 0 重複組)。
--   幾乎確定是菜單匯入/seed 跑了兩次(只重覆建分類)。
-- 修法：每組保留「品項最多」的那份(平手取最小 id)，先把品項重指到保留份(保險，
--   即使多餘份有品項也不會被 CASCADE 刪掉)，再刪掉多餘份。
-- idempotent：去重後同組只剩 1 份 → 再跑不會誤刪。

-- 1) 把品項從「多餘份」重指到「保留份」
UPDATE public.pos_menu_items i
   SET category_id = k.keeper
  FROM (
    SELECT c.id AS cat_id,
           first_value(c.id) OVER (
             PARTITION BY c.store_id, c.name
             ORDER BY (SELECT count(*) FROM public.pos_menu_items x WHERE x.category_id = c.id) DESC, c.id
           ) AS keeper
      FROM public.pos_menu_categories c
  ) k
 WHERE i.category_id = k.cat_id
   AND k.cat_id <> k.keeper;

-- 2) 刪掉多餘份（同 (store_id, name) 中非保留份）
DELETE FROM public.pos_menu_categories c
 WHERE c.id IN (
   SELECT id FROM (
     SELECT c2.id,
            row_number() OVER (
              PARTITION BY c2.store_id, c2.name
              ORDER BY (SELECT count(*) FROM public.pos_menu_items x WHERE x.category_id = c2.id) DESC, c2.id
            ) AS rn
       FROM public.pos_menu_categories c2
   ) t
   WHERE t.rn > 1
 );
