-- 表單查詢中心 修正:form_no 對齊系統各詳情頁 — 2026-07-22
-- ════════════════════════════════════════════════════════════════════════════
-- 問題:原 form_no=YYYYMMDD+類型碼+lpad(id) 這種組合號,系統其他地方(離職/請假/
--   出差…詳情頁的「單號」欄)全是 #{id}(raw row id)→查詢中心編號跟別處對不上。
-- 修正:form_no 改成 '#'||id,跟每張表單詳情頁完全一致(類型由「表單」欄區分,
--   同 id 不同類型不會混淆)。只改 form_no 這一欄,其餘(摘要/篩選/RPC)不動。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_hr_forms_unified AS
WITH base AS (
  -- ── 假勤類 ──
  SELECT 'leave'::text AS form_type, '請假'::text AS form_label, '假勤'::text AS category,
         id, employee_id, organization_id, status, created_at,
         '#'||id::text AS form_no,
         COALESCE(type,'請假') || '（' ||
           CASE WHEN days IS NULL AND hours IS NOT NULL THEN COALESCE(hours,0)::text||'小時'
                ELSE COALESCE(to_char(start_date,'MM/DD'),'')||'~'||COALESCE(to_char(end_date,'MM/DD'),'') END
         || '）' AS summary
    FROM public.leave_requests WHERE deleted_at IS NULL
  UNION ALL
  SELECT 'overtime','加班','假勤', id, employee_id, organization_id, status, created_at,
         '#'||id::text,
         to_char(date,'YYYY/MM/DD')
           || COALESCE(' '||to_char(start_time,'HH24:MI')||'~'||to_char(end_time,'HH24:MI'),'')
           || ' 加班 ' || COALESCE(ot_hours, hours, 0)::text || ' 小時'
    FROM public.overtime_requests WHERE deleted_at IS NULL
  UNION ALL
  SELECT 'trip','出差','假勤', id, employee_id, organization_id, status, created_at,
         '#'||id::text,
         COALESCE(destination,'出差')||'（'||COALESCE(to_char(start_date,'MM/DD'),'')||'~'||COALESCE(to_char(end_date,'MM/DD'),'')||'）'
    FROM public.business_trips WHERE deleted_at IS NULL
  UNION ALL
  SELECT 'correction','補打卡','假勤', id, employee_id, organization_id, status, created_at,
         '#'||id::text,
         to_char(date,'YYYY/MM/DD') || COALESCE(' '||correction_time::text,'')
    FROM public.clock_corrections WHERE deleted_at IS NULL
  -- ── 異動類 ──
  UNION ALL
  SELECT 'resignation','離職','異動', id, employee_id, organization_id, status, created_at,
         '#'||id::text,
         '離職（預計 '||COALESCE(to_char(planned_resign_date,'YYYY/MM/DD'),'—')||'）'
    FROM public.resignation_requests
  UNION ALL
  SELECT 'loa','留停','異動', id, employee_id, organization_id, status, created_at,
         '#'||id::text,
         COALESCE(reason_type,'留停')||'（'||COALESCE(to_char(start_date,'MM/DD'),'')||'~'||COALESCE(to_char(planned_end_date,'MM/DD'),'')||'）'
    FROM public.leave_of_absence_requests
  UNION ALL
  SELECT 'transfer','人事異動','異動', id, employee_id, organization_id, status, created_at,
         '#'||id::text,
         COALESCE(transfer_type,'異動')||'（生效 '||COALESCE(to_char(effective_date,'YYYY/MM/DD'),'—')||'）'
    FROM public.personnel_transfer_requests
  UNION ALL
  SELECT 'headcount','人力需求','異動', id, employee_id, organization_id, status, created_at,
         '#'||id::text,
         '人力需求申請'
    FROM public.headcount_requests WHERE deleted_at IS NULL
)
SELECT
  b.form_type, b.form_label, b.category, b.id, b.form_no,
  b.status, b.created_at, b.organization_id, b.summary, b.employee_id,
  COALESCE(e.name, '（未指定）') AS applicant,
  COALESCE(NULLIF(e.dept,''), d.name, '') AS dept
FROM base b
LEFT JOIN public.employees e   ON e.id = b.employee_id
LEFT JOIN public.departments d ON d.id = e.department_id;

NOTIFY pgrst, 'reload schema';
