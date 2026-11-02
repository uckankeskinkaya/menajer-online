-- MENAJER ONLINE 011: tek kişilik kariyer (gerçek kulüp + gerçek lig) ve ana ekrandan hızlı hazırlık maçı

-- kulüpler: lig, oyuncu sayısı, en iyi 16'nın ortalaması (güç)
create or replace function public.club_list() returns table (club text, lg text, players int, power numeric)
language sql stable security invoker set search_path = '' as $$
  select r.club, r.lg, count(*)::int,
    round((select avg(o) from (select r2.ovr o from public.real_players r2 where r2.club = r.club and r2.lg = r.lg order by r2.ovr desc limit 16) z), 1)
  from public.real_players r group by r.club, r.lg order by r.lg, 4 desc $$;

-- gerçek kulübün kadrosuyla takım oluştur (p_owner null ise yapay zeka)
create or replace function public._club_team(p_game uuid, p_club text, p_lg text, p_owner uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid; cols text[] := array['#c62828','#1565c0','#212121','#f9a825','#6a1b9a','#ef6c00','#00838f','#ad1457','#4e342e','#37474f','#0d47a1','#b71c1c'];
  h int := abs(hashtext(p_club)); sh text;
begin
  sh := upper(left(regexp_replace(p_club, '[^[:alpha:]]', '', 'g'), 3));
  if char_length(sh) < 2 then sh := 'FC'; end if;
  insert into public.teams (game_id, owner, is_bot, name, short, color1, color2, formation, kit)
  values (p_game, p_owner, p_owner is null, left(p_club, 30), sh, cols[1 + h % 12], case when h % 3 = 0 then '#facc15' else '#ffffff' end,
          (array['4-3-3','4-2-3-1','4-4-2','4-3-3'])[1 + h % 4],
          jsonb_build_object('pattern', (array['plain','plain','stripes','hoops','halves','sash'])[1 + (h / 7) % 6], 'crest', (array['shield','classic','circle','diamond'])[1 + (h / 11) % 4], 'symbol', ''))
  returning id into t;
  insert into public.squads (game_id, player_id, team_id, value)
  select p_game, p.id, t, p.val from public.real_players p where p.club = p_club and p.lg = p_lg
     and not exists (select 1 from public.squads q where q.game_id = p_game and q.player_id = p.id);
  update public.teams set lineup = public._auto_lineup(t),
    budget = greatest(10000000, (select round(sum(value) * 0.12 / 100000) * 100000 from public.squads where team_id = t))::bigint
   where id = t;
  return t;
end $$;

create or replace function public._room_code() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare c text;
begin
  loop
    c := upper(substr(md5(random()::text), 1, 6));
    exit when not exists (select 1 from public.games where code = c);
  end loop;
  return c;
end $$;

-- ana ekrandan hazırlık maçı: iki gerçek kulüp, hemen oynanır (kişiye özel gizli oda, her seferinde yenilenir)
create or replace function public.quick_match(p_home text, p_away text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); g uuid; th uuid; ta uuid; fid bigint; lh text; la text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'msg', 'Giriş yapmalısın'); end if;
  if p_home = p_away then return jsonb_build_object('ok', false, 'msg', 'İki farklı kulüp seç'); end if;
  select lg into lh from public.real_players where club = p_home limit 1;
  select lg into la from public.real_players where club = p_away limit 1;
  if lh is null or la is null then return jsonb_build_object('ok', false, 'msg', 'Kulüp bulunamadı'); end if;
  delete from public.games where owner = uid and settings->>'sandbox' = 'true';
  insert into public.games (name, code, owner, settings, status)
  values ('Hazırlık maçı', public._room_code(), uid, public._default_settings() || '{"sandbox": true, "schedule": "manual", "format": "league"}', 'active')
  returning id into g;
  th := public._club_team(g, p_home, lh, uid);
  ta := public._club_team(g, p_away, la, null);
  insert into public.fixtures (game_id, comp, round, home, away, kickoff_at)
  values (g, 'friendly', 0, th, ta, now() - interval '10 minutes') returning id into fid;
  perform public._play_fixture(fid);
  return jsonb_build_object('ok', true, 'game', g, 'fixture', fid);
end $$;

