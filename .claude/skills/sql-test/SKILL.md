---
name: sql-test
description: Menajer Online'ın Supabase RPC'lerini canlı veritabanında iz bırakmadan test etme yöntemi. Bir migration'ı uygulamadan önce veya sonra, RPC'leri (create_game, join_game, start_game, place_bid, play_next_round...) sahte kullanıcılarla denemek, gol ortalamasını ölçmek ya da bir hatayı yeniden üretmek gerektiğinde kullan.
---

# SQL testi (geri alınan DO bloğu)

Projede ayrı bir test veritabanı yok; testler canlı projede (`idpfttetphmjcmnodpdw`) yapılır.
Bu yüzden **her test tek bir `DO` bloğudur ve sonunda `raise exception` ile biter.** Exception tüm
transaction'ı geri alır: sahte kullanıcılar, odalar ve maçlar silinir. Sonuç, exception mesajında döner.

## Kurallar

1. Supabase MCP `execute_sql` ile çalıştır (kullanıcı onay penceresi 60 sn; önceden haber ver).
2. Blok **her zaman** `raise exception 'SONUC: %', ...` ile bitsin. Exception'sız biten blok veriyi kalıcı yazar.
3. Kullanıcıyı taklit etmek için `set_config('request.jwt.claims', ..., true)` kullan; `auth.uid()` bunu okur.
4. `now()` transaction boyunca sabittir. Süre dolmasını test etmek için `expires_at`'i elle geçmişe çek.
5. Beklenen hatayı test ederken iç bloğu `begin ... exception when others then ... end` ile sar ve mesajı kaydet.
6. Sonucu tek satırlık metin olarak topla (`r := r || ...`), uzun çıktıyı jsonb'ye koy.

## Şablon

```sql
do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid();
  g uuid; r text := ''; i int; res jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'test_' || left(u::text, 8) || '@ornek.test', jsonb_build_object('username', 'test_' || left(u::text, 8)), now(), now()
  from unnest(array[u1, u2, u3]) u;

  -- u1 oda kurar
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  g := public.create_game('Test Ligi', '{"format":"league_cup","legs":1}', 'Kartallar', 'KRT');

  -- diğerleri katılır
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  perform public.join_game((select code from public.games where id = g), 'Aslanlar', 'ASL');
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  perform public.join_game((select code from public.games where id = g), 'Kurtlar', 'KRT2');

  -- başlat ve sezonu oynat
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  perform public.start_game(g);
  r := r || 'kadro=' || (select count(*) from public.squads where game_id = g) || ' ';
  while (select status from public.games where id = g) = 'active' loop
    perform public.play_next_round(g);
  end loop;
  r := r || 'mac=' || (select count(*) from public.fixtures where game_id = g and played)
         || ' gol_ort=' || (select round(avg(hg + ag), 2) from public.fixtures where game_id = g and played);

  raise exception 'SONUC: %', r;   -- HER ŞEYİ GERİ AL
end $$;
```

## Hata beklenen adım

```sql
begin
  perform public.place_bid(g, 12345, 1);
  r := r || 'HATA_YOK! ';
exception when others then
  r := r || 'beklenen_hata=' || sqlerrm || ' ';
end;
```
(`place_bid` hata yerine `{ok:false,msg}` döndürür; onun için `res := public.place_bid(...)` ile `res->>'msg'`'yi kontrol et.)

## Açık artırma bitişi

```sql
update public.offers set expires_at = now() - interval '1 second'
 where game_id = g and status = 'active' and seller is null;
perform public.resolve_transfers();
```

## Gol ortalaması ölçümü

Tek sezon gürültülüdür. Çok maç için 8-10 takımla çift devre lig kur ya da döngüde birkaç oda aç; hedef ~2.5 gol/maç,
ayrıca ev sahibi galibiyet oranı (~%45), beraberlik (~%25) ve isabetli şut / gol oranlarını raporla.
