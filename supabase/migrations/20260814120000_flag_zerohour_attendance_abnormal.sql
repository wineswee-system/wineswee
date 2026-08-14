-- 一次性:把現有「上下班同時(clock_in=clock_out)、0工時」卻標「正常」的爛紀錄改標「異常」,讓後台看得見。
-- (多半是跨午夜忘打上班卡後亂打、或忘打下班亂點兩下)。status 純顯示、不影響計薪(引擎只看clock時間+班表)。
-- 這些若有補卡,核准時 _apply_correction_to_attendance 會重算 status 自動變回正常(20260814110000)。
-- 冪等:只改目前非 異常/外出/補登 的。
UPDATE public.attendance_records
   SET status = '異常'
 WHERE clock_in IS NOT NULL AND clock_out IS NOT NULL
   AND clock_in = clock_out
   AND COALESCE(status,'') NOT IN ('異常','外出','補登');
