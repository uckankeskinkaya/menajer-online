-- MENAJER ONLINE 028: antrenman (fonksiyonlar, execute_sql ile). Kolonlar ve yetkiler: 029_antrenman_yetki.sql (SQL Editor).
-- teams.training {focus: genel|hucum|ortasaha|savunma|fizik, int: 0 hafif / 1 normal / 2 yoğun}; squads.xp gelişim puanı (100 = +1 güç).

create or replace function public.set_training(p_game uuid, p_focus text, p_intensity int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); tid uuid;
begin
  if uid is null then return jsonb_build_object('ok', false, 'msg', 'Giriş yapmalısın'); end if;
  if p_focus is null or p_focus not in ('genel', 'hucum', 'ortasaha', 'savunma', 'fizik') or p_intensity is null or p_intensity not between 0 and 2 then
    return jsonb_build_object('ok', false, 'msg', 'Geçersiz antrenman programı');
  end if;
  select id into tid from public.teams where game_id = p_game and owner = uid;
  if tid is null then return jsonb_build_object('ok', false, 'msg', 'Bu odada takımın yok'); end if;
  update public.teams set training = jsonb_build_object('focus', p_focus, 'int', p_intensity) where id = tid;
  return jsonb_build_object('ok', true, 'msg', 'Antrenman programı kaydedildi');
end $$;

