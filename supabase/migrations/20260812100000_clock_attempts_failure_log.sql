-- 打卡失敗記錄:讓後台看得出「員工打不了卡」到底是哪種原因(按不允許/定位沒開/逾時/太遠/程式)
-- ─────────────────────────────────────────────────────────────
-- 背景:LIFF 打卡 GPS 失敗時按鈕直接 disabled、員工按不下去也沒送出 → 完全無紀錄 → 管理端全盲。
-- 這表由前端(LIFF/web)在「判定不能打卡的當下」透過 liff_log_clock_attempt(DEFINER)寫入,
-- 記下錯誤碼(1/2/3)+ 權限狀態(granted/denied/prompt)+ 距離/精度 → 後台一眼分得出誰是哪種。
CREATE TABLE IF NOT EXISTS public.clock_attempts (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  employee_id int, employee text, line_user_id text,
  action text,                 -- clock_in / clock_out
  result text DEFAULT 'failed',-- failed / success
  reason text,                 -- permission_denied / position_unavailable / timeout / weak_accuracy / out_of_range / no_ip / unknown
  geo_code int,                -- Geolocation API error code 1/2/3
  perm_state text,             -- navigator.permissions: granted/denied/prompt/unsupported
  lat numeric, lng numeric, accuracy numeric,
  ip text, distance_m numeric, store text, detail text,
  client text DEFAULT 'liff',  -- liff / web
  organization_id int
);
CREATE INDEX IF NOT EXISTS idx_clock_attempts_org_time ON public.clock_attempts(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clock_attempts_emp_time ON public.clock_attempts(employee_id, created_at DESC);

ALTER TABLE public.clock_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clock_attempts_sel ON public.clock_attempts;
-- 讀:同組織可見(後台 admin/主管看)。寫一律走 DEFINER RPC,不開 anon 直寫。
CREATE POLICY clock_attempts_sel ON public.clock_attempts FOR SELECT
  USING ((( SELECT auth.role()) = 'service_role') OR org_visible(organization_id));

CREATE OR REPLACE FUNCTION public.liff_log_clock_attempt(
  p_employee_id int, p_line_user_id text DEFAULT NULL, p_action text DEFAULT 'clock_in',
  p_result text DEFAULT 'failed', p_reason text DEFAULT NULL, p_geo_code int DEFAULT NULL,
  p_perm_state text DEFAULT NULL, p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL,
  p_accuracy numeric DEFAULT NULL, p_ip text DEFAULT NULL, p_distance numeric DEFAULT NULL,
  p_store text DEFAULT NULL, p_detail text DEFAULT NULL, p_client text DEFAULT 'liff')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_org int; v_name text;
BEGIN
  IF p_employee_id IS NOT NULL THEN
    SELECT organization_id, name INTO v_org, v_name FROM public.employees WHERE id = p_employee_id;
  END IF;
  INSERT INTO public.clock_attempts(employee_id, employee, line_user_id, action, result, reason, geo_code,
    perm_state, lat, lng, accuracy, ip, distance_m, store, detail, client, organization_id)
  VALUES (p_employee_id, v_name, p_line_user_id, p_action, COALESCE(p_result,'failed'), p_reason, p_geo_code,
    p_perm_state, p_lat, p_lng, p_accuracy, p_ip, p_distance, p_store, p_detail, COALESCE(p_client,'liff'), v_org);
END $fn$;
REVOKE ALL ON FUNCTION public.liff_log_clock_attempt(int,text,text,text,text,int,text,numeric,numeric,numeric,text,numeric,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.liff_log_clock_attempt(int,text,text,text,text,int,text,numeric,numeric,numeric,text,numeric,text,text,text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
