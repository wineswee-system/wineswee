-- ================================================
-- tasks.confirmation_mode — 統一認可回應的審核方式
--
-- 背景：TaskDetailPanel 的「簽核」tab 原本有三段：
--   (1) 🔐 確認審批（挑 approval_chain_id 當 template）
--   (2) 🤝 認可回應（加員工一個一個認可）
--   (3) 🔏 簽核流程（真正啟動 approval_form，有 sequential/parallel）
-- 為了簡化設定介面，(1) 跟 (2) 合而為一，並把 (3) 的「審核方式」搬到 (2)。
--
-- 新欄位：
--   tasks.confirmation_mode — 'parallel'（同時）| 'sequential'（依序）
--   預設 'parallel'（維持舊行為：新增認可對象一律立即 pending）
-- ================================================

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS confirmation_mode TEXT DEFAULT 'parallel';

-- 補一個 CHECK 保險
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'tasks_confirmation_mode_check'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_confirmation_mode_check
      CHECK (confirmation_mode IN ('parallel', 'sequential'));
  END IF;
END $$;

-- task_confirmations 需要 'waiting' 狀態支援 sequential 佇列
-- （'pending' = 當前要回應的；'waiting' = 排隊中；'approved'/'rejected' 既有）
-- 現有 status 欄位已是 TEXT，無需改 schema，只是文件化新狀態。
