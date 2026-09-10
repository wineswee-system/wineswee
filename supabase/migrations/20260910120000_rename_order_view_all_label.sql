-- order.view_all 顯示名對齊:App 各處(叫貨申請單 doc_type='order')都叫「叫貨申請單」,
--   唯獨此權限標籤沿用舊詞「訂購單申請」,使用者在權限頁認不出。改名不動權限碼(RLS 靠 code)。
UPDATE public.permissions
   SET name = '叫貨申請單-檢視全部人'
 WHERE code = 'order.view_all'
   AND name <> '叫貨申請單-檢視全部人';
