-- ════════════════════════════════════════════════════════════
-- 流程任務 step_order 線性 cascade — task 完成自動推進 + LINE 通知
--
-- 起因：
--   流程模板一鍵建出來的 task 們沒寫 task_dependencies。原本的
--   _task_cascade_on_complete trigger 靠 task_dependencies + status='待處理'
--   推進，兩個條件都對不上 → 第 2 關永遠卡「待簽核」，assignee 也沒收到 LINE。
--
-- 改法：
--   1. 新 helper _push_task_started_flex — LINE 推「🚀 任務開始」flex 卡
--   2. 新 trigger _task_advance_next_step — task UPDATE 成 '已完成'，找同
--      workflow_instance_id + step_order + 1 的 task，狀態 '待處理' 或
--      '待簽核'（legacy 誤標的）→ 改 '進行中' + 推 LINE
--   3. 不擋既有 _task_cascade_on_complete（任務依賴另一路徑也保留）
--   4. 一次性 backfill：把已卡住的 task 全部解開 + 推 LINE
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. helper：推「任務開始」flex ═══
CREATE OR REPLACE FUNCTION public._push_task_started_flex(
  p_line_user_id text,
  p_liff_id      text,
  p_task_id      int,
  p_task_title   text,
  p_instance     text   -- workflow_instance.template_name 或 store
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_push_url   CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/line-push';
  v_anon       CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
  v_liff_url   text;
  v_payload    jsonb;
BEGIN
  IF p_line_user_id IS NULL OR p_line_user_id = '' THEN RETURN; END IF;

  IF p_liff_id IS NOT NULL AND p_liff_id <> '' THEN
    v_liff_url := 'https://liff.line.me/' || p_liff_id
                  || '?to=%2Ftasks%3Ftask%3D' || p_task_id::text;
  END IF;

  v_payload := jsonb_build_object(
    'to', p_line_user_id,
    'messages', jsonb_build_array(
      jsonb_build_object(
        'type', 'flex',
        'altText', '🚀 任務開始：' || COALESCE(p_task_title, ''),
        'contents', jsonb_build_object(
          'type', 'bubble', 'size', 'kilo',
          'header', jsonb_build_object(
            'type', 'box', 'layout', 'vertical',
            'paddingAll', '14px', 'backgroundColor', '#06b6d4',
            'contents', jsonb_build_array(
              jsonb_build_object('type','text','text','🚀 任務開始','color','#FFFFFF','weight','bold','size','md')
            )
          ),
          'body', jsonb_build_object(
            'type', 'box', 'layout', 'vertical',
            'spacing', 'sm', 'paddingAll', '14px',
            'contents', jsonb_build_array(
              jsonb_build_object('type', 'text', 'text', COALESCE(p_task_title, '未命名任務'), 'weight', 'bold', 'size', 'md', 'wrap', true),
              CASE WHEN p_instance IS NOT NULL AND p_instance <> '' THEN
                jsonb_build_object('type', 'text', 'text', '📋 ' || p_instance, 'size', 'sm', 'color', '#666666', 'wrap', true)
              ELSE
                jsonb_build_object('type', 'separator', 'margin', 'sm')
              END,
              jsonb_build_object('type', 'text', 'text', '前一關已完成，輪到你了', 'size', 'xs', 'color', '#999999', 'margin', 'md', 'wrap', true)
            )
          ),
          'footer', CASE WHEN v_liff_url IS NOT NULL THEN
            jsonb_build_object(
              'type', 'box', 'layout', 'vertical', 'paddingAll', '8px',
              'contents', jsonb_build_array(
                jsonb_build_object(
                  'type', 'button', 'style', 'primary', 'color', '#06b6d4',
                  'action', jsonb_build_object('type', 'uri', 'label', '打開任務', 'uri', v_liff_url)
                )
              )
            )
          ELSE
            jsonb_build_object('type', 'box', 'layout', 'vertical', 'paddingAll', '8px', 'contents', '[]'::jsonb)
          END
        )
      )
    )
  );

  -- fire-and-forget pg_net call
  PERFORM net.http_post(
    url := v_push_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon,
      'apikey', v_anon
    ),
    body := v_payload
  );
EXCEPTION WHEN OTHERS THEN
  -- 不阻斷 transaction
  RAISE NOTICE '[_push_task_started_flex] failed: %', SQLERRM;
END $$;


