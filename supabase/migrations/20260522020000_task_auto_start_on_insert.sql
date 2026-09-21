-- ════════════════════════════════════════════════════════════════════════════
-- task 建立即「進行中」：沒有前置未完成任務就自動啟動
-- ────────────────────────────────────────────────────────────────────────────
-- 問題：任務建立預設 '未開始'/'待處理'，要手動改成「進行中」
--       通知才發得出去，使用者必須多一個動作。
-- 規則：
--   1. 無 workflow_instance_id（獨立任務 / 專案任務）→ 建立即「進行中」
--   2. workflow 任務 step_order = 0（或無 step_order）→ 建立即「進行中」
--   3. workflow 任務 step_order > 0，且前置 step 有未完成 → 維持「待處理」
--   4. 已明確傳入進行中/已完成/已擱置 → 不動
-- 通知：現有 trg_task_enqueue_started_notify 只聽 AFTER UPDATE，
--       補加 INSERT 事件，讓 BEFORE INSERT 改完狀態後能自動推 LINE。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. BEFORE INSERT：自動判斷是否可以進行中 ────────────────────────────
CREATE OR REPLACE FUNCTION public._task_auto_start_on_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- 已明確指定非預設狀態，不改
  IF NEW.status NOT IN ('待處理', '未開始') THEN
    RETURN NEW;
  END IF;

  -- 獨立任務 或 專案任務（無 workflow_instance_id）→ 直接進行中
  IF NEW.workflow_instance_id IS NULL THEN
    NEW.status     := '進行中';
    NEW.started_at := COALESCE(NEW.started_at, now());
    RETURN NEW;
  END IF;

  -- workflow 任務：第一關（step_order IS NULL 或 0）→ 直接進行中
  IF COALESCE(NEW.step_order, 0) = 0 THEN
    NEW.status     := '進行中';
    NEW.started_at := COALESCE(NEW.started_at, now());
    RETURN NEW;
  END IF;

  -- workflow 任務：有前置 step 未完成 → 維持待處理
  IF EXISTS (
    SELECT 1 FROM public.tasks
     WHERE workflow_instance_id = NEW.workflow_instance_id
       AND step_order < NEW.step_order
       AND status NOT IN ('已完成', '已擱置', '已取消')
  ) THEN
    RETURN NEW;  -- 維持 '待處理'
  END IF;

  -- 前置全完成（或尚未插入，代表本關就是第一關）→ 進行中
  NEW.status     := '進行中';
  NEW.started_at := COALESCE(NEW.started_at, now());
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_auto_start ON public.tasks;
CREATE TRIGGER trg_task_auto_start
  BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._task_auto_start_on_insert();


-- ─── 2. 補 INSERT 事件給 trg_task_enqueue_started_notify ─────────────────
-- 原本只聽 AFTER UPDATE OF status，INSERT 時就算狀態已是「進行中」也不推。
-- 重建為 AFTER INSERT OR UPDATE OF status。
-- function 本體不動（OLD.status IS NOT DISTINCT FROM '進行中' 在 INSERT 時
-- OLD 全為 NULL → false → 條件不短路 → 正常進入推通知邏輯）。
DROP TRIGGER IF EXISTS trg_task_enqueue_started_notify ON public.tasks;
CREATE TRIGGER trg_task_enqueue_started_notify
  AFTER INSERT OR UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._task_enqueue_started_notify();

COMMIT;

NOTIFY pgrst, 'reload schema';
