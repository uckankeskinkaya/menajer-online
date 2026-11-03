-- MENAJER ONLINE 026: kariyerde Avrupa kupası. SQL Editor'den çalıştır (alter table var).
-- 16 takım: kariyer liginden ilk 4 (ENG/ESP/GER/ITA), 3 (FRA) ya da 2 (diğerleri) + diğer liglerin en güçlü kulüpleri (misafir, ligde oynamaz).
-- İlk sezon kadro gücüne göre, sonraki sezonlar bir önceki lig sıralamasına göre katılır.
-- 4 grup x 4 takım çift devre (6 maç), gruplardan ilk 2 çeyrek finale; çeyrek ve yarı final rövanşlı, final tek maç.
-- Maçlar lig haftalarının arasına yayılır (iç kupa haftalarına denk getirilmez).
-- fixtures: comp 'euro', cup_round 0 = grup (tie = grup no, leg = grup maçı no), 1 = çeyrek, 2 = yarı, 3 = final.

alter table public.teams add column if not exists guest boolean not null default false;
alter table public.games add column if not exists euro jsonb;
alter table public.fixtures drop constraint if exists fixtures_comp_check;
alter table public.fixtures add constraint fixtures_comp_check check (comp in ('league', 'cup', 'friendly', 'euro'));

