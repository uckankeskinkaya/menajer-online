-- MENAJER ONLINE 020: moral, sözleşme, basın toplantısı (kolonlar + RPC'ler). SQL Editor'den çalıştır.
alter table public.squads add column if not exists morale int not null default 70;
alter table public.squads add column if not exists contract int not null default 3;
alter table public.teams add column if not exists press_fx bigint;
-- mevcut oyunculara 1-3 yıl rastgele sözleşme (0 = bu sezon sonu biter)
update public.squads set contract = 1 + floor(random() * 3)::int;

-- basın toplantısı: son resmi maçtan sonra bir cevap; tüm kadronun moralini etkiler, sözler haberlere düşer
create or replace function public.answer_press(p_game uuid, p_choice int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); tm record; fx record; gf int; ga int; res int; dl int; quote text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'msg', 'Giriş yapmalısın'); end if;
  if p_choice is null or p_choice not between 0 and 2 then return jsonb_build_object('ok', false, 'msg', 'Geçersiz cevap'); end if;
  select * into tm from public.teams where game_id = p_game and owner = uid;
  if not found then return jsonb_build_object('ok', false, 'msg', 'Bu odada takımın yok'); end if;
  select * into fx from public.fixtures where game_id = p_game and played and comp <> 'friendly' and (home = tm.id or away = tm.id)
   order by kickoff_at desc nulls last, round desc, id desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'msg', 'Henüz resmi maç oynanmadı'); end if;
  if tm.press_fx = fx.id then return jsonb_build_object('ok', false, 'msg', 'Bu maç için basın toplantısı zaten yapıldı'); end if;
  if fx.home = tm.id then gf := fx.hg; ga := fx.ag; else gf := fx.ag; ga := fx.hg; end if;
  res := case when gf > ga then 1 when gf = ga then 2 else 3 end;  -- 1 galibiyet, 2 beraberlik, 3 mağlubiyet
  dl := (array[[4, 1, -2], [2, -1, 1], [3, -4, 1]])[res][p_choice + 1];
  quote := (array[
    ['Oyuncularımla gurur duyuyorum.', 'Ayaklarımız yere basmalı, daha yolun başındayız.', 'Kazandık ama oyundan memnun değilim.'],
    ['Bir puan da değerli, oyuncularım mücadele etti.', 'İki puan kaybettik, bunu kabul edemem.', 'Hakem kararları sonucu etkiledi.'],
    ['Sorumluluk tamamen bende.', 'Oyuncularım beni hayal kırıklığına uğrattı.', 'Bu yenilgiden ders çıkaracağız, kafalar dik.']])[res][p_choice + 1];
  update public.squads set morale = least(100, greatest(5, morale + dl)) where team_id = tm.id;
  update public.teams set press_fx = fx.id where id = tm.id;
  perform public._news(p_game, null, 'info', '🎙️ ' || tm.name || ' menajeri: "' || quote || '"');
  return jsonb_build_object('ok', true, 'msg', 'Basın toplantısı yapıldı · takım morali ' || case when dl > 0 then '+' else '' end || dl, 'delta', dl);
end $$;

-- sözleşme uzatma: imza parası (yeni haftalık maaşın 6 katı) + maaş zammı; morali düşük oyuncu reddeder
create or replace function public.renew_contract(p_game uuid, p_player int, p_years int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); tm record; q record; g record; rp record; age int; nw bigint; bonus bigint; bill bigint;
begin
  if uid is null then return jsonb_build_object('ok', false, 'msg', 'Giriş yapmalısın'); end if;
  if p_years is null or p_years not between 1 and 4 then return jsonb_build_object('ok', false, 'msg', 'Sözleşme 1-4 yıl uzatılabilir'); end if;
  select * into tm from public.teams where game_id = p_game and owner = uid for update;
  if not found then return jsonb_build_object('ok', false, 'msg', 'Bu odada takımın yok'); end if;
  select * into q from public.squads where game_id = p_game and player_id = p_player and team_id = tm.id;
  if not found then return jsonb_build_object('ok', false, 'msg', 'Bu oyuncu senin takımında değil'); end if;
  select * into g from public.games where id = p_game;
  select * into rp from public.real_players where id = p_player;
  age := rp.age + coalesce(g.season, 1) - 1;
  if q.morale < 35 then return jsonb_build_object('ok', false, 'msg', rp.name || ' yeni sözleşme istemiyor (morali çok düşük)'); end if;
  if age >= 34 and p_years > 1 then return jsonb_build_object('ok', false, 'msg', '34 yaş ve üstü oyuncuya en fazla 1 yıl verilebilir'); end if;
  if q.contract + p_years > 5 then return jsonb_build_object('ok', false, 'msg', 'Sözleşme en fazla 5 yıl kalabilir'); end if;
  nw := (round(greatest(coalesce(q.wage, 0), public._wage_of(q.value)) * (1.08 + 0.03 * p_years) * case when q.morale < 55 then 1.1 else 1 end / 1000) * 1000)::bigint;
  bonus := nw * 6;
  if tm.budget < bonus then return jsonb_build_object('ok', false, 'msg', 'Bütçe yetersiz: imza parası ' || public._money(bonus)); end if;
  select coalesce(sum(wage), 0) into bill from public.squads where team_id = tm.id;
  if coalesce(tm.wage_budget, 0) > 0 and bill - coalesce(q.wage, 0) + nw > tm.wage_budget then
    return jsonb_build_object('ok', false, 'msg', 'Maaş bütçesi yetmiyor (yeni maaş ' || public._money(nw) || '/hafta)');
  end if;
  update public.squads set contract = contract + p_years, wage = nw, morale = least(100, morale + 5) where game_id = p_game and player_id = p_player;
  update public.teams set budget = budget - bonus where id = tm.id;
  perform public._fin(tm.id, 'imza', bonus);
  perform public._news(p_game, tm.id, 'info', '✍️ ' || rp.name || ' sözleşmesini ' || p_years || ' yıl uzattı. Maaş ' || public._money(nw) || '/hafta, imza parası ' || public._money(bonus));
  return jsonb_build_object('ok', true, 'msg', rp.name || ' ' || p_years || ' yıl daha bizde!');
end $$;

revoke execute on function public.answer_press(uuid, int) from public, anon;
revoke execute on function public.renew_contract(uuid, int, int) from public, anon;
grant execute on function public.answer_press(uuid, int), public.renew_contract(uuid, int, int) to authenticated;
