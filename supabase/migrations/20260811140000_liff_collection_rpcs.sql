-- ════════════════════════════════════════════════════════════════════════════
-- LIFF 收款 RPC 套件(SECURITY DEFINER 繞 anon RLS;內部檢查 collection.manage) — 2026-08-11
--   訂金 / 加盟金 / 投資人 三分頁全套 CRUD,對齊 web src/pages/process/Collections.jsx。
--   身分:_liff_resolve_employee(line_user) → emp;權限:liff_employee_has_permission。
--   paid_total / status / paid_stageN 由 DB trigger 自動維護,RPC 只插原始列。
--   超收擋(訂金:target−paid_total;加盟金:每期 45/45/10 目標−paid_stageN)。
--   加盟金投資人須先有「訂金收款完成」的訂金案(對齊 web eligibleInvestors)。
--   idempotent。
-- ════════════════════════════════════════════════════════════════════════════

-- 內部小工具:解析員工 + 檢查 collection.manage,回 emp(找不到/無權限則 RAISE 由外層捕捉)
--   為維持每支 RPC 自我完整,直接在各函式內展開,不另抽 helper(避免多一層 DEFINER)。

-- ── 列表:一次回 6 張表 ──
CREATE OR REPLACE FUNCTION public.liff_list_collections(p_line_user_id text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE emp public.employees; v_org bigint;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'collection.manage') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN'); END IF;
  v_org := emp.organization_id;
  RETURN json_build_object(
    'ok', true,
    'deposits',   COALESCE((SELECT json_agg(d ORDER BY d.created_at DESC) FROM public.deposit_records d WHERE d.organization_id = v_org), '[]'::json),
    'depPays',    COALESCE((SELECT json_agg(p ORDER BY p.paid_date)        FROM public.deposit_payments p WHERE p.organization_id = v_org), '[]'::json),
    'franchises', COALESCE((SELECT json_agg(f ORDER BY f.created_at DESC)  FROM public.franchise_fees f WHERE f.organization_id = v_org), '[]'::json),
    'ffInvestors',COALESCE((SELECT json_agg(x) FROM (SELECT * FROM public.franchise_fee_investors WHERE organization_id = v_org ORDER BY amount DESC, investor_id) x), '[]'::json),
    'ffPays',     COALESCE((SELECT json_agg(p ORDER BY p.paid_date)        FROM public.franchise_fee_payments p WHERE p.organization_id = v_org), '[]'::json),
    'investors',  COALESCE((SELECT json_agg(i ORDER BY i.created_at DESC)  FROM public.collection_investors i WHERE i.organization_id = v_org), '[]'::json)
  );
END $fn$;
GRANT EXECUTE ON FUNCTION public.liff_list_collections(text) TO anon, authenticated;

-- ── 投資人:新增 ──
CREATE OR REPLACE FUNCTION public.liff_add_investor(p_line_user_id text, p_company text, p_name text, p_phone text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE emp public.employees; row public.collection_investors;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'collection.manage') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN'); END IF;
  IF COALESCE(trim(p_name), '') = '' THEN RETURN json_build_object('ok', false, 'error', '名字必填'); END IF;
  IF COALESCE(trim(p_phone), '') = '' THEN RETURN json_build_object('ok', false, 'error', '電話必填'); END IF;
  INSERT INTO public.collection_investors (organization_id, company, name, phone, created_by)
  VALUES (emp.organization_id, NULLIF(trim(p_company), ''), trim(p_name), trim(p_phone), emp.name)
  RETURNING * INTO row;
  RETURN json_build_object('ok', true, 'row', to_json(row));
END $fn$;
GRANT EXECUTE ON FUNCTION public.liff_add_investor(text, text, text, text) TO anon, authenticated;

-- ── 投資人:刪除(被訂金/加盟金引用則擋)──
CREATE OR REPLACE FUNCTION public.liff_delete_investor(p_line_user_id text, p_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'collection.manage') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN'); END IF;
  IF EXISTS (SELECT 1 FROM public.deposit_records WHERE investor_id = p_id AND organization_id = emp.organization_id)
     OR EXISTS (SELECT 1 FROM public.franchise_fee_investors WHERE investor_id = p_id AND organization_id = emp.organization_id) THEN
    RETURN json_build_object('ok', false, 'error', '此投資人已用於訂金/加盟金,不能刪'); END IF;
  DELETE FROM public.collection_investors WHERE id = p_id AND organization_id = emp.organization_id;
  RETURN json_build_object('ok', true);
END $fn$;
GRANT EXECUTE ON FUNCTION public.liff_delete_investor(text, uuid) TO anon, authenticated;

