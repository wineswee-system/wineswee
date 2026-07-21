-- 假別規則表(單一來源)— 2026-07-21 [階段3a/4]
-- 把 src/lib/leavePolicy.js 的 LEAVE_TYPES(16種假的法定規則)變成資料表,
--   讓 create_leave_request RPC + web + LIFF + 手機全讀這張 → 改規則改一列即可(維護成本低)。
-- 全域系統預設(organization_id NULL);未來要租戶覆寫再加同 code 帶 org 的列。
-- 規則值逐項對齊 leavePolicy.js,不改任何法定內容。

CREATE TABLE IF NOT EXISTS public.leave_types (
  id              serial PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  name            text NOT NULL,
  short_name      text,
  law             text,
  paid            boolean NOT NULL DEFAULT true,
  unit            text NOT NULL DEFAULT 'day',      -- 'day' | 'hour'
  min_unit        numeric NOT NULL DEFAULT 0.5,
  allow_hourly    boolean NOT NULL DEFAULT true,
  max_days        numeric,                          -- NULL=無固定上限(特休看年資/喪假產假看條件)
  gender          text,                             -- NULL=不限;'female'=限女性
  require_balance boolean NOT NULL DEFAULT false,   -- 補休:需先查餘額
  salary_note     text,
  description     text,
  sort_order      int NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- seed(idempotent:同 code 更新)。逐項對齊 leavePolicy.js LEAVE_TYPES。
INSERT INTO public.leave_types
  (code, name, short_name, law, paid, unit, min_unit, allow_hourly, max_days, gender, require_balance, salary_note, sort_order)
VALUES
  ('annual','特別休假','特休','勞基法 §38',              true, 'day',  0.5, true, NULL, NULL, false, '照給(未休折算工資)', 10),
  ('sick','普通傷病假','病假','勞工請假規則 §4、§4-1',    true, 'hour', 1,   true, 30,   NULL, false, '減半發給(不低於基本工資)', 20),
  ('personal','事假','事假','勞工請假規則 §7',            false,'hour', 1,   true, 14,   NULL, false, '不給薪', 30),
  ('official','公假','公假','勞工請假規則 §8',            true, 'day',  0.5, true, NULL, NULL, false, '照給', 40),
  ('disaster','天災假','天災','天然災害停止上班辦法',      true, 'day',  0.5, true, NULL, NULL, false, '照給', 50),
  ('maternity','產假','產假','勞基法 §50、性平法 §15',    true, 'day',  1,   true, NULL, 'female', false, '8週全/半薪(依條件)', 60),
  ('paternity','陪產檢及陪產假','陪產假','性平法 §15',    true, 'day',  1,   true, 7,    NULL, false, '照給', 70),
  ('parental','育嬰留職停薪','育嬰假','性平法 §16、就保法 §11', false,'day', 1, true, 730,  NULL, false, '留停(就保津貼80%)', 80),
  ('menstrual','生理假','生理假','性平法 §14',            true, 'day',  0.5, true, 12,   'female', false, '減半發給', 90),
  ('marriage','婚假','婚假','勞工請假規則 §2',            true, 'day',  1,   true, 8,    NULL, false, '照給', 100),
  ('bereavement','喪假','喪假','勞工請假規則 §3',          true, 'day',  1,   true, NULL, NULL, false, '照給(依親等8/6/3天)', 110),
  ('family_care','家庭照顧假','家庭照顧','性平法 §20',    false,'hour', 1,   true, 7,    NULL, false, '不給薪(併入事假),不扣全勤', 120),
  ('occupational','公傷病假','工傷假','勞基法 §59',        true, 'day',  1,   true, NULL, NULL, false, '照給原領工資', 130),
  ('nursing','哺乳時間','哺乳','性平法 §18',              true, 'hour', 0.5, true, NULL, 'female', false, '照給(每日2次各30分)', 140),
  ('comp_time','補休','補休','勞基法 §32-1',              true, 'hour', 0.5, true, NULL, NULL, true,  '補休餘額抵扣(不另扣薪)', 150),
  ('prenatal','產檢假','產檢假','性平法 §15',            true, 'day',  0.5, true, 7,    'female', false, '照給', 160)
ON CONFLICT (code) DO UPDATE SET
  name=EXCLUDED.name, short_name=EXCLUDED.short_name, law=EXCLUDED.law, paid=EXCLUDED.paid,
  unit=EXCLUDED.unit, min_unit=EXCLUDED.min_unit, allow_hourly=EXCLUDED.allow_hourly,
  max_days=EXCLUDED.max_days, gender=EXCLUDED.gender, require_balance=EXCLUDED.require_balance,
  salary_note=EXCLUDED.salary_note, sort_order=EXCLUDED.sort_order, updated_at=now();

-- RLS:參考資料,全員可讀;寫入限 service_role/admin(不加寫 policy → 只有 service_role/Studio 能改)
ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leave_types_select ON public.leave_types;
CREATE POLICY leave_types_select ON public.leave_types FOR SELECT TO anon, authenticated USING (true);

NOTIFY pgrst, 'reload schema';
