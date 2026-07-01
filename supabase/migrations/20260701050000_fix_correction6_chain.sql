-- 修正 補打卡申請 id=6 (黃蘊珊) 的簽核鏈
-- 送出時 store_type 尚未改為 hq，誤走門市人員鏈
-- 正確分類：行政人員 → chain_id=32

UPDATE public.clock_corrections
SET approval_chain_id = 32,
    current_step = 0
WHERE id = 6
  AND approval_chain_id <> 32;

UPDATE public.request_chain_snapshots
SET chain_id = 32
WHERE request_type = 'correction'
  AND request_id = 6;

NOTIFY pgrst, 'reload schema';
