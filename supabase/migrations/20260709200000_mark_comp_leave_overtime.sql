-- 標記「選折換補休」的加班單:不發現金加班費(改記補休)
-- 2026-07-09  104 匯入把全部加班設 ot_type='pay'(現金),折換補休的選擇遺失→_compute 照發現金。
--   依 104「加班申請明細」折換補休>0 的紀錄,標記對應 overtime_requests。
--   每筆折換補休都是整筆補休(現金0),按 員工+歸屬日(request_date)+時數 對應,只標 104匯入(不碰 manual)。
--   ⚠️ 標記後需搭配 _compute 排除 is_comp_leave 才會真的不發現金(下一支 migration)。
--   9 人 49h。idempotent。

ALTER TABLE public.overtime_requests
  ADD COLUMN IF NOT EXISTS is_comp_leave boolean NOT NULL DEFAULT false;

UPDATE public.overtime_requests o SET is_comp_leave = true
FROM (VALUES
  (101, '2026-06-02', 8.5),
  (397, '2026-06-05', 1.5),
  (397, '2026-06-13', 3),
  (60, '2026-06-05', 2.5),
  (60, '2026-06-12', 3.5),
  (60, '2026-06-15', 2),
  (60, '2026-06-17', 2),
  (59, '2026-06-22', 1),
  (64, '2026-06-11', 1.5),
  (64, '2026-06-16', 1.5),
  (64, '2026-06-18', 3),
  (64, '2026-06-24', 2.5),
  (62, '2026-06-04', 2.5),
  (62, '2026-06-29', 9),
  (133, '2026-05-31', 0.5),
  (133, '2026-06-02', 0.5),
  (58, '2026-06-04', 0.5),
  (209, '2026-06-10', 0.5),
  (209, '2026-06-18', 3)
) AS v(emp_id, gd, hrs)
WHERE o.employee_id = v.emp_id
  AND o.request_date = v.gd::date
  AND o.ot_hours = v.hrs
  AND COALESCE(o.source,'') = '104匯入'
  AND o.status = '已核准';

NOTIFY pgrst, 'reload schema';
