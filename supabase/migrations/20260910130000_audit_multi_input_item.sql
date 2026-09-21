-- 稽核單:「抽查N樣庫存與現場實際對比 ▶簽名」改成多格可填(input_type='multi')— 2026-09-10
-- 需求:該項要能填 3~5 格不等的內容(抽查哪幾樣、帳面 vs 現場),且內容要進月報表,
--       一眼看出哪間門市、哪天、抽了什麼、有沒有問題。
-- 設計(對齊 [feedback_minimize_touching_existing]):
--   * 不動巨型模板函式 _create_store_audit_default_items;改用一支「命名排在其後」的
--     AFTER INSERT trigger 把符合的項改成 input_type='multi'。
--   * 內容存新欄 remark_list(jsonb 字串陣列),與單格 remark(text)分開,零破壞。
--   * liff_update_store_audit_item 加 p_remark_list(DROP 舊 6 參數版→建 7 參數版,避免 overload 42725)。
--   * 報表另開一支加法 RPC get_monthly_audit_key_checks(不改 get_monthly_audit_report)。

-- ① 多格內容欄
ALTER TABLE public.store_audit_items ADD COLUMN IF NOT EXISTS remark_list jsonb;

-- ② 新單:把「庫存與現場實際對比」項標成 multi(trigger 名 zz 確保排在 after_insert 之後)
CREATE OR REPLACE FUNCTION public._trg_store_audit_flag_multi_items()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.store_audit_items
     SET input_type = 'multi'
   WHERE audit_id = NEW.id
     AND item_text LIKE '%庫存與現場實際對比%'
     AND COALESCE(input_type, 'check') = 'check';
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_store_audit_zz_multi_items ON public.store_audits;
CREATE TRIGGER trg_store_audit_zz_multi_items AFTER INSERT ON public.store_audits
  FOR EACH ROW EXECUTE FUNCTION public._trg_store_audit_flag_multi_items();

-- ③ 回填既有單(所有狀態;未填者 remark_list 留 NULL,僅改渲染方式)
UPDATE public.store_audit_items
   SET input_type = 'multi'
 WHERE item_text LIKE '%庫存與現場實際對比%'
   AND COALESCE(input_type, 'check') = 'check';

-- ④ liff_update_store_audit_item 加 p_remark_list(DROP 舊版再建新版,防 overload)
DROP FUNCTION IF EXISTS public.liff_update_store_audit_item(text, integer, integer, text, text, text);

CREATE OR REPLACE FUNCTION public.liff_update_store_audit_item(
  p_line_user_id text,
  p_item_id integer,
  p_deduct_score integer DEFAULT NULL::integer,
  p_group_note text DEFAULT NULL::text,
  p_remark text DEFAULT NULL::text,
  p_item_text text DEFAULT NULL::text,
  p_remark_list jsonb DEFAULT NULL::jsonb
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp employees; v_item store_audit_items; v_audit store_audits;
  v_other int; v_ded int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  SELECT * INTO v_item FROM store_audit_items WHERE id = p_item_id;
  IF v_item.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'ITEM_NOT_FOUND'); END IF;
  SELECT * INTO v_audit FROM store_audits WHERE id = v_item.audit_id;
  IF v_audit.status <> '草稿' THEN RETURN json_build_object('ok', false, 'error', 'NOT_DRAFT', 'status', v_audit.status); END IF;
  -- 草稿編輯:稽核員本人 / super_admin(跨租戶) / 同租戶的 admin 或 稽核室部門
  IF NOT (
       v_audit.auditor_id = emp.id
    OR EXISTS (SELECT 1 FROM public.roles r WHERE r.id = emp.role_id AND r.name = 'super_admin')
    OR (v_audit.organization_id = emp.organization_id AND (
          EXISTS (SELECT 1 FROM public.roles r WHERE r.id = emp.role_id AND r.name = 'admin')
       OR EXISTS (SELECT 1 FROM public.departments d WHERE d.id = emp.department_id AND d.name = '稽核室')
       ))
  ) THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;

  IF p_deduct_score IS NOT NULL THEN
    v_ded := GREATEST(0, p_deduct_score);
    IF v_item.input_type IN ('bonus','other') THEN
      UPDATE store_audit_items SET deduct_score = v_ded, passed = TRUE WHERE id = p_item_id;
    ELSE
      SELECT COALESCE(SUM(deduct_score), 0) INTO v_other FROM store_audit_items
        WHERE audit_id = v_item.audit_id
          AND relation_group IS NOT DISTINCT FROM v_item.relation_group
          AND id <> p_item_id AND input_type NOT IN ('bonus','other');
      IF v_ded > COALESCE(v_item.group_allot, 0) - v_other THEN
        v_ded := GREATEST(0, COALESCE(v_item.group_allot, 0) - v_other);
      END IF;
      UPDATE store_audit_items SET deduct_score = v_ded, passed = (v_ded = 0) WHERE id = p_item_id;
    END IF;
  END IF;

  IF p_group_note IS NOT NULL THEN UPDATE store_audit_items SET group_note = p_group_note WHERE id = p_item_id; END IF;
  IF p_remark    IS NOT NULL THEN UPDATE store_audit_items SET remark    = p_remark    WHERE id = p_item_id; END IF;
  IF p_item_text IS NOT NULL THEN UPDATE store_audit_items SET item_text = p_item_text WHERE id = p_item_id; END IF;
  IF p_remark_list IS NOT NULL THEN UPDATE store_audit_items SET remark_list = p_remark_list WHERE id = p_item_id; END IF;

  PERFORM public.calc_store_audit_score(v_item.audit_id);
  RETURN json_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.liff_update_store_audit_item(text, integer, integer, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.liff_update_store_audit_item(text, integer, integer, text, text, text, jsonb) TO anon, authenticated;

-- ⑤ 報表加法 RPC:當月已核准稽核裡「多格填寫項」的內容,按門市/日期列出(有填才回)
CREATE OR REPLACE FUNCTION public.get_monthly_audit_key_checks(p_org int, p_year int, p_month int)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_start date := make_date(p_year, p_month, 1);
  v_end   date := (make_date(p_year, p_month, 1) + INTERVAL '1 month - 1 day')::date;
  v_rows  json;
BEGIN
  IF p_org IS NULL OR NOT public._same_org_or_super(p_org) THEN RETURN '[]'::json; END IF;

  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.audit_date, t.store_name), '[]'::json) INTO v_rows
  FROM (
    SELECT a.store_name,
           a.audit_date,
           i.item_text,
           COALESCE(i.deduct_score, 0)::int AS deduct,
           (i.passed = false)               AS is_bad,
           (SELECT COALESCE(json_agg(e), '[]'::json)
              FROM jsonb_array_elements_text(i.remark_list) e
             WHERE btrim(e) <> '')          AS entries
    FROM public.store_audit_items i
    JOIN public.store_audits a ON a.id = i.audit_id
    WHERE a.organization_id = p_org AND a.status = '已核准'
      AND a.audit_date BETWEEN v_start AND v_end
      AND i.input_type = 'multi'
      AND i.remark_list IS NOT NULL
      AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(i.remark_list) e WHERE btrim(e) <> '')
  ) t;

  RETURN v_rows;
END $fn$;

REVOKE ALL ON FUNCTION public.get_monthly_audit_key_checks(int,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_monthly_audit_key_checks(int,int,int) TO authenticated;

NOTIFY pgrst, 'reload schema';
