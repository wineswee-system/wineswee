-- 服務類(四) 加分列 — 2026-07-16
-- 服務類最後多一列「加分」:填分數+說明,有加分則說明必填(前端擋);
--   加分往回補該大類分數(從扣分回血),但每大類上限 100 不超過。
-- 存法:input_type='bonus' 的 item,deduct_score 存加分點數(正數,計分時當負扣)。
--   不動 142 列大函式 → 改 after-insert trigger 加列 + 回填既有單。idempotent。

-- 1. 新單自動帶「加分」列(改 after-insert trigger)
CREATE OR REPLACE FUNCTION public._trg_store_audit_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._create_store_audit_default_items(NEW.id);
  -- 服務類加分列(item_no 149 → 排序落在服務類最後)
  INSERT INTO public.store_audit_items
    (audit_id, category_code, category_name, relation_group, group_allot, item_no, item_text, is_star, input_type)
  VALUES (NEW.id, '四', '服務類', '加分', 0, 149, '服務表現優異加分', false, 'bonus');
  RETURN NEW;
END $function$;

-- 2. 回填既有稽核單(沒加分列的都補一列)
INSERT INTO public.store_audit_items
  (audit_id, category_code, category_name, relation_group, group_allot, item_no, item_text, is_star, input_type)
SELECT sa.id, '四', '服務類', '加分', 0, 149, '服務表現優異加分', false, 'bonus'
FROM public.store_audits sa
WHERE NOT EXISTS (
  SELECT 1 FROM public.store_audit_items i
  WHERE i.audit_id = sa.id AND i.input_type = 'bonus' AND i.category_code = '四'
);

-- 3. liff_update:加分不 clamp;avg 加分往回加、每類 LEAST(100);total_deducted 排除加分
CREATE OR REPLACE FUNCTION public.liff_update_store_audit_item(
  p_line_user_id text, p_item_id integer,
  p_deduct_score integer DEFAULT NULL, p_group_note text DEFAULT NULL, p_remark text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
  IF v_audit.auditor_id IS DISTINCT FROM emp.id THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;

  IF p_deduct_score IS NOT NULL THEN
    v_ded := GREATEST(0, p_deduct_score);
    IF v_item.input_type = 'bonus' THEN
      -- 加分:不受群組配分限制(靠類別上限100控),直接存
      UPDATE store_audit_items SET deduct_score = v_ded, passed = TRUE WHERE id = p_item_id;
    ELSE
      SELECT COALESCE(SUM(deduct_score), 0) INTO v_other FROM store_audit_items
        WHERE audit_id = v_item.audit_id
          AND relation_group IS NOT DISTINCT FROM v_item.relation_group
          AND id <> p_item_id AND input_type <> 'bonus';
      IF v_ded > COALESCE(v_item.group_allot, 0) - v_other THEN
        v_ded := GREATEST(0, COALESCE(v_item.group_allot, 0) - v_other);
      END IF;
      UPDATE store_audit_items SET deduct_score = v_ded, passed = (v_ded = 0) WHERE id = p_item_id;
    END IF;
  END IF;

  IF p_group_note IS NOT NULL THEN UPDATE store_audit_items SET group_note = p_group_note WHERE id = p_item_id; END IF;
  IF p_remark    IS NOT NULL THEN UPDATE store_audit_items SET remark = p_remark WHERE id = p_item_id; END IF;

  UPDATE store_audits SET
    total_deducted = COALESCE((SELECT SUM(deduct_score) FROM store_audit_items
                                WHERE audit_id = v_item.audit_id AND input_type <> 'bonus'), 0),
    avg_score = COALESCE((
      SELECT ROUND(AVG(LEAST(100, GREATEST(0, 100 - cat_ded))), 2)
      FROM (SELECT category_code,
              SUM(CASE WHEN input_type = 'bonus' THEN -COALESCE(deduct_score,0) ELSE COALESCE(deduct_score,0) END) AS cat_ded
            FROM store_audit_items WHERE audit_id = v_item.audit_id GROUP BY category_code) c
    ), 0)
  WHERE id = v_item.audit_id;

  RETURN json_build_object('ok', true);
END $function$;

NOTIFY pgrst, 'reload schema';
