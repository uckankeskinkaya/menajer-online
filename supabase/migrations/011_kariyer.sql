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
