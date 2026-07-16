-- 行事曆活動(store_events)加兩欄 — 2026-07-16
-- ① category：活動類別(公司公休/節慶活動/包場/教育訓練/促銷檔期/其他)，前端帶固定 icon/顏色。純標示。
-- ② pay_class：計薪比照(目前只支援 'national_holiday'=比照國定假日)。
--    綁了 national_holiday 的活動 → 該門市當天「有上班的人」比照國定假日算加給/加班費
--    (整合點在 _is_national_holiday，見同批另一支 migration)。null=不影響計薪。
-- 只加欄位(功能)，不動既有資料。idempotent。

ALTER TABLE public.store_events
  ADD COLUMN IF NOT EXISTS category  TEXT,   -- 活動類別(顯示用)
  ADD COLUMN IF NOT EXISTS pay_class TEXT;   -- 計薪比照('national_holiday' | null)

COMMENT ON COLUMN public.store_events.category  IS '行事曆活動類別(公司公休/節慶活動/包場/教育訓練/促銷檔期/其他)，前端帶 icon/顏色';
COMMENT ON COLUMN public.store_events.pay_class IS '計薪比照：national_holiday=該門市當天有上班者比照國定假日算加給/加班費；null=不影響計薪';

NOTIFY pgrst, 'reload schema';
