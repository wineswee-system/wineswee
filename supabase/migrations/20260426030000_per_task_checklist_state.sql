-- ============================================================
-- 修：清單範本 (checklist_items.checked) 是共用狀態
--     一個任務勾起來，所有用同範本的任務都顯示已勾 → 大 bug
--
-- 解：建獨立 per-task 狀態表，每個任務自己的勾選快照
--     - 範本永遠不動 (checklist_items.checked 棄用)
--     - 任務勾選只寫 task_checklist_item_state
--     - liff_get_task_detail / liff_toggle_checklist_item 全部走新表
-- ============================================================

BEGIN;

-- ═══ 1. 新表：per-task per-item 狀態 ═══
CREATE TABLE IF NOT EXISTS public.task_checklist_item_state (
  task_id           INT NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  checklist_item_id INT NOT NULL REFERENCES public.checklist_items(id) ON DELETE CASCADE,
  checked           BOOLEAN NOT NULL DEFAULT false,
  checked_by        TEXT,
  checked_at        TIMESTAMPTZ,
  PRIMARY KEY (task_id, checklist_item_id)
);

CREATE INDEX IF NOT EXISTS idx_tcis_task ON public.task_checklist_item_state(task_id);

COMMENT ON TABLE public.task_checklist_item_state IS
  '每個任務對範本清單項目的勾選狀態。範本 (checklist_items.checked) 棄用';

-- 範本上殘留的 checked 應該全部歸 false（避免下次任務又看到髒資料）
UPDATE public.checklist_items SET checked = false WHERE checked = true;
COMMENT ON COLUMN public.checklist_items.checked IS
  'DEPRECATED — 不要再用。任務勾選改寫 task_checklist_item_state';


-- ═══ 2. liff_get_task_detail：checklist 勾選狀態走新表 ═══
CREATE OR REPLACE FUNCTION public.liff_get_task_detail(
  p_line_user_id text,
  p_task_id      int
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  task_row tasks;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO task_row FROM public.tasks
   WHERE id = p_task_id AND assignee_id = emp.id;
  IF task_row.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_NOT_ASSIGNED');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'task', row_to_json(task_row),
    -- ★ checklists 的 items.checked 改從 task_checklist_item_state 拉
    'checklists', COALESCE((
      SELECT json_agg(json_build_object(
        'id',    cl.id,
        'name',  cl.name,
        'items', COALESCE((
          SELECT json_agg(json_build_object(
            'id',         ci.id,
            'title',      ci.title,
            'checked',    COALESCE(s.checked, false),
            'sort_order', ci.sort_order
          ) ORDER BY ci.sort_order, ci.id)
          FROM public.checklist_items ci
          LEFT JOIN public.task_checklist_item_state s
            ON s.checklist_item_id = ci.id AND s.task_id = p_task_id
          WHERE ci.checklist_id = cl.id
        ), '[]'::json)
      ) ORDER BY tc.id)
      FROM public.task_checklists tc
      JOIN public.checklists cl ON cl.id = tc.checklist_id
      WHERE tc.task_id = p_task_id
    ), '[]'::json),
    -- inline items 維持原樣（task_checklist_items 本來就 per-task）
    'inline_items', COALESCE((
      SELECT json_agg(json_build_object(
        'id',      tci.id,
        'title',   tci.title,
        'checked', tci.checked,
        'sort_order', tci.sort_order
      ) ORDER BY tci.sort_order, tci.id)
      FROM public.task_checklist_items tci
      WHERE tci.task_id = p_task_id
    ), '[]'::json),
    'comments', COALESCE((
      SELECT json_agg(json_build_object(
        'id',         tc.id,
        'author',     tc.author,
        'content',    tc.content,
        'source',     tc.source,
        'created_at', tc.created_at
      ) ORDER BY tc.created_at)
      FROM public.task_comments tc
      WHERE tc.task_id = p_task_id
    ), '[]'::json)
  );
END $$;


-- ═══ 3. liff_toggle_checklist_item：UPSERT 到新表 ═══
-- 之前直接 UPDATE checklist_items.checked → 共用狀態爛
-- 現在改成需要帶 task_id 的版本：upsert task_checklist_item_state
-- 為了向下相容 LIFF 舊呼叫（只傳 item_id 不傳 task_id）：
--   找該員工任意一個有掛這個 item 的 task → 取最新 → upsert
-- LIFF 後續會升級成新版 RPC liff_toggle_task_checklist_item_v2(task_id, item_id, checked)
DROP FUNCTION IF EXISTS public.liff_toggle_checklist_item(text, int, boolean);
CREATE OR REPLACE FUNCTION public.liff_toggle_checklist_item(
  p_line_user_id text,
  p_item_id      int,
  p_checked      boolean
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  v_task_id int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 找這個 item 屬於哪個 checklist → 找哪個指派給此員工的 task 連結到該 checklist
  SELECT t.id INTO v_task_id
    FROM public.checklist_items ci
    JOIN public.task_checklists tc ON tc.checklist_id = ci.checklist_id
    JOIN public.tasks t ON t.id = tc.task_id
   WHERE ci.id = p_item_id
     AND t.assignee_id = emp.id
   ORDER BY t.id DESC
   LIMIT 1;

  IF v_task_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_FORBIDDEN');
  END IF;

  INSERT INTO public.task_checklist_item_state (task_id, checklist_item_id, checked, checked_by, checked_at)
  VALUES (v_task_id, p_item_id, p_checked, emp.name, NOW())
  ON CONFLICT (task_id, checklist_item_id) DO UPDATE SET
    checked    = EXCLUDED.checked,
    checked_by = EXCLUDED.checked_by,
    checked_at = EXCLUDED.checked_at;

  RETURN json_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_toggle_checklist_item(text, int, boolean) TO anon, authenticated;


-- ═══ 4. 新版 RPC：明確帶 task_id 的 toggle，避免歧義 ═══
CREATE OR REPLACE FUNCTION public.liff_toggle_checklist_item_v2(
  p_line_user_id text,
  p_task_id      int,
  p_item_id      int,
  p_checked      boolean
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  v_belongs boolean;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 驗證：item 屬於 task 連結的 checklist + task 是該員工的
  SELECT EXISTS (
    SELECT 1
      FROM public.checklist_items ci
      JOIN public.task_checklists tc ON tc.checklist_id = ci.checklist_id
      JOIN public.tasks t ON t.id = tc.task_id
     WHERE ci.id = p_item_id
       AND t.id = p_task_id
       AND t.assignee_id = emp.id
  ) INTO v_belongs;

  IF NOT v_belongs THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_FORBIDDEN');
  END IF;

  INSERT INTO public.task_checklist_item_state (task_id, checklist_item_id, checked, checked_by, checked_at)
  VALUES (p_task_id, p_item_id, p_checked, emp.name, NOW())
  ON CONFLICT (task_id, checklist_item_id) DO UPDATE SET
    checked    = EXCLUDED.checked,
    checked_by = EXCLUDED.checked_by,
    checked_at = EXCLUDED.checked_at;

  RETURN json_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_toggle_checklist_item_v2(text, int, int, boolean) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
