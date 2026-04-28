-- 補 tasks.started_at 欄位
-- handleDeploy 在建立 workflow tasks 時，第 1 步狀態 '進行中' 會記錄 started_at
-- 但 schema 從未加過此欄位 → 整個部署 fail with "Could not find the 'started_at' column"

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

COMMENT ON COLUMN public.tasks.started_at IS '任務實際開始執行的時間（與 created_at 區分：建立 vs 開始）';

-- 通知 PostgREST 重載 schema cache
NOTIFY pgrst, 'reload schema';
