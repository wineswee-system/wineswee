-- 表單查詢中心 階段1:統一查詢 view + RPC — 2026-07-22
-- ════════════════════════════════════════════════════════════════════════════
-- v_hr_forms_unified:UNION 8 核心 HR 表單表(假勤4+異動4)成統一列(單號/類型/申請人/
--   部門/摘要/狀態/申請日/org)。單號=YYYYMMDD+類型碼+id(無實體單號欄,產生)。
-- list_hr_forms:狀態/日期/姓名員編/分類/類型 篩選 + 分頁 + 總筆數,org 過濾。
-- 階段1 只做查詢(唯讀);批次動作(改簽核人/抽單/強制通過)階段3。
-- 排班(off/shift_swap)+人事文件(form_submission)申請人欄不同,階段2 再補。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_hr_forms_unified AS
WITH base AS (
  -- ── 假勤類 ──
  SELECT 'leave'::text AS form_type, '請假'::text AS form_label, '假勤'::text AS category,
         id, employee_id, organization_id, status, created_at,
         to_char(created_at,'YYYYMMDD')||'1010'||lpad(id::text,4,'0') AS form_no,
         COALESCE(type,'請假') || '（' ||
           CASE WHEN days IS NULL AND hours IS NOT NULL THEN COALESCE(hours,0)::text||'小時'
                ELSE COALESCE(to_char(start_date,'MM/DD'),'')||'~'||COALESCE(to_char(end_date,'MM/DD'),'') END
         || '）' AS summary
    FROM public.leave_requests WHERE deleted_at IS NULL
  UNION ALL
  SELECT 'overtime','加班','假勤', id, employee_id, organization_id, status, created_at,
         to_char(created_at,'YYYYMMDD')||'1020'||lpad(id::text,4,'0'),
         to_char(date,'YYYY/MM/DD')
           || COALESCE(' '||to_char(start_time,'HH24:MI')||'~'||to_char(end_time,'HH24:MI'),'')
           || ' 加班 ' || COALESCE(ot_hours, hours, 0)::text || ' 小時'
    FROM public.overtime_requests WHERE deleted_at IS NULL
  UNION ALL
  SELECT 'trip','出差','假勤', id, employee_id, organization_id, status, created_at,
         to_char(created_at,'YYYYMMDD')||'1030'||lpad(id::text,4,'0'),
         COALESCE(destination,'出差')||'（'||COALESCE(to_char(start_date,'MM/DD'),'')||'~'||COALESCE(to_char(end_date,'MM/DD'),'')||'）'
    FROM public.business_trips WHERE deleted_at IS NULL
  UNION ALL
  SELECT 'correction','補打卡','假勤', id, employee_id, organization_id, status, created_at,
         to_char(created_at,'YYYYMMDD')||'1050'||lpad(id::text,4,'0'),
         to_char(date,'YYYY/MM/DD') || COALESCE(' '||correction_time::text,'')
    FROM public.clock_corrections WHERE deleted_at IS NULL
  -- ── 異動類 ──
  UNION ALL
  SELECT 'resignation','離職','異動', id, employee_id, organization_id, status, created_at,
         to_char(created_at,'YYYYMMDD')||'2010'||lpad(id::text,4,'0'),
         '離職（預計 '||COALESCE(to_char(planned_resign_date,'YYYY/MM/DD'),'—')||'）'
    FROM public.resignation_requests
  UNION ALL
  SELECT 'loa','留停','異動', id, employee_id, organization_id, status, created_at,
         to_char(created_at,'YYYYMMDD')||'2020'||lpad(id::text,4,'0'),
         COALESCE(reason_type,'留停')||'（'||COALESCE(to_char(start_date,'MM/DD'),'')||'~'||COALESCE(to_char(planned_end_date,'MM/DD'),'')||'）'
    FROM public.leave_of_absence_requests
  UNION ALL
  SELECT 'transfer','人事異動','異動', id, employee_id, organization_id, status, created_at,
         to_char(created_at,'YYYYMMDD')||'2030'||lpad(id::text,4,'0'),
         COALESCE(transfer_type,'異動')||'（生效 '||COALESCE(to_char(effective_date,'YYYY/MM/DD'),'—')||'）'
    FROM public.personnel_transfer_requests
  UNION ALL
  SELECT 'headcount','人力需求','異動', id, employee_id, organization_id, status, created_at,
         to_char(created_at,'YYYYMMDD')||'2040'||lpad(id::text,4,'0'),
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

-- ── 查詢 RPC(篩選+分頁+總數;org 過濾) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_hr_forms(
  p_status    text    DEFAULT NULL,
  p_from      date    DEFAULT NULL,
  p_to        date    DEFAULT NULL,
  p_search    text    DEFAULT NULL,
  p_category  text    DEFAULT NULL,
  p_form_type text    DEFAULT NULL,
  p_page      integer DEFAULT 1,
  p_size      integer DEFAULT 100,
  p_actor_id  integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org   bigint;
  v_total int;
  v_rows  jsonb;
  v_size  int := LEAST(GREATEST(COALESCE(p_size,100), 1), 500);
  v_page  int := GREATEST(COALESCE(p_page,1), 1);
BEGIN
  -- 呼叫者 org(auth.uid 優先;service/測試用 p_actor_id)
  v_org := current_user_org();
  IF v_org IS NULL AND p_actor_id IS NOT NULL THEN
    SELECT organization_id INTO v_org FROM employees WHERE id = p_actor_id;
  END IF;

  SELECT count(*) INTO v_total
    FROM v_hr_forms_unified f
   WHERE (v_org IS NULL OR f.organization_id = v_org)
     AND (COALESCE(p_status,'')    = '' OR f.status = p_status)
     AND (p_from IS NULL OR f.created_at::date >= p_from)
     AND (p_to   IS NULL OR f.created_at::date <= p_to)
     AND (COALESCE(p_category,'')  = '' OR f.category = p_category)
     AND (COALESCE(p_form_type,'') = '' OR f.form_type = p_form_type)
     AND (COALESCE(p_search,'')    = '' OR f.applicant ILIKE '%'||p_search||'%' OR f.form_no ILIKE '%'||p_search||'%');

  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT f.* FROM v_hr_forms_unified f
       WHERE (v_org IS NULL OR f.organization_id = v_org)
         AND (COALESCE(p_status,'')    = '' OR f.status = p_status)
         AND (p_from IS NULL OR f.created_at::date >= p_from)
         AND (p_to   IS NULL OR f.created_at::date <= p_to)
         AND (COALESCE(p_category,'')  = '' OR f.category = p_category)
         AND (COALESCE(p_form_type,'') = '' OR f.form_type = p_form_type)
         AND (COALESCE(p_search,'')    = '' OR f.applicant ILIKE '%'||p_search||'%' OR f.form_no ILIKE '%'||p_search||'%')
       ORDER BY f.created_at DESC, f.form_type, f.id DESC
       LIMIT v_size OFFSET (v_page - 1) * v_size
    ) x;

  RETURN jsonb_build_object('total', v_total, 'page', v_page, 'size', v_size, 'rows', v_rows);
END $function$;

GRANT EXECUTE ON FUNCTION public.list_hr_forms(text, date, date, text, text, text, integer, integer, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
