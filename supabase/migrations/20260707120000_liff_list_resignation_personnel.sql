-- 修：LIFF 離職申請 / 人事異動 → 清單永遠空、編輯/撤回/重送按鈕全死
-- 2026-07-07
-- 根因：Resignation.jsx / PersonnelTransfer.jsx 呼叫 liff_list_my_resignation_requests /
--   liff_list_my_personnel_transfer_requests，但 live DB 只有 insert/update/delete，沒有 list_my
--   → reload() 拿到 undefined → 清單 [] → 申請中的編輯/撤回、已駁回的「編輯重送」都不出現，
--     駁回 LINE 卡的 ?resubmit=<id> 深連結也找不到目標。
-- 修法：補兩支 SECURITY DEFINER list RPC（比照 insert 用 _liff_resolve_employee 解員工），
--   回傳該員工全部申請（整列 json，前端直接讀 status/reason/planned_resign_date 等欄位）。
-- idempotent：CREATE OR REPLACE。

CREATE OR REPLACE FUNCTION public.liff_list_my_resignation_requests(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  emp    employees;
  result json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::json; END IF;

  SELECT COALESCE(json_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::json)
    INTO result
    FROM public.resignation_requests r
   WHERE r.employee_id = emp.id;

  RETURN result;
END $function$;

CREATE OR REPLACE FUNCTION public.liff_list_my_personnel_transfer_requests(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  emp    employees;
  result json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::json; END IF;

  SELECT COALESCE(json_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::json)
    INTO result
    FROM public.personnel_transfer_requests r
   WHERE r.employee_id = emp.id;

  RETURN result;
END $function$;

GRANT EXECUTE ON FUNCTION public.liff_list_my_resignation_requests(text)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_list_my_personnel_transfer_requests(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
