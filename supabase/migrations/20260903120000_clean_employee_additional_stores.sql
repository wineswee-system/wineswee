-- 排班選「上班地點」下拉出現已刪除門市:ShiftEditPopup 的選項 = 員工主店 + additional_stores,
-- 而 additional_stores(門市名字陣列)還殘留已刪/停用門市名(台中英才/天母百貨/台北測試中心/龍洞海鮮餐廳…)
-- → 下拉就冒出來。清掉 additional_stores 內「非現有 active 門市」的名字。冪等,可重跑。

UPDATE public.employees e
   SET additional_stores = COALESCE((
     SELECT array_agg(s ORDER BY s)
       FROM unnest(e.additional_stores) s
      WHERE s IN (SELECT name FROM public.stores
                   WHERE organization_id = e.organization_id AND is_active)
   ), ARRAY[]::text[])
 WHERE e.additional_stores IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM unnest(e.additional_stores) s
      WHERE s NOT IN (SELECT name FROM public.stores
                       WHERE organization_id = e.organization_id AND is_active)
   );
