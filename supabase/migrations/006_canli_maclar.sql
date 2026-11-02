-- MENAJER ONLINE 006: yapay zeka takımları, saatli otomatik maçlar (canlı izleme), hazırlık maçı,
-- "hazırım" sistemi, YZ kulüplerinden menajerlere teklif, transfer dönemi, oda sahipliği devri / takım çıkarma.

-- ---------- şema ----------
alter table public.teams alter column owner drop not null;
alter table public.teams add column if not exists is_bot boolean not null default false;
alter table public.teams add column if not exists ready_round int not null default 0;
alter table public.teams drop constraint if exists teams_owner_or_bot;
alter table public.teams add constraint teams_owner_or_bot check (owner is not null or is_bot);

alter table public.offers alter column bidder drop not null;          -- null = yapay zeka kulübü teklifi
alter table public.offers add column if not exists ai_club text;

alter table public.fixtures add column if not exists kickoff_at timestamptz;
alter table public.fixtures drop constraint if exists fixtures_comp_check;
alter table public.fixtures add constraint fixtures_comp_check check (comp in ('league', 'cup', 'friendly'));
create index if not exists fixtures_kickoff_idx on public.fixtures (kickoff_at) where not played;

-- ---------- ayarlar ----------
create or replace function public._default_settings() returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'format','league',            -- league | cup | league_cup
    'legs',2,                     -- lig: 1 = tek devre, 2 = çift devre
    'cup_legs',1,                 -- kupa: 1 = tek maç, 2 = rövanşlı (final hep tek maç)
    'max_teams',20,
    'bots',0,                     -- başlarken eklenecek yapay zeka takımı
    'start_budget',50000000,
    'squad',jsonb_build_object('S',1,'A',3,'B',6,'C',6,'D',4),
    'tiers',jsonb_build_object('S',jsonb_build_array(85,99),'A',jsonb_build_array(80,84),
            'B',jsonb_build_array(75,79),'C',jsonb_build_array(70,74),'D',jsonb_build_array(60,69)),
    'leagues',jsonb_build_array('ENG','ESP','GER','FRA','ITA','NED','POR','TUR','BEL'),
    'schedule','auto',            -- auto: maçlar saatinde kendiliğinden | manual: oda sahibi oynatır
    'kickoff','11:00',            -- her haftanın ilk maç saati (her gün bir hafta)
    'gap_min',10,                 -- maçlar arası dakika
    'first_day','tomorrow',       -- today | tomorrow (başlarken tarihe çevrilir)
    'tz','Europe/Istanbul',
    'transfer_window','always',   -- always | breaks (sezon başı + devre arası)
    'ai_offers',true,             -- YZ kulüpleri menajerlerin oyuncularına teklif yapar
    'bid_minutes',10,
    'offer_hours',24,
    'min_squad',16, 'max_squad',30,
    'win_bonus',3000000, 'draw_bonus',1500000, 'loss_bonus',500000,
    'ai_sell_ratio',0.75
  ) $$;

