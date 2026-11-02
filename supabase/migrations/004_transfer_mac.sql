-- MENAJER ONLINE: transferler (yapay zeka teklif değerlendirme + açık artırma) ve maç motoru

-- ---------- 003 düzeltmeleri ----------
-- text[] || 'DEF' 'malformed array literal' hatası veriyordu: eleman açıkça text'e çevrildi
create or replace function public._slots(p_form text) returns text[] language plpgsql immutable set search_path = '' as $$
declare parts int[] := string_to_array(p_form, '-')::int[]; r text[] := array['GK']; i int; k int;
begin
  for i in 1..parts[1] loop r := r || 'DEF'::text; end loop;
  for k in 2..array_length(parts,1)-1 loop for i in 1..parts[k] loop r := r || 'MID'::text; end loop; end loop;
  for i in 1..parts[array_length(parts,1)] loop r := r || 'FWD'::text; end loop;
  return r;
end $$;

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
    for i in 1..ndef loop poss := poss || 'DEF'::text; end loop;
    for i in 1..nmid loop poss := poss || 'MID'::text; end loop;
    for i in 1..nfwd loop poss := poss || 'FWD'::text; end loop;
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


-- ---------- transfer ----------
-- açık artırması biten / süresi dolan teklifleri sonuçlandır (pg_cron her dakika + istemci de çağırabilir)
create or replace function public.resolve_transfers() returns int
language plpgsql security definer set search_path = '' as $$
declare a record; o record; done int := 0; won boolean; sz int; mx int;
begin
  -- oyuncudan oyuncuya tekliflerin süresi doldu
  update public.offers set status = 'rejected', note = 'Süre doldu, cevap verilmedi'
   where status = 'active' and seller is not null and expires_at <= now();
  -- yapay zeka kulübü açık artırmaları
  for a in select distinct game_id, player_id from public.offers
            where status = 'active' and seller is null and expires_at <= now() loop
    won := false;
    for o in select * from public.offers where game_id = a.game_id and player_id = a.player_id
              and status = 'active' and seller is null order by amount desc, created_at loop
      select (g.settings->>'max_squad')::int into mx from public.games g where g.id = o.game_id;
      select count(*) into sz from public.squads where team_id = o.bidder;
      if not won and (select budget from public.teams where id = o.bidder) >= o.amount and sz < mx
         and not exists (select 1 from public.squads where game_id = o.game_id and player_id = o.player_id) then
        insert into public.squads (game_id, player_id, team_id, value, bought_for)
          select o.game_id, p.id, o.bidder, p.val, o.amount from public.real_players p where p.id = o.player_id;
        update public.teams set budget = budget - o.amount where id = o.bidder;
        update public.offers set status = 'won', note = 'Transfer tamamlandı' where id = o.id;
        perform public._news(o.game_id, null, 'transfer',
          (select name from public.real_players where id = o.player_id) || ' → ' ||
          (select name from public.teams where id = o.bidder) || ' (' || public._money(o.amount) || ')');
        won := true; done := done + 1;
      else
        update public.offers set status = case when won then 'lost' else 'cancelled' end,
          note = case when won then 'Açık artırmayı kaybettin' else 'Bütçe/kadro yetersiz, teklif iptal' end
         where id = o.id;
      end if;
    end loop;
  end loop;
  return done;
end $$;

