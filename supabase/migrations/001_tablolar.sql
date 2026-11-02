-- MENAJER ONLINE: tablolar
-- Tüm yazma işlemleri security definer RPC fonksiyonlarıyla yapılır; istemci sadece okur.

create table public.real_players (
  id int primary key,
  name text not null,
  positions text not null,
  grp text not null check (grp in ('GK','DEF','MID','FWD')),
  ovr int not null,
  pot int not null,
  age int not null,
  nat text not null default '',
  club text not null,
  lg text not null,
  val bigint not null
);
create index on public.real_players (ovr desc);
create index on public.real_players (lg);

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (char_length(username) between 3 and 20),
  created_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 40),
  code text unique not null,
  owner uuid not null references public.profiles on delete cascade,
  status text not null default 'lobby' check (status in ('lobby','active','finished')),
  settings jsonb not null,
  current_round int not null default 0,
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games on delete cascade,
  owner uuid not null references public.profiles on delete cascade,
  name text not null check (char_length(name) between 3 and 30),
  short text not null check (char_length(short) between 2 and 4),
  color1 text not null default '#d00000',
  color2 text not null default '#ffffff',
  budget bigint not null default 0,
  formation text not null default '4-4-2',
  mentality int not null default 0 check (mentality between -2 and 2),
  lineup int[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (game_id, owner),
  unique (game_id, name)
);

-- hangi gerçek oyuncu, hangi oyunda, hangi takımda (satır yoksa oyuncu gerçek kulübünde = yapay zeka kulübü)
create table public.squads (
  game_id uuid not null references public.games on delete cascade,
  player_id int not null references public.real_players,
  team_id uuid not null references public.teams on delete cascade,
  value bigint not null,
  bought_for bigint not null default 0,
  joined_at timestamptz not null default now(),
  primary key (game_id, player_id)
);
create index on public.squads (team_id);

create table public.offers (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games on delete cascade,
  player_id int not null references public.real_players,
  bidder uuid not null references public.teams on delete cascade,
  seller uuid references public.teams on delete cascade,      -- null = yapay zeka kulübü (açık artırma)
  amount bigint not null check (amount > 0),
  status text not null default 'active'
    check (status in ('active','won','lost','accepted','rejected','cancelled','outbid')),
  note text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index on public.offers (game_id, status);

create table public.fixtures (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games on delete cascade,
  comp text not null check (comp in ('league','cup')),
  round int not null,
  cup_round int,
  leg int not null default 1,
  tie int,
  home uuid not null references public.teams on delete cascade,
  away uuid not null references public.teams on delete cascade,
  hg int, ag int,
  pens text,
  played boolean not null default false,
  events jsonb,
  stats jsonb
);
create index on public.fixtures (game_id, round);

create table public.news (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games on delete cascade,
  team_id uuid references public.teams on delete cascade,     -- null = herkese
  kind text not null default 'info',
  text text not null,
  created_at timestamptz not null default now()
);
create index on public.news (game_id, created_at desc);

-- RLS: giriş yapmış herkes okuyabilir (arkadaş oyunu), yazma yok (sadece RPC)
alter table public.real_players enable row level security;
alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.teams enable row level security;
alter table public.squads enable row level security;
alter table public.offers enable row level security;
alter table public.fixtures enable row level security;
alter table public.news enable row level security;

create policy "oku" on public.real_players for select to authenticated using (true);
create policy "oku" on public.profiles for select to authenticated using (true);
create policy "oku" on public.games for select to authenticated using (true);
create policy "oku" on public.teams for select to authenticated using (true);
create policy "oku" on public.squads for select to authenticated using (true);
create policy "oku" on public.offers for select to authenticated using (true);
create policy "oku" on public.fixtures for select to authenticated using (true);
create policy "oku" on public.news for select to authenticated
  using (team_id is null or team_id in (select id from public.teams where owner = auth.uid()));

-- kayıt olunca profil oluştur (kullanıcı adı signUp metadata'sından)
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', 'oyuncu_' || left(new.id::text, 6)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- canlı güncellemeler (teklif savaşları, haberler, maç sonuçları)
alter publication supabase_realtime add table public.offers, public.news, public.fixtures, public.games;
