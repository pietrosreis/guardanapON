-- ============================================================
--  GuardanapON — Schema SQL para Supabase (PostgreSQL)
--  Execute no SQL Editor: https://app.supabase.com/project/_/sql
-- ============================================================

-- ============================================================
--  EXTENSÕES
-- ============================================================
create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm; -- para busca full-text eficiente

-- ============================================================
--  TIPOS ENUMERADOS
-- ============================================================
create type user_role        as enum ('cliente', 'musico', 'restaurante', 'admin');
create type request_status   as enum ('pending', 'accepted', 'declined', 'refunded', 'played');
create type event_status     as enum ('scheduled', 'live', 'ended', 'cancelled');
create type transaction_type as enum ('recharge', 'payment', 'refund', 'split_payout', 'withdrawal');

-- ============================================================
--  PROFILES  (extensão de auth.users)
-- ============================================================
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       user_role not null default 'cliente',
  name       text not null,
  email      text not null,
  avatar_url text,
  pix_key    text,           -- chave PIX para saques (músico/restaurante)
  repertoire text,           -- lista de estilos do músico
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Atualiza updated_at automaticamente
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

-- ============================================================
--  WALLETS  (carteira de créditos do cliente)
-- ============================================================
create table public.wallets (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  balance    numeric(10,2) not null default 0.00 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);
create trigger wallets_updated_at
  before update on public.wallets
  for each row execute procedure public.set_updated_at();

-- Cria wallet automaticamente ao criar perfil
create or replace function public.create_wallet_for_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.wallets (user_id) values (new.id);
  return new;
end;
$$;
create trigger on_profile_created
  after insert on public.profiles
  for each row execute procedure public.create_wallet_for_new_user();

-- ============================================================
--  TRANSACTIONS  (extrato de movimentações)
-- ============================================================
create table public.transactions (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  type           transaction_type not null,
  amount         numeric(10,2) not null,    -- positivo = entrada, negativo = saída
  description    text,
  payment_id     text,                      -- ID externo Mercado Pago
  queue_item_id  uuid,                      -- referência ao pedido
  created_at     timestamptz not null default now()
);
create index idx_transactions_user on public.transactions(user_id, created_at desc);

-- ============================================================
--  SONGS  (catálogo de músicas)
-- ============================================================
create table public.songs (
  id          uuid primary key default uuid_generate_v4(),
  title       text not null,
  artist      text not null,
  album       text,
  album_art   text,                          -- URL da capa (Spotify API)
  spotify_id  text unique,
  has_chord   boolean not null default false, -- cifra encontrada?
  chord_url   text,                           -- link da cifra
  created_at  timestamptz not null default now()
);
create index idx_songs_title_trgm on public.songs using gin (title gin_trgm_ops);
create index idx_songs_artist on public.songs(artist);

-- ============================================================
--  RESTAURANTES / ESTABELECIMENTOS
-- ============================================================
create table public.restaurantes (
  id              uuid primary key references public.profiles(id) on delete cascade,
  business_name   text not null,
  cnpj            text unique,
  address         text,
  split_pct       numeric(5,2) not null default 20.00  -- % que o restaurante recebe
                    check (split_pct between 0 and 100),
  platform_pct    numeric(5,2) not null default 10.00  -- % da plataforma
                    check (platform_pct between 0 and 100),
  created_at      timestamptz not null default now()
);

-- ============================================================
--  EVENTOS  (show / apresentação)
-- ============================================================
create table public.eventos (
  id              uuid primary key default uuid_generate_v4(),
  musico_id       uuid not null references public.profiles(id),
  restaurante_id  uuid not null references public.restaurantes(id),
  status          event_status not null default 'live',
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  created_at      timestamptz not null default now()
);
create index idx_eventos_restaurante on public.eventos(restaurante_id, status);
create index idx_eventos_musico on public.eventos(musico_id, status);

-- ============================================================
--  QUEUE_ITEMS  (fila de músicas pedidas)
-- ============================================================
create table public.queue_items (
  id             uuid primary key default uuid_generate_v4(),
  evento_id      uuid not null references public.eventos(id) on delete cascade,
  song_id        uuid references public.songs(id),
  requested_by   uuid references public.profiles(id),
  status         request_status not null default 'pending',
  is_paid        boolean not null default false,
  tip_amount     numeric(10,2) not null default 0.00,
  dedication     text,
  payment_id     text,          -- ID externo Mercado Pago
  vote_count     integer not null default 0,
  responded_at   timestamptz,
  played_at      timestamptz,
  created_at     timestamptz not null default now()
);
create index idx_queue_evento on public.queue_items(evento_id, status);
create index idx_queue_ranking on public.queue_items(evento_id, is_paid desc, vote_count desc);

