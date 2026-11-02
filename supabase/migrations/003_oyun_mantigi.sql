-- MENAJER ONLINE: oyun mantığı (RPC'ler). İstemci sadece bunları çağırır.
drop function if exists public.tmp_import_players(jsonb);
alter table public.games add column cup jsonb;            -- {"round":1,"alive":[team ids],"champion":uuid}
alter table public.fixtures add column winner uuid;       -- kupa eşleşmesinin son ayağında tur atlayan

-- ---------- yardımcılar ----------
create or replace function public._default_settings() returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'format','league',            -- league | cup | league_cup
    'legs',2,                     -- lig: 1 = tek devre, 2 = çift devre
    'cup_legs',1,                 -- kupa: 1 = tek maç, 2 = rövanşlı (final hep tek maç)
    'max_teams',20,
    'start_budget',50000000,
    'squad',jsonb_build_object('S',1,'A',3,'B',6,'C',6,'D',4),
    'tiers',jsonb_build_object('S',jsonb_build_array(85,99),'A',jsonb_build_array(80,84),
            'B',jsonb_build_array(75,79),'C',jsonb_build_array(70,74),'D',jsonb_build_array(60,69)),
    'leagues',jsonb_build_array('ENG','ESP','GER','FRA','ITA','NED','POR','TUR','BEL'),
    'bid_minutes',10,             -- yapay zeka kulübünden alımda açık artırma süresi
    'offer_hours',24,             -- oyuncudan oyuncuya teklifin geçerlilik süresi
    'min_squad',16, 'max_squad',30,
    'win_bonus',3000000, 'draw_bonus',1500000, 'loss_bonus',500000,
    'ai_sell_ratio',0.75          -- oyuncuyu yapay zekaya satınca değerin %75'i
  ) $$;

