-- ── 補打卡也支援 4 模式 tag ─────────────────────────────────────────────────────
-- 員工事後補打卡時也能標明「這筆是加班/請假/換班/外出」，與 Edge Function 即時
-- 打卡的 clock_in_mode / clock_out_mode 對齊。HR 核准補打卡後，理論上應該把這個
-- mode 傳遞到對應的 attendance_records 行 — 但現有 approval RPC 寫死中文 type
-- (`'上班打卡'` / `'下班打卡'`) 已經跟 LIFF normalize 後的 'clock_in'/'clock_out'
-- 脫節（2026-05-09 normalize migration 後沒人補修 approval propagation），所以
-- 本 migration 只負責欄位 + LIFF insert RPC，不動 approval 流程；現存 bug 等另
-- 起單修。

BEGIN;

-- ── 1. 加 clock_mode 欄位 ─────────────────────────────────────────────────────
ALTER TABLE public.clock_corrections
  ADD COLUMN IF NOT EXISTS clock_mode text NOT NULL DEFAULT 'normal';

-- CHECK 跟 attendance_records 的兩個 mode 欄一致
ALTER TABLE public.clock_corrections
  DROP CONSTRAINT IF EXISTS chk_clock_corrections_mode;
ALTER TABLE public.clock_corrections
  ADD CONSTRAINT chk_clock_corrections_mode
    CHECK (clock_mode IN ('normal','overtime','leave','shift_swap','outing'));

COMMENT ON COLUMN public.clock_corrections.clock_mode
  IS '補打卡的模式 tag — normal / overtime / leave / shift_swap / outing；對齊 attendance_records.clock_in_mode';

-- ── 2. liff_insert_clock_correction 改寫：接 p_payload.clock_mode ─────────────
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

  RETURN json_build_object('id', new_id);
END $function$;

GRANT EXECUTE ON FUNCTION public.liff_insert_clock_correction(text, json) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
