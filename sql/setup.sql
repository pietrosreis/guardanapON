-- SQL UNIFICADO DO PROJETO
-- Ordem:
-- 1) Migracao financeira
-- 2) Admin de acesso seguro
-- 3) Verificacoes opcionais
--
-- Rode no SQL Editor em Results/Run.
-- Se quiser usar EXPLAIN, execute apenas uma query por vez.

/* =========================================================
   1) MIGRACAO FINANCEIRA
   ========================================================= */

-- MIGRACAO FINANCEIRA AVANCADA
-- Objetivo: habilitar status, recorrencia, competencia, contas,
-- forma de pagamento, centro de custo e historico de depositos da meta
-- sem quebrar as tabelas atuais.

begin;

alter table if exists public.receitas
  add column if not exists categoria text,
  add column if not exists tipo text default 'receita_real',
  add column if not exists status text default 'recebido',
  add column if not exists competencia date,
  add column if not exists recebimento_em date,
  add column if not exists conta text,
  add column if not exists recorrente boolean default false,
  add column if not exists recorrencia_tipo text default 'nao_recorrente',
  add column if not exists observacao text;

alter table if exists public.despesas
  add column if not exists tipo text default 'variavel',
  add column if not exists status text default 'paga',
  add column if not exists competencia date,
  add column if not exists pagamento_em date,
  add column if not exists forma_pagamento text,
  add column if not exists centro_custo text,
  add column if not exists conta text,
  add column if not exists recorrente boolean default false,
  add column if not exists recorrencia_tipo text default 'nao_recorrente',
  add column if not exists observacao text;

alter table if exists public.parcelas
  add column if not exists forma_pagamento text,
  add column if not exists centro_custo text,
  add column if not exists conta text,
  add column if not exists observacao text;

create table if not exists public.meta_depositos (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  valor numeric(12,2) not null check (valor > 0),
  data_deposito date not null default current_date,
  observacao text,
  created_at timestamptz not null default now()
);

create index if not exists idx_meta_depositos_user_data
  on public.meta_depositos(user_id, data_deposito desc);

alter table public.meta_depositos enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'meta_depositos'
      and policyname = 'meta_depositos_select_own'
  ) then
    create policy meta_depositos_select_own
      on public.meta_depositos
      for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'meta_depositos'
      and policyname = 'meta_depositos_insert_own'
  ) then
    create policy meta_depositos_insert_own
      on public.meta_depositos
      for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'meta_depositos'
      and policyname = 'meta_depositos_update_own'
  ) then
    create policy meta_depositos_update_own
      on public.meta_depositos
      for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'meta_depositos'
      and policyname = 'meta_depositos_delete_own'
  ) then
    create policy meta_depositos_delete_own
      on public.meta_depositos
      for delete
      using (auth.uid() = user_id);
  end if;
end $$;

update public.receitas
set
  categoria = coalesce(nullif(categoria, ''), 'Receita'),
  tipo = coalesce(nullif(tipo, ''), 'receita_real'),
  status = coalesce(nullif(status, ''), 'recebido'),
  competencia = coalesce(competencia, created_at::date),
  recebimento_em = coalesce(recebimento_em, created_at::date),
  recorrencia_tipo = coalesce(nullif(recorrencia_tipo, ''), case when recorrente then 'mensal' else 'nao_recorrente' end)
where true;

update public.despesas
set
  tipo = coalesce(nullif(tipo, ''), 'variavel'),
  status = coalesce(nullif(status, ''), 'paga'),
  competencia = coalesce(competencia, created_at::date),
  pagamento_em = coalesce(pagamento_em, created_at::date),
  recorrencia_tipo = coalesce(nullif(recorrencia_tipo, ''), case when recorrente then 'mensal' else 'nao_recorrente' end)
where true;

commit;

/* =========================================================
   2) ADMIN DE ACESSO SEGURO
   ========================================================= */

-- Funcao auxiliar usada nas policies de user_profiles e user_roles
drop function if exists public.is_admin(uuid) cascade;
create or replace function public.is_admin(p_user_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.user_roles
    where user_roles.user_id = p_user_id
      and user_roles.role = 'admin'
  );
$$;