create or replace function public._my_team(p_game uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.teams where game_id = p_game and owner = auth.uid() $$;

create or replace function public._news(p_game uuid, p_team uuid, p_kind text, p_text text) returns void
language sql security definer set search_path = '' as $$
  insert into public.news (game_id, team_id, kind, text) values (p_game, p_team, p_kind, p_text) $$;

create or replace function public._money(v bigint) returns text language sql immutable set search_path = '' as $$
  select case when v >= 1000000 then '€' || trim(to_char(v / 1000000.0, 'FM999990.0')) || 'M'
              else '€' || (v / 1000)::text || 'K' end $$;

-- yapay zeka kulübünün istediği fiyat: değer + %0-20 (oyuna ve oyuncuya göre sabit), yaşa göre
create or replace function public._ai_ask(p_game uuid, p_player int) returns bigint
language sql stable security definer set search_path = '' as $$
  select (round(p.val * (1 + (abs(hashtext(p_game::text || p_player::text)) % 21) / 100.0
          + case when p.age <= 23 then 0.10 when p.age >= 32 then -0.10 else 0 end) / 100000) * 100000)::bigint
  from public.real_players p where p.id = p_player $$;

-- formasyon -> slot grupları: '4-3-3' => GK, DEF x4, MID x3, FWD x3 (ortadaki sayılar MID)
create or replace function public._slots(p_form text) returns text[] language plpgsql immutable set search_path = '' as $$
declare parts int[] := string_to_array(p_form, '-')::int[]; r text[] := array['GK']; i int; k int;
begin
  for i in 1..parts[1] loop r := r || 'DEF'; end loop;
  for k in 2..array_length(parts,1)-1 loop for i in 1..parts[k] loop r := r || 'MID'; end loop; end loop;
  for i in 1..parts[array_length(parts,1)] loop r := r || 'FWD'; end loop;
  return r;
end $$;

-- otomatik en iyi 11
create or replace function public._auto_lineup(p_team uuid) returns int[]
language plpgsql security definer set search_path = '' as $$
declare t record; slots text[]; res int[] := '{}'; s text; pid int;
begin
  select * into t from public.teams where id = p_team;
  slots := public._slots(t.formation);
  foreach s in array slots loop
    select p.id into pid from public.squads q join public.real_players p on p.id = q.player_id
     where q.team_id = p_team and not (p.id = any(res))
     order by (p.grp = s) desc, (s <> 'GK' and p.grp <> 'GK') desc, p.ovr desc limit 1;
    if pid is not null then res := res || pid; end if;
  end loop;
  return res;
end $$;

-- ---------- lobi ----------
create or replace function public.create_game(p_name text, p_settings jsonb, p_team text, p_short text,
  p_c1 text default '#d00000', p_c2 text default '#ffffff') returns uuid
language plpgsql security definer set search_path = '' as $$
declare g uuid; c text;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısın'; end if;
  loop
    c := upper(substr(md5(random()::text), 1, 6));
    exit when not exists (select 1 from public.games where code = c);
  end loop;
  insert into public.games (name, code, owner, settings)
  values (p_name, c, auth.uid(), public._default_settings() || coalesce(p_settings, '{}'))
  returning id into g;
  insert into public.teams (game_id, owner, name, short, color1, color2) values (g, auth.uid(), p_team, upper(p_short), p_c1, p_c2);
  return g;
end $$;

create or replace function public.update_settings(p_game uuid, p_settings jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.games set settings = settings || p_settings
   where id = p_game and owner = auth.uid() and status = 'lobby';
  if not found then raise exception 'Sadece lobi aşamasında oda sahibi değiştirebilir'; end if;
end $$;

create or replace function public.join_game(p_code text, p_team text, p_short text,
  p_c1 text default '#0050d0', p_c2 text default '#ffffff') returns uuid
language plpgsql security definer set search_path = '' as $$
declare g record;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısın'; end if;
  select * into g from public.games where code = upper(trim(p_code));
  if g.id is null then raise exception 'Oda bulunamadı'; end if;
  if exists (select 1 from public.teams where game_id = g.id and owner = auth.uid()) then return g.id; end if;
  if g.status <> 'lobby' then raise exception 'Oyun başlamış, artık katılamazsın'; end if;
  if (select count(*) from public.teams where game_id = g.id) >= (g.settings->>'max_teams')::int then
    raise exception 'Oda dolu'; end if;
  insert into public.teams (game_id, owner, name, short, color1, color2) values (g.id, auth.uid(), p_team, upper(p_short), p_c1, p_c2);
  perform public._news(g.id, null, 'join', p_team || ' odaya katıldı');
  return g.id;
end $$;

create or replace function public.leave_game(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.games where id = p_game and owner = auth.uid()) then
    raise exception 'Oda sahibi ayrılamaz (odayı silebilir)'; end if;
  delete from public.teams t using public.games g
   where t.game_id = p_game and t.owner = auth.uid() and g.id = t.game_id and g.status = 'lobby';
end $$;

create or replace function public.delete_game(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.games where id = p_game and owner = auth.uid();
end $$;

-- ---------- fikstür ----------
-- tek/çift devre lig (circle method), tek sayıda takımda bay geçen olur
create or replace function public._gen_league(p_game uuid, p_legs int) returns int
language plpgsql security definer set search_path = '' as $$
declare arr uuid[]; n int; r int; i int; a uuid; b uuid; tmp uuid; rounds int;
begin
  select array_agg(id order by random()) into arr from public.teams where game_id = p_game;
  if array_length(arr,1) % 2 = 1 then arr := arr || null::uuid; end if;
  n := array_length(arr,1); rounds := n - 1;
  for r in 1..rounds loop
    for i in 1..n/2 loop
      a := arr[i]; b := arr[n + 1 - i];
      if a is not null and b is not null then
        if (r + i) % 2 = 0 then tmp := a; a := b; b := tmp; end if;
        insert into public.fixtures (game_id, comp, round, home, away) values (p_game, 'league', r, a, b);
        if p_legs = 2 then
          insert into public.fixtures (game_id, comp, round, home, away) values (p_game, 'league', r + rounds, b, a);
        end if;
      end if;
    end loop;
    arr := arr[1:1] || arr[n:n] || arr[2:n-1];   -- ilk sabit, gerisi döner
  end loop;
  return rounds * p_legs;
end $$;

-- kupa turu oluştur. alive: turda kalanlar. 2'nin kuvveti değilse ilk turda bazıları bay geçer.
create or replace function public._gen_cup_round(p_game uuid, p_at int) returns void
language plpgsql security definer set search_path = '' as $$
declare g record; alive uuid[]; n int; size int := 1; byes int; i int; tie int := 0; legs int; cr int; is_final boolean;
begin
  select * into g from public.games where id = p_game;
  select array_agg(x::uuid order by random()) into alive from jsonb_array_elements_text(g.cup->'alive') x;
  n := array_length(alive, 1);
  cr := (g.cup->>'round')::int;
  while size < n loop size := size * 2; end loop;
  byes := size - n;
  is_final := (n = 2);
  legs := case when is_final then 1 else (g.settings->>'cup_legs')::int end;
  -- bay geçenler doğrudan bir sonraki tura (winner'ı dolu, oynanmış sahte kayıt yok; 'byes' listesinde tutulur)
  update public.games set cup = cup || jsonb_build_object('byes', to_jsonb(alive[1:byes]), 'pending', n - byes) where id = p_game;
  i := byes + 1;
  while i < n loop
    tie := tie + 1;
    insert into public.fixtures (game_id, comp, round, cup_round, leg, tie, home, away)
      values (p_game, 'cup', p_at, cr, 1, tie, alive[i], alive[i+1]);
    if legs = 2 then
      insert into public.fixtures (game_id, comp, round, cup_round, leg, tie, home, away)
        values (p_game, 'cup', p_at + 1, cr, 2, tie, alive[i+1], alive[i]);
    end if;
    i := i + 2;
  end loop;
  perform public._news(p_game, null, 'cup', case when is_final then 'Kupa finali belli oldu!' else cr || '. kupa turu kurası çekildi' end);
end $$;

-- ---------- başlat: kadro dağıtımı + fikstür ----------
create or replace function public.start_game(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare g record; s jsonb; t record; tiers text[] := '{}'; poss text[]; k text; i int; n int;
  ngk int; ndef int; nmid int; nfwd int; lo int; hi int; pid int; lgs text[]; lr int := 0; cnt int; mid_t text; gap int;
begin
  select * into g from public.games where id = p_game for update;
  if g.owner <> auth.uid() then raise exception 'Sadece oda sahibi başlatabilir'; end if;
  if g.status <> 'lobby' then raise exception 'Oyun zaten başladı'; end if;
  select count(*) into cnt from public.teams where game_id = p_game;
  if cnt < 2 then raise exception 'En az 2 takım gerekli'; end if;
  s := g.settings;
  select array_agg(x) into lgs from jsonb_array_elements_text(s->'leagues') x;
  foreach k in array array['S','A','B','C','D'] loop
    for i in 1..coalesce((s->'squad'->>k)::int, 0) loop tiers := tiers || k; end loop;
  end loop;
  n := array_length(tiers, 1);
  ngk := 2; ndef := round((n - 2) * 0.39); nmid := round((n - 2) * 0.33); nfwd := n - 2 - ndef - nmid;
  mid_t := tiers[(n + 1) / 2];
  for t in select * from public.teams where game_id = p_game order by random() loop
    -- kaleciler: biri orta kademe, biri en alt kademe; kalan kademeler diğer mevkilere rastgele
    poss := '{}';
    for i in 1..ndef loop poss := poss || 'DEF'; end loop;
    for i in 1..nmid loop poss := poss || 'MID'; end loop;
    for i in 1..nfwd loop poss := poss || 'FWD'; end loop;
    select array_agg(x order by random()) into poss from unnest(poss) x;
    declare rest text[] := tiers; tk text; gi int; slot text;
    begin
      -- orta ve en alt kademeyi kaleciler için ayır
      gi := array_position(rest, mid_t); rest := rest[1:gi-1] || rest[gi+1:];
      gi := array_length(rest,1); tk := rest[gi]; rest := rest[1:gi-1];
      for i in 0..n-1 loop
        if i = 0 then slot := 'GK'; k := mid_t;
        elsif i = 1 then slot := 'GK'; k := tk;
        else slot := poss[i - 1]; k := rest[i - 1]; end if;
        lo := (s->'tiers'->k->>0)::int; hi := (s->'tiers'->k->>1)::int;
        select p.id into pid from public.real_players p
         where p.grp = slot and p.lg = any(lgs) and p.ovr between lo and hi
           and not exists (select 1 from public.squads q where q.game_id = p_game and q.player_id = p.id)
         order by random() limit 1;
        if pid is null then   -- kademede kalmadıysa en yakın ratingden
          select p.id into pid from public.real_players p
           where p.grp = slot and p.lg = any(lgs)
             and not exists (select 1 from public.squads q where q.game_id = p_game and q.player_id = p.id)
           order by abs(p.ovr - (lo + hi) / 2), random() limit 1;
        end if;
        if pid is not null then
          insert into public.squads (game_id, player_id, team_id, value)
          select p_game, p.id, t.id, p.val from public.real_players p where p.id = pid;
        end if;
        pid := null;
      end loop;
    end;
    update public.teams set budget = (s->>'start_budget')::bigint, lineup = public._auto_lineup(t.id) where id = t.id;
  end loop;

  if s->>'format' in ('league','league_cup') then lr := public._gen_league(p_game, (s->>'legs')::int); end if;
  if s->>'format' in ('cup','league_cup') then
    gap := greatest(1, lr / greatest(1, ceil(log(2.0, cnt::numeric))::int * (s->>'cup_legs')::int));
    update public.games set cup = jsonb_build_object('round', 1,
      'alive', (select jsonb_agg(id) from public.teams where game_id = p_game), 'gap', gap)
     where id = p_game;
    perform public._gen_cup_round(p_game, case when lr > 0 then gap else 1 end);
  end if;
  update public.games set status = 'active', current_round = 0 where id = p_game;
  perform public._news(p_game, null, 'start', 'Sezon başladı! Kadrolar dağıtıldı, transfer dönemi açık.');
end $$;

-- ---------- taktik ----------
create or replace function public.set_tactics(p_game uuid, p_formation text, p_mentality int, p_lineup int[]) returns void
language plpgsql security definer set search_path = '' as $$
declare t uuid := public._my_team(p_game);
begin
  if t is null then raise exception 'Bu odada takımın yok'; end if;
  if p_formation not in ('4-4-2','4-3-3','4-2-3-1','4-1-4-1','4-5-1','3-5-2','3-4-3','5-3-2','5-4-1','4-4-1-1') then
    raise exception 'Geçersiz diziliş'; end if;
  if p_lineup is not null and cardinality(p_lineup) > 0 then
    if cardinality(p_lineup) <> 11 or (select count(distinct x) from unnest(p_lineup) x) <> 11 then
      raise exception 'İlk 11 tam 11 farklı oyuncu olmalı'; end if;
    if exists (select 1 from unnest(p_lineup) x where not exists
      (select 1 from public.squads q where q.team_id = t and q.player_id = x)) then
      raise exception 'İlk 11''de kadronda olmayan oyuncu var'; end if;
  end if;
  update public.teams set formation = p_formation, mentality = greatest(-2, least(2, p_mentality)),
    lineup = coalesce(p_lineup, '{}') where id = t;
  if cardinality(coalesce(p_lineup, '{}')) = 0 then
    update public.teams set lineup = public._auto_lineup(t) where id = t;
  end if;
end $$;

-- ---------- okuma yetkisi: sadece odanın üyeleri ----------
create or replace function public.is_member(p_game uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.teams where game_id = p_game and owner = (select auth.uid())) $$;

drop policy "oku" on public.games;    create policy "uye" on public.games    for select to authenticated using (public.is_member(id));
drop policy "oku" on public.teams;    create policy "uye" on public.teams    for select to authenticated using (public.is_member(game_id));
drop policy "oku" on public.squads;   create policy "uye" on public.squads   for select to authenticated using (public.is_member(game_id));
drop policy "oku" on public.offers;   create policy "uye" on public.offers   for select to authenticated using (public.is_member(game_id));
drop policy "oku" on public.fixtures; create policy "uye" on public.fixtures for select to authenticated using (public.is_member(game_id));
drop policy "oku" on public.news;     create policy "uye" on public.news     for select to authenticated
  using (public.is_member(game_id) and (team_id is null or team_id in (select id from public.teams where owner = (select auth.uid()))));

-- kullanıcı adı çakışırsa kayıt patlamasın
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare u text := coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''), 'oyuncu_' || left(new.id::text, 6));
begin
  if char_length(u) < 3 then u := 'oyuncu_' || left(new.id::text, 6); end if;
  u := left(u, 20);
  if exists (select 1 from public.profiles where username = u) then u := left(u, 13) || '_' || left(new.id::text, 6); end if;
  insert into public.profiles (id, username) values (new.id, u);
  return new;
end $$;

-- yabancı anahtar indeksleri
create index if not exists games_owner_idx on public.games (owner);
create index if not exists teams_owner_idx on public.teams (owner);
create index if not exists squads_player_idx on public.squads (player_id);
create index if not exists offers_player_idx on public.offers (game_id, player_id);
create index if not exists offers_bidder_idx on public.offers (bidder);
create index if not exists offers_seller_idx on public.offers (seller);
create index if not exists fixtures_home_idx on public.fixtures (home);
create index if not exists fixtures_away_idx on public.fixtures (away);
create index if not exists news_team_idx on public.news (team_id);
