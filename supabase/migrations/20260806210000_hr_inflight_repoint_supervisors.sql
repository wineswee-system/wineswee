-- 在飛 HR 表單(加班/請假/補打卡)未簽關卡對齊新組織圖 — 2026-08-06
-- ════════════════════════════════════════════════════════════════════════════
-- 背景:直屬主管/部門經理換人(營運部經理 張庭瑋→周容甄、督導 黃蘊珊→劉家君 等),
--   但待審核舊單的簽核人凍在 request_chain_snapshots.frozen_emp_ids(送單當下解析),
--   核准只認凍結人不再動態解析 → 舊單仍送舊主管。
-- 修:只改「未簽關卡(step_order>=current_step)」且「換人(舊有人→新有人)」的 frozen_emp_ids
--   為現行組織解析結果。不動已核准關卡(不竄改歷史)、不動原本跳過的關卡(不加關)。
-- 每條帶 frozen=舊陣列 守門 → 冪等(已套用/被改過→0 列),不改任何 function/trigger。
-- 影響關卡數:
--   overtime_request: 5 關
--   leave_request: 0 關
--   correction: 51 關
-- ════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='overtime_request' AND request_id=2022 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='overtime_request' AND request_id=2023 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='overtime_request' AND request_id=2026 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='overtime_request' AND request_id=2027 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='overtime_request' AND request_id=2028 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[152]::int[] WHERE request_type='correction' AND request_id=11 AND step_order=2 AND frozen_emp_ids=ARRAY[48]::int[]; -- 董事長 決核: 韓德森→張啟達
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[75]::int[] WHERE request_type='correction' AND request_id=16 AND step_order=1 AND frozen_emp_ids=ARRAY[148]::int[]; -- 第2關督導 覆核: 黃蘊珊→劉家君
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=16 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 第3關營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[75]::int[] WHERE request_type='correction' AND request_id=45 AND step_order=1 AND frozen_emp_ids=ARRAY[148]::int[]; -- 第2關督導 覆核: 黃蘊珊→劉家君
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=45 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 第3關營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[75]::int[] WHERE request_type='correction' AND request_id=400 AND step_order=1 AND frozen_emp_ids=ARRAY[148]::int[]; -- 2.督導 覆核: 黃蘊珊→劉家君
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=400 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=5 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 營運部經理: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[52]::int[] WHERE request_type='correction' AND request_id=4 AND step_order=1 AND frozen_emp_ids=ARRAY[62]::int[]; -- 部門主管: 張庭瑋→陳虹
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=279 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=100 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 第3關營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[75]::int[] WHERE request_type='correction' AND request_id=82 AND step_order=1 AND frozen_emp_ids=ARRAY[148]::int[]; -- 第2關督導 覆核: 黃蘊珊→劉家君
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=82 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 第3關營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=278 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=395 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=401 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=131 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 第3關營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=135 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 第3關營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=179 AND step_order=0 AND frozen_emp_ids=ARRAY[62]::int[]; -- 部門主管 初核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=201 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 第3關營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[75]::int[] WHERE request_type='correction' AND request_id=46 AND step_order=1 AND frozen_emp_ids=ARRAY[148]::int[]; -- 第2關督導 覆核: 黃蘊珊→劉家君
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=46 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 第3關營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=285 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=287 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=288 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=99 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 第3關營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=304 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=306 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=314 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[75]::int[] WHERE request_type='correction' AND request_id=316 AND step_order=1 AND frozen_emp_ids=ARRAY[148]::int[]; -- 2.督導 覆核: 黃蘊珊→劉家君
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=316 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=280 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=345 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=348 AND step_order=0 AND frozen_emp_ids=ARRAY[62]::int[]; -- 1.主管 初核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=348 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=403 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=261 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=286 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=305 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=309 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[75]::int[] WHERE request_type='correction' AND request_id=315 AND step_order=1 AND frozen_emp_ids=ARRAY[148]::int[]; -- 2.督導 覆核: 黃蘊珊→劉家君
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=315 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=270 AND step_order=0 AND frozen_emp_ids=ARRAY[62]::int[]; -- 1.主管 初核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=270 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=381 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=390 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=374 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=398 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=392 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=393 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
  UPDATE public.request_chain_snapshots SET frozen_emp_ids=ARRAY[425]::int[] WHERE request_type='correction' AND request_id=399 AND step_order=2 AND frozen_emp_ids=ARRAY[62]::int[]; -- 3.營運部經理 決核: 張庭瑋→周容甄
END $$;
