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