-- tek kişilik kariyer: seçilen ligin bütün kulüpleri gerçek kadrolarıyla, menajer seçtiği kulübü yönetir
create or replace function public.start_career(p_lg text, p_club text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); g uuid; c text; n int := 0;
begin
  if uid is null then return jsonb_build_object('ok', false, 'msg', 'Giriş yapmalısın'); end if;
  if not exists (select 1 from public.real_players where lg = p_lg and club = p_club) then
    return jsonb_build_object('ok', false, 'msg', 'Kulüp bu ligde bulunamadı'); end if;
  if (select count(*) from public.games where owner = uid and coalesce(settings->>'career', '') = 'true' and status <> 'finished') >= 5 then
    return jsonb_build_object('ok', false, 'msg', 'En fazla 5 açık kariyerin olabilir; birini sil'); end if;
  insert into public.games (name, code, owner, settings)
  values (left(p_club, 30) || ' kariyeri', public._room_code(), uid, public._default_settings() || jsonb_build_object(
      'career', true, 'real_league', p_lg, 'schedule', 'manual', 'format', 'league_cup', 'legs', 2, 'cup_legs', 1,
      'max_teams', 20, 'max_squad', 40, 'min_squad', 16, 'leagues', jsonb_build_array(p_lg), 'transfer_window', 'always'))
  returning id into g;
  -- önce menajerin kulübü (oyuncuları ona ait olsun), sonra diğerleri
  perform public._club_team(g, p_club, p_lg, uid);
  for c in select distinct club from public.real_players where lg = p_lg and club <> p_club order by 1 loop
    perform public._club_team(g, c, p_lg, null);
    n := n + 1;
  end loop;
  update public.games set status = 'active', current_round = 0 where id = g;
  perform public._set_first_day(g);
  perform public._new_fixtures(g);
  perform public._news(g, null, 'start', p_club || ' kariyerin başladı! ' || (n + 1) || ' takımlı lig. Yönetim seni bekliyor.');
  return jsonb_build_object('ok', true, 'game', g);
end $$;