-- ═══ 2. trigger：task 完成 → 找下一個 step → 推進 + LINE ═══
CREATE OR REPLACE FUNCTION public._task_advance_next_step()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_next         tasks;
  v_inst_name    text;
  v_line_uid     text;
  v_liff_id      text;
BEGIN
  -- 只在 status 變 '已完成' 時 fire
  IF NEW.status <> '已完成' OR OLD.status = '已完成' THEN
    RETURN NEW;
  END IF;
  IF NEW.workflow_instance_id IS NULL OR NEW.step_order IS NULL THEN
    RETURN NEW;
  END IF;

  -- 找下一個 step 的 task — 只認 '待處理'（前端修好後新建任務 step 2+ 用這個）
  -- '待簽核' 在業務上是「等簽」，不該被前一關完成強制推進
  SELECT * INTO v_next FROM public.tasks
   WHERE workflow_instance_id = NEW.workflow_instance_id
     AND step_order = NEW.step_order + 1
     AND status = '待處理'
   ORDER BY id LIMIT 1;

  IF v_next.id IS NULL THEN
    RETURN NEW;  -- 沒下一關，或下一關已經在跑
  END IF;

  -- 推進
  UPDATE public.tasks
     SET status     = '進行中',
         started_at = COALESCE(started_at, now())
   WHERE id = v_next.id;

  -- 解 LINE
  IF v_next.assignee_id IS NOT NULL OR v_next.assignee IS NOT NULL THEN
    SELECT v.line_user_id, v.liff_id
      INTO v_line_uid, v_liff_id
      FROM v_employee_line_resolved v
     WHERE (v_next.assignee_id IS NOT NULL AND v.employee_id = v_next.assignee_id)
        OR (v_next.assignee_id IS NULL     AND v.employee_name = v_next.assignee)
     ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST
     LIMIT 1;

    IF v_line_uid IS NOT NULL THEN
      SELECT template_name INTO v_inst_name FROM public.workflow_instances WHERE id = NEW.workflow_instance_id;
      PERFORM public._push_task_started_flex(
        v_line_uid, v_liff_id, v_next.id, v_next.title, v_inst_name
      );
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_advance_next_step ON public.tasks;
CREATE TRIGGER trg_task_advance_next_step
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public._task_advance_next_step();


-- ═══ 3. 一次性 backfill：解開所有卡住的下游 task ═══
-- 條件：status IN ('待處理','待簽核')，workflow_instance_id 內前一 step 已完成
DO $$
DECLARE
  r RECORD;
  v_inst_name text;
  v_line_uid  text;
  v_liff_id   text;
BEGIN
  FOR r IN
    SELECT t.id, t.title, t.assignee, t.assignee_id, t.workflow_instance_id
      FROM public.tasks t
     WHERE t.status IN ('待處理', '待簽核')
       AND t.workflow_instance_id IS NOT NULL
       AND t.step_order IS NOT NULL
       AND t.approval_chain_id IS NULL                      -- 有 chain 的不動（chain trigger 自己處理）
       AND t.confirmation_required IS NOT TRUE              -- 有 confirmation 的不動
       AND EXISTS (
         SELECT 1 FROM public.tasks prev
          WHERE prev.workflow_instance_id = t.workflow_instance_id
            AND prev.step_order = t.step_order - 1
            AND prev.status = '已完成'
       )
       -- 上一關剛好是「完成的」才推；如果是再上一關完成、中間斷一個，不處理
  LOOP
    UPDATE public.tasks SET status = '進行中', started_at = COALESCE(started_at, now())
     WHERE id = r.id;

    -- 推 LINE
    IF r.assignee_id IS NOT NULL OR r.assignee IS NOT NULL THEN
      SELECT v.line_user_id, v.liff_id INTO v_line_uid, v_liff_id
        FROM public.v_employee_line_resolved v
       WHERE (r.assignee_id IS NOT NULL AND v.employee_id = r.assignee_id)
          OR (r.assignee_id IS NULL     AND v.employee_name = r.assignee)
       ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST
       LIMIT 1;

      IF v_line_uid IS NOT NULL THEN
        SELECT template_name INTO v_inst_name FROM public.workflow_instances WHERE id = r.workflow_instance_id;
        PERFORM public._push_task_started_flex(
          v_line_uid, v_liff_id, r.id, r.title, v_inst_name
        );
        RAISE NOTICE 'backfill: pushed LINE to task %', r.id;
      END IF;
    END IF;
  END LOOP;
END $$;


COMMIT;

NOTIFY pgrst, 'reload schema';