-- teklif ver. dönen jsonb: {ok, msg, ask?}
create or replace function public.place_bid(p_game uuid, p_player int, p_amount bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g record; me uuid := public._my_team(p_game); my record; pl record; own record; ask bigint;
  reserved bigint; top record; mins int; existing record; v_note text;
begin
  -- aynı oyuncuya eşzamanlı teklifler sırayla işlensin
  perform pg_advisory_xact_lock(hashtext(p_game::text || ':' || p_player::text));
  perform public.resolve_transfers();
  select * into g from public.games where id = p_game;
  if me is null then return jsonb_build_object('ok',false,'msg','Bu odada takımın yok'); end if;
  if g.status <> 'active' then return jsonb_build_object('ok',false,'msg','Transfer dönemi kapalı'); end if;
  select * into my from public.teams where id = me for update;
  select * into pl from public.real_players where id = p_player;
  if pl.id is null then return jsonb_build_object('ok',false,'msg','Oyuncu bulunamadı'); end if;
  select * into own from public.squads where game_id = p_game and player_id = p_player;
  if own.team_id = me then return jsonb_build_object('ok',false,'msg','Bu oyuncu zaten senin'); end if;
  if (select count(*) from public.squads where team_id = me) >= (g.settings->>'max_squad')::int then
    return jsonb_build_object('ok',false,'msg','Kadron dolu (en fazla ' || (g.settings->>'max_squad') || ' oyuncu)'); end if;
  select coalesce(sum(amount),0) into reserved from public.offers
   where bidder = me and status = 'active' and player_id <> p_player;
  if my.budget - reserved < p_amount then
    return jsonb_build_object('ok',false,'msg','Bütçen yetmiyor. Kullanılabilir: ' || public._money(my.budget - reserved)); end if;

  if own.team_id is not null then
    -- başka bir menajerin oyuncusu: değerinin altına teklif yapılamaz, karar sahibinde
    if p_amount < own.value then
      return jsonb_build_object('ok',false,'ask',own.value,'msg',
        'Yapay zeka: ' || pl.name || ' için değerinin (' || public._money(own.value) || ') altında teklif kabul edilmez.'); end if;
    v_note := case when p_amount >= own.value * 1.5 then 'Değerinin çok üstünde bir teklif!'
                 when p_amount >= own.value * 1.2 then 'Cazip bir teklif.' else 'Değerine yakın bir teklif.' end;
    select * into existing from public.offers where bidder = me and player_id = p_player and game_id = p_game and status = 'active';
    if existing.id is not null then
      if p_amount <= existing.amount then return jsonb_build_object('ok',false,'msg','Yeni teklif öncekinden yüksek olmalı'); end if;
      update public.offers set amount = p_amount, note = v_note, expires_at = now() + make_interval(hours => (g.settings->>'offer_hours')::int)
       where id = existing.id;
    else
      insert into public.offers (game_id, player_id, bidder, seller, amount, note, expires_at)
      values (p_game, p_player, me, own.team_id, p_amount, v_note, now() + make_interval(hours => (g.settings->>'offer_hours')::int));
    end if;
    perform public._news(p_game, own.team_id, 'offer', my.name || ', ' || pl.name || ' için ' || public._money(p_amount) || ' teklif etti. ' || v_note);
    -- rakip teklif sahiplerine haber (transfer kapışması)
    insert into public.news (game_id, team_id, kind, text)
      select p_game, o.bidder, 'rival', 'Rakip teklif: ' || my.name || ', ' || pl.name || ' için ' || public._money(p_amount) || ' önerdi'
      from public.offers o where o.game_id = p_game and o.player_id = p_player and o.status = 'active' and o.bidder <> me;
    return jsonb_build_object('ok',true,'msg','Teklif ' || (select name from public.teams where id = own.team_id) || ' menajerine iletildi. ' || v_note);
  end if;

  -- yapay zeka kulübünün oyuncusu: istenen fiyatın altına satmaz, üstündeyse açık artırma başlar
  ask := public._ai_ask(p_game, p_player);
  select * into top from public.offers where game_id = p_game and player_id = p_player and status = 'active'
    and seller is null order by amount desc limit 1;
  if top.id is null then
    if p_amount < ask then
      return jsonb_build_object('ok',false,'ask',ask,'msg', pl.club || ' teklifi reddetti. Karşı teklif: en az ' || public._money(ask)
        || case when p_amount >= ask * 0.9 then ' (çok yaklaştın!)' else '' end); end if;
    mins := (g.settings->>'bid_minutes')::int;
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
   where game_id = p_game and player_id = p_player and status = 'active' and bidder <> me;
  delete from public.offers where game_id = p_game and player_id = p_player and status = 'active' and bidder = me;
  insert into public.offers (game_id, player_id, bidder, amount, note, expires_at)
    values (p_game, p_player, me, p_amount, 'En yüksek teklif sende', greatest(top.expires_at, now() + interval '1 minute'));
  perform public._news(p_game, top.bidder, 'outbid', my.name || ', ' || pl.name || ' için teklifini geçti: ' || public._money(p_amount) || '! Karşılık vermek için acele et.');
  perform public._news(p_game, null, 'auction', 'Transfer kapışması! ' || pl.name || ' için ' || my.name || ' ' || public._money(p_amount) || ' verdi');
  return jsonb_build_object('ok',true,'msg','En yüksek teklif artık sende!');
end $$;

-- satıcı menajer teklife cevap verir
create or replace function public.respond_offer(p_offer bigint, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o record; g record; pl record;
begin
  select * into o from public.offers where id = p_offer for update;
  if o.id is null or o.status <> 'active' or o.seller is null then return jsonb_build_object('ok',false,'msg','Teklif geçerli değil'); end if;
  if (select owner from public.teams where id = o.seller) <> auth.uid() then return jsonb_build_object('ok',false,'msg','Bu teklif sana değil'); end if;
  select * into g from public.games where id = o.game_id;
  select * into pl from public.real_players where id = o.player_id;
  if not p_accept then
    update public.offers set status = 'rejected', note = 'Menajer reddetti' where id = o.id;
    perform public._news(o.game_id, o.bidder, 'offer', pl.name || ' için teklifin reddedildi');
    return jsonb_build_object('ok',true,'msg','Teklif reddedildi');
  end if;
  if not exists (select 1 from public.squads where game_id = o.game_id and player_id = o.player_id and team_id = o.seller) then
    update public.offers set status = 'cancelled', note = 'Oyuncu artık bu takımda değil' where id = o.id;
    return jsonb_build_object('ok',false,'msg','Oyuncu artık kadronda değil'); end if;
  if (select count(*) from public.squads where team_id = o.seller) <= (g.settings->>'min_squad')::int then
    return jsonb_build_object('ok',false,'msg','Kadron en az ' || (g.settings->>'min_squad') || ' oyuncu olmalı, satamazsın'); end if;
  if (select budget from public.teams where id = o.bidder) < o.amount then
    update public.offers set status = 'cancelled', note = 'Alıcının bütçesi yetmiyor' where id = o.id;
    return jsonb_build_object('ok',false,'msg','Alıcının bütçesi artık yetmiyor, teklif iptal edildi'); end if;
  if (select count(*) from public.squads where team_id = o.bidder) >= (g.settings->>'max_squad')::int then
    return jsonb_build_object('ok',false,'msg','Alıcının kadrosu dolu'); end if;
  update public.squads set team_id = o.bidder, bought_for = o.amount, joined_at = now()
   where game_id = o.game_id and player_id = o.player_id and team_id = o.seller;
  update public.teams set budget = budget - o.amount where id = o.bidder;
  update public.teams set budget = budget + o.amount, lineup = array_remove(lineup, o.player_id) where id = o.seller;
  update public.offers set status = 'accepted', note = 'Transfer tamamlandı' where id = o.id;
  update public.offers set status = 'lost', note = 'Oyuncu başka takıma satıldı'
   where game_id = o.game_id and player_id = o.player_id and status = 'active';
  perform public._news(o.game_id, null, 'transfer', pl.name || ': ' || (select name from public.teams where id = o.seller)
    || ' → ' || (select name from public.teams where id = o.bidder) || ' (' || public._money(o.amount) || ')');
  return jsonb_build_object('ok',true,'msg','Transfer tamamlandı');
end $$;

create or replace function public.cancel_offer(p_offer bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update public.offers o set status = 'cancelled', note = 'Teklif geri çekildi'
   where o.id = p_offer and o.status = 'active' and o.seller is not null
     and o.bidder in (select id from public.teams where owner = auth.uid());
  if not found then return jsonb_build_object('ok',false,'msg','Sadece menajerlere yaptığın aktif teklifleri geri çekebilirsin'); end if;
  return jsonb_build_object('ok',true,'msg','Teklif geri çekildi');
end $$;

-- oyuncuyu yapay zeka kulübüne sat (değerin %75'i, anında)
create or replace function public.sell_to_ai(p_game uuid, p_player int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := public._my_team(p_game); g record; q record; price bigint;
begin
  select * into g from public.games where id = p_game;
  if g.status <> 'active' then return jsonb_build_object('ok',false,'msg','Transfer dönemi kapalı'); end if;
  select * into q from public.squads where game_id = p_game and player_id = p_player and team_id = me;
  if q.player_id is null then return jsonb_build_object('ok',false,'msg','Bu oyuncu senin değil'); end if;
  if (select count(*) from public.squads where team_id = me) <= (g.settings->>'min_squad')::int then
    return jsonb_build_object('ok',false,'msg','Kadron en az ' || (g.settings->>'min_squad') || ' oyuncu olmalı'); end if;
  price := (q.value * (g.settings->>'ai_sell_ratio')::numeric)::bigint;
  delete from public.squads where game_id = p_game and player_id = p_player;
  update public.teams set budget = budget + price, lineup = array_remove(lineup, p_player) where id = me;
  update public.offers set status = 'cancelled', note = 'Oyuncu başka kulübe satıldı'
   where game_id = p_game and player_id = p_player and status = 'active';
  perform public._news(p_game, null, 'transfer', (select name from public.real_players where id = p_player)
    || ' yapay zeka kulübüne satıldı (' || public._money(price) || ')');
  return jsonb_build_object('ok',true,'msg','Satıldı: ' || public._money(price));
end $$;

-- ---------- maç motoru ----------
-- dakika dakika olasılıksal simülasyon. events: [{m,t,s,p,a}] t: goal|save|miss|yellow  s: h|a
-- stats: {poss:[h,a], shots:[h,a], on:[h,a], lh:[11 id], la:[11 id], fh, fa}
create or replace function public._team_power(p_team uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t record; slots text[]; lu int[]; i int; p record; eff numeric;
  d numeric := 0; m numeric := 0; f numeric := 0; gk numeric := 50; nd int := 0; nm int := 0; nf int := 0;
  shooters jsonb := '[]';
begin
  select * into t from public.teams where id = p_team;
  lu := t.lineup;
  if cardinality(lu) <> 11 or exists (select 1 from unnest(lu) x where not exists
      (select 1 from public.squads q where q.team_id = p_team and q.player_id = x)) then
    lu := public._auto_lineup(p_team);
  end if;
  slots := public._slots(t.formation);
  for i in 1..cardinality(lu) loop
    select * into p from public.real_players where id = lu[i];
    eff := case when p.grp = slots[i] then p.ovr
                when slots[i] = 'GK' or p.grp = 'GK' then p.ovr * 0.5
                else p.ovr * 0.85 end;
    case slots[i]
      when 'GK' then gk := eff;
      when 'DEF' then d := d + eff; nd := nd + 1;
      when 'MID' then m := m + eff; nm := nm + 1;
      else f := f + eff; nf := nf + 1;
    end case;
    if slots[i] <> 'GK' then
      shooters := shooters || jsonb_build_object('id', p.id, 'w',
        (case slots[i] when 'FWD' then 3.0 when 'MID' then 1.3 else 0.35 end) * (case when p.sho > 0 then p.sho else p.ovr end) / 70.0,
        'q', case when p.sho > 0 then (p.sho + p.ovr) / 2.0 else p.ovr end);
    end if;
  end loop;
  -- eksik oyuncu (kadro <11) cezası: 0'la ortalama alınır
  return jsonb_build_object(
    'def', (d + 40 * greatest(0, 4 - nd)) / greatest(nd, 4) * (1 - t.mentality * 0.03),
    'mid', (m + 40 * greatest(0, 3 - nm)) / greatest(nm, 3) * (0.9 + 0.033 * nm),
    'att', (f + 40 * greatest(0, 1 - nf)) / greatest(nf, 1) * (0.92 + 0.04 * nf) * (1 + t.mentality * 0.04),
    'gk', gk, 'lineup', to_jsonb(lu), 'formation', t.formation, 'shooters', shooters);
end $$;

create or replace function public._pick_shooter(p_sh jsonb) returns jsonb language plpgsql volatile set search_path = '' as $$
declare tot numeric := 0; x jsonb; r numeric;
begin
  for x in select * from jsonb_array_elements(p_sh) loop tot := tot + (x->>'w')::numeric; end loop;
  r := random() * tot;
  for x in select * from jsonb_array_elements(p_sh) loop
    r := r - (x->>'w')::numeric; if r <= 0 then return x; end if;
  end loop;
  return p_sh->0;
end $$;

create or replace function public._sim_fixture(p_fix bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare fx record; H jsonb; A jsonb; minute int; ph numeric; side text; atk jsonb; dfn jsonb; ratio numeric;
  shp numeric; sh jsonb; gp numeric; vh int := 0; va int := 0; ev jsonb := '[]'; ast jsonb;
  posh int := 0; sh_h int := 0; sh_a int := 0; on_h int := 0; on_a int := 0; maxm int;
begin
  select * into fx from public.fixtures where id = p_fix;
  H := public._team_power(fx.home); A := public._team_power(fx.away);
  maxm := 90 + floor(random() * 5)::int;
  for minute in 1..maxm loop
    ph := (H->>'mid')::numeric ^ 2 / ((H->>'mid')::numeric ^ 2 + (A->>'mid')::numeric ^ 2) + 0.03;
    if random() < ph then side := 'h'; atk := H; dfn := A; posh := posh + 1; else side := 'a'; atk := A; dfn := H; end if;
    ratio := ((atk->>'att')::numeric * 0.6 + (atk->>'mid')::numeric * 0.4) / (dfn->>'def')::numeric;
    shp := 0.22 * ratio ^ 5;
    if random() < shp then
      sh := public._pick_shooter(atk->'shooters');
      if side = 'h' then sh_h := sh_h + 1; else sh_a := sh_a + 1; end if;
      if random() < 0.45 then       -- isabetli şut
        if side = 'h' then on_h := on_h + 1; else on_a := on_a + 1; end if;
        gp := 0.30 * ((sh->>'q')::numeric / (dfn->>'gk')::numeric) ^ 3;
        if random() < gp then
          ast := case when random() < 0.7 then public._pick_shooter(atk->'shooters') else null end;
          if ast is not null and ast->>'id' = sh->>'id' then ast := null; end if;
          ev := ev || jsonb_build_object('m', least(minute, 90), 't','goal','s',side,'p',(sh->>'id')::int,'a',(ast->>'id')::int);
          if side = 'h' then vh := vh + 1; else va := va + 1; end if;
        else
          ev := ev || jsonb_build_object('m', least(minute, 90), 't','save','s',side,'p',(sh->>'id')::int);
        end if;
      else
        ev := ev || jsonb_build_object('m', least(minute, 90), 't','miss','s',side,'p',(sh->>'id')::int);
      end if;
    elsif random() < 0.012 then
      sh := public._pick_shooter(dfn->'shooters');
      ev := ev || jsonb_build_object('m', least(minute, 90), 't','yellow','s',case side when 'h' then 'a' else 'h' end,'p',(sh->>'id')::int);
    end if;
  end loop;
  update public.fixtures set hg = vh, ag = va, played = true, events = ev,
    stats = jsonb_build_object('poss', jsonb_build_array(round(posh * 100.0 / maxm), 100 - round(posh * 100.0 / maxm)),
      'shots', jsonb_build_array(sh_h, sh_a), 'on', jsonb_build_array(on_h, on_a),
      'lh', H->'lineup', 'la', A->'lineup', 'fh', H->>'formation', 'fa', A->>'formation')
   where id = p_fix;
end $$;

-- kupa eşleşmesi tamamlandıysa tur atlayanı belirle (eşitlikte penaltı)
create or replace function public._resolve_cup(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare g record; cr int; t record; h int; a int; w uuid; ph int; pa int; winners jsonb; nxt int; last record;
begin
  select * into g from public.games where id = p_game;
  if g.cup is null or g.cup ? 'champion' then return; end if;
  cr := (g.cup->>'round')::int;
  -- tüm ayakları oynanmış ve kazananı yazılmamış eşleşmeler
  for t in select tie, min(home::text)::uuid as x from public.fixtures
            where game_id = p_game and comp = 'cup' and cup_round = cr group by tie
           having bool_and(played) and bool_and(winner is null) loop
    select * into last from public.fixtures where game_id = p_game and comp = 'cup' and cup_round = cr and tie = t.tie
      order by leg desc limit 1;
    -- last.home/last.away: toplam skor last.home perspektifinden
    select coalesce(sum(case when home = last.home then hg else ag end),0),
           coalesce(sum(case when home = last.home then ag else hg end),0) into h, a
      from public.fixtures where game_id = p_game and comp = 'cup' and cup_round = cr and tie = t.tie;
    if h > a then w := last.home; elsif a > h then w := last.away;
    else
      ph := 3 + floor(random() * 3)::int; pa := 3 + floor(random() * 3)::int;
      if ph = pa then if random() < 0.5 then ph := ph + 1; else pa := pa + 1; end if; end if;
      w := case when ph > pa then last.home else last.away end;
      update public.fixtures set pens = ph || '-' || pa where id = last.id;
    end if;
    update public.fixtures set winner = w where id = last.id;
  end loop;
  -- tur bitti mi?
  if (select count(distinct tie) from public.fixtures where game_id = p_game and comp = 'cup' and cup_round = cr)
     <> (select count(*) from public.fixtures where game_id = p_game and comp = 'cup' and cup_round = cr and winner is not null) then
    return; end if;
  select coalesce(g.cup->'byes', '[]') || coalesce(jsonb_agg(winner), '[]') into winners
    from public.fixtures where game_id = p_game and comp = 'cup' and cup_round = cr and winner is not null;
  if jsonb_array_length(winners) = 1 then
    update public.games set cup = cup || jsonb_build_object('champion', winners->>0, 'alive', winners) where id = p_game;
    perform public._news(p_game, null, 'champion', '🏆 Kupa şampiyonu: ' || (select name from public.teams where id = (winners->>0)::uuid));
    return;
  end if;
  update public.games set cup = cup || jsonb_build_object('round', cr + 1, 'alive', winners) where id = p_game;
  nxt := g.current_round + case when g.settings->>'format' = 'league_cup' then (g.cup->>'gap')::int else 1 end;
  perform public._gen_cup_round(p_game, nxt);
end $$;

-- sonraki haftayı oynat (oda sahibi)
create or replace function public.play_next_round(p_game uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g record; r int; f0 record; f record; s jsonb; n int := 0; lt record;
begin
  select * into g from public.games where id = p_game for update;
  if g.owner <> auth.uid() then raise exception 'Sadece oda sahibi maçları oynatabilir'; end if;
  if g.status <> 'active' then raise exception 'Oyun aktif değil'; end if;
  perform public.resolve_transfers();
  s := g.settings;
  select min(round) into r from public.fixtures where game_id = p_game and not played;
  if r is null then raise exception 'Oynanacak maç yok'; end if;
  for f0 in select id from public.fixtures where game_id = p_game and round = r and not played loop
    perform public._sim_fixture(f0.id);
    select * into f from public.fixtures where id = f0.id;
    update public.teams set budget = budget + case when f.hg > f.ag then (s->>'win_bonus')::bigint
      when f.hg = f.ag then (s->>'draw_bonus')::bigint else (s->>'loss_bonus')::bigint end where id = f.home;
    update public.teams set budget = budget + case when f.ag > f.hg then (s->>'win_bonus')::bigint
      when f.hg = f.ag then (s->>'draw_bonus')::bigint else (s->>'loss_bonus')::bigint end where id = f.away;
    n := n + 1;
  end loop;
  update public.games set current_round = r where id = p_game;
  perform public._resolve_cup(p_game);
  perform public._news(p_game, null, 'round', r || '. hafta oynandı');
  -- sezon bitti mi?
  if not exists (select 1 from public.fixtures where game_id = p_game and not played) then
    update public.games set status = 'finished' where id = p_game;
    if s->>'format' in ('league','league_cup') then
      select * into lt from public.standings(p_game) limit 1;
      perform public._news(p_game, null, 'champion', '🏆 Lig şampiyonu: ' || lt.name);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'round', r, 'played', n);
end $$;

-- puan durumu
create or replace function public.standings(p_game uuid)
returns table (team_id uuid, name text, short text, color1 text, color2 text, o int, w int, d int, l int, gf int, ga int, gd int, pts int)
language sql stable security invoker set search_path = '' as $$
  with r as (
    select home t, hg f, ag a from public.fixtures where game_id = p_game and comp = 'league' and played
    union all select away, ag, hg from public.fixtures where game_id = p_game and comp = 'league' and played)
  select t.id, t.name, t.short, t.color1, t.color2,
    count(r.t)::int, count(*) filter (where r.f > r.a)::int, count(*) filter (where r.f = r.a)::int,
    count(*) filter (where r.f < r.a)::int, coalesce(sum(r.f),0)::int, coalesce(sum(r.a),0)::int,
    coalesce(sum(r.f - r.a),0)::int,
    (count(*) filter (where r.f > r.a) * 3 + count(*) filter (where r.f = r.a))::int
  from public.teams t left join r on r.t = t.id
  where t.game_id = p_game
  group by t.id order by 13 desc, 12 desc, 10 desc, t.name $$;

-- ---------- yetkiler ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.create_game, public.update_settings, public.join_game, public.leave_game,
  public.delete_game, public.start_game, public.set_tactics, public.place_bid, public.respond_offer,
  public.cancel_offer, public.sell_to_ai, public.play_next_round, public.standings, public.resolve_transfers,
  public.is_member
  to authenticated;

alter publication supabase_realtime add table public.teams, public.squads;

-- her dakika açık artırmaları sonuçlandır
create extension if not exists pg_cron;
select cron.schedule('resolve-transfers', '* * * * *', 'select public.resolve_transfers()');
