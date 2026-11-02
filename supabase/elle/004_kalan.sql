-- 004'ün elle çalıştırılacak kısmı (maç motoru Claude tarafından yüklendi).
-- Supabase SQL Editor'e TAMAMINI yapıştırıp Run de.

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
