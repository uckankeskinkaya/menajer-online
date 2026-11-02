-- MENAJER ONLINE 024: devre arası kararları (kariyer). SQL Editor'den çalıştır.
-- Maç 45. dakikada durur (025); menajer takım konuşması, oyuncu değişikliği ve oyun anlayışıyla ikinci yarıyı başlatır.
create or replace function public.play_second_half(p_game uuid, p_talk int, p_mentality int, p_lineup int[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); tm record; fx record; st jsonb; sd text; S text; oldlu int[]; newlu int[]; used int[]; reds int[];
  injured int[]; subs int; incoming int[]; outgoing int[]; sl text[]; i int; gf int; ga int; d int; boost numeric; pin jsonb; ev jsonb;
  opp record; msg text; ob numeric := 0;
begin
  if uid is null then return jsonb_build_object('ok', false, 'msg', 'Giriş yapmalısın'); end if;
  if p_talk is null or p_talk not between 0 and 2 then return jsonb_build_object('ok', false, 'msg', 'Takım konuşmasını seç'); end if;
  select * into tm from public.teams where game_id = p_game and owner = uid for update;
  if not found then return jsonb_build_object('ok', false, 'msg', 'Bu odada takımın yok'); end if;
  select * into fx from public.fixtures where game_id = p_game and not played and stats ? 'ht' and (home = tm.id or away = tm.id) for update;
  if not found then return jsonb_build_object('ok', false, 'msg', 'Devre arasında bekleyen maçın yok'); end if;
  st := fx.stats->'ht';
  if fx.home = tm.id then sd := 'h'; S := 'H'; gf := (st->>'vh')::int; ga := (st->>'va')::int;
  else sd := 'a'; S := 'A'; gf := (st->>'va')::int; ga := (st->>'vh')::int; end if;
  oldlu := array(select jsonb_array_elements_text(st->('lu' || S))::int);
  used := array(select jsonb_array_elements_text(st->('used' || S))::int);
  reds := array(select jsonb_array_elements_text(st->'reds')::int);
  injured := array(select jsonb_array_elements_text(st->'injured')::int);
  subs := (st->>('subs' || S))::int;
  newlu := coalesce(p_lineup, oldlu);
  -- oyuncu değişiklikleri: aynı mevkiye, kalan hak kadar
  if cardinality(newlu) <> cardinality(oldlu) or (select count(distinct x) from unnest(newlu) x) <> cardinality(newlu) then
    return jsonb_build_object('ok', false, 'msg', 'İlk 11 geçersiz'); end if;
  if exists (select 1 from unnest(oldlu) x where x = any(reds) and not (x = any(newlu))) then
    return jsonb_build_object('ok', false, 'msg', 'Kırmızı kart gören oyuncunun yerine oyuncu giremez'); end if;
  incoming := array(select x from unnest(newlu) x where not (x = any(oldlu)));
  outgoing := array(select x from unnest(oldlu) x where not (x = any(newlu)));
  if exists (select 1 from unnest(incoming) x where x = any(used)) then
    return jsonb_build_object('ok', false, 'msg', 'Oyundan çıkan oyuncu geri giremez'); end if;
  if cardinality(incoming) > 3 - subs then
    return jsonb_build_object('ok', false, 'msg', 'Kalan değişiklik hakkın: ' || (3 - subs)); end if;
  if exists (select 1 from unnest(incoming) x where not exists (select 1 from public.squads q where q.team_id = tm.id and q.player_id = x and q.injury = 0 and q.ban = 0)) then
    return jsonb_build_object('ok', false, 'msg', 'Giren oyuncu kadronda değil ya da sakat/cezalı'); end if;
  sl := public._slots(tm.formation);
  pin := st->'pin'; ev := st->'ev';
  for i in 1..cardinality(newlu) loop
    if not (newlu[i] = any(oldlu)) then
      pin := jsonb_set(pin, array[oldlu[i]::text, 'out'], to_jsonb(45));
      pin := pin || jsonb_build_object(newlu[i]::text, jsonb_build_object('s', sd, 'in', 45, 'out', 90, 'g', sl[i]));
      ev := ev || jsonb_build_array(jsonb_build_object('m', 46, 't', 'sub', 's', sd, 'p', oldlu[i], 'a', newlu[i]));
    elsif newlu[i] <> oldlu[i] then
      return jsonb_build_object('ok', false, 'msg', 'Oyuncuların yerini değiştirme; değişiklik aynı mevkiye yapılır');
    end if;
  end loop;
  -- takım konuşması: etkisi skora bağlı (ikinci yarı boyunca takım gücüne ±%3)
  d := sign(gf - ga);
  boost := (array[[0.02, -0.015, 0.025], [0.01, 0.02, 0], [0, 0.03, -0.02]])[case d when 1 then 1 when 0 then 2 else 3 end][p_talk + 1];
  msg := (array[
    ['Oyuncular sakin, işi bitirmeye odaklı.', 'Öndeyken bağırmak gerginlik yarattı.', 'Övgüler oyunculara güven verdi.'],
    ['Sakinlik iyi geldi.', 'Sert konuşma oyuncuları ateşledi!', 'Övgüler pek etki etmedi.'],
    ['Sakin konuşma pek etki etmedi.', 'Sert konuşma oyuncuları ateşledi!', 'Gerideyken övmek oyuncuları rahatlattı, fazla rahat.']])[case d when 1 then 1 when 0 then 2 else 3 end][p_talk + 1];
  st := jsonb_set(st, array['lu' || S], to_jsonb(newlu));
  st := jsonb_set(st, array['used' || S], to_jsonb(used || incoming));
  st := jsonb_set(st, array['subs' || S], to_jsonb(subs + cardinality(incoming)));
  st := jsonb_set(st, array['b' || S], to_jsonb(boost));
  st := jsonb_set(st, '{pin}', pin); st := jsonb_set(st, '{ev}', ev);
  -- rakip yapay zekaysa ve gerideyse ikinci yarıya hücumla çıkar
  select * into opp from public.teams where id = case when sd = 'h' then fx.away else fx.home end;
  if opp.is_bot and d > 0 then ob := 0.015; msg := msg || ' Rakip ikinci yarıya hücumla çıkıyor.'; end if;
  st := jsonb_set(st, array['b' || case when S = 'H' then 'A' else 'H' end], to_jsonb(ob));
  update public.teams set mentality = greatest(-2, least(2, coalesce(p_mentality, tm.mentality))), lineup = newlu where id = tm.id;
  update public.fixtures set stats = jsonb_set(stats, '{ht}', st) where id = fx.id;
  perform public._play_fixture(fx.id);
  if not exists (select 1 from public.fixtures where game_id = p_game and round = fx.round and not played and comp <> 'friendly') then
    perform public._after_round(p_game, fx.round);
  end if;
  return jsonb_build_object('ok', true, 'msg', msg, 'fixture', fx.id, 'boost', boost);
end $$;

revoke execute on function public.play_second_half(uuid, int, int, int[]) from public, anon;
grant execute on function public.play_second_half(uuid, int, int, int[]) to authenticated;
