-- 休息日加班:兼職(hourly)由 flat ×2 改為與月薪同一套階梯+擬制(勞基法§24 前2h×1.34/3-8h×1.67/>8h×2.67 + 做1給4)
-- 例假(weekly_off)、國定假(holiday)兼職維持 flat ×2 不變。8月不再批次計薪,故不綁生效月份。

CREATE OR REPLACE FUNCTION public._ot_pay_zh(p_hours numeric, p_hourly numeric, p_category text, p_is_hourly boolean)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE p_category
    WHEN 'weekday' THEN
      CASE WHEN p_hours <= 2 THEN ceil(p_hours * p_hourly * 1.34)
           ELSE ceil(2 * p_hourly * 1.34 + (p_hours - 2) * p_hourly * 1.67) END
    WHEN 'restday' THEN
      -- 兼職與月薪一律階梯+擬制(§24 做1給4/做5給8);2026-09 起兼職不再 flat ×2
      ceil(least(public._ot_deem_hours(p_hours), 2) * p_hourly * 1.34
         + least(greatest(public._ot_deem_hours(p_hours) - 2, 0), 6) * p_hourly * 1.67
         + greatest(public._ot_deem_hours(p_hours) - 8, 0) * p_hourly * 2.67)
    WHEN 'holiday' THEN
      CASE WHEN p_is_hourly THEN ceil(p_hours * p_hourly * 2)
           WHEN p_hours <= 0 THEN 0
           ELSE ceil(8 * p_hourly
                   + least(greatest(p_hours - 8, 0), 2) * p_hourly * 1.34
                   + greatest(p_hours - 10, 0) * p_hourly * 1.67) END
    WHEN 'weekly_off' THEN
      CASE WHEN p_is_hourly THEN ceil(p_hours * p_hourly * 2)
           ELSE ceil(least(p_hours, 8) * p_hourly + greatest(p_hours - 8, 0) * p_hourly * 2) END
    ELSE 0 END
$function$;

CREATE OR REPLACE FUNCTION public._ot_rate_label(p_from numeric, p_to numeric, p_cat text, p_is_hourly boolean)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  labs text[] := '{}';
  brk numeric[]; rts text[];
  i int;
BEGIN
  IF p_to <= p_from THEN RETURN ''; END IF;
  -- 例假/國定假 兼職仍 flat ×2;休息日已改階梯(拿掉 restday)
  IF p_is_hourly AND p_cat IN ('weekly_off','holiday') THEN RETURN '×2.0'; END IF;
  IF p_cat='weekday' THEN brk:=ARRAY[0,2,999]; rts:=ARRAY['×1.34','×1.67'];
  ELSIF p_cat='restday' THEN brk:=ARRAY[0,2,8,999]; rts:=ARRAY['×1.34','×1.67','×2.67'];
  ELSIF p_cat='weekly_off' THEN brk:=ARRAY[0,8,999]; rts:=ARRAY['×1.0','×2.0'];
  ELSIF p_cat='holiday' THEN brk:=ARRAY[0,8,10,999]; rts:=ARRAY['固定8h','×1.34','×1.67'];
  ELSE RETURN ''; END IF;
  FOR i IN 1..array_length(rts,1) LOOP
    IF p_from < brk[i+1] AND p_to > brk[i] THEN labs := labs || rts[i]; END IF;
  END LOOP;
  RETURN array_to_string(labs, ' / ');
END $function$;