-- Funcao chamada apos login com Google para registrar o provedor
drop function if exists public.link_google_account();
create or replace function public.link_google_account()
returns void
language plpgsql
security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_current_provider text;
begin
  if v_user_id is null then return; end if;
  select provider into v_current_provider
  from public.user_profiles
  where user_profiles.user_id = v_user_id;
  if v_current_provider is null then return; end if;
  if v_current_provider not like '%google%' then
    update public.user_profiles
    set provider = v_current_provider || ' + google'
    where user_profiles.user_id = v_user_id;
  end if;
end;
$$;


alter table public.user_profiles
  add column if not exists is_active boolean not null default true,
  add column if not exists blocked_until timestamptz null,
  add column if not exists force_password_reset boolean not null default false;

update public.user_profiles
set
  is_active = coalesce(is_active, true),
  force_password_reset = coalesce(force_password_reset, false)
where is_active is null or force_password_reset is null;

-- Recriar todas as policies que dependem de is_admin (dropadas pelo CASCADE acima)
-- user_profiles: proprio usuario pode ver/editar o seu perfil
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_profiles' and policyname='profiles_select_own_or_admin') then
    create policy profiles_select_own_or_admin on public.user_profiles
      for select to authenticated
      using (auth.uid() = user_id or public.is_admin(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_profiles' and policyname='profiles_insert_own') then
    create policy profiles_insert_own on public.user_profiles
      for insert to authenticated
      with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_profiles' and policyname='profiles_update_own_or_admin') then
    create policy profiles_update_own_or_admin on public.user_profiles
      for update to authenticated
      using (auth.uid() = user_id or public.is_admin(auth.uid()))
      with check (auth.uid() = user_id or public.is_admin(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_profiles' and policyname='profiles_delete_admin') then
    create policy profiles_delete_admin on public.user_profiles
      for delete to authenticated
      using (public.is_admin(auth.uid()));
  end if;
  -- user_roles: usuario ve propria role, admin ve tudo
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_roles' and policyname='roles_select_own_or_admin') then
    create policy roles_select_own_or_admin on public.user_roles
      for select to authenticated
      using (auth.uid() = user_id or public.is_admin(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_roles' and policyname='roles_insert_admin') then
    create policy roles_insert_admin on public.user_roles
      for insert to authenticated
      with check (public.is_admin(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_roles' and policyname='roles_update_admin') then
    create policy roles_update_admin on public.user_roles
      for update to authenticated
      using (public.is_admin(auth.uid()))
      with check (public.is_admin(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_roles' and policyname='roles_delete_admin') then
    create policy roles_delete_admin on public.user_roles
      for delete to authenticated
      using (public.is_admin(auth.uid()));
  end if;
  -- Aliases legados (compatibilidade com policies antigas)
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_profiles' and policyname='Admins podem ver todos os perfis') then
    create policy "Admins podem ver todos os perfis" on public.user_profiles
      for select to authenticated
      using (public.is_admin(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_profiles' and policyname='Admins podem atualizar todos os perfis') then
    create policy "Admins podem atualizar todos os perfis" on public.user_profiles
      for update to authenticated
      using (public.is_admin(auth.uid()))
      with check (public.is_admin(auth.uid()));
  end if;
end $$;

/* =========================================================
   3) VERIFICACOES OPCIONAIS
   ========================================================= */

-- 3.1 Resumo rapido de tabelas, policies e funcoes
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('receitas','despesas','parcelas','metas','user_profiles','user_roles')) as tabelas_encontradas,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('receitas','despesas','parcelas','metas','user_profiles','user_roles')) as policies_encontradas,
  (select count(*) from information_schema.routines where specific_schema = 'public' and routine_name in ('is_admin','link_google_account')) as funcoes_encontradas;

-- 3.2 Verificacao detalhada em query unica
with tabelas as (
  select
    'tabela'::text as tipo,
    table_name::text as objeto,
    null::text as detalhe_1,
    null::text as detalhe_2
  from information_schema.tables
  where table_schema = 'public'
    and table_name in ('receitas', 'despesas', 'parcelas', 'metas', 'user_profiles', 'user_roles')
), funcoes as (
  select
    'funcao'::text as tipo,
    routine_name::text as objeto,
    null::text as detalhe_1,
    null::text as detalhe_2
  from information_schema.routines
  where specific_schema = 'public'
    and routine_name in ('is_admin', 'link_google_account')
), policies as (
  select
    'policy'::text as tipo,
    (tablename || ' :: ' || policyname)::text as objeto,
    coalesce(cmd, '')::text as detalhe_1,
    trim(both ' ' from concat(
      case when qual is not null and qual <> '' then 'USING: ' || qual else '' end,
      case when qual is not null and qual <> '' and with_check is not null and with_check <> '' then ' | ' else '' end,
      case when with_check is not null and with_check <> '' then 'CHECK: ' || with_check else '' end
    ))::text as detalhe_2
  from pg_policies
  where schemaname = 'public'
    and tablename in ('receitas', 'despesas', 'parcelas', 'metas', 'user_profiles', 'user_roles')
)
select * from tabelas
union all
select * from funcoes
union all
select * from policies
order by tipo, objeto;


/* =========================================================
   3) CONTAS, PLANOS E MEMBROS
   ========================================================= */

begin;

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  max_members int not null check (max_members > 0),
  features jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.plans (code, name, max_members, features)
values
  ('individual', 'Individual', 1, jsonb_build_object('attachments', true, 'shared_account', false, 'member_management', false, 'comparison_view', false, 'analysis_assistant', false)),
  ('duo', 'Duo', 2, jsonb_build_object('attachments', true, 'shared_account', true, 'member_management', true, 'comparison_view', true, 'analysis_assistant', true)),
  ('family', 'Família', 6, jsonb_build_object('attachments', true, 'shared_account', true, 'member_management', true, 'comparison_view', true, 'family_space', true, 'analysis_assistant', true))
on conflict (code) do update set
  name = excluded.name,
  max_members = excluded.max_members,
  features = excluded.features,
  is_active = true;

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','trialing','past_due','canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.account_subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  status text not null default 'active' check (status in ('trialing','active','past_due','canceled')),
  started_at timestamptz not null default now(),
  expires_at timestamptz null,
  billing_cycle text null check (billing_cycle in ('monthly','yearly')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_account_subscriptions_account on public.account_subscriptions(account_id, created_at desc);

create table if not exists public.account_members (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member','viewer')),
  status text not null default 'active' check (status in ('active','invited','removed')),
  invited_by_user_id uuid null references auth.users(id) on delete set null,
  joined_at timestamptz null,
  created_at timestamptz not null default now(),
  unique(account_id, user_id)
);
create index if not exists idx_account_members_user on public.account_members(user_id, status);
create index if not exists idx_account_members_account on public.account_members(account_id, status);

create table if not exists public.account_invites (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('member','viewer')),
  token text not null unique,
  status text not null default 'pending' check (status in ('pending','accepted','expired','revoked')),
  invited_by_user_id uuid null references auth.users(id) on delete set null,
  expires_at timestamptz null,
  created_at timestamptz not null default now()
);
create index if not exists idx_account_invites_account on public.account_invites(account_id, status);

alter table if exists public.receitas
  add column if not exists account_id uuid references public.accounts(id) on delete cascade,
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;

alter table if exists public.despesas
  add column if not exists account_id uuid references public.accounts(id) on delete cascade,
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;

alter table if exists public.parcelas
  add column if not exists account_id uuid references public.accounts(id) on delete cascade,
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;

alter table if exists public.metas
  add column if not exists account_id uuid references public.accounts(id) on delete cascade,
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;

alter table if exists public.meta_depositos
  add column if not exists account_id uuid references public.accounts(id) on delete cascade,
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;

create table if not exists public.expense_attachments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  despesa_id bigint null references public.despesas(id) on delete cascade,
  parcela_id bigint null references public.parcelas(id) on delete cascade,
  attachment_type text not null check (attachment_type in ('image','audio')),
  storage_path text not null,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists idx_expense_attachments_account on public.expense_attachments(account_id, created_at desc);

create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_account_member(p_account_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.account_members
    where account_id = p_account_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function public.has_account_role(p_account_id uuid, p_roles text[])
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.account_members
    where account_id = p_account_id
      and user_id = auth.uid()
      and status = 'active'
      and role = any(p_roles)
  );
$$;

alter table public.accounts enable row level security;
alter table public.account_subscriptions enable row level security;
alter table public.account_members enable row level security;
alter table public.account_invites enable row level security;
alter table public.expense_attachments enable row level security;
alter table public.receitas enable row level security;
alter table public.despesas enable row level security;
alter table public.parcelas enable row level security;
alter table public.metas enable row level security;
alter table public.meta_depositos enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='accounts' and policyname='accounts_select_member') then
    create policy accounts_select_member on public.accounts
      for select to authenticated
      using (public.is_platform_admin() or public.is_account_member(id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='accounts' and policyname='accounts_insert_owner') then
    create policy accounts_insert_owner on public.accounts
      for insert to authenticated
      with check (owner_user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='accounts' and policyname='accounts_update_owner') then
    create policy accounts_update_owner on public.accounts
      for update to authenticated
      using (public.is_platform_admin() or public.has_account_role(id, array['owner']))
      with check (public.is_platform_admin() or public.has_account_role(id, array['owner']));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='account_members' and policyname='account_members_select_member') then
    create policy account_members_select_member on public.account_members
      for select to authenticated
      using (public.is_platform_admin() or public.is_account_member(account_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='account_members' and policyname='account_members_insert_owner') then
    create policy account_members_insert_owner on public.account_members
      for insert to authenticated
      with check (public.is_platform_admin() or public.has_account_role(account_id, array['owner']));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='account_members' and policyname='account_members_delete_owner') then
    create policy account_members_delete_owner on public.account_members
      for delete to authenticated
      using (public.is_platform_admin() or public.has_account_role(account_id, array['owner']));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='account_members' and policyname='account_members_update_owner') then
    create policy account_members_update_owner on public.account_members
      for update to authenticated
      using (public.is_platform_admin() or public.has_account_role(account_id, array['owner']))
      with check (public.is_platform_admin() or public.has_account_role(account_id, array['owner']));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='account_subscriptions' and policyname='account_subscriptions_select_member') then
    create policy account_subscriptions_select_member on public.account_subscriptions
      for select to authenticated
      using (public.is_platform_admin() or public.is_account_member(account_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='account_subscriptions' and policyname='account_subscriptions_insert_owner') then
    create policy account_subscriptions_insert_owner on public.account_subscriptions
      for insert to authenticated
      with check (public.is_platform_admin() or public.has_account_role(account_id, array['owner']));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='account_subscriptions' and policyname='account_subscriptions_update_owner') then
    create policy account_subscriptions_update_owner on public.account_subscriptions
      for update to authenticated
      using (public.is_platform_admin() or public.has_account_role(account_id, array['owner']))
      with check (public.is_platform_admin() or public.has_account_role(account_id, array['owner']));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='account_invites' and policyname='account_invites_select_member') then
    create policy account_invites_select_member on public.account_invites
      for select to authenticated
      using (public.is_platform_admin() or public.is_account_member(account_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='account_invites' and policyname='account_invites_insert_owner') then
    create policy account_invites_insert_owner on public.account_invites
      for insert to authenticated
      with check (public.is_platform_admin() or public.has_account_role(account_id, array['owner']));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='expense_attachments' and policyname='expense_attachments_select_member') then
    create policy expense_attachments_select_member on public.expense_attachments
      for select to authenticated
      using (public.is_platform_admin() or public.is_account_member(account_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='expense_attachments' and policyname='expense_attachments_insert_member') then
    create policy expense_attachments_insert_member on public.expense_attachments
      for insert to authenticated
      with check ((public.is_platform_admin() or public.is_account_member(account_id)) and created_by_user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='expense_attachments' and policyname='expense_attachments_delete_owner') then
    create policy expense_attachments_delete_owner on public.expense_attachments
      for delete to authenticated
      using (public.is_platform_admin() or public.has_account_role(account_id, array['owner','member']));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='receitas' and policyname='receitas_account_select') then
    create policy receitas_account_select on public.receitas
      for select to authenticated
      using (public.is_platform_admin() or public.is_account_member(account_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='receitas' and policyname='receitas_account_insert') then
    create policy receitas_account_insert on public.receitas
      for insert to authenticated
      with check ((public.is_platform_admin() or public.is_account_member(account_id)) and created_by_user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='receitas' and policyname='receitas_account_update') then
    create policy receitas_account_update on public.receitas
      for update to authenticated
      using (public.is_platform_admin() or public.is_account_member(account_id))
      with check (public.is_platform_admin() or public.is_account_member(account_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='receitas' and policyname='receitas_account_delete') then
    create policy receitas_account_delete on public.receitas
      for delete to authenticated
      using (public.is_platform_admin() or public.is_account_member(account_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='despesas' and policyname='despesas_account_select') then
    create policy despesas_account_select on public.despesas
      for select to authenticated
      using (public.is_platform_admin() or public.is_account_member(account_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='despesas' and policyname='despesas_account_insert') then
    create policy despesas_account_insert on public.despesas
      for insert to authenticated
      with check ((public.is_platform_admin() or public.is_account_member(account_id)) and created_by_user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='despesas' and policyname='despesas_account_update') then
    create policy despesas_account_update on public.despesas
      for update to authenticated
      using (public.is_platform_admin() or public.is_account_member(account_id))
      with check (public.is_platform_admin() or public.is_account_member(account_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='despesas' and policyname='despesas_account_delete') then
    create policy despesas_account_delete on public.despesas
      for delete to authenticated
      using (public.is_platform_admin() or public.is_account_member(account_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='parcelas' and policyname='parcelas_account_select') then
    create policy parcelas_account_select on public.parcelas
      for select to authenticated
      using (public.is_platform_admin() or public.is_account_member(account_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='parcelas' and policyname='parcelas_account_insert') then
    create policy parcelas_account_insert on public.parcelas
      for insert to authenticated
      with check ((public.is_platform_admin() or public.is_account_member(account_id)) and created_by_user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='parcelas' and policyname='parcelas_account_update') then
    create policy parcelas_account_update on public.parcelas
      for update to authenticated
      using (public.is_platform_admin() or public.is_account_member(account_id))
      with check (public.is_platform_admin() or public.is_account_member(account_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='parcelas' and policyname='parcelas_account_delete') then
    create policy parcelas_account_delete on public.parcelas
      for delete to authenticated
      using (public.is_platform_admin() or public.is_account_member(account_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='metas' and policyname='metas_account_select') then
    create policy metas_account_select on public.metas
      for select to authenticated
      using (public.is_platform_admin() or public.is_account_member(account_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='metas' and policyname='metas_account_insert') then
    create policy metas_account_insert on public.metas
      for insert to authenticated
      with check ((public.is_platform_admin() or public.is_account_member(account_id)) and created_by_user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='metas' and policyname='metas_account_update') then
    create policy metas_account_update on public.metas
      for update to authenticated
      using (public.is_platform_admin() or public.is_account_member(account_id))
      with check (public.is_platform_admin() or public.is_account_member(account_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='meta_depositos' and policyname='meta_depositos_account_select') then
    create policy meta_depositos_account_select on public.meta_depositos
      for select to authenticated
      using (public.is_platform_admin() or public.is_account_member(account_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='meta_depositos' and policyname='meta_depositos_account_insert') then
    create policy meta_depositos_account_insert on public.meta_depositos
      for insert to authenticated
      with check ((public.is_platform_admin() or public.is_account_member(account_id)) and created_by_user_id = auth.uid());
  end if;
end $$;

-- Backfill seguro: cria uma conta individual para cada usuário atual e vincula registros antigos.
insert into public.accounts (name, owner_user_id, status)
select distinct coalesce(nullif(up.username, ''), split_part(coalesce(up.email, ''), '@', 1), 'Conta') || ' • Individual', up.user_id, 'active'
from public.user_profiles up
where up.user_id is not null
  and not exists (select 1 from public.accounts a where a.owner_user_id = up.user_id);

insert into public.account_members (account_id, user_id, role, status, invited_by_user_id, joined_at)
select a.id, a.owner_user_id, 'owner', 'active', a.owner_user_id, now()
from public.accounts a
where not exists (
  select 1 from public.account_members am where am.account_id = a.id and am.user_id = a.owner_user_id
);

insert into public.account_subscriptions (account_id, plan_id, status, started_at)
select a.id, p.id, 'active', now()
from public.accounts a
join public.plans p on p.code = 'individual'
where not exists (
  select 1 from public.account_subscriptions s where s.account_id = a.id
);

update public.receitas r
set account_id = a.id,
    created_by_user_id = coalesce(r.created_by_user_id, r.user_id)
from public.accounts a
where r.user_id = a.owner_user_id
  and r.account_id is null;

update public.despesas d
set account_id = a.id,
    created_by_user_id = coalesce(d.created_by_user_id, d.user_id)
from public.accounts a
where d.user_id = a.owner_user_id
  and d.account_id is null;

update public.parcelas p1
set account_id = a.id,
    created_by_user_id = coalesce(p1.created_by_user_id, p1.user_id)
from public.accounts a
where p1.user_id = a.owner_user_id
  and p1.account_id is null;

update public.metas m
set account_id = a.id,
    created_by_user_id = coalesce(m.created_by_user_id, m.user_id)
from public.accounts a
where m.user_id = a.owner_user_id
  and m.account_id is null;

update public.meta_depositos md
set account_id = a.id,
    created_by_user_id = coalesce(md.created_by_user_id, md.user_id)
from public.accounts a
where md.user_id = a.owner_user_id
  and md.account_id is null;

create unique index if not exists idx_metas_account_unique on public.metas(account_id) where account_id is not null;
create index if not exists idx_receitas_account_created on public.receitas(account_id, created_at desc);
create index if not exists idx_despesas_account_created on public.despesas(account_id, created_at desc);
create index if not exists idx_parcelas_account_vencimento on public.parcelas(account_id, vencimento desc);
create index if not exists idx_meta_depositos_account_data on public.meta_depositos(account_id, data_deposito desc);

commit;


create table if not exists public.launch_attachments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  launch_type text not null check (launch_type in ('receita','despesa','parcela')),
  launch_id bigint not null,
  attachment_type text not null check (attachment_type in ('image','audio')),
  file_name text not null default '',
  mime_type text not null default '',
  file_size bigint not null default 0,
  file_data_url text not null,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists idx_launch_attachments_account on public.launch_attachments(account_id, created_at desc);
create index if not exists idx_launch_attachments_launch on public.launch_attachments(launch_type, launch_id);

create table if not exists public.launch_analysis (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  launch_type_target text not null check (launch_type_target in ('receita','despesa','parcela')),
  launch_id bigint not null,
  analysis_status text not null default 'prepared' check (analysis_status in ('prepared','processing','completed','failed')),
  ocr_text text not null default '',
  audio_transcript text not null default '',
  suggested_direction text null check (suggested_direction in ('entrada','saida')),
  suggested_description text null,
  suggested_amount numeric(12,2) null,
  suggested_date date null,
  suggested_category text null,
  suggested_notes text null,
  confidence_score numeric(5,2) null,
  raw_result_json jsonb null,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_launch_analysis_account on public.launch_analysis(account_id, created_at desc);
create index if not exists idx_launch_analysis_launch on public.launch_analysis(launch_type_target, launch_id);

alter table public.launch_attachments enable row level security;
alter table public.launch_analysis enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='launch_attachments' and policyname='launch_attachments_select_member') then
    create policy launch_attachments_select_member on public.launch_attachments
      for select to authenticated
      using (public.is_platform_admin() or public.is_account_member(account_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='launch_attachments' and policyname='launch_attachments_insert_member') then
    create policy launch_attachments_insert_member on public.launch_attachments
      for insert to authenticated
      with check ((public.is_platform_admin() or public.is_account_member(account_id)) and created_by_user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='launch_attachments' and policyname='launch_attachments_delete_member') then
    create policy launch_attachments_delete_member on public.launch_attachments
      for delete to authenticated
      using (public.is_platform_admin() or public.is_account_member(account_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='launch_analysis' and policyname='launch_analysis_select_member') then
    create policy launch_analysis_select_member on public.launch_analysis
      for select to authenticated
      using (public.is_platform_admin() or public.is_account_member(account_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='launch_analysis' and policyname='launch_analysis_insert_member') then
    create policy launch_analysis_insert_member on public.launch_analysis
      for insert to authenticated
      with check ((public.is_platform_admin() or public.is_account_member(account_id)) and created_by_user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='launch_analysis' and policyname='launch_analysis_update_member') then
    create policy launch_analysis_update_member on public.launch_analysis
      for update to authenticated
      using (public.is_platform_admin() or public.is_account_member(account_id))
      with check (public.is_platform_admin() or public.is_account_member(account_id));
  end if;
end $$;
