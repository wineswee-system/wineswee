-- ============================================================
-- 20260702630000_crm_message_log.sql
-- CRM LINE 發送通道（會員專用）— 資料層
--
-- 1. members.line_user_id — 會員 LINE 綁定欄位
--    ⚠️ 僅供「會員」LINE 官方帳號使用（crm-line-send edge function）。
--    員工 LINE 綁定走 employee_line_accounts，兩者完全分離，
--    此欄位不得與員工 workflow channel 混用。
--    綁定來源：member-app (LIFF) 登入流程寫入，或後台手動綁定。
--
-- 2. message_logs 擴充 — CRM 發送紀錄（MessageLog.jsx 讀取此表）
--    既有表（20260426030001 建立）已含 channel/recipient/status/error/
--    meta/organization_id/sent_at；此處補上會員維度欄位。
--    status 額外允許值：'skipped_no_binding'（會員未綁定 LINE 略過）
-- ============================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. members.line_user_id（會員 LINE 綁定，非員工）
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS line_user_id TEXT;

-- 同一組織內一個 LINE 帳號只能綁一位會員
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_line_user_org
  ON public.members(organization_id, line_user_id)
  WHERE line_user_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════
-- 2. message_logs 擴充：會員維度 + 範本快照
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.message_logs
  ADD COLUMN IF NOT EXISTS member_id         INT REFERENCES public.members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS kind              TEXT,   -- 'campaign' / 'survey_invitation' / 'birthday' / 'level_up' / 'points' / 'coupon' / 'manual'
  ADD COLUMN IF NOT EXISTS template_snapshot JSONB;

CREATE INDEX IF NOT EXISTS idx_message_logs_member_sent
  ON public.message_logs(member_id, sent_at DESC)
  WHERE member_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_logs_kind
  ON public.message_logs(kind)
  WHERE kind IS NOT NULL;

-- ═══════════════════════════════════════════════════════════
-- 3. RLS 收斂：message_logs 原為 blanket authenticated ALL，
--    改為 org 範圍（沿用 org_visible() 慣例，同 surveys 遷移）
-- ═══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'org_visible'
  ) THEN
    -- 移除舊的 blanket policy，改 org-scoped
    DROP POLICY IF EXISTS auth_message_logs ON public.message_logs;

    DROP POLICY IF EXISTS message_logs_org_sel ON public.message_logs;
    CREATE POLICY message_logs_org_sel ON public.message_logs
      FOR SELECT TO authenticated
      USING (organization_id IS NULL OR org_visible(organization_id));

    DROP POLICY IF EXISTS message_logs_org_ins ON public.message_logs;
    CREATE POLICY message_logs_org_ins ON public.message_logs
      FOR INSERT TO authenticated
      WITH CHECK (organization_id IS NULL OR org_visible(organization_id));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