revoke execute on function public._club_team(uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public._room_code() from public, anon, authenticated;
revoke execute on function public.club_list() from public, anon;
revoke execute on function public.quick_match(text, text) from public, anon;
revoke execute on function public.start_career(text, text) from public, anon;
grant execute on function public.club_list(), public.quick_match(text, text), public.start_career(text, text) to authenticated;

-- =====================================================================
-- FM tarzı kulüp finansı: oyuncu maaşları, maaş bütçesi, sponsor/TV geliri, bilet, gelir-gider defteri
-- =====================================================================
alter table public.squads add column if not exists wage bigint not null default 0;            -- haftalık maaş
alter table public.teams add column if not exists wage_budget bigint not null default 0;      -- haftalık maaş bütçesi (0 = sınırsız)
alter table public.teams add column if not exists weekly_income bigint not null default 0;    -- sponsor + yayın geliri / hafta
alter table public.teams add column if not exists ticket bigint not null default 0;           -- iç saha bilet geliri (0 = oda ayarı)
alter table public.teams add column if not exists reputation int not null default 0;          -- 1-5 kulüp itibarı
alter table public.teams add column if not exists fin jsonb not null default '{}';            -- sezon defteri: bilet, sponsor, odul, satis | maas, transfer

create or replace function public._wage_of(p_value bigint) returns bigint
language sql immutable set search_path = '' as $$
  select greatest(2000, round(coalesce(p_value, 0) * 0.0022 / 1000) * 1000)::bigint $$;

create or replace function public._fin(p_team uuid, p_key text, p_amount bigint) returns void
language sql security definer set search_path = '' as $$
  update public.teams set fin = jsonb_set(fin, array[p_key], to_jsonb(coalesce((fin->>p_key)::bigint, 0) + coalesce(p_amount, 0)))
   where id = p_team $$;

-- yeni oyuncu ya da transfer: forma numarası + yeni sözleşme maaşı
create or replace function public._squads_shirt() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.shirt is null or tg_op = 'INSERT' or new.team_id is distinct from old.team_id then
    new.shirt := public._free_shirt(new.team_id, new.player_id, (select grp from public.real_players where id = new.player_id));
    new.wage := public._wage_of(new.value);
  end if;
  return new;
end $$;
update public.squads set wage = public._wage_of(value) where wage = 0;

-- kulüp yapısı: kadro değerine göre maaş bütçesi, sponsor/TV, bilet, itibar (ve istenirse transfer bütçesi)
create or replace function public._setup_finances(p_game uuid, p_keep_budget boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare t record; n int; i int := 0;
begin
  select count(*) into n from public.teams where game_id = p_game;
  for t in select tm.id, coalesce(sum(q.value), 0) sv, coalesce(sum(q.wage), 0) wb
             from public.teams tm left join public.squads q on q.team_id = tm.id
            where tm.game_id = p_game group by tm.id order by 2 desc loop
    i := i + 1;
    update public.teams set
      wage_budget = (round((t.wb * 1.15 + 50000) / 1000) * 1000)::bigint,
      weekly_income = (round(t.sv * 0.0015 / 1000) * 1000)::bigint,
      ticket = (round((100000 + t.sv * 0.0015) / 1000) * 1000)::bigint,
      reputation = greatest(1, 5 - ((i - 1) * 5) / greatest(n, 1)),
      budget = case when p_keep_budget then budget else greatest(10000000, (round(t.sv * 0.12 / 100000) * 100000))::bigint end,
      fin = '{}'
     where id = t.id;
  end loop;
end $$;

-- maç: primler + iç saha bileti (kulübün kendi bilet geliri varsa o)
create or replace function public._play_fixture(p_fix bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare f record; s jsonb; bh bigint; ba bigint; tk bigint;
begin
  select * into f from public.fixtures where id = p_fix for update;
  if f.played then return; end if;
  perform public._sim_fixture(p_fix);
  if f.comp = 'friendly' then return; end if;
  select * into f from public.fixtures where id = p_fix;
  s := public._settings(f.game_id);
  bh := case when f.hg > f.ag then (s->>'win_bonus')::bigint when f.hg = f.ag then (s->>'draw_bonus')::bigint else (s->>'loss_bonus')::bigint end;
  ba := case when f.ag > f.hg then (s->>'win_bonus')::bigint when f.hg = f.ag then (s->>'draw_bonus')::bigint else (s->>'loss_bonus')::bigint end;
  select (coalesce(nullif(ticket, 0), (s->>'ticket_income')::bigint) * case when f.comp = 'cup' then 1.5 else 1 end)::bigint into tk from public.teams where id = f.home;
  update public.teams set budget = budget + bh + tk where id = f.home;
  update public.teams set budget = budget + ba where id = f.away;
  perform public._fin(f.home, 'odul', bh); perform public._fin(f.home, 'bilet', tk); perform public._fin(f.away, 'odul', ba);
end $$;

-- transfer: defterlere satış / alış
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
    perform public._fin(p_to, 'transfer', p_amount);
  end if;
  update public.teams set budget = budget + p_amount, lineup = array_remove(lineup, p_player) where id = p_from;
  perform public._fin(p_from, 'satis', p_amount);
  update public.offers set status = 'lost', note = 'Oyuncu başka takıma satıldı'
   where game_id = p_game and player_id = p_player and status = 'active';
  perform public._news(p_game, null, 'transfer', pl || ': ' || (select name from public.teams where id = p_from)
    || ' → ' || coalesce((select name from public.teams where id = p_to), p_ai_club, 'yapay zeka kulübü')
    || ' (' || public._money(p_amount) || ')');
end $$;

-- mevcut fonksiyonlara küçük ekler (beklenen metin yoksa hata verir, hiçbir şey değişmez)
do $$
declare d text;
begin
  -- hafta sonu: kulübe özel maaş + sponsor/TV geliri, sezon sonu ödülleri deftere
  d := pg_get_functiondef('public._after_round(uuid,int)'::regprocedure);
  if position('round(sum(q.value) * (s->>''wage_pct'')::numeric)::bigint w' in d) = 0 then raise exception '_after_round beklenen haliyle değil'; end if;
  d := replace(d, $a$  for t in select tm.id, tm.is_bot, round(sum(q.value) * (s->>'wage_pct')::numeric)::bigint w
             from public.teams tm join public.squads q on q.team_id = tm.id where tm.game_id = p_game group by tm.id, tm.is_bot loop
    update public.teams set budget = budget - t.w where id = t.id;
    if not t.is_bot then perform public._news(p_game, t.id, 'info', 'Haftalık maaşlar ödendi: ' || public._money(t.w)); end if;
  end loop;$a$, $b$  for t in select tm.id, tm.is_bot, tm.weekly_income inc, coalesce(sum(q.wage), 0)::bigint w
             from public.teams tm left join public.squads q on q.team_id = tm.id where tm.game_id = p_game group by tm.id, tm.is_bot, tm.weekly_income loop
    update public.teams set budget = budget - t.w + t.inc where id = t.id;
    perform public._fin(t.id, 'maas', t.w); perform public._fin(t.id, 'sponsor', t.inc);
    if not t.is_bot then perform public._news(p_game, t.id, 'info', 'Haftalık maaşlar: ' || public._money(t.w)
      || case when t.inc > 0 then ' · sponsor ve yayın geliri: ' || public._money(t.inc) else '' end); end if;
  end loop;$b$);
  d := replace(d, $a$update public.teams set budget = budget + (n - i + 1) * (s->>'season_prize')::bigint where id = lt.team_id;$a$,
                  $b$update public.teams set budget = budget + (n - i + 1) * (s->>'season_prize')::bigint where id = lt.team_id;
        perform public._fin(lt.team_id, 'odul', (n - i + 1) * (s->>'season_prize')::bigint);$b$);
  execute d;

  -- açık artırmadan alınan oyuncu deftere
  d := pg_get_functiondef('public.resolve_transfers()'::regprocedure);
  if position('update public.teams set budget = budget - o.amount where id = o.bidder;' in d) = 0 then raise exception 'resolve_transfers beklenen haliyle değil'; end if;
  execute replace(d, 'update public.teams set budget = budget - o.amount where id = o.bidder;',
    'update public.teams set budget = budget - o.amount where id = o.bidder; perform public._fin(o.bidder, ''transfer'', o.amount);');

  -- teklif: maaş bütçesi kontrolü
  d := pg_get_functiondef('public.place_bid(uuid,int,bigint)'::regprocedure);
  if position('''Bütçen yetmiyor. Kullanılabilir: '' || public._money(my.budget - reserved)); end if;' in d) = 0 then raise exception 'place_bid beklenen haliyle değil'; end if;
  execute replace(d, '''Bütçen yetmiyor. Kullanılabilir: '' || public._money(my.budget - reserved)); end if;',
    '''Bütçen yetmiyor. Kullanılabilir: '' || public._money(my.budget - reserved)); end if;
  if my.wage_budget > 0 and (select coalesce(sum(wage), 0) from public.squads where team_id = me) + public._wage_of(coalesce(own.value, pl.val)) > my.wage_budget then
    return jsonb_build_object(''ok'',false,''msg'',''Maaş bütçen yetmiyor. Bu oyuncu haftada ~'' || public._money(public._wage_of(coalesce(own.value, pl.val)))
      || '' ister, boş maaş bütçen '' || public._money(greatest(0, my.wage_budget - (select coalesce(sum(wage), 0) from public.squads where team_id = me))::bigint) || ''/hafta. Önce oyuncu sat.''); end if;');

  -- yeni sezon: defter sıfırlanır, yönetim maaş bütçesini %5 artırır
  d := pg_get_functiondef('public.new_season(uuid)'::regprocedure);
  if position('update public.squads set fitness = 100, injury = 0, ban = 0, yellows = 0, form = 6.5 where game_id = p_game;' in d) = 0 then raise exception 'new_season beklenen haliyle değil'; end if;
  execute replace(d, 'update public.squads set fitness = 100, injury = 0, ban = 0, yellows = 0, form = 6.5 where game_id = p_game;',
    'update public.squads set fitness = 100, injury = 0, ban = 0, yellows = 0, form = 6.5 where game_id = p_game;
  update public.teams set fin = ''{}'', wage_budget = case when wage_budget > 0 then (round(wage_budget * 1.05 / 1000) * 1000)::bigint else 0 end where game_id = p_game;');

  -- kurmaca kariyer de kulüp yapısı alsın (seçilen bütçe korunur)
  d := pg_get_functiondef('public.start_game(uuid)'::regprocedure);
  if position('  perform public._new_fixtures(p_game);' in d) = 0 then raise exception 'start_game beklenen haliyle değil'; end if;
  execute replace(d, '  perform public._new_fixtures(p_game);',
    '  if coalesce(s->>''career'', '''') = ''true'' then perform public._setup_finances(p_game, true); end if;
  perform public._new_fixtures(p_game);');
end $$;

-- gerçek kulüp kariyeri: kulüp yapısını kur
do $$
declare d text;
begin
  d := pg_get_functiondef('public.start_career(text,text)'::regprocedure);
  if position('  perform public._set_first_day(g);' in d) = 0 then raise exception 'start_career beklenen haliyle değil'; end if;
  execute replace(d, '  perform public._set_first_day(g);', '  perform public._setup_finances(g, false);
  perform public._set_first_day(g);');
end $$;

revoke execute on function public._wage_of(bigint) from public, anon, authenticated;
revoke execute on function public._fin(uuid, text, bigint) from public, anon, authenticated;
revoke execute on function public._setup_finances(uuid, boolean) from public, anon, authenticated;
revoke execute on function public._squads_shirt() from public, anon, authenticated;
revoke execute on function public._play_fixture(bigint) from public, anon, authenticated;
revoke execute on function public._transfer(uuid, int, uuid, uuid, bigint, text) from public, anon, authenticated;
