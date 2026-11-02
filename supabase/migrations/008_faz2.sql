-- MENAJER ONLINE 008 (Faz 2): maç puanları + istatistik, form ve değer, kartlar ve sakatlıklar, yorgunluk,
-- maç içi oyuncu değişikliği, maaş/bilet/ödül, yeni sezon (yaşlanma, gelişim, emeklilik), sezon geçmişi.

-- ---------- şema ----------
alter table public.squads add column if not exists ovr_delta int not null default 0;          -- sezonlar boyunca gelişim/düşüş
alter table public.squads add column if not exists form numeric(3,1) not null default 6.5;    -- son maç puanlarının ağırlıklı ortalaması
alter table public.squads add column if not exists fitness int not null default 100;          -- kondisyon 20-100
alter table public.squads add column if not exists injury int not null default 0;             -- kalan sakatlık (hafta)
alter table public.squads add column if not exists ban int not null default 0;                -- kalan ceza (maç)
alter table public.squads add column if not exists yellows int not null default 0;            -- birikmiş sarı kart
alter table public.games add column if not exists season int not null default 1;
alter table public.games add column if not exists history jsonb not null default '[]';

-- ---------- ayarlar ----------
create or replace function public._default_settings() returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'format','league', 'legs',2, 'cup_legs',1, 'max_teams',20, 'bots',0,
    'start_budget',50000000,
    'squad',jsonb_build_object('S',1,'A',3,'B',6,'C',6,'D',4),
    'tiers',jsonb_build_object('S',jsonb_build_array(85,99),'A',jsonb_build_array(80,84),
            'B',jsonb_build_array(75,79),'C',jsonb_build_array(70,74),'D',jsonb_build_array(60,69)),
    'leagues',jsonb_build_array('ENG','ESP','GER','FRA','ITA','NED','POR','TUR','BEL'),
    'schedule','auto', 'kickoff','11:00', 'gap_min',10, 'first_day','tomorrow', 'tz','Europe/Istanbul',
    'transfer_window','always', 'ai_offers',true,
    'bid_minutes',10, 'offer_hours',24, 'min_squad',16, 'max_squad',30,
    'win_bonus',3000000, 'draw_bonus',1500000, 'loss_bonus',500000,
    'ai_sell_ratio',0.75,
    'wage_pct',0.0015,            -- haftalık maaş = kadro değerinin %0.15'i
    'ticket_income',1000000,      -- iç saha maçı bilet geliri (kupada 1.5 katı)
    'season_prize',2000000,       -- sezon sonu: (takım sayısı - sıra + 1) x bu tutar
    'cup_prize',10000000          -- kupa şampiyonu (finalist yarısı)
  ) $$;

-- ---------- ilk 11 ----------
-- otomatik en iyi 11: sakat/cezalıları atlar, kondisyonu hesaba katar
create or replace function public._auto_lineup(p_team uuid) returns int[]
language plpgsql security definer set search_path = '' as $$
declare t record; slots text[]; res int[] := '{}'; s text; pid int;
begin
  select * into t from public.teams where id = p_team;
  slots := public._slots(t.formation);
  foreach s in array slots loop
    pid := null;
    select p.id into pid from public.squads q join public.real_players p on p.id = q.player_id
     where q.team_id = p_team and q.injury = 0 and q.ban = 0 and not (p.id = any(res))
     order by (p.grp = s) desc, (s <> 'GK' and p.grp <> 'GK') desc,
              (p.ovr + q.ovr_delta) * (0.75 + 0.25 * q.fitness / 100.0) desc limit 1;
    if pid is not null then res := res || pid; end if;
  end loop;
  return res;
end $$;

-- menajerin ilk 11'ini koru, sadece oynayamayanların yerine en iyisini koy (YZ takımları her maç yeniden dizer)
create or replace function public._fix_lineup(p_team uuid) returns int[]
language plpgsql security definer set search_path = '' as $$
declare t record; slots text[]; res int[] := array_fill(null::int, array[11]); pid int; i int;
begin
  select * into t from public.teams where id = p_team;
  if t.is_bot or coalesce(cardinality(t.lineup), 0) <> 11 then return public._auto_lineup(p_team); end if;
  slots := public._slots(t.formation);
  for i in 1..11 loop
    pid := t.lineup[i];
    if pid is not null and not coalesce(pid = any(res), false) and exists (select 1 from public.squads q
        where q.team_id = p_team and q.player_id = pid and q.injury = 0 and q.ban = 0) then res[i] := pid; end if;
  end loop;
  for i in 1..11 loop
    if res[i] is null then
      pid := null;
      select q.player_id into pid from public.squads q join public.real_players p on p.id = q.player_id
       where q.team_id = p_team and q.injury = 0 and q.ban = 0 and not coalesce(q.player_id = any(res), false)
       order by (p.grp = slots[i]) desc, (slots[i] <> 'GK' and p.grp <> 'GK') desc,
                (p.ovr + q.ovr_delta) * (0.75 + 0.25 * q.fitness / 100.0) desc limit 1;
      res[i] := pid;
    end if;
  end loop;
  return array_remove(res, null);
