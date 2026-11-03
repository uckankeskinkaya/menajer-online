-- MENAJER ONLINE 031: kiralık oyuncu (loan_player + _after_round, execute_sql ile). Kolonlar, _loan_guard, _end_loans (içinde delete var), tetikleyici ve yetkiler: 032_kiralik_yetki.sql (SQL Editor).
-- squads.loan_from = oyuncunun asıl kulübünün adı (null = kiralık değil), squads.loan_team = asıl YZ takımı (null = kadrosu oyunda olmayan YZ kulübü).
-- Kiralama sezon sonuna kadar: bedel değerin %10'u (en az 100 bin), maaşı kiralayan öder. Sezon bitince oyuncu kulübüne döner.

-- yapay zeka kulübünden sezon sonuna kadar oyuncu kirala
create or replace function public.loan_player(p_game uuid, p_player int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); tm record; bt record; s jsonb; q record; p record; val bigint; fee bigint; w bigint; club text; src uuid;
begin
  if uid is null then return jsonb_build_object('ok', false, 'msg', 'Giriş yapmalısın'); end if;
  select * into tm from public.teams where game_id = p_game and owner = uid for update;
  if not found then return jsonb_build_object('ok', false, 'msg', 'Bu odada takımın yok'); end if;
  if not public._window_open(p_game) then return jsonb_build_object('ok', false, 'msg', 'Transfer dönemi kapalı'); end if;
  s := public._settings(p_game);
  select * into p from public.real_players where id = p_player;
  if not found then return jsonb_build_object('ok', false, 'msg', 'Oyuncu bulunamadı'); end if;
  select * into q from public.squads where game_id = p_game and player_id = p_player for update;
  if found then
    if q.team_id = tm.id then return jsonb_build_object('ok', false, 'msg', 'Bu oyuncu zaten senin'); end if;
    if q.loan_from is not null then return jsonb_build_object('ok', false, 'msg', 'Bu oyuncu zaten kiralık'); end if;
    select * into bt from public.teams where id = q.team_id;
    if not bt.is_bot then return jsonb_build_object('ok', false, 'msg', 'Sadece yapay zeka kulüplerinden oyuncu kiralanabilir'); end if;
    if p_player = any(bt.lineup) then return jsonb_build_object('ok', false, 'msg', bt.name || ' ilk 11 oyuncusunu kiralık vermiyor'); end if;
    if (select count(*) from public.squads where team_id = bt.id) <= 18 then
      return jsonb_build_object('ok', false, 'msg', bt.name || ' kadrosu dar, kiralık oyuncu vermiyor'); end if;
    src := bt.id; club := bt.name; val := q.value;
  else
    club := p.club; val := p.val;
  end if;
  if exists (select 1 from public.offers where game_id = p_game and player_id = p_player and status = 'active') then
    return jsonb_build_object('ok', false, 'msg', 'Bu oyuncu için süren bir teklif ya da açık artırma var'); end if;
  if (select count(*) from public.squads where team_id = tm.id) >= (s->>'max_squad')::int then
    return jsonb_build_object('ok', false, 'msg', 'Kadron dolu (en fazla ' || (s->>'max_squad') || ')'); end if;
  if (select count(*) from public.squads where team_id = tm.id and loan_from is not null) >= 4 then
    return jsonb_build_object('ok', false, 'msg', 'En fazla 4 kiralık oyuncu alabilirsin'); end if;
  fee := greatest(100000, round(val * 0.1 / 100000) * 100000)::bigint;
  w := public._wage_of(val);
  if tm.wage_budget > 0 and (select coalesce(sum(wage), 0) from public.squads where team_id = tm.id) + w > tm.wage_budget then
    return jsonb_build_object('ok', false, 'msg', 'Maaş bütçen yetmiyor (' || public._money(w) || '/hafta)'); end if;
  if tm.budget < fee then return jsonb_build_object('ok', false, 'msg', 'Bütçen yetmiyor: kiralama bedeli ' || public._money(fee)); end if;
  update public.teams set budget = budget - fee where id = tm.id;
  perform public._fin(tm.id, 'transfer', fee);
  if src is not null then
    update public.teams set budget = budget + fee where id = src;
    update public.squads set team_id = tm.id, loan_from = club, loan_team = src, joined_at = now(), morale = greatest(morale, 70)
     where game_id = p_game and player_id = p_player;
  else
    insert into public.squads (game_id, player_id, team_id, value, contract, morale, loan_from)
    values (p_game, p_player, tm.id, val, 0, 75, club);
  end if;
  perform public._news(p_game, null, 'transfer', '🤝 ' || p.name || ' sezon sonuna kadar kiralık: ' || club || ' → ' || tm.name || ' (bedel ' || public._money(fee) || ')');
  return jsonb_build_object('ok', true, 'msg', p.name || ' kiralandı: ' || public._money(fee));
end $$;

-- hafta sonu: sezon sonunda kiralıklar döner; YZ teklifleri kiralık oyunculara yapılmaz
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
    -- kiralık oyuncular kulüplerine döner
    perform public._end_loans(p_game);
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
      if random() < 0.4 and (select count(*) from public.squads where team_id = t.id) > (s->>'min_squad')::int
         and exists (select 1 from public.squads where team_id = t.id and loan_from is null) then
        select q.player_id, q.value, p.name, p.club into sp
          from public.squads q join public.real_players p on p.id = q.player_id
         where q.team_id = t.id and q.loan_from is null order by random() limit 1;
        select c.club into club from (select distinct p.club from public.real_players p where p.club <> sp.club) c order by random() limit 1;
        amt := (round(sp.value * (1.05 + random() * 0.35) / 100000) * 100000)::bigint;
        insert into public.offers (game_id, player_id, bidder, seller, ai_club, amount, note, expires_at)
        values (p_game, sp.player_id, null, t.id, club, amt, 'Yapay zeka kulübü teklifi', now() + interval '24 hours');
        perform public._news(p_game, t.id, 'offer', club || ', ' || sp.name || ' için ' || public._money(amt) || ' teklif etti!');
      end if;
    end loop;
  end if;
end $$;

