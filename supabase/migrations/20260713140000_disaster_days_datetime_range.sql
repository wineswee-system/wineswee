-- 天災宣告改為「起訖時間區間」— 2026-07-13
-- 需求:門市有跨天班次(如 22:00→06:00),單一日期框不住 → 宣告改成
--   開始日期+時間 / 結束日期+時間。沒來結算涵蓋區間內每一天。
-- 做法:disaster_days 加 start_at / end_at (timestamp 無時區=牆上時間,避免 timestamptz 在
--   UTC 換算讓晚上時間 ::date 回退一天的跨天結算漏日雷),保留 date(=開始日,向下相容:
--   allowances/attendance 仍可用 date 當主日,顯示 fallback 也靠它)。純加欄,idempotent。

ALTER TABLE public.disaster_days
  ADD COLUMN IF NOT EXISTS start_at timestamp,
  ADD COLUMN IF NOT EXISTS end_at   timestamp;

-- 既有 row 回填(表目前為空,防守用):視為整日 00:00 ~ 23:59:59
UPDATE public.disaster_days
   SET start_at = date::timestamp,
       end_at   = (date + INTERVAL '1 day' - INTERVAL '1 second')
 WHERE start_at IS NULL;

NOTIFY pgrst, 'reload schema';
