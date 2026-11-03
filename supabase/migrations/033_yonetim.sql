-- MENAJER ONLINE 033: kariyerde yönetim güveni (execute_sql ile; şema değişikliği yok, durum games.settings içinde).
-- settings.board = {season, team, target, n, rank, conf 0-100, warned}; her hafta lig sonucuna ve hedefe göre güncellenir.
-- Güven çok düşerse menajer kovulur: takım yapay zekaya geçer, settings.jobless = {season, from, teams} (daha küçük kulüplerden teklif).
-- Sezonu hedefte ya da üstünde bitirene büyük kulüplerden teklif: settings.job_offers = {season, teams}. take_job ile kabul edilir.

-- sezon hedefi: kadro gücü sıralamasına göre (istemcideki eski hesapla aynı)
create or replace function public._board_target(p_game uuid, p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare n int; rk int; tg int;
begin
  select count(*) into n from public.teams where game_id = p_game and not guest;
  select x.rk into rk from (select id, row_number() over (order by public._euro_power(id) desc) rk from public.teams where game_id = p_game and not guest) x where x.id = p_team;
  tg := case when rk = 1 then 1 when rk <= ceil(n * 0.25) then ceil(n * 0.25) when rk <= ceil(n / 2.0) then ceil(n / 2.0)
             when rk <= ceil(n * 0.8) then ceil(n * 0.75) else greatest(1, n - 2) end;
  return jsonb_build_object('target', tg, 'rank', rk, 'n', n);
end $$;

-- kovulan menajere teklif: kendinden zayıf (ya da başka) kulüpler
create or replace function public._job_pool(p_game uuid, p_from uuid, p_up boolean, p_count int) returns jsonb
language sql stable security definer set search_path = '' as $$
  with r as (select id, row_number() over (order by public._euro_power(id) desc) rk from public.teams where game_id = p_game and not guest),
  me as (select rk from r where id = p_from)
  select coalesce(jsonb_agg(x.id), '[]'::jsonb) from (
    select r.id from r, me, public.teams t where t.id = r.id and t.is_bot and r.id <> p_from
       and case when p_up then r.rk < me.rk else r.rk > me.rk end
     order by random() limit p_count) x $$;

create or replace function public._board_update(p_game uuid, p_round int, p_final boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare g record; s jsonb; b jsonb; tm record; tg jsonb; pos int; npl int; pts numeric; f record; conf numeric; warned int; dl numeric;
  offers jsonb; names text;
begin
  select * into g from public.games where id = p_game;
  s := public._settings(p_game);
  if not coalesce((s->>'career')::boolean, false) or s->>'format' not in ('league', 'league_cup') then return; end if;
  select * into tm from public.teams where game_id = p_game and owner = g.owner and not is_bot;
  if not found then return; end if;  -- işsiz menajer
  b := coalesce(s->'board', '{}'::jsonb);
  if (b->>'season')::int is distinct from g.season or b->>'team' is distinct from tm.id::text then
    tg := public._board_target(p_game, tm.id);
    b := jsonb_build_object('season', g.season, 'team', tm.id, 'target', tg->'target', 'rank', tg->'rank', 'n', tg->'n',
      'conf', case when b->>'team' = tm.id::text then least(80, greatest(45, coalesce((b->>'conf')::numeric, 60))) else 60 end, 'warned', 0);
  end if;
  conf := (b->>'conf')::numeric; warned := coalesce((b->>'warned')::int, 0);
  select x.rn, x.o into pos, npl from (select team_id, o, row_number() over () rn from public.standings(p_game)) x where x.team_id = tm.id;
  -- bu haftanın lig maçı
  select * into f from public.fixtures where game_id = p_game and round = p_round and comp = 'league' and played and tm.id in (home, away) limit 1;
  if found then
    pts := case when (f.home = tm.id and f.hg > f.ag) or (f.away = tm.id and f.ag > f.hg) then 3 when f.hg = f.ag then 1 else 0 end;
    -- beklenen puan hedefe göre: şampiyonluk adayı ~2.2, kümede kalma adayı ~0.8 puan/maç
    dl := (pts - (2.2 - ((b->>'target')::numeric - 1) / greatest(1, (b->>'n')::numeric - 1) * 1.4)) * 2.5 + case when npl >= 4 then least(6, greatest(-6, (b->>'target')::int - pos)) * 0.5 else 0 end;
    conf := least(100, greatest(0, conf + dl));
  end if;
  if not p_final then
    if conf < 30 and warned < 1 then
      warned := 1;
      perform public._news(p_game, tm.id, 'info', '🏢 Yönetim sonuçlardan memnun değil. Hedef: ' || case when (b->>'target')::int >= (b->>'n')::int - 2 then 'ligde kalmak' else 'ilk ' || (b->>'target') end || ', şu an ' || pos || '. sıradasın.');
    elsif conf < 17 and warned < 2 then
      warned := 2;
      perform public._news(p_game, tm.id, 'info', '🏢 Yönetimden son uyarı: sonuçlar düzelmezse görevine son verilecek.');
    elsif conf >= 45 and warned > 0 then
      warned := 0;
      perform public._news(p_game, tm.id, 'info', '🏢 Yönetim gidişattan memnun, güven tazelendi.');
    end if;
    if conf < 8 and npl >= 8 then
      perform public._sack(p_game, tm.id, 'Yönetim sabrını yitirdi');
      return;
    end if;
  else
    -- sezon sonu değerlendirmesi
    if pos <= (b->>'target')::int then
      conf := least(100, conf + 15);
      perform public._news(p_game, tm.id, 'info', '🏢 Yönetim sezon hedefinin tutturulmasından çok memnun (' || pos || '. sıra, hedef ilk ' || (b->>'target') || ').');
      offers := public._job_pool(p_game, tm.id, true, 2);
      if jsonb_array_length(offers) > 0 then
        select string_agg(t.name, ', ') into names from public.teams t where t.id in (select x::uuid from jsonb_array_elements_text(offers) x);
        update public.games set settings = settings || jsonb_build_object('job_offers', jsonb_build_object('season', g.season, 'teams', offers)) where id = p_game;
        perform public._news(p_game, tm.id, 'offer', '📨 Başarın dikkat çekti! İş teklifi yapan kulüpler: ' || names || '. Yeni sezondan önce kabul edebilirsin.');
      end if;
    elsif pos > (b->>'target')::int + 4 and conf < 40 then
      perform public._sack(p_game, tm.id, 'Sezon hedefinin çok gerisinde kalındı (' || pos || '. sıra, hedef ilk ' || (b->>'target') || ')');
      return;
    else
      perform public._news(p_game, tm.id, 'info', '🏢 Yönetim hedefin tutmamasından hoşnut değil ama sana bir sezon daha veriyor.');
    end if;
  end if;
  b := b || jsonb_build_object('conf', round(conf, 1), 'warned', warned, 'pos', pos);
  update public.games set settings = settings || jsonb_build_object('board', b) where id = p_game;
end $$;

-- kovulma: takım yapay zekaya geçer, daha küçük kulüplerden teklif gelir
create or replace function public._sack(p_game uuid, p_team uuid, p_why text) returns void
language plpgsql security definer set search_path = '' as $$
declare g record; offers jsonb; names text; tn text;
begin
  select * into g from public.games where id = p_game;
  select name into tn from public.teams where id = p_team;
  offers := public._job_pool(p_game, p_team, false, 3);
  if jsonb_array_length(offers) = 0 then offers := public._job_pool(p_game, p_team, true, 3); end if;
  update public.offers set status = 'cancelled', note = 'Menajer görevden alındı' where game_id = p_game and status = 'active' and (bidder = p_team or seller = p_team);
  update public.teams set owner = null, is_bot = true, ready_round = 0 where id = p_team;
  select string_agg(t.name, ', ') into names from public.teams t where t.id in (select x::uuid from jsonb_array_elements_text(offers) x);
  update public.games set settings = (settings - 'board' - 'job_offers') || jsonb_build_object('jobless', jsonb_build_object('season', g.season, 'from', p_team, 'teams', offers)) where id = p_game;
  perform public._news(p_game, null, 'info', '🚪 ' || tn || ' menajerini görevden aldı. ' || p_why || '.' || coalesce(' İş teklifi yapan kulüpler: ' || names || '.', ''));
end $$;

-- iş teklifini kabul et (kovulduysan ya da sezon sonunda büyük kulüpten teklif geldiyse)
create or replace function public.take_job(p_game uuid, p_team uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); g record; s jsonb; offers jsonb; cur record; nt record; tg jsonb;
begin
  if uid is null then return jsonb_build_object('ok', false, 'msg', 'Giriş yapmalısın'); end if;
  select * into g from public.games where id = p_game for update;
  if g.owner is distinct from uid then return jsonb_build_object('ok', false, 'msg', 'Bu kariyer senin değil'); end if;
  s := public._settings(p_game);
  if s ? 'jobless' then offers := s->'jobless'->'teams';
  elsif s ? 'job_offers' and g.status = 'finished' and (s->'job_offers'->>'season')::int = g.season then offers := s->'job_offers'->'teams';
  else return jsonb_build_object('ok', false, 'msg', 'Bekleyen iş teklifin yok'); end if;
  if not exists (select 1 from jsonb_array_elements_text(offers) x where x = p_team::text) then
    return jsonb_build_object('ok', false, 'msg', 'Bu kulüpten teklif yok'); end if;
  select * into nt from public.teams where id = p_team and game_id = p_game and is_bot and not guest;
  if not found then return jsonb_build_object('ok', false, 'msg', 'Kulüp bulunamadı'); end if;
  select * into cur from public.teams where game_id = p_game and owner = uid;
  if found then
    update public.offers set status = 'cancelled', note = 'Menajer kulüpten ayrıldı' where game_id = p_game and status = 'active' and (bidder = cur.id or seller = cur.id);
    update public.teams set owner = null, is_bot = true, ready_round = 0 where id = cur.id;
  end if;
  update public.teams set owner = uid, is_bot = false, ready_round = 0 where id = p_team;
  tg := public._board_target(p_game, p_team);
  update public.games set settings = (settings - 'jobless' - 'job_offers') || jsonb_build_object('board', jsonb_build_object(
      'season', g.season, 'team', p_team, 'target', tg->'target', 'rank', tg->'rank', 'n', tg->'n', 'conf', 60, 'warned', 0)),
    name = left(nt.name, 30) || ' kariyeri'
   where id = p_game;
  perform public._news(p_game, null, 'start', '✍️ ' || nt.name || ' yeni menajerini açıkladı! Yönetimin hedefi: ilk ' || (tg->>'target') || '.');
  return jsonb_build_object('ok', true, 'msg', nt.name || ' menajeri oldun!');
end $$;

-- hafta sonu: yönetim güveni güncellenir
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
  -- kariyer: yönetim güveni (son haftada sezon değerlendirmesi)
  perform public._board_update(p_game, p_round, not exists (select 1 from public.fixtures where game_id = p_game and not played and comp <> 'friendly'));
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