end $$;

-- yedek kulübesinden giren: aynı mevkiden, sahaya çıkmamış, oynayabilir en iyi oyuncu
create or replace function public._bench_pick(p_team uuid, p_grp text, p_used int[]) returns int
language sql stable security definer set search_path = '' as $$
  select q.player_id from public.squads q join public.real_players p on p.id = q.player_id
   where q.team_id = p_team and q.injury = 0 and q.ban = 0 and not (q.player_id = any(p_used))
   order by (p.grp = p_grp) desc, (p_grp <> 'GK' and p.grp <> 'GK') desc,
            (p.ovr + q.ovr_delta) * (0.75 + 0.25 * q.fitness / 100.0) desc limit 1 $$;

-- verilen ilk 11 ile takım gücü (gelişim, kondisyon ve form dahil)
create or replace function public._power(p_team uuid, p_lineup int[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t record; slots text[]; i int; p record; eff numeric; f numeric; base numeric;
  d numeric := 0; m numeric := 0; fw numeric := 0; gk numeric := 35; gkid int; nd int := 0; nm int := 0; nf int := 0;
  shooters jsonb := '[]'; players jsonb := '[]';
begin
  select * into t from public.teams where id = p_team;
  slots := public._slots(t.formation);
  for i in 1..coalesce(cardinality(p_lineup), 0) loop
    select rp.id, rp.grp, rp.ovr, rp.sho, rp.phy, coalesce(q.ovr_delta, 0) dl, coalesce(q.fitness, 100) fit, coalesce(q.form, 6.5) frm
      into p from public.real_players rp left join public.squads q on q.player_id = rp.id and q.team_id = p_team
     where rp.id = p_lineup[i];
    f := (0.75 + 0.25 * p.fit / 100.0) * (1 + (p.frm - 6.5) * 0.02);
    base := p.ovr + p.dl;
    eff := (case when p.grp = slots[i] then base when slots[i] = 'GK' or p.grp = 'GK' then base * 0.5 else base * 0.85 end) * f;
    case slots[i]
      when 'GK' then gk := eff; gkid := p.id;
      when 'DEF' then d := d + eff; nd := nd + 1;
      when 'MID' then m := m + eff; nm := nm + 1;
      else fw := fw + eff; nf := nf + 1;
    end case;
    if slots[i] <> 'GK' then
      shooters := shooters || jsonb_build_object('id', p.id, 'w',
        (case slots[i] when 'FWD' then 3.0 when 'MID' then 1.3 else 0.35 end) * (case when p.sho > 0 then p.sho else p.ovr end) / 70.0,
        'q', ((case when p.sho > 0 then (p.sho + p.ovr) / 2.0 else p.ovr end) + p.dl) * f);
    end if;
    players := players || jsonb_build_object('id', p.id, 'g', slots[i], 'e', round(eff, 1), 'phy', p.phy, 'fit', p.fit);
  end loop;
  return jsonb_build_object(
    -- diziliş etkisi: hat başına oyuncu sayısı küçük bir çarpan (3'lü defans biraz zayıf, 5'li biraz güçlü)
    'def', (case when nd > 0 then d / nd else 40 end) * (0.94 + 0.02 * least(nd, 5)) * (1 - t.mentality * 0.03),
    'mid', (case when nm > 0 then m / nm else 40 end) * (0.9 + 0.033 * least(nm, 6)),
    'att', (case when nf > 0 then fw / nf else 40 end) * (0.92 + 0.04 * least(nf, 3)) * (1 + t.mentality * 0.04),
    'gk', gk, 'gkid', gkid, 'lineup', to_jsonb(p_lineup), 'formation', t.formation, 'shooters', shooters, 'players', players);
end $$;

create or replace function public._team_power(p_team uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select public._power(p_team, public._fix_lineup(p_team)) $$;

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
    if exists (select 1 from public.squads q where q.team_id = t and q.player_id = any(p_lineup) and (q.injury > 0 or q.ban > 0)) then
      raise exception 'İlk 11''de sakat ya da cezalı oyuncu var'; end if;
  end if;
  update public.teams set formation = p_formation, mentality = greatest(-2, least(2, p_mentality)),
    lineup = coalesce(p_lineup, '{}') where id = t;
  if cardinality(coalesce(p_lineup, '{}')) = 0 then
    update public.teams set lineup = public._auto_lineup(t) where id = t;
  end if;
end $$;

-- ---------- maç motoru ----------
-- events: {m, t: goal|save|miss|yellow|red|injury|sub, s: h|a, p, a}   (sub: p çıkan, a giren)
-- stats: {poss, shots, on, lh, la, fh, fa, rt: {oyuncu: puan}, motm}
create or replace function public._sim_fixture(p_fix bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare fx record; H jsonb; A jsonb; P jsonb; minute int; ph numeric; side text; atk jsonb; dfn jsonb; ratio numeric;
  shp numeric; sh jsonb; gp numeric; vh int := 0; va int := 0; ev jsonb := '[]'; ast jsonb;
  posh int := 0; sh_h int := 0; sh_a int := 0; on_h int := 0; on_a int := 0; maxm int; friendly boolean;
  slH text[]; slA text[]; sl text[]; luH int[]; luA int[]; lu int[]; usedH int[]; usedA int[]; used int[];
  subsH int := 0; subsA int := 0; subs int; missH int := 0; missA int := 0; miss int;
  subMinH int; subMinA int; injMinH int; injMinA int; smin int; imin int;
  reds int[] := '{}'; yel int[] := '{}'; injured int[] := '{}'; direct_red int[] := '{}';
  pin jsonb := '{}'; effm jsonb := '{}'; k int; sd text; tid uuid; pid int; nin int; i int; chg boolean;
  mH numeric; mA numeric; aH jsonb; aA jsonb;
  rt jsonb := '{}'; r numeric; motm int; best numeric := -1; info jsonb; kv record; mins int; gf int; ga int;
  ng int; na int; svs int; s jsonb; pl text;
begin
  select * into fx from public.fixtures where id = p_fix;
  friendly := fx.comp = 'friendly';
  H := public._team_power(fx.home); A := public._team_power(fx.away);
  slH := public._slots(H->>'formation'); slA := public._slots(A->>'formation');
  select array_agg(x::int) into luH from jsonb_array_elements_text(H->'lineup') x;
  select array_agg(x::int) into luA from jsonb_array_elements_text(A->'lineup') x;
  usedH := luH; usedA := luA; aH := to_jsonb(luH); aA := to_jsonb(luA);
  for info in select x from jsonb_array_elements(H->'players') x loop
    pin := pin || jsonb_build_object(info->>'id', jsonb_build_object('s','h','in',0,'out',90,'g',info->>'g'));
    effm := effm || jsonb_build_object(info->>'id', info->'e');
  end loop;
  for info in select x from jsonb_array_elements(A->'players') x loop
    pin := pin || jsonb_build_object(info->>'id', jsonb_build_object('s','a','in',0,'out',90,'g',info->>'g'));
    effm := effm || jsonb_build_object(info->>'id', info->'e');
  end loop;
  subMinH := 58 + floor(random() * 18)::int; subMinA := 58 + floor(random() * 18)::int;
  injMinH := case when not friendly and random() < 0.08 then 1 + floor(random() * 88)::int end;
  injMinA := case when not friendly and random() < 0.08 then 1 + floor(random() * 88)::int end;
  maxm := 90 + floor(random() * 5)::int;

  for minute in 1..maxm loop
    -- sakatlık ve oyuncu değişiklikleri
    for k in 1..2 loop
      if k = 1 then sd := 'h'; tid := fx.home; lu := luH; used := usedH; subs := subsH; miss := missH; smin := subMinH; imin := injMinH; sl := slH; P := H;
      else sd := 'a'; tid := fx.away; lu := luA; used := usedA; subs := subsA; miss := missA; smin := subMinA; imin := injMinA; sl := slA; P := A; end if;
      chg := false;
      if minute = imin then
        select x into pid from unnest(lu) x where x <> (P->>'gkid')::int and not (x = any(reds)) and not (x = any(injured)) order by random() limit 1;
        if pid is not null then
          injured := injured || pid;
          ev := ev || jsonb_build_array(jsonb_build_object('m', minute, 't', 'injury', 's', sd, 'p', pid));
          i := array_position(lu, pid);
          nin := case when subs < 3 then public._bench_pick(tid, sl[i], used) end;
          if nin is not null then
            lu[i] := nin; used := used || nin; subs := subs + 1; chg := true;
            pin := jsonb_set(pin, array[pid::text, 'out'], to_jsonb(minute));
            pin := pin || jsonb_build_object(nin::text, jsonb_build_object('s', sd, 'in', minute, 'out', 90, 'g', sl[i]));
            ev := ev || jsonb_build_array(jsonb_build_object('m', minute, 't', 'sub', 's', sd, 'p', pid, 'a', nin));
          else miss := miss + 1; end if;
        end if;
      end if;
      if minute = smin and subs < 3 then
        for pid in select (x->>'id')::int from jsonb_array_elements(P->'players') x
                    where x->>'g' <> 'GK' and (x->>'id')::int = any(lu) and not ((x->>'id')::int = any(reds))
                    order by (x->>'fit')::int, random() limit least(3 - subs, 2 + (random() < 0.5)::int) loop
          i := array_position(lu, pid);
          nin := public._bench_pick(tid, sl[i], used);
          exit when nin is null;
          lu[i] := nin; used := used || nin; subs := subs + 1; chg := true;
          pin := jsonb_set(pin, array[pid::text, 'out'], to_jsonb(minute));
          pin := pin || jsonb_build_object(nin::text, jsonb_build_object('s', sd, 'in', minute, 'out', 90, 'g', sl[i]));
          ev := ev || jsonb_build_array(jsonb_build_object('m', minute, 't', 'sub', 's', sd, 'p', pid, 'a', nin));
        end loop;
      end if;
      if chg then
        P := public._power(tid, lu);
        for info in select x from jsonb_array_elements(P->'players') x loop effm := effm || jsonb_build_object(info->>'id', info->'e'); end loop;
      end if;
      -- kırmızı kart görenler ve yerine giremeyen sakatlar şut atamaz
      if chg or minute = 1 or cardinality(reds) + cardinality(injured) > 0 then
        P := jsonb_set(P, '{shooters}', coalesce((select jsonb_agg(x) from jsonb_array_elements(P->'shooters') x
               where (x->>'id')::int = any(lu) and not ((x->>'id')::int = any(reds)) and not ((x->>'id')::int = any(injured))), '[]'));
      end if;
      if k = 1 then luH := lu; usedH := used; subsH := subs; missH := miss; H := P; else luA := lu; usedA := used; subsA := subs; missA := miss; A := P; end if;
    end loop;

    -- eksik oyuncu (kırmızı / değiştirilemeyen sakat) başına %10 güç kaybı
    mH := power(0.9, missH); mA := power(0.9, missA);
    ph := ((H->>'mid')::numeric * mH) ^ 2 / (((H->>'mid')::numeric * mH) ^ 2 + ((A->>'mid')::numeric * mA) ^ 2) + 0.03;
    if random() < ph then side := 'h'; atk := H; dfn := A; posh := posh + 1;
      ratio := ((H->>'att')::numeric * 0.6 + (H->>'mid')::numeric * 0.4) * mH / ((A->>'def')::numeric * mA);
    else side := 'a'; atk := A; dfn := H;
      ratio := ((A->>'att')::numeric * 0.6 + (A->>'mid')::numeric * 0.4) * mA / ((H->>'def')::numeric * mH);
    end if;
    shp := 0.22 * ratio ^ 5;
    if random() < shp and jsonb_array_length(atk->'shooters') > 0 then
      sh := public._pick_shooter(atk->'shooters');
      if side = 'h' then sh_h := sh_h + 1; else sh_a := sh_a + 1; end if;
      if random() < 0.45 then
        if side = 'h' then on_h := on_h + 1; else on_a := on_a + 1; end if;
        gp := 0.33 * ((sh->>'q')::numeric / greatest((dfn->>'gk')::numeric, 20)) ^ 3;
        if random() < gp then
          ast := case when random() < 0.7 then public._pick_shooter(atk->'shooters') else null end;
          if ast is not null and ast->>'id' = sh->>'id' then ast := null; end if;
          ev := ev || jsonb_build_array(jsonb_build_object('m', least(minute, 90), 't','goal','s',side,'p',(sh->>'id')::int,'a',(ast->>'id')::int));
          if side = 'h' then vh := vh + 1; else va := va + 1; end if;
        else
          ev := ev || jsonb_build_array(jsonb_build_object('m', least(minute, 90), 't','save','s',side,'p',(sh->>'id')::int,'k',(dfn->>'gkid')::int));
        end if;
      else
        ev := ev || jsonb_build_array(jsonb_build_object('m', least(minute, 90), 't','miss','s',side,'p',(sh->>'id')::int));
      end if;
    elsif random() < 0.0125 and jsonb_array_length(dfn->'shooters') > 0 then
      -- savunan takımdan kart
      sh := public._pick_shooter(dfn->'shooters');
      pid := (sh->>'id')::int;
      sd := case side when 'h' then 'a' else 'h' end;
      if pid = any(yel) or random() < 0.05 then
        if not (pid = any(yel)) then direct_red := direct_red || pid; end if;
        reds := reds || pid;
        ev := ev || jsonb_build_array(jsonb_build_object('m', least(minute, 90), 't', 'red', 's', sd, 'p', pid));
        if sd = 'h' then missH := missH + 1; else missA := missA + 1; end if;
      else
        yel := yel || pid;
        ev := ev || jsonb_build_array(jsonb_build_object('m', least(minute, 90), 't', 'yellow', 's', sd, 'p', pid));
      end if;
    end if;
  end loop;

  -- oyuncu puanları
  for kv in select key, value from jsonb_each(pin) loop
    pid := kv.key::int; info := kv.value;
    mins := least(90, (info->>'out')::int) - (info->>'in')::int;
    if mins <= 0 then continue; end if;
    if info->>'s' = 'h' then gf := vh; ga := va; else gf := va; ga := vh; end if;
    select count(*) filter (where e->>'t' = 'goal' and (e->>'p')::int = pid),
           count(*) filter (where e->>'t' = 'goal' and (e->>'a')::int = pid),
           count(*) filter (where e->>'t' = 'save' and (e->>'k')::int = pid)
      into ng, na, svs from jsonb_array_elements(ev) e;
    r := 6.0 + case when gf > ga then 0.4 when gf < ga then -0.4 else 0 end
         + ng * 1.0 + na * 0.6 + (random() - 0.5) * 0.8 + (coalesce((effm->>pid::text)::numeric, 70) - 72) / 40.0;
    if info->>'g' = 'GK' then r := r + svs * 0.25 - ga * 0.35 + case when ga = 0 then 0.6 else 0 end;
    elsif info->>'g' = 'DEF' then r := r + case when ga = 0 then 0.5 else -0.15 * ga end; end if;
    if pid = any(reds) then r := r - 1.5; elsif pid = any(yel) then r := r - 0.2; end if;
    if pid = any(injured) then r := r - 0.3; end if;
    if mins < 30 then r := 6.0 + (r - 6.0) * 0.5; end if;
    r := round(least(10, greatest(3, r)), 1);
    rt := rt || jsonb_build_object(pid::text, r);
    if r > best then best := r; motm := pid; end if;
  end loop;

  update public.fixtures set hg = vh, ag = va, played = true, events = ev,
    stats = jsonb_build_object('poss', jsonb_build_array(round(posh * 100.0 / maxm), 100 - round(posh * 100.0 / maxm)),
      'shots', jsonb_build_array(sh_h, sh_a), 'on', jsonb_build_array(on_h, on_a),
      'lh', aH, 'la', aA, 'fh', H->>'formation', 'fa', A->>'formation', 'rt', rt, 'motm', motm,
      'end_h', to_jsonb(luH), 'end_a', to_jsonb(luA))
   where id = p_fix;

  if friendly then return; end if;

  -- maç sonrası: ceza sayacı, kondisyon, form, değer, kartlar, sakatlıklar
  update public.squads set ban = ban - 1
   where team_id in (fx.home, fx.away) and ban > 0 and not (player_id = any(usedH || usedA));
  for kv in select key, value from jsonb_each(pin) loop
    pid := kv.key::int; info := kv.value;
    mins := least(90, (info->>'out')::int) - (info->>'in')::int;
    if mins <= 0 or (rt->>pid::text) is null then continue; end if;
    r := (rt->>pid::text)::numeric;
    update public.squads q
       set fitness = greatest(20, q.fitness - round(case when info->>'g' = 'GK' then 6 else 18 + (100 - p.phy) * 0.12 end * mins / 90.0)::int),
           form = round(q.form * 0.7 + r * 0.3, 1),
           value = greatest(100000, round(q.value * (1 + (r - 6.5) * 0.01)))::bigint
      from public.real_players p
     where p.id = q.player_id and q.game_id = fx.game_id and q.player_id = pid
       and q.team_id = case info->>'s' when 'h' then fx.home else fx.away end;
  end loop;
  -- sarı kart birikimi: 5 sarı = 1 maç ceza
  update public.squads set yellows = yellows + 1 where game_id = fx.game_id and player_id = any(yel) and not (player_id = any(reds));
  for pid in select player_id from public.squads where game_id = fx.game_id and player_id = any(yel) and yellows >= 5 loop
    update public.squads set yellows = yellows - 5, ban = ban + 1 where game_id = fx.game_id and player_id = pid;
    select name into pl from public.real_players where id = pid;
    perform public._news(fx.game_id, (select team_id from public.squads where game_id = fx.game_id and player_id = pid), 'info', pl || ' 5. sarı kartını gördü: 1 maç ceza');
  end loop;
  -- kırmızı: çift sarı 1 maç, direkt kırmızı 2 maç
  for pid in select unnest(reds) loop
    update public.squads set ban = ban + case when pid = any(direct_red) then 2 else 1 end where game_id = fx.game_id and player_id = pid;
    select name into pl from public.real_players where id = pid;
    perform public._news(fx.game_id, (select team_id from public.squads where game_id = fx.game_id and player_id = pid), 'info',
      pl || ' kırmızı kart gördü: ' || case when pid = any(direct_red) then 2 else 1 end || ' maç ceza');
  end loop;
  -- sakatlık: 1-4 hafta
  for pid in select unnest(injured) loop
    update public.squads set injury = 1 + floor(random() * 4)::int where game_id = fx.game_id and player_id = pid returning injury into i;
    select name into pl from public.real_players where id = pid;
    perform public._news(fx.game_id, (select team_id from public.squads where game_id = fx.game_id and player_id = pid), 'info',
      '🚑 ' || pl || ' sakatlandı: ' || i || ' hafta yok');
  end loop;
end $$;

-- tek maçı oynat + primler + iç saha bilet geliri (hazırlık maçında hiçbiri yok)
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
    when f.hg = f.ag then (s->>'draw_bonus')::bigint else (s->>'loss_bonus')::bigint end
    + ((s->>'ticket_income')::numeric * case when f.comp = 'cup' then 1.5 else 1 end)::bigint where id = f.home;
  update public.teams set budget = budget + case when f.ag > f.hg then (s->>'win_bonus')::bigint
    when f.hg = f.ag then (s->>'draw_bonus')::bigint else (s->>'loss_bonus')::bigint end where id = f.away;
end $$;

-- ---------- istatistik ----------
create or replace function public.player_stats(p_game uuid)
returns table (player_id int, team_id uuid, apps int, goals int, assists int, yellows int, reds int, rating numeric, motm int)
language sql stable security invoker set search_path = '' as $$
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
  order by coalesce(g.n, 0) desc, a.rating desc $$;

-- ---------- hafta sonu: dinlenme, sakatlık sayacı, maaş, YZ teklifleri, sezon sonu ödülleri + geçmiş ----------
create or replace function public._after_round(p_game uuid, p_round int) returns void
language plpgsql security definer set search_path = '' as $$
declare g record; s jsonb; lt record; t record; sp record; club text; amt bigint; n int; i int; champ uuid; fin record;
  top record; bst record;
begin
  select * into g from public.games where id = p_game for update;
  if g.status <> 'active' or p_round <= g.current_round then return; end if;
  if exists (select 1 from public.fixtures where game_id = p_game and round = p_round and comp <> 'friendly' and not played) then return; end if;
  s := public._default_settings() || g.settings;
  update public.games set current_round = p_round where id = p_game;
  update public.teams set ready_round = 0 where game_id = p_game;
  -- dinlenme ve sakatlık iyileşmesi
  update public.squads set fitness = least(100, fitness + 15), injury = greatest(0, injury - 1) where game_id = p_game;
  -- haftalık maaşlar
  for t in select tm.id, tm.is_bot, round(sum(q.value) * (s->>'wage_pct')::numeric)::bigint w
             from public.teams tm join public.squads q on q.team_id = tm.id where tm.game_id = p_game group by tm.id, tm.is_bot loop
    update public.teams set budget = budget - t.w where id = t.id;
    if not t.is_bot then perform public._news(p_game, t.id, 'info', 'Haftalık maaşlar ödendi: ' || public._money(t.w)); end if;
  end loop;
  perform public._resolve_cup(p_game);
  perform public._news(p_game, null, 'round', p_round || '. hafta tamamlandı');
  -- sezon bitti mi?
  if not exists (select 1 from public.fixtures where game_id = p_game and not played and comp <> 'friendly') then
    update public.games set status = 'finished' where id = p_game;
    n := (select count(*) from public.teams where game_id = p_game);
    if s->>'format' in ('league','league_cup') then
      i := 0;
      for lt in select * from public.standings(p_game) loop
        i := i + 1;
        update public.teams set budget = budget + (n - i + 1) * (s->>'season_prize')::bigint where id = lt.team_id;
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
    select x.*, p.name into top from public.player_stats(p_game) x join public.real_players p on p.id = x.player_id order by x.goals desc, x.rating desc limit 1;
    select x.*, p.name into bst from public.player_stats(p_game) x join public.real_players p on p.id = x.player_id
     where x.apps >= greatest(1, p_round / 3) order by x.rating desc limit 1;
    update public.games set history = history || jsonb_build_array(jsonb_build_object(
      'season', g.season,
      'league', case when champ is not null then jsonb_build_object('id', champ, 'name', (select name from public.teams where id = champ)) end,
      'cup', case when g.cup ? 'champion' then jsonb_build_object('id', g.cup->>'champion', 'name', (select name from public.teams where id = (g.cup->>'champion')::uuid)) end,
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

-- ---------- fikstür + ilk gün (başlangıç ve yeni sezon ortak) ----------
create or replace function public._set_first_day(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s jsonb; mode text; local_now timestamp; fd date;
begin
  s := public._settings(p_game);
  mode := coalesce(s->>'first_day_mode', case when s->>'first_day' in ('today','tomorrow') then s->>'first_day' else 'tomorrow' end);
  local_now := now() at time zone (s->>'tz');
  fd := case when mode = 'today' and local_now::time < (s->>'kickoff')::time - interval '2 minutes' then local_now::date else local_now::date + 1 end;
  update public.games set settings = s || jsonb_build_object('first_day', fd::text, 'first_day_mode', mode) where id = p_game;
end $$;

create or replace function public._new_fixtures(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s jsonb; cnt int; lr int := 0; gap int;
begin
  s := public._settings(p_game);
  select count(*) into cnt from public.teams where game_id = p_game;
  update public.games set cup = null where id = p_game;
  if s->>'format' in ('league','league_cup') then lr := public._gen_league(p_game, (s->>'legs')::int); end if;
  if s->>'format' in ('cup','league_cup') then
    gap := greatest(1, lr / greatest(1, ceil(log(2.0, cnt::numeric))::int * (s->>'cup_legs')::int));
    update public.games set cup = jsonb_build_object('round', 1,
      'alive', (select jsonb_agg(id) from public.teams where game_id = p_game), 'gap', gap)
     where id = p_game;
    perform public._gen_cup_round(p_game, case when lr > 0 then gap else 1 end);
  end if;
  perform public._schedule(p_game);
end $$;

create or replace function public.start_game(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare g record; s jsonb; t record; tiers text[] := '{}'; poss text[]; k text; i int; n int;
  ngk int; ndef int; nmid int; nfwd int; lo int; hi int; pid int; lgs text[]; cnt int; mid_t text;
  nb int; bnames text[] := array['Atlas FK','Demir Kartallar','Yıldız SK','Liman Spor','Rüzgar FK','Kuzey United','Güney Atletik',
    'Ova Gücü','Dağ Kurtları','Sahil FK','Çınar SK','Boğaz Spor','Kale FK','Bozkır Atletik','Nehir United','Fırtına SK',
    'Zirve FK','Ada Spor','Vadi FK','Kanyon SK'];
  cols text[] := array['#c62828','#1565c0','#212121','#f9a825','#6a1b9a','#ef6c00','#00838f','#ad1457','#4e342e','#37474f'];
  bn text;
begin
  select * into g from public.games where id = p_game for update;
  if g.owner <> auth.uid() then raise exception 'Sadece oda sahibi başlatabilir'; end if;
  if g.status <> 'lobby' then raise exception 'Oyun zaten başladı'; end if;
  s := public._default_settings() || g.settings;
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
  update public.games set settings = s where id = p_game;
  perform public._set_first_day(p_game);
  s := public._settings(p_game);

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
  update public.games set status = 'active', current_round = 0 where id = p_game;
  perform public._new_fixtures(p_game);
  perform public._news(p_game, null, 'start', 'Sezon başladı! Kadrolar dağıtıldı'
    || case when public._window_open(p_game) then ', transfer dönemi açık.' else '.' end
    || coalesce(' İlk maç: ' || to_char((select min(kickoff_at) from public.fixtures where game_id = p_game) at time zone (s->>'tz'), 'DD.MM HH24:MI'), ''));
end $$;

-- ---------- yeni sezon ----------
create or replace function public.new_season(p_game uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g record; s jsonb; q record; age int; ch int; t record; pid int; lgs text[]; ret int := 0; lst text := '';
begin
  select * into g from public.games where id = p_game for update;
  if g.owner is distinct from auth.uid() then return jsonb_build_object('ok', false, 'msg', 'Sadece oda sahibi yeni sezonu başlatabilir'); end if;
  if g.status <> 'finished' then return jsonb_build_object('ok', false, 'msg', 'Sezon henüz bitmedi'); end if;
  s := public._settings(p_game);
  select array_agg(x) into lgs from jsonb_array_elements_text(s->'leagues') x;
  update public.games set season = season + 1, status = 'active', current_round = 0 where id = p_game;
  delete from public.fixtures where game_id = p_game;
  update public.offers set status = 'cancelled', note = 'Sezon bitti' where game_id = p_game and status = 'active';
  -- yaşlanma + gelişim (yeni sezondaki yaşa göre)
  for q in select sq.player_id, sq.team_id, sq.ovr_delta, sq.value, p.ovr, p.pot, p.age, p.name
             from public.squads sq join public.real_players p on p.id = sq.player_id where sq.game_id = p_game loop
    age := q.age + g.season;   -- g.season eski sezon; yeni sezonda yaş +1
    ch := case when age <= 21 then 1 + floor(random() * 4)::int
               when age <= 25 then floor(random() * 3)::int
               when age <= 29 then floor(random() * 3)::int - 1
               when age <= 32 then -floor(random() * 3)::int
               else -1 - floor(random() * 4)::int end;
    if ch > 0 then ch := least(ch, greatest(0, q.pot - (q.ovr + q.ovr_delta))); end if;
    if q.ovr + q.ovr_delta + ch < 40 then ch := 40 - q.ovr - q.ovr_delta; end if;
    -- emeklilik
    if age >= 38 or (age >= 35 and random() < (age - 33) * 0.2) then
      delete from public.squads where game_id = p_game and player_id = q.player_id;
      ret := ret + 1; lst := lst || case when lst = '' then '' else ', ' end || q.name;
      -- yerine altyapıdan genç oyuncu
      select p.id into pid from public.real_players p where p.lg = any(lgs) and p.age <= 20 and p.ovr between 60 and 70
         and not exists (select 1 from public.squads x where x.game_id = p_game and x.player_id = p.id) order by random() limit 1;
      if pid is not null then
        insert into public.squads (game_id, player_id, team_id, value) select p_game, p.id, q.team_id, p.val from public.real_players p where p.id = pid;
      end if;
      continue;
    end if;
    update public.squads set ovr_delta = ovr_delta + ch,
      value = greatest(100000, round(value * (1 + 0.08 * ch) * case when age >= 33 then 0.85 else 1 end))::bigint
     where game_id = p_game and player_id = q.player_id;
  end loop;
  update public.squads set fitness = 100, injury = 0, ban = 0, yellows = 0, form = 6.5 where game_id = p_game;
  update public.teams set ready_round = 0, lineup = public._fix_lineup(id) where game_id = p_game;
  perform public._set_first_day(p_game);
  perform public._new_fixtures(p_game);
  perform public._news(p_game, null, 'start', (g.season + 1) || '. sezon başladı! Oyuncular bir yaş büyüdü.'
    || case when ret > 0 then ' Emekli olanlar: ' || lst || ' (yerlerine altyapıdan genç oyuncu geldi).' else '' end
    || coalesce(' İlk maç: ' || to_char((select min(kickoff_at) from public.fixtures where game_id = p_game) at time zone (s->>'tz'), 'DD.MM HH24:MI'), ''));
  return jsonb_build_object('ok', true, 'msg', (g.season + 1) || '. sezon başladı', 'retired', ret);
end $$;

-- ---------- yetkiler ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.create_game, public.update_settings, public.join_game, public.leave_game,
  public.delete_game, public.start_game, public.set_tactics, public.place_bid, public.respond_offer,
  public.cancel_offer, public.sell_to_ai, public.play_next_round, public.standings, public.resolve_transfers,
  public.is_member, public.set_ready, public.friendly_match, public.transfer_ownership, public.kick_team,
  public.new_season, public.player_stats
  to authenticated;
