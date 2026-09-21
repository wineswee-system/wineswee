-- 員工資料加「備註」欄(內部註記,僅管理者可見可編);存檔走 secure_update_employee 全動態 SET,加欄即自動支援
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS notes text;
COMMENT ON COLUMN public.employees.notes IS '內部備註(僅管理者於員工資料頁可見/可編)';

NOTIFY pgrst, 'reload schema';