-- hafta sonu antrenmanı (her takım kendi programıyla; YZ takımları genel/normal)
create or replace function public._train_week(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare g record; t record; pid int; pn text; w int; lst text;
begin
  select * into g from public.games where id = p_game;
  -- dinlenme: hafif +26, normal +20, yoğun +14 (fizik odağı +4); moral: iki haftada bir hafif +1, yoğun -1
  update public.squads q set
    fitness = least(100, q.fitness + (array[26, 20, 14])[1 + coalesce((tm.training->>'int')::int, 1)] + case when tm.training->>'focus' = 'fizik' then 4 else 0 end),
    injury = greatest(0, q.injury - 1),
    morale = greatest(0, least(100, q.morale + case when random() < 0.5 then 0 when coalesce((tm.training->>'int')::int, 1) = 0 then 1 when coalesce((tm.training->>'int')::int, 1) = 2 then -1 else 0 end))
   from public.teams tm where tm.id = q.team_id and q.game_id = p_game;
  -- gelişim puanı: gençler daha hızlı, yoğunluk ve mevkiye uygun odak hızlandırır, potansiyelde durur
  update public.squads q set xp = q.xp + round(
      (case when p.age + g.season - 1 <= 20 then 4 when p.age + g.season - 1 <= 23 then 3 when p.age + g.season - 1 <= 26 then 1.5 else 0 end)
      * (array[0.6, 1.0, 1.4])[1 + coalesce((tm.training->>'int')::int, 1)]
      * case coalesce(tm.training->>'focus', 'genel')
          when 'genel' then 1.1
          when 'hucum' then case when p.grp = 'FWD' then 1.4 else 0.9 end
          when 'ortasaha' then case when p.grp = 'MID' then 1.4 else 0.9 end
          when 'savunma' then case when p.grp in ('DEF', 'GK') then 1.4 else 0.9 end
          else 0.9 end)::int
   from public.teams tm, public.real_players p
   where tm.id = q.team_id and p.id = q.player_id and q.game_id = p_game and q.injury = 0 and not tm.guest and p.ovr + q.ovr_delta < p.pot;
  -- 100 puan = +1 güç, değer %6 artar
  for t in select tm.id, tm.is_bot from public.teams tm where tm.game_id = p_game
            and exists (select 1 from public.squads x where x.team_id = tm.id and x.xp >= 100) loop
    select string_agg(p.name || ' ' || (p.ovr + q.ovr_delta + 1), ', ') into lst
      from public.squads q join public.real_players p on p.id = q.player_id where q.team_id = t.id and q.xp >= 100;
    update public.squads set xp = xp - 100, ovr_delta = ovr_delta + 1, value = (round(value * 1.06 / 1000) * 1000)::bigint
     where team_id = t.id and xp >= 100;
    if not t.is_bot then perform public._news(p_game, t.id, 'info', '📈 Antrenmanda gelişenler: ' || lst); end if;
  end loop;
  -- antrenman sakatlığı: normalde %4, yoğunda %12 (fizik odağı yarıya indirir)
  for t in select tm.id, tm.is_bot, coalesce((tm.training->>'int')::int, 1) i, coalesce(tm.training->>'focus', 'genel') f
             from public.teams tm where tm.game_id = p_game and not tm.guest loop
    if random() < ((array[0.0, 0.04, 0.12])[1 + t.i] * (case when t.f = 'fizik' then 0.5 else 1 end)) then
      select q.player_id, p.name into pid, pn from public.squads q join public.real_players p on p.id = q.player_id
       where q.team_id = t.id and q.injury = 0 order by random() limit 1;
      if pid is not null then
        w := 1 + floor(random() * 2)::int;
        update public.squads set injury = w where game_id = p_game and player_id = pid;
        if not t.is_bot then perform public._news(p_game, t.id, 'info', '🚑 ' || pn || ' antrenmanda sakatlandı: ' || w || ' hafta yok'); end if;
      end if;
    end if;
  end loop;
end $$;

-- hafta sonu: dinlenme satırı yerine antrenman haftası
create or replace function public._after_round(p_game uuid, p_round int) returns void
language plpgsql security definer set search_path = '' as $$
declare g record; s jsonb; lt record; t record; sp record; club text; amt bigint; n int; i int; champ uuid; fin record;
  top record; bst record; nx jsonb; nxn text;
begin
  select * into g from public.games where id = p_game for update;
  if g.status <> 'active' or p_round <= g.current_round then return; end if;
  if exists (select 1 from public.fixtures where game_id = p_game and round = p_round and comp <> 'friendly' and not played) then return; end if;
  s := public._default_settings() || g.settings;
  update public.games set current_round = p_round where id = p_game;
  update public.teams set ready_round = 0 where game_id = p_game;
  -- antrenman haftası: dinlenme, sakatlık iyileşmesi, gelişim, antrenman sakatlıkları
  perform public._train_week(p_game);
  -- haftalık maaşlar
  for t in select tm.id, tm.is_bot, tm.weekly_income inc, coalesce(sum(q.wage), 0)::bigint w
             from public.teams tm left join public.squads q on q.team_id = tm.id where tm.game_id = p_game and not tm.guest group by tm.id, tm.is_bot, tm.weekly_income loop
    update public.teams set budget = budget - t.w + t.inc where id = t.id;
    perform public._fin(t.id, 'maas', t.w); perform public._fin(t.id, 'sponsor', t.inc);
    if not t.is_bot then perform public._news(p_game, t.id, 'info', 'Haftalık maaşlar: ' || public._money(t.w)
      || case when t.inc > 0 then ' · sponsor ve yayın geliri: ' || public._money(t.inc) else '' end); end if;
  end loop;
  perform public._resolve_cup(p_game);
  perform public._resolve_euro(p_game);
  perform public._news(p_game, null, 'round', p_round || '. hafta tamamlandı');
  -- sezon bitti mi?
  if not exists (select 1 from public.fixtures where game_id = p_game and not played and comp <> 'friendly') then
    update public.games set status = 'finished' where id = p_game;
    n := (select count(*) from public.teams where game_id = p_game and not guest);
    if s->>'format' in ('league', 'league_cup') then
      i := 0;
      for lt in select * from public.standings(p_game) loop
        i := i + 1;
        update public.teams set budget = budget + (n - i + 1) * (s->>'season_prize')::bigint where id = lt.team_id;
        perform public._fin(lt.team_id, 'odul', (n - i + 1) * (s->>'season_prize')::bigint);
        if i = 1 then champ := lt.team_id; perform public._news(p_game, null, 'champion', '🏆 Lig şampiyonu: ' || lt.name); end if;
      end loop;
    end if;
    select * into g from public.games where id = p_game;
    if g.cup ? 'champion' then
      update public.teams set budget = budget + (s->>'cup_prize')::bigint where id = (g.cup->>'champion')::uuid;
      select * into fin from public.fixtures where game_id = p_game and comp = 'cup' order by cup_round desc, leg desc limit 1;
      update public.teams set budget = budget + (s->>'cup_prize')::bigint / 2
       where id = case when fin.home = (g.cup->>'champion')::uuid then fin.away else fin.home end;
    end if;
    -- gelecek sezon Avrupa'ya gidenler: lig sıralaması
    if coalesce((s->>'career')::boolean, false) and s->>'real_league' is not null and s->>'format' in ('league', 'league_cup') then
      select jsonb_agg(x.team_id), string_agg(x.name, ', ') into nx, nxn
        from (select * from public.standings(p_game) limit public._euro_slots(s->>'real_league')) x;
      update public.games set euro = coalesce(euro, '{}'::jsonb) || jsonb_build_object('next', nx) where id = p_game;
      perform public._news(p_game, null, 'cup', '🌍 Gelecek sezon Avrupa kupasında: ' || nxn);
    end if;
    select x.*, p.name into top from public.player_stats(p_game) x join public.real_players p on p.id = x.player_id order by x.goals desc, x.rating desc limit 1;
    select x.*, p.name into bst from public.player_stats(p_game) x join public.real_players p on p.id = x.player_id
     where x.apps >= greatest(1, p_round / 3) order by x.rating desc limit 1;
    update public.games set history = history || jsonb_build_array(jsonb_build_object(
      'season', g.season,
      'league', case when champ is not null then jsonb_build_object('id', champ, 'name', (select name from public.teams where id = champ)) end,
      'cup', case when g.cup ? 'champion' then jsonb_build_object('id', g.cup->>'champion', 'name', (select name from public.teams where id = (g.cup->>'champion')::uuid)) end,
      'euro', case when g.euro ? 'champion' then jsonb_build_object('id', g.euro->>'champion', 'name', (select name from public.teams where id = (g.euro->>'champion')::uuid)) end,
      'top', case when top.player_id is not null then jsonb_build_object('name', top.name, 'goals', top.goals, 'team', (select name from public.teams where id = top.team_id)) end,
      'best', case when bst.player_id is not null then jsonb_build_object('name', bst.name, 'rating', bst.rating, 'team', (select name from public.teams where id = bst.team_id)) end))
     where id = p_game;
    if top.player_id is not null then
      perform public._news(p_game, null, 'champion', '⚽ Gol kralı: ' || top.name || ' (' || top.goals || ' gol)');
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