-- ============================================================
--  VOTES  (votos na fila gratuita)
-- ============================================================
create table public.votes (
  queue_item_id  uuid not null references public.queue_items(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (queue_item_id, user_id)  -- sem votos duplicados
);

-- Atualiza vote_count em queue_items quando voto é inserido/removido
create or replace function public.update_vote_count()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    update public.queue_items set vote_count = vote_count + 1 where id = new.queue_item_id;
  elsif TG_OP = 'DELETE' then
    update public.queue_items set vote_count = vote_count - 1 where id = old.queue_item_id;
  end if;
  return null;
end;
$$;
create trigger votes_count_trigger
  after insert or delete on public.votes
  for each row execute procedure public.update_vote_count();

-- ============================================================
--  EARNINGS  (receita do músico por evento)
-- ============================================================
create table public.earnings (
  id              uuid primary key default uuid_generate_v4(),
  musico_id       uuid not null references public.profiles(id),
  evento_id       uuid not null references public.eventos(id),
  total_gross     numeric(10,2) not null default 0.00,
  platform_cut    numeric(10,2) not null default 0.00,
  restaurante_cut numeric(10,2) not null default 0.00,
  musico_net      numeric(10,2) not null default 0.00,
  withdrawn       boolean not null default false,
  withdrawn_at    timestamptz,
  created_at      timestamptz not null default now(),
  unique(musico_id, evento_id)
);

-- ============================================================
--  ROW-LEVEL SECURITY (RLS)
-- ============================================================
alter table public.profiles    enable row level security;
alter table public.wallets     enable row level security;
alter table public.transactions enable row level security;
alter table public.queue_items  enable row level security;
alter table public.votes        enable row level security;
alter table public.earnings     enable row level security;

-- Profiles: usuário vê e edita apenas o próprio; admins veem tudo
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Wallets: apenas o dono
create policy "wallets_select_own" on public.wallets
  for select using (auth.uid() = user_id);
create policy "wallets_update_own" on public.wallets
  for update using (auth.uid() = user_id);

-- Transactions: apenas o dono
create policy "transactions_select_own" on public.transactions
  for select using (auth.uid() = user_id);

-- Queue Items: leitura pública por evento; escrita apenas pelo solicitante
create policy "queue_items_select_all" on public.queue_items
  for select using (true);
create policy "queue_items_insert_auth" on public.queue_items
  for insert with check (auth.uid() = requested_by);

-- Músico pode atualizar status dos pedidos do seu evento
create policy "queue_items_update_musico" on public.queue_items
  for update using (
    exists (
      select 1 from public.eventos e
      where e.id = queue_items.evento_id
        and e.musico_id = auth.uid()
    )
  );

-- Votes: leitura pública; escrita apenas do próprio usuário
create policy "votes_select_all" on public.votes for select using (true);
create policy "votes_insert_own" on public.votes
  for insert with check (auth.uid() = user_id);
create policy "votes_delete_own" on public.votes
  for delete using (auth.uid() = user_id);

-- Songs: leitura pública
alter table public.songs enable row level security;
create policy "songs_select_all" on public.songs for select using (true);

-- Eventos: leitura pública
alter table public.eventos enable row level security;
create policy "eventos_select_all" on public.eventos for select using (true);

-- Earnings: apenas o próprio músico
create policy "earnings_select_own" on public.earnings
  for select using (auth.uid() = musico_id);

-- ============================================================
--  REALTIME — ativa para as tabelas que precisam de live update
-- ============================================================
alter publication supabase_realtime add table public.queue_items;
alter publication supabase_realtime add table public.votes;

-- ============================================================
--  DADOS DE EXEMPLO (opcional — remova em produção)
-- ============================================================
insert into public.songs (title, artist, album, has_chord, spotify_id) values
  ('Bohemian Rhapsody',   'Queen',         'A Night at the Opera',   true,  '4u7EnebtmKWzUH433cf5Qv'),
  ('Hotel California',    'Eagles',        'Hotel California',        true,  '40riOy7x9W7GXjyGp4pjAv'),
  ('Wonderwall',          'Oasis',         '(What''s the Story) Morning Glory?', true, '7tFiyTwD0nx5a1eklYtX2J'),
  ('Garota de Ipanema',   'Tom Jobim',     'Getz/Gilberto',           true,  '5UcpBqEL0NVQKJ5KMy5ACL'),
  ('Yellow',              'Coldplay',      'Parachute',               true,  '3AJwUDP919kvQ9QcozQPxg'),
  ('Creep',               'Radiohead',     'Pablo Honey',             true,  '70LcF31zb1H0PyJoS1Sx1r'),
  ('Stairway to Heaven',  'Led Zeppelin',  'Led Zeppelin IV',         false, '5CQ30WqJwcep0pYcV4AMNc'),
  ('Lose Yourself',       'Eminem',        '8 Mile Soundtrack',       false, '4j5MJmJLcLYlvHKTEEPnNs'),
  ('Smells Like Teen Spirit', 'Nirvana',   'Nevermind',               true,  '5ghIJDpPoe3CfHMGu71E6T');

-- ============================================================
--  FIM DO SCHEMA
-- ============================================================
