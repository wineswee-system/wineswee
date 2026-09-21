-- 離職申請建單 RPC(單一來源) — 2026-07-21
-- ════════════════════════════════════════════════════════════════════════════
-- 根治「簽核鏈路由兩套矛盾」:
--   web  → hrChain.js findFormChainByApplicantType 硬塞鏈,且解析器只認 manager/staff
--          (不認 store_staff)→ 門市員工從網頁送會被錯配到 #32「行政人員鏈」而非 #45「門市人員鏈」
--   LIFF → liff_insert_resignation_request 用 category='離職申請' 抓鏈,但無任何鏈是此 category
--          → v_chain=NULL(歪打正著:插 NULL 反而讓 trigger 接手解對)
--
-- 正解(對齊 20260602180000 設計意圖「chain 由 DB 決定,不靠前端傳入」):
--   前端一律插 approval_chain_id=NULL → BEFORE INSERT trigger `trg_auto_apply_chain_resignation`
--   (_auto_apply_hr_form_chain, 3-way: manager/store_staff/staff→form_chain_configs) 是唯一解鏈來源。
--   其餘連動(快照/LINE通知/代簽通知)本就由 resignation_requests 的 INSERT triggers 處理。
--
-- 本 RPC:web(auth.uid,可主管代他人送) + LIFF(line_user_id,本人送) 共用單一進入點,只做 驗證+插入。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_resignation_request(
  p_payload json,
  p_line_user_id text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller       employees;
  v_applicant    employees;
  v_applicant_id int;
  v_date         date;
  new_id         int;
  v_chain        int;
BEGIN
  -- ── 解析呼叫者 / 申請人 ────────────────────────────────────────────────
  IF p_line_user_id IS NOT NULL THEN
    -- LIFF:本人送
    SELECT * INTO v_caller FROM public._liff_resolve_employee(p_line_user_id);
    IF v_caller.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
    END IF;
    v_applicant_id := v_caller.id;
  ELSE
    -- Web:呼叫者 = auth.uid();申請人可為他人(限主管以上,對齊 isManagerOrAbove)
    SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
    IF v_caller.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'CALLER_NOT_FOUND');
    END IF;
    v_applicant_id := COALESCE(NULLIF(p_payload->>'employee_id', '')::int, v_caller.id);
    IF v_applicant_id <> v_caller.id
       AND v_caller.role NOT IN ('manager', 'admin', 'super_admin') THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_ALLOWED_FOR_OTHERS');
    END IF;
  END IF;

  SELECT * INTO v_applicant FROM employees WHERE id = v_applicant_id;
  IF v_applicant.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'APPLICANT_NOT_FOUND');
  END IF;

  -- ── 驗證 ──────────────────────────────────────────────────────────────
  v_date := NULLIF(p_payload->>'planned_resign_date', '')::date;
  IF v_date IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'DATE_REQUIRED');
  END IF;
  IF COALESCE(btrim(p_payload->>'reason'), '') = '' THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;
  -- 防重複:同員工已有申請中的離職單
  IF EXISTS (
    SELECT 1 FROM resignation_requests
     WHERE employee_id = v_applicant_id AND status = '申請中'
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_PENDING');
  END IF;

  -- ── 插入(chain=NULL → trigger 解出正確鏈+快照;notify/delegate trigger 連動)────
  INSERT INTO resignation_requests (
    employee_id, organization_id, planned_resign_date,
    reason, reason_detail, handover_notes, attachment_url,
    status, approval_chain_id, current_step
  ) VALUES (
    v_applicant_id, v_applicant.organization_id, v_date,
    p_payload->>'reason',
    NULLIF(p_payload->>'reason_detail', ''),
    NULLIF(p_payload->>'handover_notes', ''),
    NULLIF(p_payload->>'attachment_url', ''),
    '申請中', NULL, 0
  ) RETURNING id, approval_chain_id INTO new_id, v_chain;

  RETURN json_build_object('ok', true, 'id', new_id, 'approval_chain_id', v_chain);
END $function$;

GRANT EXECUTE ON FUNCTION public.create_resignation_request(json, text) TO authenticated, service_role;

-- ── LIFF 舊 RPC 改為 delegate(移除壞掉的 category='離職申請' 抓鏈;回傳型別維持 {id}) ──
CREATE OR REPLACE FUNCTION public.liff_insert_resignation_request(p_line_user_id text, p_payload json)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res json;
BEGIN
  v_res := public.create_resignation_request(p_payload, p_line_user_id);
  IF COALESCE((v_res->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION '[liff_insert_resignation_request] %', COALESCE(v_res->>'error', 'UNKNOWN');
  END IF;
  RETURN json_build_object('id', (v_res->>'id')::int);
END $function$;

-- ── 清掉 resignation/transfer 的 'all' 共用設定 ──────────────────────────────
-- 兩者 all → #16「請假簽核鏈」:語意錯(離職/異動竟 fallback 到請假鏈)且永不觸及
-- (manager/staff/store_staff 三種身分皆有專屬 config,trigger 不會走到 'all' fallback)。
DELETE FROM public.form_chain_configs
 WHERE form_type IN ('resignation', 'transfer')
   AND applicant_type = 'all';

NOTIFY pgrst, 'reload schema';