-- takım gücü: en iyi 16 oyuncunun ortalaması (gelişim dahil)
create or replace function public._euro_power(p_team uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(avg(o), 0) from (select p.ovr + q.ovr_delta o from public.squads q join public.real_players p on p.id = q.player_id
   where q.team_id = p_team order by 1 desc limit 16) z $$;

-- takımın ligi (kadrosundaki oyuncuların çoğunun gerçek ligi)
create or replace function public._team_lg(p_team uuid) returns text
language sql stable security definer set search_path = '' as $$
  select p.lg from public.squads q join public.real_players p on p.id = q.player_id where q.team_id = p_team
   group by p.lg order by count(*) desc limit 1 $$;

-- kariyer liginden kaç takım katılır
create or replace function public._euro_slots(p_lg text) returns int
language sql immutable set search_path = '' as $$
  select case when p_lg in ('ENG', 'ESP', 'GER', 'ITA') then 4 when p_lg = 'FRA' then 3 else 2 end $$;

-- Avrupa ödülü (sadece menajerin ligindeki takımlar; misafirlerin bütçesi önemsiz)
create or replace function public._euro_prize(p_team uuid, p_amount bigint, p_text text) returns void
language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  select * into t from public.teams where id = p_team;
  if t.guest then return; end if;
  update public.teams set budget = budget + p_amount where id = p_team;
  perform public._fin(p_team, 'odul', p_amount);
  if not t.is_bot then perform public._news(t.game_id, p_team, 'info', '💶 ' || p_text || ': ' || public._money(p_amount)); end if;
end $$;

-- lig fikstürü: misafir takımlar ligde oynamaz
create or replace function public._gen_league(p_game uuid, p_legs int) returns int
language plpgsql security definer set search_path = '' as $$
declare arr uuid[]; n int; r int; i int; a uuid; b uuid; tmp uuid; rounds int;
begin
  select array_agg(id order by random()) into arr from public.teams where game_id = p_game and not guest;
  if array_length(arr, 1) % 2 = 1 then arr := arr || null::uuid; end if;
  n := array_length(arr, 1); rounds := n - 1;
  for r in 1..rounds loop
    for i in 1..n / 2 loop
      a := arr[i]; b := arr[n + 1 - i];
      if a is not null and b is not null then
        if (r + i) % 2 = 0 then tmp := a; a := b; b := tmp; end if;
        insert into public.fixtures (game_id, comp, round, home, away) values (p_game, 'league', r, a, b);
        if p_legs = 2 then
          insert into public.fixtures (game_id, comp, round, home, away) values (p_game, 'league', r + rounds, b, a);
        end if;
      end if;
    end loop;
    arr := arr[1:1] || arr[n:n] || arr[2:n - 1];   -- ilk sabit, gerisi döner
  end loop;
  return rounds * p_legs;
end $$;

create or replace function public.standings(p_game uuid)
returns table (team_id uuid, name text, short text, color1 text, color2 text, o int, w int, d int, l int, gf int, ga int, gd int, pts int)
language sql stable set search_path = '' as $$
  with r as (
    select home t, hg f, ag a from public.fixtures where game_id = p_game and comp = 'league' and played
    union all select away, ag, hg from public.fixtures where game_id = p_game and comp = 'league' and played)
  select t.id, t.name, t.short, t.color1, t.color2,
    count(r.t)::int, count(*) filter (where r.f > r.a)::int, count(*) filter (where r.f = r.a)::int,
    count(*) filter (where r.f < r.a)::int, coalesce(sum(r.f), 0)::int, coalesce(sum(r.a), 0)::int,
    coalesce(sum(r.f - r.a), 0)::int,
    (count(*) filter (where r.f > r.a) * 3 + count(*) filter (where r.f = r.a))::int
  from public.teams t left join r on r.t = t.id
  where t.game_id = p_game and not t.guest
  group by t.id order by 13 desc, 12 desc, 10 desc, t.name $$;

-- istatistikler: misafir kulüplerin oyuncuları listelerde görünmez
create or replace function public.player_stats(p_game uuid)
returns table (player_id int, team_id uuid, apps int, goals int, assists int, yellows int, reds int, rating numeric, motm int)
language sql stable set search_path = '' as $$
  with f as (select * from public.fixtures where game_id = p_game and played and comp <> 'friendly'),
  ap as (select (kv.key)::int pid, (kv.value)::numeric r from f, jsonb_each(f.stats->'rt') kv),
  ev as (select e from f, jsonb_array_elements(f.events) e),
  a as (select pid, count(*)::int apps, round(avg(r), 2) rating from ap group by pid),
  g as (select (e->>'p')::int pid, count(*)::int n from ev where e->>'t' = 'goal' group by 1),
  s as (select (e->>'a')::int pid, count(*)::int n from ev where e->>'t' = 'goal' and e ? 'a' and e->>'a' is not null group by 1),
  y as (select (e->>'p')::int pid, count(*)::int n from ev where e->>'t' = 'yellow' group by 1),
  rd as (select (e->>'p')::int pid, count(*)::int n from ev where e->>'t' = 'red' group by 1),
  m as (select (f.stats->>'motm')::int pid, count(*)::int n from f where f.stats ? 'motm' group by 1)
  select a.pid, q.team_id, a.apps, coalesce(g.n, 0), coalesce(s.n, 0), coalesce(y.n, 0), coalesce(rd.n, 0), a.rating, coalesce(m.n, 0)
  from a left join g on g.pid = a.pid left join s on s.pid = a.pid left join y on y.pid = a.pid
       left join rd on rd.pid = a.pid left join m on m.pid = a.pid
       left join public.squads q on q.game_id = p_game and q.player_id = a.pid
       left join public.teams tm on tm.id = q.team_id
  where not coalesce(tm.guest, false)
  order by coalesce(g.n, 0) desc, a.rating desc $$;

-- Avrupa kupasını kur: katılımcılar, kura (aynı ligden takımlar mümkünse ayrı gruplara), grup maçları
create or replace function public._gen_euro(p_game uuid, p_lr int) returns void
language plpgsql security definer set search_path = '' as $$
declare s jsonb; e jsonb; v_lg text; q int; parts uuid[]; c record; t uuid; allt uuid[]; lgs jsonb := '{}'; rounds int[] := '{}';
  gap int; r int; k int; best uuid[]; bestc int := 99; cand uuid[]; cl int; att int; p int; gi int; i int; j int;
  pat int[] := array[1,2,3,4, 4,1,2,3, 1,3,2,4, 2,1,4,3, 1,4,3,2, 3,1,4,2]; grp uuid[]; groups jsonb := '[]'; mine text;
begin
  s := public._settings(p_game);
  v_lg := s->>'real_league';
  select euro into e from public.games where id = p_game;
  if not coalesce((s->>'career')::boolean, false) or v_lg is null or s->>'format' not in ('league', 'league_cup') or p_lr < 12 then
    update public.games set euro = null where id = p_game;
    return;
  end if;
  q := public._euro_slots(v_lg);
  -- katılımcılar: geçen sezonun ilk q'su, ilk sezon kadro gücü
  if e ? 'next' then
    parts := array(select x::uuid from jsonb_array_elements_text(e->'next') x
                    where exists (select 1 from public.teams where id = x::uuid and not guest));
  end if;
  if coalesce(cardinality(parts), 0) = 0 then
    parts := array(select id from public.teams where game_id = p_game and not guest order by public._euro_power(id) desc limit q);
  end if;
  -- misafir kulüpler bir kez kurulur: diğer liglerin her birinden en fazla 2, güce göre
  if not exists (select 1 from public.teams where game_id = p_game and guest) then
    for c in select z.club, z.lg from (select x.club, x.lg, x.power, row_number() over (partition by x.lg order by x.power desc) rn
                                        from public.club_list() x where x.lg <> v_lg) z
              where z.rn <= 2 order by z.power desc limit 16 - q loop
      t := public._club_team(p_game, c.club, c.lg, null);
      update public.teams set guest = true where id = t;
    end loop;
  end if;
  allt := parts || array(select id from public.teams where game_id = p_game and guest);
  if cardinality(allt) <> 16 then
    update public.games set euro = null where id = p_game;
    return;
  end if;
  for i in 1..16 loop lgs := lgs || jsonb_build_object(allt[i]::text, public._team_lg(allt[i])); end loop;
  -- torbalar: güce göre 4'erli
  allt := array(select x from unnest(allt) x order by public._euro_power(x) desc);
  for att in 1..60 loop
    cand := '{}';
    for p in 0..3 loop
      cand := cand || array(select x from unnest(allt[p * 4 + 1:p * 4 + 4]) x order by random());
    end loop;
    cl := 0;
    for gi in 1..4 loop
      for i in 0..2 loop
        for j in i + 1..3 loop
          if lgs->>(cand[i * 4 + gi]::text) = lgs->>(cand[j * 4 + gi]::text) then cl := cl + 1; end if;
        end loop;
      end loop;
    end loop;
    if cl < bestc then best := cand; bestc := cl; end if;
    exit when cl = 0;
  end loop;
  -- haftalar: ligin içine 11 Avrupa haftası, iç kupa haftalarına denk gelmesin
  select (cup->>'gap')::int into gap from public.games where id = p_game;
  r := 0;
  for k in 1..11 loop
    r := greatest(round(p_lr * k / 12.0)::int, r + 1);
    while gap >= 3 and r % gap = 0 and r < p_lr loop r := r + 1; end loop;
    rounds := rounds || least(r, p_lr);
  end loop;
  -- grup maçları
  for gi in 1..4 loop
    grp := array[best[gi], best[4 + gi], best[8 + gi], best[12 + gi]];
    groups := groups || jsonb_build_array(to_jsonb(grp));
    for k in 1..6 loop
      for i in 0..1 loop
        insert into public.fixtures (game_id, comp, round, cup_round, leg, tie, home, away)
        values (p_game, 'euro', rounds[k], 0, k, gi, grp[pat[(k - 1) * 4 + i * 2 + 1]], grp[pat[(k - 1) * 4 + i * 2 + 2]]);
      end loop;
    end loop;
  end loop;
  update public.games set euro = jsonb_build_object('season', (select season from public.games where id = p_game), 'stage', 0,
    'rounds', to_jsonb(rounds), 'groups', groups, 'lg', lgs, 'teams', to_jsonb(parts)) where id = p_game;
  for i in 1..cardinality(parts) loop
    perform public._euro_prize(parts[i], 5000000, 'Avrupa kupası katılım payı');
  end loop;
  select string_agg(tm.name, ', ') into mine from unnest(parts) x join public.teams tm on tm.id = x;
  perform public._news(p_game, null, 'cup', '🌍 Avrupa kupası kurası çekildi! Ligimizi temsil edenler: ' || mine || '. İlk maçlar ' || rounds[1] || '. haftada.');
end $$;

-- grup sıralaması
create or replace function public.euro_table(p_game uuid)
returns table (grp int, team_id uuid, o int, w int, d int, l int, gf int, ga int, gd int, pts int)
language sql stable set search_path = '' as $$
  with g as (select (x.ord)::int grp, (y.v)::uuid team_id from public.games gm,
               jsonb_array_elements(gm.euro->'groups') with ordinality x(arr, ord), jsonb_array_elements_text(x.arr) y(v)
              where gm.id = p_game),
  r as (select tie, home t, hg f, ag a from public.fixtures where game_id = p_game and comp = 'euro' and cup_round = 0 and played
        union all select tie, away, ag, hg from public.fixtures where game_id = p_game and comp = 'euro' and cup_round = 0 and played)
  select g.grp, g.team_id, count(r.t)::int, count(*) filter (where r.f > r.a)::int, count(*) filter (where r.f = r.a)::int,
    count(*) filter (where r.f < r.a)::int, coalesce(sum(r.f), 0)::int, coalesce(sum(r.a), 0)::int, coalesce(sum(r.f - r.a), 0)::int,
    (count(*) filter (where r.f > r.a) * 3 + count(*) filter (where r.f = r.a))::int
  from g left join r on r.t = g.team_id and r.tie = g.grp
  group by g.grp, g.team_id order by 1, 10 desc, 9 desc, 7 desc $$;

-- eleme maçı (rövanşlıysa iki ayak)
create or replace function public._euro_tie(p_game uuid, p_cr int, p_tie int, p_a uuid, p_b uuid, p_r1 int, p_r2 int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.fixtures (game_id, comp, round, cup_round, leg, tie, home, away) values (p_game, 'euro', p_r1, p_cr, 1, p_tie, p_a, p_b);
  if p_r2 is not null then
    insert into public.fixtures (game_id, comp, round, cup_round, leg, tie, home, away) values (p_game, 'euro', p_r2, p_cr, 2, p_tie, p_b, p_a);
  end if;
end $$;

-- hafta sonunda: grup bitti mi, eleme turu bitti mi
create or replace function public._resolve_euro(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e jsonb; st int; rr int[]; w uuid[] := '{}'; ru uuid[] := '{}'; x record; t record; last record; h int; a int; ph int; pa int;
  wn uuid; win uuid[] := '{}'; i int; nm text;
begin
  select euro into e from public.games where id = p_game for update;
  if e is null or e ? 'champion' then return; end if;
  st := (e->>'stage')::int;
  rr := array(select jsonb_array_elements_text(e->'rounds')::int);
  if exists (select 1 from public.fixtures where game_id = p_game and comp = 'euro' and cup_round = st and not played) then return; end if;
  if not exists (select 1 from public.fixtures where game_id = p_game and comp = 'euro' and cup_round = st) then return; end if;
  if st = 0 then
    for i in 1..4 loop
      select array_agg(team_id order by pts desc, gd desc, gf desc, random()) into win from public.euro_table(p_game) where grp = i;
      w := w || win[1]; ru := ru || win[2];
    end loop;
    perform public._euro_tie(p_game, 1, 1, ru[2], w[1], rr[7], rr[8]);
    perform public._euro_tie(p_game, 1, 2, ru[1], w[2], rr[7], rr[8]);
    perform public._euro_tie(p_game, 1, 3, ru[4], w[3], rr[7], rr[8]);
    perform public._euro_tie(p_game, 1, 4, ru[3], w[4], rr[7], rr[8]);
    for i in 1..4 loop
      perform public._euro_prize(w[i], 4000000, 'Avrupa kupasında çeyrek final');
      perform public._euro_prize(ru[i], 4000000, 'Avrupa kupasında çeyrek final');
    end loop;
    update public.games set euro = euro || '{"stage": 1}' where id = p_game;
    perform public._news(p_game, null, 'cup', '🌍 Avrupa kupasında gruplar tamamlandı, çeyrek final eşleşmeleri belli oldu.');
    return;
  end if;
  -- eleme turu: toplam skor, eşitlikte penaltı
  for x in select tie from public.fixtures where game_id = p_game and comp = 'euro' and cup_round = st group by tie order by tie loop
    select * into last from public.fixtures where game_id = p_game and comp = 'euro' and cup_round = st and tie = x.tie order by leg desc limit 1;
    select coalesce(sum(case when home = last.home then hg else ag end), 0), coalesce(sum(case when home = last.home then ag else hg end), 0) into h, a
      from public.fixtures where game_id = p_game and comp = 'euro' and cup_round = st and tie = x.tie;
    if h > a then wn := last.home; elsif a > h then wn := last.away;
    else
      ph := 3 + floor(random() * 3)::int; pa := 3 + floor(random() * 3)::int;
      if ph = pa then if random() < 0.5 then ph := ph + 1; else pa := pa + 1; end if; end if;
      wn := case when ph > pa then last.home else last.away end;
      update public.fixtures set pens = ph || '-' || pa where id = last.id;
    end if;
    update public.fixtures set winner = wn where id = last.id;
    win := win || wn;
  end loop;
  if st = 3 then
    select name into nm from public.teams where id = win[1];
    update public.games set euro = euro || jsonb_build_object('champion', win[1]) where id = p_game;
    perform public._euro_prize(win[1], 15000000, 'Avrupa şampiyonluğu');
    perform public._news(p_game, null, 'champion', '🌍🏆 Avrupa şampiyonu: ' || nm || '!');
    return;
  end if;
  win := array(select v from unnest(win) v order by random());
  if st = 1 then
    perform public._euro_tie(p_game, 2, 1, win[1], win[2], rr[9], rr[10]);
    perform public._euro_tie(p_game, 2, 2, win[3], win[4], rr[9], rr[10]);
    for i in 1..4 loop perform public._euro_prize(win[i], 6000000, 'Avrupa kupasında yarı final'); end loop;
    perform public._news(p_game, null, 'cup', '🌍 Avrupa kupasında yarı final kurası çekildi.');
  else
    perform public._euro_tie(p_game, 3, 1, win[1], win[2], rr[11], null);
    for i in 1..2 loop perform public._euro_prize(win[i], 8000000, 'Avrupa kupası finali'); end loop;
    perform public._news(p_game, null, 'cup', '🌍 Avrupa kupası finali: ' || (select name from public.teams where id = win[1]) || ' - ' || (select name from public.teams where id = win[2]));
  end if;
  update public.games set euro = euro || jsonb_build_object('stage', st + 1) where id = p_game;
end $$;

-- fikstür: misafirler ligde ve iç kupada yok; kariyerde Avrupa kupası eklenir
create or replace function public._new_fixtures(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s jsonb; cnt int; lr int := 0; gap int;
begin
  s := public._settings(p_game);
  select count(*) into cnt from public.teams where game_id = p_game and not guest;
  update public.games set cup = null where id = p_game;
  if s->>'format' in ('league', 'league_cup') then lr := public._gen_league(p_game, (s->>'legs')::int); end if;
  if s->>'format' in ('cup', 'league_cup') then
    gap := greatest(1, lr / greatest(1, ceil(log(2.0, cnt::numeric))::int * (s->>'cup_legs')::int));
    update public.games set cup = jsonb_build_object('round', 1,
      'alive', (select jsonb_agg(id) from public.teams where game_id = p_game and not guest), 'gap', gap)
     where id = p_game;
    perform public._gen_cup_round(p_game, case when lr > 0 then gap else 1 end);
  end if;
  perform public._gen_euro(p_game, lr);
  perform public._schedule(p_game);
end $$;

-- iç saha bileti Avrupa'da 2.5 kat
create or replace function public._play_fixture(p_fix bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare f record; s jsonb; bh bigint; ba bigint; tk bigint;
begin
  select * into f from public.fixtures where id = p_fix for update;
  if f.played then return; end if;
  perform public._sim_fixture(p_fix);
  if f.comp = 'friendly' then return; end if;
  select * into f from public.fixtures where id = p_fix;
  if not f.played then return; end if;  -- devre arasında durdu: ödüller maç bitince
  s := public._settings(f.game_id);
  bh := case when f.hg > f.ag then (s->>'win_bonus')::bigint when f.hg = f.ag then (s->>'draw_bonus')::bigint else (s->>'loss_bonus')::bigint end;
  ba := case when f.ag > f.hg then (s->>'win_bonus')::bigint when f.hg = f.ag then (s->>'draw_bonus')::bigint else (s->>'loss_bonus')::bigint end;
  select (coalesce(nullif(ticket, 0), (s->>'ticket_income')::bigint) * case when f.comp = 'cup' then 1.5 when f.comp = 'euro' then 2.5 else 1 end)::bigint
    into tk from public.teams where id = f.home;
  update public.teams set budget = budget + bh + tk where id = f.home;
  update public.teams set budget = budget + ba where id = f.away;
  perform public._fin(f.home, 'odul', bh); perform public._fin(f.home, 'bilet', tk); perform public._fin(f.away, 'odul', ba);
end $$;

-- hafta sonu: Avrupa turu çözülür; sezon sonunda gelecek sezonun Avrupa takımları belirlenir
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
  -- dinlenme ve sakatlık iyileşmesi
  update public.squads set fitness = least(100, fitness + 20), injury = greatest(0, injury - 1) where game_id = p_game;
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

revoke execute on function public._euro_power(uuid) from public, anon, authenticated;
revoke execute on function public._team_lg(uuid) from public, anon, authenticated;
revoke execute on function public._euro_slots(text) from public, anon, authenticated;
revoke execute on function public._euro_prize(uuid, bigint, text) from public, anon, authenticated;
revoke execute on function public._gen_euro(uuid, int) from public, anon, authenticated;
revoke execute on function public._euro_tie(uuid, int, int, uuid, uuid, int, int) from public, anon, authenticated;
revoke execute on function public._resolve_euro(uuid) from public, anon, authenticated;
revoke execute on function public.euro_table(uuid) from public, anon;
grant execute on function public.euro_table(uuid) to authenticated;
