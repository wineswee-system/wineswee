alter table organizations add column if not exists gemini_api_key text;

comment on column organizations.gemini_api_key is
  'Optional per-org override for the Gemini API key. Edge functions (gemini-proxy, scheduling-ai) fall back to the project-level GEMINI_API_KEY secret when this is null.';
