-- ============================================================
--  Seed: Register 'workflow' LINE Official Account
--  Credentials (secret / access_token / login_secret) live in
--  Supabase Edge Function secrets — NOT in this file.
--  Env vars expected:
--    LINE_CHANNEL_SECRET_WORKFLOW
--    LINE_CHANNEL_ACCESS_TOKEN_WORKFLOW
--    LINE_LOGIN_CHANNEL_ID_WORKFLOW       (optional — only if using LINE Login on this OA)
--    LINE_LOGIN_CHANNEL_SECRET_WORKFLOW   (optional)
-- ============================================================

INSERT INTO line_channels (code, name, channel_id, liff_id, is_default, status, metadata)
VALUES (
  'workflow',
  'Workflow 官方帳號',
  '2009191289',
  '2009567492-aJcgaxOz',          -- primary LIFF (Manager Dashboard)
  false,
  'active',
  jsonb_build_object(
    'liff_apps', jsonb_build_object(
      'dashboard',  '2009567492-aJcgaxOz',
      'task_update','2009567492-Hpa3NSAi',
      'new_task',   '2009567492-C5Gv3cJ5'
    )
  )
)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  channel_id = EXCLUDED.channel_id,
  liff_id = EXCLUDED.liff_id,
  status = EXCLUDED.status,
  metadata = EXCLUDED.metadata,
  updated_at = now();