-- ── 訂金:新增案(目標固定 30 萬,綁一位投資人)──
CREATE OR REPLACE FUNCTION public.liff_add_deposit(p_line_user_id text, p_title text, p_investor_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE emp public.employees; v_id uuid;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'collection.manage') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN'); END IF;
  IF COALESCE(trim(p_title), '') = '' THEN RETURN json_build_object('ok', false, 'error', '請填標的名稱'); END IF;
  IF p_investor_id IS NULL THEN RETURN json_build_object('ok', false, 'error', '請選投資人'); END IF;
  INSERT INTO public.deposit_records (organization_id, title, target_amount, investor_id, created_by)
  VALUES (emp.organization_id, trim(p_title), 300000, p_investor_id, emp.name)
  RETURNING id INTO v_id;
  RETURN json_build_object('ok', true, 'id', v_id);
END $fn$;
GRANT EXECUTE ON FUNCTION public.liff_add_deposit(text, text, uuid) TO anon, authenticated;

-- ── 訂金:刪除(已開加盟金會被 FK 擋)──
CREATE OR REPLACE FUNCTION public.liff_delete_deposit(p_line_user_id text, p_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'collection.manage') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN'); END IF;
  DELETE FROM public.deposit_records WHERE id = p_id AND organization_id = emp.organization_id;
  RETURN json_build_object('ok', true);
EXCEPTION WHEN foreign_key_violation THEN
  RETURN json_build_object('ok', false, 'error', '此訂金已開加盟金,不能刪');
END $fn$;
GRANT EXECUTE ON FUNCTION public.liff_delete_deposit(text, uuid) TO anon, authenticated;

-- ── 訂金:記一筆收款(超收擋)──
CREATE OR REPLACE FUNCTION public.liff_add_deposit_payment(p_line_user_id text, p_deposit_id uuid, p_paid_date date, p_amount numeric, p_note text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE emp public.employees; d public.deposit_records; v_remaining numeric;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'collection.manage') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN'); END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN RETURN json_build_object('ok', false, 'error', '金額要 > 0'); END IF;
  SELECT * INTO d FROM public.deposit_records WHERE id = p_deposit_id AND organization_id = emp.organization_id;
  IF d.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  v_remaining := COALESCE(d.target_amount, 0) - COALESCE(d.paid_total, 0);
  IF p_amount > v_remaining + 0.5 THEN
    RETURN json_build_object('ok', false, 'error', '超過剩餘上限,最多再記 ' || to_char(v_remaining, 'FM999,999,999')); END IF;
  INSERT INTO public.deposit_payments (organization_id, deposit_id, paid_date, amount, note, created_by)
  VALUES (emp.organization_id, p_deposit_id, COALESCE(p_paid_date, CURRENT_DATE), p_amount, NULLIF(p_note, ''), emp.name);
  RETURN json_build_object('ok', true);
END $fn$;
GRANT EXECUTE ON FUNCTION public.liff_add_deposit_payment(text, uuid, date, numeric, text) TO anon, authenticated;

-- ── 訂金:刪一筆收款 ──
CREATE OR REPLACE FUNCTION public.liff_delete_deposit_payment(p_line_user_id text, p_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'collection.manage') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN'); END IF;
  DELETE FROM public.deposit_payments WHERE id = p_id AND organization_id = emp.organization_id;
  RETURN json_build_object('ok', true);
END $fn$;
GRANT EXECUTE ON FUNCTION public.liff_delete_deposit_payment(text, uuid) TO anon, authenticated;

-- ── 加盟金:新增(header + 投資人分攤;投資人須已付訂金;分攤加總=總額)──
CREATE OR REPLACE FUNCTION public.liff_add_franchise(p_line_user_id text, p_title text, p_total numeric, p_allocs jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE emp public.employees; v_id uuid; a jsonb; v_sum numeric := 0; v_ids uuid[] := '{}'; v_inv uuid;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'collection.manage') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN'); END IF;
  IF COALESCE(trim(p_title), '') = '' THEN RETURN json_build_object('ok', false, 'error', '請填標的名稱'); END IF;
  IF COALESCE(p_total, 0) <= 0 THEN RETURN json_build_object('ok', false, 'error', '請填總額'); END IF;

  -- 驗證分攤列
  FOR a IN SELECT * FROM jsonb_array_elements(COALESCE(p_allocs, '[]'::jsonb)) LOOP
    v_inv := NULLIF(a->>'investor_id', '')::uuid;
    IF v_inv IS NULL OR COALESCE((a->>'amount')::numeric, 0) <= 0 THEN CONTINUE; END IF;
    IF v_inv = ANY(v_ids) THEN RETURN json_build_object('ok', false, 'error', '同一投資人重複了'); END IF;
    -- 投資人須有「訂金收款完成」的訂金案
    IF NOT EXISTS (SELECT 1 FROM public.deposit_records
                   WHERE investor_id = v_inv AND organization_id = emp.organization_id AND status = 'completed') THEN
      RETURN json_build_object('ok', false, 'error', '有投資人尚未付滿訂金,不能列入加盟金分攤'); END IF;
    v_ids := array_append(v_ids, v_inv);
    v_sum := v_sum + (a->>'amount')::numeric;
  END LOOP;
  IF array_length(v_ids, 1) IS NULL THEN RETURN json_build_object('ok', false, 'error', '至少一位投資人 + 分攤金額'); END IF;
  IF abs(v_sum - p_total) > 0.5 THEN RETURN json_build_object('ok', false, 'error', '分攤加總與總額不符'); END IF;

  INSERT INTO public.franchise_fees (organization_id, title, total_amount, created_by)
  VALUES (emp.organization_id, trim(p_title), p_total, emp.name)
  RETURNING id INTO v_id;

  FOR a IN SELECT * FROM jsonb_array_elements(p_allocs) LOOP
    v_inv := NULLIF(a->>'investor_id', '')::uuid;
    IF v_inv IS NULL OR COALESCE((a->>'amount')::numeric, 0) <= 0 THEN CONTINUE; END IF;
    INSERT INTO public.franchise_fee_investors (organization_id, franchise_fee_id, investor_id, amount)
    VALUES (emp.organization_id, v_id, v_inv, (a->>'amount')::numeric);
  END LOOP;

  RETURN json_build_object('ok', true, 'id', v_id);
