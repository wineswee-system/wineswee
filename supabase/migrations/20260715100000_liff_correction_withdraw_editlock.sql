-- LIFF 補打卡:加撤回 + 編輯擋簽核後 — 2026-07-15
-- 對齊 Web:①編輯不吃新時間 LIFF 本來就沒此 bug(無前端寫回,靠 DB 觸發器套最新值)。
-- ②撤回:LIFF 原本假 alert「不支援」→ 新增 liff_delete_clock_correction(本人待審核單→soft_delete_request)。
-- ③編輯鎖:liff_update_clock_correction 加 current_step=0 條件(有人簽過第一關就不能改)。

-- ② 撤回:本人 + 待審核 才能撤,走既有 soft_delete_request(處理加簽/通知)
CREATE OR REPLACE FUNCTION public.liff_delete_clock_correction(p_line_user_id text, p_id integer)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.clock_corrections
     WHERE id = p_id AND employee_id = emp.id AND status = '待審核' AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION '找不到可撤回的補打卡紀錄';
  END IF;
  PERFORM public.soft_delete_request('clock_corrections', p_id, emp.id);
  RETURN json_build_object('ok', true);
END $function$;
GRANT EXECUTE ON FUNCTION public.liff_delete_clock_correction(text, integer) TO anon, authenticated;

-- ③ 編輯只在「還沒人簽核」(current_step=0)時允許;逐字保留原欄位更新,只加 current_step 條件
CREATE OR REPLACE FUNCTION public.liff_update_clock_correction(p_line_user_id text, p_id integer, p_payload json)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  UPDATE public.clock_corrections SET
    type            = COALESCE(p_payload->>'type', type),
    correction_time = CASE WHEN p_payload->>'correction_time' IS NOT NULL
                           THEN NULLIF(p_payload->>'correction_time', '')::time
                           ELSE correction_time END,
    reason          = COALESCE(NULLIF(p_payload->>'reason', ''), reason)
  WHERE id = p_id AND employee_id = emp.id AND status = '待審核'
    AND COALESCE(current_step, 0) = 0;   -- 有人簽過第一關就不能改(改用撤回重送)

  IF NOT FOUND THEN RAISE EXCEPTION '找不到可編輯的補打卡紀錄（可能已有人簽核）'; END IF;
  RETURN json_build_object('id', p_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[liff_update_clock_correction] %', SQLERRM; RAISE;
END $function$;

NOTIFY pgrst, 'reload schema';