create or replace function public._settings(p_game uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public._default_settings() || settings from public.games where id = p_game $$;

-- ---------- yardımcılar ----------
-- transfer dönemi açık mı? (breaks: sezon başı ve lig devre arası)
create or replace function public._window_open(p_game uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare g record; s jsonb; half int;
begin
  select * into g from public.games where id = p_game;
  s := public._settings(p_game);
  if g.status <> 'active' then return false; end if;
  if s->>'transfer_window' = 'always' then return true; end if;
  select max(round) / 2 into half from public.fixtures where game_id = p_game and comp = 'league';
  return g.current_round = 0 or g.current_round = coalesce(half, -1);
end $$;

-- fikstürlere saat ver: hafta r -> first_day + (r-1) gün; haftanın maçları kickoff'tan gap_min arayla
create or replace function public._schedule(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s jsonb; f record; n int; d date;
begin
  s := public._settings(p_game);
  if s->>'schedule' <> 'auto' or s->>'first_day' !~ '^\d{4}-\d{2}-\d{2}$' then return; end if;
  for f in select id, round from public.fixtures
            where game_id = p_game and kickoff_at is null and not played and comp <> 'friendly'
            order by round, comp desc, id loop
    select count(*) into n from public.fixtures where game_id = p_game and round = f.round and kickoff_at is not null and comp <> 'friendly';
    d := (s->>'first_day')::date + (f.round - 1);
    update public.fixtures
       set kickoff_at = ((d + (s->>'kickoff')::time) + make_interval(mins => n * (s->>'gap_min')::int)) at time zone (s->>'tz')
     where id = f.id;
  end loop;
end $$;

-- oyuncuyu bir takımdan diğerine (ya da p_to null ise yapay zeka kulübüne) geçir, parayı aktar
create or replace function public._transfer(p_game uuid, p_player int, p_from uuid, p_to uuid, p_amount bigint, p_ai_club text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare pl text := (select name from public.real_players where id = p_player);
begin
  if p_to is null then
    delete from public.squads where game_id = p_game and player_id = p_player;
  else
    update public.squads set team_id = p_to, bought_for = p_amount, joined_at = now()
     where game_id = p_game and player_id = p_player;
    update public.teams set budget = budget - p_amount where id = p_to;
  end if;
  update public.teams set budget = budget + p_amount, lineup = array_remove(lineup, p_player) where id = p_from;
  update public.offers set status = 'lost', note = 'Oyuncu başka takıma satıldı'
   where game_id = p_game and player_id = p_player and status = 'active';
  perform public._news(p_game, null, 'transfer', pl || ': ' || (select name from public.teams where id = p_from)
    || ' → ' || coalesce((select name from public.teams where id = p_to), p_ai_club, 'yapay zeka kulübü')
    || ' (' || public._money(p_amount) || ')');
end $$;

-- ---------- başlat: YZ takımları + kadro dağıtımı + fikstür + saatler ----------
create or replace function public.start_game(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare g record; s jsonb; t record; tiers text[] := '{}'; poss text[]; k text; i int; n int;
  ngk int; ndef int; nmid int; nfwd int; lo int; hi int; pid int; lgs text[]; lr int := 0; cnt int; mid_t text; gap int;
  nb int; bnames text[] := array['Atlas FK','Demir Kartallar','Yıldız SK','Liman Spor','Rüzgar FK','Kuzey United','Güney Atletik',
    'Ova Gücü','Dağ Kurtları','Sahil FK','Çınar SK','Boğaz Spor','Kale FK','Bozkır Atletik','Nehir United','Fırtına SK',
    'Zirve FK','Ada Spor','Vadi FK','Kanyon SK'];
  cols text[] := array['#c62828','#1565c0','#2e7d32','#f9a825','#6a1b9a','#ef6c00','#00838f','#ad1457','#4e342e','#37474f'];
  bn text; local_now timestamp; fd date;
begin
  select * into g from public.games where id = p_game for update;
  if g.owner <> auth.uid() then raise exception 'Sadece oda sahibi başlatabilir'; end if;
  if g.status <> 'lobby' then raise exception 'Oyun zaten başladı'; end if;
  s := public._default_settings() || g.settings;
  -- yapay zeka takımları
  select count(*) into cnt from public.teams where game_id = p_game;
  nb := least(greatest(coalesce((s->>'bots')::int, 0), 0), greatest((s->>'max_teams')::int, 2) - cnt, 19);
  for i in 1..nb loop
    select x into bn from unnest(bnames) x where not exists (select 1 from public.teams where game_id = p_game and name = x) order by random() limit 1;
    exit when bn is null;
    insert into public.teams (game_id, owner, is_bot, name, short, color1, color2, formation)
    values (p_game, null, true, bn, upper(left(replace(bn, ' ', ''), 3)), cols[1 + floor(random() * 10)::int], '#ffffff',
            (array['4-4-2','4-3-3','4-2-3-1','3-5-2'])[1 + floor(random() * 4)::int]);
  end loop;
  select count(*) into cnt from public.teams where game_id = p_game;
  if cnt < 2 then raise exception 'En az 2 takım gerekli (yapay zeka takımı ekleyebilirsin)'; end if;
  -- ilk maç günü
  local_now := now() at time zone (s->>'tz');
  fd := case when s->>'first_day' ~ '^\d{4}-\d{2}-\d{2}$' then (s->>'first_day')::date
             when s->>'first_day' = 'today' and local_now::time < (s->>'kickoff')::time - interval '2 minutes' then local_now::date
             else local_now::date + 1 end;
  s := s || jsonb_build_object('first_day', fd::text);
  update public.games set settings = s where id = p_game;

  select array_agg(x) into lgs from jsonb_array_elements_text(s->'leagues') x;
  foreach k in array array['S','A','B','C','D'] loop
    for i in 1..coalesce((s->'squad'->>k)::int, 0) loop tiers := tiers || k; end loop;
  end loop;
  n := array_length(tiers, 1);
  ngk := 2; ndef := round((n - 2) * 0.39); nmid := round((n - 2) * 0.33); nfwd := n - 2 - ndef - nmid;
  mid_t := tiers[(n + 1) / 2];
  for t in select * from public.teams where game_id = p_game order by random() loop
    poss := '{}';
    for i in 1..ndef loop poss := poss || 'DEF'::text; end loop;
    for i in 1..nmid loop poss := poss || 'MID'::text; end loop;
    for i in 1..nfwd loop poss := poss || 'FWD'::text; end loop;
    select array_agg(x order by random()) into poss from unnest(poss) x;
    declare rest text[] := tiers; tk text; gi int; slot text;
    begin
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
        if pid is null then
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
  perform public._schedule(p_game);
  perform public._news(p_game, null, 'start', 'Sezon başladı! Kadrolar dağıtıldı'
    || case when public._window_open(p_game) then ', transfer dönemi açık.' else '.' end
    || coalesce(' İlk maç: ' || to_char((select min(kickoff_at) from public.fixtures where game_id = p_game) at time zone (s->>'tz'), 'DD.MM HH24:MI'), ''));
end $$;

-- kupa turu oluşturunca saatlerini de ver
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
  perform public._schedule(p_game);
  perform public._news(p_game, null, 'cup', case when is_final then 'Kupa finali belli oldu!' else cr || '. kupa turu kurası çekildi' end);
end $$;

-- ---------- maç oynatma ----------
-- tek maçı oynat + primler (hazırlık maçında prim yok)
create or replace function public._play_fixture(p_fix bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare f record; s jsonb;
begin
  select * into f from public.fixtures where id = p_fix for update;
  if f.played then return; end if;
  perform public._sim_fixture(p_fix);
  if f.comp = 'friendly' then return; end if;
  select * into f from public.fixtures where id = p_fix;
  s := public._settings(f.game_id);
  update public.teams set budget = budget + case when f.hg > f.ag then (s->>'win_bonus')::bigint
    when f.hg = f.ag then (s->>'draw_bonus')::bigint else (s->>'loss_bonus')::bigint end where id = f.home;
  update public.teams set budget = budget + case when f.ag > f.hg then (s->>'win_bonus')::bigint
    when f.hg = f.ag then (s->>'draw_bonus')::bigint else (s->>'loss_bonus')::bigint end where id = f.away;
end $$;

-- haftanın bütün maçları oynandıysa: hafta sayacı, kupa, YZ teklifleri, sezon sonu
create or replace function public._after_round(p_game uuid, p_round int) returns void
language plpgsql security definer set search_path = '' as $$
declare g record; s jsonb; lt record; t record; sp record; club text; amt bigint;
begin
  select * into g from public.games where id = p_game for update;
  if g.status <> 'active' or p_round <= g.current_round then return; end if;
  if exists (select 1 from public.fixtures where game_id = p_game and round = p_round and comp <> 'friendly' and not played) then return; end if;
  s := public._default_settings() || g.settings;
  update public.games set current_round = p_round where id = p_game;
  update public.teams set ready_round = 0 where game_id = p_game;
  perform public._resolve_cup(p_game);
  perform public._news(p_game, null, 'round', p_round || '. hafta tamamlandı');
  -- sezon bitti mi?
  if not exists (select 1 from public.fixtures where game_id = p_game and not played and comp <> 'friendly') then
    update public.games set status = 'finished' where id = p_game;
    if s->>'format' in ('league','league_cup') then
      select * into lt from public.standings(p_game) limit 1;
      perform public._news(p_game, null, 'champion', '🏆 Lig şampiyonu: ' || lt.name);
    end if;
    return;
  end if;
  -- YZ kulüpleri menajerlerin oyuncularına teklif yapar (eski YZ teklifleri düşer)
  update public.offers set status = 'rejected', note = 'Süresi doldu'
   where game_id = p_game and status = 'active' and bidder is null and seller is not null;
  if (s->>'ai_offers')::boolean and public._window_open(p_game) then
    for t in select id from public.teams where game_id = p_game and not is_bot loop
      if random() < 0.4 and (select count(*) from public.squads where team_id = t.id) > (s->>'min_squad')::int then
        select q.player_id, q.value, p.name, p.club into sp
          from public.squads q join public.real_players p on p.id = q.player_id
         where q.team_id = t.id order by random() limit 1;
        select c.club into club from (select distinct p.club from public.real_players p where p.club <> sp.club) c order by random() limit 1;
        amt := (round(sp.value * (1.05 + random() * 0.35) / 100000) * 100000)::bigint;
        insert into public.offers (game_id, player_id, bidder, seller, ai_club, amount, note, expires_at)
        values (p_game, sp.player_id, null, t.id, club, amt, 'Yapay zeka kulübü teklifi', now() + interval '24 hours');
        perform public._news(p_game, t.id, 'offer', club || ', ' || sp.name || ' için ' || public._money(amt) || ' teklif etti!');
      end if;
    end loop;
  end if;
end $$;

-- sıradaki haftanın hepsini hemen oynat (yetki kontrolü çağıranda)
create or replace function public._play_round(p_game uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r int; f record; n int := 0;
begin
  perform public.resolve_transfers();
  select min(round) into r from public.fixtures where game_id = p_game and not played and comp <> 'friendly';
  if r is null then raise exception 'Oynanacak maç yok'; end if;
  for f in select id from public.fixtures where game_id = p_game and round = r and not played and comp <> 'friendly' order by kickoff_at nulls last, id loop
    perform public._play_fixture(f.id);
    n := n + 1;
  end loop;
  perform public._after_round(p_game, r);
  return jsonb_build_object('ok', true, 'round', r, 'played', n);
end $$;

create or replace function public.play_next_round(p_game uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g record;
begin
  select * into g from public.games where id = p_game for update;
  if g.owner is distinct from auth.uid() then raise exception 'Sadece oda sahibi maçları oynatabilir'; end if;
  if g.status <> 'active' then raise exception 'Oyun aktif değil'; end if;
  return public._play_round(p_game);
end $$;

-- pg_cron her dakika: saati gelen maçları oynat
create or replace function public._auto_tick() returns int
language plpgsql security definer set search_path = '' as $$
declare f record; n int := 0; rounds jsonb := '[]';
begin
  for f in select x.id, x.game_id, x.round, x.comp from public.fixtures x join public.games g on g.id = x.game_id
            where not x.played and x.kickoff_at <= now() and g.status = 'active'
            order by x.kickoff_at limit 100 for update of x skip locked loop
    perform public._play_fixture(f.id);
    n := n + 1;
    if f.comp <> 'friendly' then rounds := rounds || jsonb_build_array(jsonb_build_array(f.game_id, f.round)); end if;
  end loop;
  for f in select distinct (x->>0)::uuid game_id, (x->>1)::int round from jsonb_array_elements(rounds) x order by 2 loop
    perform public._after_round(f.game_id, f.round);
  end loop;
  perform public.resolve_transfers();
  return n;
end $$;

-- ---------- hazırım ----------
create or replace function public.set_ready(p_game uuid, p_ready boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g record; me uuid := public._my_team(p_game); s jsonb; nxt int; waiting int; r jsonb;
begin
  select * into g from public.games where id = p_game for update;
  if me is null then return jsonb_build_object('ok', false, 'msg', 'Bu odada takımın yok'); end if;
  if g.status <> 'active' then return jsonb_build_object('ok', false, 'msg', 'Oyun aktif değil'); end if;
  select min(round) into nxt from public.fixtures where game_id = p_game and not played and comp <> 'friendly';
  update public.teams set ready_round = case when p_ready then nxt else 0 end where id = me;
  s := public._default_settings() || g.settings;
  select count(*) into waiting from public.teams where game_id = p_game and not is_bot and ready_round is distinct from nxt;
  if waiting = 0 and s->>'schedule' = 'manual' then
    r := public._play_round(p_game);
    return jsonb_build_object('ok', true, 'msg', 'Herkes hazır! ' || (r->>'round') || '. hafta oynandı', 'round', r->'round');
  end if;
  return jsonb_build_object('ok', true, 'msg', case when p_ready then 'Hazırsın' || case when waiting > 0 then ' (' || waiting || ' menajer bekleniyor)' else '' end else 'Hazır değilsin' end);
end $$;

-- ---------- hazırlık maçı (hemen başlar, canlı izlenir, puana/primlere etkisi yok) ----------
create or replace function public.friendly_match(p_game uuid, p_opponent uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := public._my_team(p_game); fid bigint;
begin
  if me is null then return jsonb_build_object('ok', false, 'msg', 'Bu odada takımın yok'); end if;
  if (select status from public.games where id = p_game) <> 'active' then return jsonb_build_object('ok', false, 'msg', 'Sezon başlamadan hazırlık maçı yapılamaz'); end if;
  if p_opponent = me or not exists (select 1 from public.teams where id = p_opponent and game_id = p_game) then
    return jsonb_build_object('ok', false, 'msg', 'Rakip geçersiz'); end if;
  if exists (select 1 from public.fixtures where game_id = p_game and comp = 'friendly' and (home = me or away = me)
             and kickoff_at > now() - interval '9 minutes') then
    return jsonb_build_object('ok', false, 'msg', 'Hazırlık maçın sürüyor, bitince yenisini oynayabilirsin'); end if;
  insert into public.fixtures (game_id, comp, round, home, away, kickoff_at)
  values (p_game, 'friendly', 0, me, p_opponent, now()) returning id into fid;
  perform public._play_fixture(fid);
  return jsonb_build_object('ok', true, 'msg', 'Hazırlık maçı başladı', 'fixture', fid);
end $$;

-- ---------- transfer: YZ teklifleri, YZ takımları, transfer dönemi ----------
create or replace function public.place_bid(p_game uuid, p_player int, p_amount bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g record; me uuid := public._my_team(p_game); my record; pl record; own record; ask bigint;
  reserved bigint; top record; mins int; existing record; v_note text; s jsonb; ot record;
begin
  perform pg_advisory_xact_lock(hashtext(p_game::text || ':' || p_player::text));
  perform public.resolve_transfers();
  select * into g from public.games where id = p_game;
  s := public._default_settings() || g.settings;
  if me is null then return jsonb_build_object('ok',false,'msg','Bu odada takımın yok'); end if;
  if g.status <> 'active' then return jsonb_build_object('ok',false,'msg','Sezon aktif değil'); end if;
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('ok',false,'msg','Geçerli bir tutar yaz'); end if;
  if not public._window_open(p_game) then return jsonb_build_object('ok',false,'msg','Transfer dönemi kapalı (sezon başında ve devre arasında açılır)'); end if;
  select * into my from public.teams where id = me for update;
  select * into pl from public.real_players where id = p_player;
  if pl.id is null then return jsonb_build_object('ok',false,'msg','Oyuncu bulunamadı'); end if;
  select * into own from public.squads where game_id = p_game and player_id = p_player;
  if own.team_id = me then return jsonb_build_object('ok',false,'msg','Bu oyuncu zaten senin'); end if;
  if (select count(*) from public.squads where team_id = me) >= (s->>'max_squad')::int then
    return jsonb_build_object('ok',false,'msg','Kadron dolu (en fazla ' || (s->>'max_squad') || ' oyuncu)'); end if;
  select coalesce(sum(amount),0) into reserved from public.offers
   where bidder = me and status = 'active' and player_id <> p_player;
  if my.budget - reserved < p_amount then
    return jsonb_build_object('ok',false,'msg','Bütçen yetmiyor. Kullanılabilir: ' || public._money(my.budget - reserved)); end if;

  if own.team_id is not null then
    if p_amount < own.value then
      return jsonb_build_object('ok',false,'ask',own.value,'msg',
        'Yapay zeka: ' || pl.name || ' için değerinin (' || public._money(own.value) || ') altında teklif kabul edilmez.'); end if;
    select * into ot from public.teams where id = own.team_id;
    -- yapay zeka takımı hemen karar verir
    if ot.is_bot then
      ask := (ceil(own.value * (1.10 + (abs(hashtext(p_game::text || p_player::text || 'bot')) % 21) / 100.0) / 100000) * 100000)::bigint;
      if p_amount < ask then
        return jsonb_build_object('ok',false,'ask',ask,'msg', ot.name || ' (yapay zeka) reddetti. En az ' || public._money(ask) || ' isterler.'); end if;
      if (select count(*) from public.squads where team_id = ot.id) <= (s->>'min_squad')::int then
        return jsonb_build_object('ok',false,'msg', ot.name || ' kadrosu dar, oyuncu satmıyor.'); end if;
      perform public._transfer(p_game, p_player, ot.id, me, p_amount);
      return jsonb_build_object('ok',true,'msg', ot.name || ' teklifi kabul etti! ' || pl.name || ' artık senin.');
    end if;
    v_note := case when p_amount >= own.value * 1.5 then 'Değerinin çok üstünde bir teklif!'
                 when p_amount >= own.value * 1.2 then 'Cazip bir teklif.' else 'Değerine yakın bir teklif.' end;
    select * into existing from public.offers where bidder = me and player_id = p_player and game_id = p_game and status = 'active';
    if existing.id is not null then
      if p_amount <= existing.amount then return jsonb_build_object('ok',false,'msg','Yeni teklif öncekinden yüksek olmalı'); end if;
      update public.offers set amount = p_amount, note = v_note, expires_at = now() + make_interval(hours => (s->>'offer_hours')::int)
       where id = existing.id;
    else
      insert into public.offers (game_id, player_id, bidder, seller, amount, note, expires_at)
      values (p_game, p_player, me, own.team_id, p_amount, v_note, now() + make_interval(hours => (s->>'offer_hours')::int));
    end if;
    perform public._news(p_game, own.team_id, 'offer', my.name || ', ' || pl.name || ' için ' || public._money(p_amount) || ' teklif etti. ' || v_note);
    insert into public.news (game_id, team_id, kind, text)
      select p_game, o.bidder, 'rival', 'Rakip teklif: ' || my.name || ', ' || pl.name || ' için ' || public._money(p_amount) || ' önerdi'
      from public.offers o where o.game_id = p_game and o.player_id = p_player and o.status = 'active' and o.bidder <> me;
    return jsonb_build_object('ok',true,'msg','Teklif ' || ot.name || ' menajerine iletildi. ' || v_note);
  end if;

  ask := public._ai_ask(p_game, p_player);
  select * into top from public.offers where game_id = p_game and player_id = p_player and status = 'active'
    and seller is null order by amount desc limit 1;
  if top.id is null then
    if p_amount < ask then
      return jsonb_build_object('ok',false,'ask',ask,'msg', pl.club || ' teklifi reddetti. Karşı teklif: en az ' || public._money(ask)
        || case when p_amount >= ask * 0.9 then ' (çok yaklaştın!)' else '' end); end if;
    mins := (s->>'bid_minutes')::int;
    insert into public.offers (game_id, player_id, bidder, amount, note, expires_at)
      values (p_game, p_player, me, p_amount, 'En yüksek teklif sende', now() + make_interval(mins => mins));
    perform public._news(p_game, null, 'auction', my.name || ', ' || pl.name || ' için ' || public._money(p_amount)
      || ' teklif etti! ' || mins || ' dk içinde daha yüksek teklif gelmezse transfer tamam.');
    return jsonb_build_object('ok',true,'msg', pl.club || ' teklifi kabul etti! ' || mins || ' dk içinde rakip teklif gelmezse oyuncu senin.');
  end if;
  if top.bidder = me then return jsonb_build_object('ok',false,'msg','En yüksek teklif zaten sende'); end if;
  if p_amount < greatest(ask, ceil(top.amount * 1.05 / 100000) * 100000) then
    return jsonb_build_object('ok',false,'ask',greatest(ask, (ceil(top.amount * 1.05 / 100000) * 100000)::bigint),
      'msg','Açık artırmada en az ' || public._money(greatest(ask, (ceil(top.amount * 1.05 / 100000) * 100000)::bigint)) || ' vermelisin (%5 artış)'); end if;
  update public.offers set status = 'outbid', note = my.name || ' teklifini geçti'
   where game_id = p_game and player_id = p_player and status = 'active' and seller is null and bidder <> me;
  delete from public.offers where game_id = p_game and player_id = p_player and status = 'active' and bidder = me;
  insert into public.offers (game_id, player_id, bidder, amount, note, expires_at)
    values (p_game, p_player, me, p_amount, 'En yüksek teklif sende', greatest(top.expires_at, now() + interval '1 minute'));
  perform public._news(p_game, top.bidder, 'outbid', my.name || ', ' || pl.name || ' için teklifini geçti: ' || public._money(p_amount) || '! Karşılık vermek için acele et.');
  perform public._news(p_game, null, 'auction', 'Transfer kapışması! ' || pl.name || ' için ' || my.name || ' ' || public._money(p_amount) || ' verdi');
  return jsonb_build_object('ok',true,'msg','En yüksek teklif artık sende!');
end $$;

create or replace function public.respond_offer(p_offer bigint, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o record; s jsonb; pl record;
begin
  select * into o from public.offers where id = p_offer for update;
  if o.id is null or o.status <> 'active' or o.seller is null then return jsonb_build_object('ok',false,'msg','Teklif geçerli değil'); end if;
  if (select owner from public.teams where id = o.seller) is distinct from auth.uid() then return jsonb_build_object('ok',false,'msg','Bu teklif sana değil'); end if;
  s := public._settings(o.game_id);
  select * into pl from public.real_players where id = o.player_id;
  if not p_accept then
    update public.offers set status = 'rejected', note = 'Menajer reddetti' where id = o.id;
    if o.bidder is not null then perform public._news(o.game_id, o.bidder, 'offer', pl.name || ' için teklifin reddedildi'); end if;
    return jsonb_build_object('ok',true,'msg','Teklif reddedildi');
  end if;
  if not public._window_open(o.game_id) then return jsonb_build_object('ok',false,'msg','Transfer dönemi kapalı'); end if;
  if not exists (select 1 from public.squads where game_id = o.game_id and player_id = o.player_id and team_id = o.seller) then
    update public.offers set status = 'cancelled', note = 'Oyuncu artık bu takımda değil' where id = o.id;
    return jsonb_build_object('ok',false,'msg','Oyuncu artık kadronda değil'); end if;
  if (select count(*) from public.squads where team_id = o.seller) <= (s->>'min_squad')::int then
    return jsonb_build_object('ok',false,'msg','Kadron en az ' || (s->>'min_squad') || ' oyuncu olmalı, satamazsın'); end if;
  if o.bidder is not null then
    if (select budget from public.teams where id = o.bidder) < o.amount then
      update public.offers set status = 'cancelled', note = 'Alıcının bütçesi yetmiyor' where id = o.id;
      return jsonb_build_object('ok',false,'msg','Alıcının bütçesi artık yetmiyor, teklif iptal edildi'); end if;
    if (select count(*) from public.squads where team_id = o.bidder) >= (s->>'max_squad')::int then
      return jsonb_build_object('ok',false,'msg','Alıcının kadrosu dolu'); end if;
  end if;
  update public.offers set status = 'accepted', note = 'Transfer tamamlandı' where id = o.id;
  perform public._transfer(o.game_id, o.player_id, o.seller, o.bidder, o.amount, o.ai_club);
  return jsonb_build_object('ok',true,'msg','Transfer tamamlandı: ' || public._money(o.amount));
end $$;

create or replace function public.sell_to_ai(p_game uuid, p_player int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := public._my_team(p_game); s jsonb; q record; price bigint;
begin
  s := public._settings(p_game);
  if not public._window_open(p_game) then return jsonb_build_object('ok',false,'msg','Transfer dönemi kapalı'); end if;
  select * into q from public.squads where game_id = p_game and player_id = p_player and team_id = me;
  if q.player_id is null then return jsonb_build_object('ok',false,'msg','Bu oyuncu senin değil'); end if;
  if (select count(*) from public.squads where team_id = me) <= (s->>'min_squad')::int then
    return jsonb_build_object('ok',false,'msg','Kadron en az ' || (s->>'min_squad') || ' oyuncu olmalı'); end if;
  price := (q.value * (s->>'ai_sell_ratio')::numeric)::bigint;
  perform public._transfer(p_game, p_player, me, null, price, (select club from public.real_players where id = p_player));
  return jsonb_build_object('ok',true,'msg','Satıldı: ' || public._money(price));
end $$;

-- ---------- oda yönetimi ----------
-- oda sahipliğini başka bir menajere devret
create or replace function public.transfer_ownership(p_game uuid, p_team uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  if (select owner from public.games where id = p_game) is distinct from auth.uid() then
    return jsonb_build_object('ok',false,'msg','Sadece oda sahibi devredebilir'); end if;
  select * into t from public.teams where id = p_team and game_id = p_game;
  if t.id is null or t.owner is null or t.owner = auth.uid() then return jsonb_build_object('ok',false,'msg','Geçerli bir menajer seç'); end if;
  update public.games set owner = t.owner where id = p_game;
  perform public._news(p_game, null, 'info', 'Oda sahipliği ' || t.name || ' menajerine devredildi');
  return jsonb_build_object('ok',true,'msg','Oda sahipliği devredildi');
end $$;

-- takımı odadan çıkar: lobide siler, sezon sırasında yapay zekaya devreder
create or replace function public.kick_team(p_game uuid, p_team uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g record; t record;
begin
  select * into g from public.games where id = p_game for update;
  if g.owner is distinct from auth.uid() then return jsonb_build_object('ok',false,'msg','Sadece oda sahibi çıkarabilir'); end if;
  select * into t from public.teams where id = p_team and game_id = p_game;
  if t.id is null or t.owner = auth.uid() then return jsonb_build_object('ok',false,'msg','Geçerli bir takım seç'); end if;
  if g.status = 'lobby' then
    delete from public.teams where id = p_team;
    return jsonb_build_object('ok',true,'msg', t.name || ' odadan çıkarıldı');
  end if;
  update public.teams set owner = null, is_bot = true where id = p_team;
  update public.offers set status = 'cancelled', note = 'Takım yapay zekaya devredildi' where bidder = p_team and status = 'active' and seller is not null;
  perform public._news(p_game, null, 'info', t.name || ' artık yapay zeka tarafından yönetiliyor');
  return jsonb_build_object('ok',true,'msg', t.name || ' yapay zekaya devredildi');
end $$;

-- odadan ayrıl: lobide takım silinir, sezon sırasında takım yapay zekaya geçer
create or replace function public.leave_game(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare g record; me uuid := public._my_team(p_game);
begin
  select * into g from public.games where id = p_game;
  if g.owner = auth.uid() then raise exception 'Oda sahibi ayrılamaz (önce sahipliği devret ya da odayı sil)'; end if;
  if me is null then return; end if;
  if g.status = 'lobby' then
    delete from public.teams where id = me;
  else
    update public.teams set owner = null, is_bot = true where id = me;
    update public.offers set status = 'cancelled', note = 'Takım yapay zekaya devredildi' where bidder = me and status = 'active' and seller is not null;
    perform public._news(p_game, null, 'info', (select name from public.teams where id = me) || ' menajeri ayrıldı, takımı yapay zeka yönetecek');
  end if;
end $$;

-- ---------- yetkiler + zamanlayıcı ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.create_game, public.update_settings, public.join_game, public.leave_game,
  public.delete_game, public.start_game, public.set_tactics, public.place_bid, public.respond_offer,
  public.cancel_offer, public.sell_to_ai, public.play_next_round, public.standings, public.resolve_transfers,
  public.is_member, public.set_ready, public.friendly_match, public.transfer_ownership, public.kick_team
  to authenticated;

select cron.unschedule('resolve-transfers') where exists (select 1 from cron.job where jobname = 'resolve-transfers');
select cron.schedule('auto-matches', '* * * * *', 'select public._auto_tick()');