END $fn$;
GRANT EXECUTE ON FUNCTION public.liff_add_franchise(text, text, numeric, jsonb) TO anon, authenticated;

-- ── 加盟金:刪除 ──
CREATE OR REPLACE FUNCTION public.liff_delete_franchise(p_line_user_id text, p_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'collection.manage') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN'); END IF;
  DELETE FROM public.franchise_fees WHERE id = p_id AND organization_id = emp.organization_id;
  RETURN json_build_object('ok', true);
END $fn$;
GRANT EXECUTE ON FUNCTION public.liff_delete_franchise(text, uuid) TO anon, authenticated;

-- ── 加盟金:記一筆分期收款(超收擋:該投資人該期 45/45/10 目標 − 已收)──
CREATE OR REPLACE FUNCTION public.liff_add_franchise_payment(
  p_line_user_id text, p_ff_id uuid, p_investor_id uuid, p_stage smallint, p_paid_date date, p_amount numeric, p_note text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE emp public.employees; ffi public.franchise_fee_investors; v_t1 numeric; v_t2 numeric; v_target numeric; v_paid numeric; v_remaining numeric;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'collection.manage') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN'); END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN RETURN json_build_object('ok', false, 'error', '金額要 > 0'); END IF;
  IF p_stage NOT IN (1, 2, 3) THEN RETURN json_build_object('ok', false, 'error', '期別錯誤'); END IF;
  SELECT * INTO ffi FROM public.franchise_fee_investors
    WHERE franchise_fee_id = p_ff_id AND investor_id = p_investor_id AND organization_id = emp.organization_id;
  IF ffi.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  -- 三期目標 45 / 45 / 10(第三期用餘數,免進位差)
  v_t1 := round(COALESCE(ffi.amount, 0) * 0.45);
  v_t2 := round(COALESCE(ffi.amount, 0) * 0.45);
  v_target := CASE p_stage WHEN 1 THEN v_t1 WHEN 2 THEN v_t2 ELSE COALESCE(ffi.amount, 0) - v_t1 - v_t2 END;
  v_paid   := CASE p_stage WHEN 1 THEN COALESCE(ffi.paid_stage1, 0) WHEN 2 THEN COALESCE(ffi.paid_stage2, 0) ELSE COALESCE(ffi.paid_stage3, 0) END;
  v_remaining := v_target - v_paid;
  IF p_amount > v_remaining + 0.5 THEN
    RETURN json_build_object('ok', false, 'error', '超過本期剩餘上限,最多再記 ' || to_char(v_remaining, 'FM999,999,999')); END IF;
  INSERT INTO public.franchise_fee_payments (organization_id, franchise_fee_id, investor_id, stage, paid_date, amount, note, created_by)
  VALUES (emp.organization_id, p_ff_id, p_investor_id, p_stage, COALESCE(p_paid_date, CURRENT_DATE), p_amount, NULLIF(p_note, ''), emp.name);
  RETURN json_build_object('ok', true);
END $fn$;
GRANT EXECUTE ON FUNCTION public.liff_add_franchise_payment(text, uuid, uuid, smallint, date, numeric, text) TO anon, authenticated;

-- ── 加盟金:刪一筆分期收款 ──
CREATE OR REPLACE FUNCTION public.liff_delete_franchise_payment(p_line_user_id text, p_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  IF NOT public.liff_employee_has_permission(emp.id, 'collection.manage') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN'); END IF;
  DELETE FROM public.franchise_fee_payments WHERE id = p_id AND organization_id = emp.organization_id;
  RETURN json_build_object('ok', true);
END $fn$;
GRANT EXECUTE ON FUNCTION public.liff_delete_franchise_payment(text, uuid) TO anon, authenticated;
