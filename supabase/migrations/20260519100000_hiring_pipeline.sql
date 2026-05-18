-- ============================================================
-- Hiring Pipeline: candidates, interviews, offer letters, approval
-- ============================================================

-- 1. backfill organization_id onto recruitment_jobs (was missing)
alter table recruitment_jobs
  add column if not exists organization_id bigint references organizations(id) on delete cascade;

create index if not exists recruitment_jobs_org_idx on recruitment_jobs(organization_id);

-- RLS for recruitment_jobs (was unprotected)
alter table recruitment_jobs enable row level security;

drop policy if exists "recruitment_jobs_org" on recruitment_jobs;
create policy "recruitment_jobs_org" on recruitment_jobs
  using (organization_id = (select organization_id from employees where auth_user_id = auth.uid() limit 1));

-- 2. candidates
create table if not exists candidates (
  id              bigserial primary key,
  organization_id bigint not null references organizations(id) on delete cascade,
  job_id          int references recruitment_jobs(id) on delete set null,
  name            text not null,
  email           text,
  phone           text,
  source          text default '主動投遞',
  -- 主動投遞 / 獵頭 / 員工推薦 / 校園 / 平台
  stage           text not null default '投遞',
  -- 投遞 → 篩選 → 面試 → 錄取決定 → 已錄取 → 淘汰
  resume_url      text,
  notes           text,
  approval_chain_id bigint references approval_chains(id) on delete set null,
  current_step    int default 0,
  hire_status     text default null,
  -- null / 待審 / 已核准 / 已駁回
  created_by      bigint references employees(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists candidates_org_idx   on candidates(organization_id);
create index if not exists candidates_job_idx   on candidates(job_id);
create index if not exists candidates_stage_idx on candidates(stage);

alter table candidates enable row level security;

drop policy if exists "candidates_org" on candidates;
create policy "candidates_org" on candidates
  using (organization_id = (select organization_id from employees where auth_user_id = auth.uid() limit 1));

-- 3. interviews
create table if not exists interviews (
  id              bigserial primary key,
  organization_id bigint not null references organizations(id) on delete cascade,
  candidate_id    bigint not null references candidates(id) on delete cascade,
  round           text not null default '初試',
  -- 初試 / 複試 / 主管面 / 最終面
  scheduled_at    timestamptz,
  location        text,
  interviewer_id  bigint references employees(id) on delete set null,
  result          text default '待定',
  -- 待定 / 通過 / 不通過
  score           int check (score between 1 and 5),
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists interviews_org_idx       on interviews(organization_id);
create index if not exists interviews_candidate_idx on interviews(candidate_id);

alter table interviews enable row level security;

drop policy if exists "interviews_org" on interviews;
create policy "interviews_org" on interviews
  using (organization_id = (select organization_id from employees where auth_user_id = auth.uid() limit 1));

-- 4. offer_letter_templates
create table if not exists offer_letter_templates (
  id              bigserial primary key,
  organization_id bigint not null references organizations(id) on delete cascade,
  name            text not null,
  body_html       text not null default '',
  -- placeholders: {{candidate_name}} {{position}} {{dept}} {{salary}}
  --   {{start_date}} {{probation_days}} {{company_name}} {{signed_date}}
  is_default      boolean not null default false,
  version         int not null default 1,
  created_by      bigint references employees(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists offer_letter_templates_org_idx on offer_letter_templates(organization_id);

alter table offer_letter_templates enable row level security;

drop policy if exists "offer_letter_templates_org" on offer_letter_templates;
create policy "offer_letter_templates_org" on offer_letter_templates
  using (organization_id = (select organization_id from employees where auth_user_id = auth.uid() limit 1));

-- 5. offer_letters
create table if not exists offer_letters (
  id              bigserial primary key,
  organization_id bigint not null references organizations(id) on delete cascade,
  candidate_id    bigint not null references candidates(id) on delete cascade,
  template_id     bigint references offer_letter_templates(id) on delete set null,
  filled_html     text not null default '',
  position        text,
  dept            text,
  salary          numeric(12,0),
  start_date      date,
  probation_days  int default 90,
  status          text not null default '草稿',
  -- 草稿 / 待審 / 已核准 / 已發送 / 已婉拒
  approval_chain_id bigint references approval_chains(id) on delete set null,
  current_step    int default 0,
  reject_reason   text,
  approved_at     timestamptz,
  sent_at         timestamptz,
  created_by      bigint references employees(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists offer_letters_org_idx       on offer_letters(organization_id);
create index if not exists offer_letters_candidate_idx on offer_letters(candidate_id);
create index if not exists offer_letters_status_idx    on offer_letters(status);

alter table offer_letters enable row level security;

drop policy if exists "offer_letters_org" on offer_letters;
create policy "offer_letters_org" on offer_letters
  using (organization_id = (select organization_id from employees where auth_user_id = auth.uid() limit 1));

-- 6. form_chain_configs entry for hire_approval
insert into form_chain_configs (form_type, organization_id, chain_id, is_active)
select
  'hire_approval',
  ac.organization_id,
  ac.id,
  true
from approval_chains ac
where ac.name ilike '%人事%' or ac.name ilike '%HR%' or ac.name ilike '%簽核%'
order by ac.id
limit 1
on conflict (form_type, organization_id) do nothing;

-- 7. updated_at triggers
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'candidates_updated_at') then
    create trigger candidates_updated_at before update on candidates
      for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'interviews_updated_at') then
    create trigger interviews_updated_at before update on interviews
      for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'offer_letter_templates_updated_at') then
    create trigger offer_letter_templates_updated_at before update on offer_letter_templates
      for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'offer_letters_updated_at') then
    create trigger offer_letters_updated_at before update on offer_letters
      for each row execute function set_updated_at();
  end if;
end $$;

-- 8. grants
grant select, insert, update, delete
  on candidates, interviews, offer_letter_templates, offer_letters
  to authenticated;

grant usage, select
  on sequence candidates_id_seq, interviews_id_seq,
     offer_letter_templates_id_seq, offer_letters_id_seq
  to authenticated;
