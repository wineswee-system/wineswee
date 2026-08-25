-- liff_insert_clock_correction 支援同交易寫入選填照片(p_payload.attachments)
-- 為什麼:送審通知(correction_step_assigned)是 INSERT 後由 pg_net post-commit 發出;
--   若附件是前端 insert 完再單獨寫,通知撈 form_attachments 時常常還沒寫入(race)→ LINE 卡片 hero 空。
--   把附件放進同一筆交易,commit 後通知就撈得到 → 送審卡片可靠帶照片。
-- 逐字保留原本邏輯,只在 RETURNING 後、RETURN 前加附件寫入段(沿用 p_payload,不新增參數→不觸發 overload)。

CREATE OR REPLACE FUNCTION public.liff_insert_clock_correction(p_line_user_id text, p_payload json)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp employees;
  new_id int;
  v_type_in   text;
  v_type_out  text;
  v_mode_in   text;
  v_mode_out  text;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  -- type 收斂：中文 → 英文（向下相容舊 LIFF）
  v_type_in := COALESCE(p_payload->>'type', 'clock_in');
  v_type_out := CASE v_type_in
                  WHEN '上班打卡' THEN 'clock_in'
                  WHEN '下班打卡' THEN 'clock_out'
                  ELSE v_type_in
                END;

  -- clock_mode 驗證（不在白名單一律退回 normal，避免 CHECK constraint 噴錯）
  v_mode_in := COALESCE(p_payload->>'clock_mode', 'normal');
  v_mode_out := CASE
                  WHEN v_mode_in IN ('normal','overtime','leave','shift_swap','outing') THEN v_mode_in
                  ELSE 'normal'
                END;

  INSERT INTO public.clock_corrections (
    employee, employee_id, date, type, correction_time, reason, store, status, organization_id, clock_mode
  )
  VALUES (
    emp.name,
    emp.id,
    (p_payload->>'date')::date,
    v_type_out,
    NULLIF(p_payload->>'correction_time', '')::time,
    p_payload->>'reason',
    p_payload->>'store',
    '待審核',
    emp.organization_id,
    v_mode_out
  )
  RETURNING id INTO new_id;

  -- 選填照片：同交易寫 form_attachments（form_type='correction'）→ 送審通知撈得到，LINE 卡片可帶 hero
  IF p_payload->'attachments' IS NOT NULL AND json_typeof(p_payload->'attachments') = 'array' THEN
    INSERT INTO public.form_attachments (
      form_type, form_id, organization_id, storage_bucket, storage_path,
      file_name, file_size, mime_type, uploaded_by_id, uploaded_by
    )
    SELECT 'correction', new_id, emp.organization_id, 'attachments',
           a->>'storage_path',
           COALESCE(NULLIF(a->>'file_name',''), '附件'),
           NULLIF(a->>'file_size','')::bigint,
           a->>'mime_type',
           emp.id, emp.name
    FROM json_array_elements(p_payload->'attachments') a
    WHERE COALESCE(a->>'storage_path','') <> '';
  END IF;

  RETURN json_build_object('id', new_id);
END $function$;
