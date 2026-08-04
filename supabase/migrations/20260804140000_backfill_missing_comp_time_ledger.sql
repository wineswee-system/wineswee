-- 回補:已核准「換補休」加班卻沒建 comp_time_ledger 的補休帳 — 2026-08-04
-- ════════════════════════════════════════════════════════════════════════════
-- 病灶:trg_create_comp_time_ledger 只在「status 轉為已核准的當下」建補休帳。若某張加班單是用
--   非正常途徑被設成已核准(approved_at=null、Studio/舊資料/繞過 trigger)→ 補休帳沒建 →
--   員工補休少算。實測全公司唯一一張:#998 張庭瑋 2026-07-03 8h(補休少 8h,顯示13應21)。
--   老闆 20260804130000 已補 is_comp_leave(防現金雙付),但沒回補 ledger,這支補上。
-- 作法:掃「ot_type='comp_time'、已核准、未刪、有 base_salary、且 ledger 沒有」的加班單,照 trigger
--   同款規則建 ledger(時數=ot_hours/hours、到期=OT日+1年-1天、凍結時薪=base/30/8、凍結金額=
--   _compute_ot_pay)。NOT EXISTS + ON CONFLICT 雙保險,idempotent、重跑無害、不重複建。
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.comp_time_ledger (
  employee_id, overtime_request_id, organization_id,
  hours, ot_date, expires_at, frozen_hourly_rate, frozen_ot_amount, status
)
SELECT
  o.employee_id,
  o.id,
  COALESCE(o.organization_id, e.organization_id),
  COALESCE(o.ot_hours, o.hours),
  COALESCE(o.request_date, o.date),
  COALESCE(o.request_date, o.date) + INTERVAL '1 year' - INTERVAL '1 day',
  ROUND(ss.base_salary / 30.0 / 8.0, 2),
  public._compute_ot_pay(
    COALESCE(o.ot_hours, o.hours),
    ROUND(ss.base_salary / 30.0 / 8.0, 2),
    COALESCE(o.ot_category, public.classify_overtime_category_v2(COALESCE(o.request_date, o.date), o.employee_id))
  ),
  'active'
FROM public.overtime_requests o
JOIN public.employees e ON e.id = o.employee_id
LEFT JOIN public.salary_structures ss ON ss.employee_id = o.employee_id
WHERE o.ot_type = 'comp_time'
  AND o.status = '已核准'
  AND o.deleted_at IS NULL
  AND COALESCE(o.ot_hours, o.hours) > 0
  AND COALESCE(ss.base_salary, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM public.comp_time_ledger l WHERE l.overtime_request_id = o.id)
ON CONFLICT (overtime_request_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
