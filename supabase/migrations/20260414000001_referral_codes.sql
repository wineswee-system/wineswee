-- 推薦碼 (Referral Codes)
create table if not exists referral_codes (
  id serial primary key,
  member_id int references members(id) not null,
  code text unique not null,
  max_uses int default 10,
  bonus_points int default 200,
  status text default '有效',           -- 有效 / 停用
  created_at timestamptz default now()
);

-- 推薦碼使用紀錄 (Referral Redemptions)
create table if not exists referral_redemptions (
  id serial primary key,
  referral_code_id int references referral_codes(id) not null,
  referrer_id int references members(id) not null,      -- who owns the code
  referee_id int references members(id) not null,        -- who used the code
  referrer_points int not null default 200,              -- points awarded to referrer
  referee_points int not null default 100,               -- points awarded to referee
  created_at timestamptz default now()
);

create index if not exists idx_referral_codes_member on referral_codes(member_id);
create index if not exists idx_referral_codes_code on referral_codes(code);
create index if not exists idx_referral_redemptions_code on referral_redemptions(referral_code_id);
