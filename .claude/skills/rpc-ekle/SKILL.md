---
name: rpc-ekle
description: Menajer Online'a yeni bir Supabase RPC (Postgres fonksiyonu) ekleme veya mevcut birini değiştirme kontrol listesi. İstemcinin veritabanına yazması gereken her yeni işlemde (oda, kadro, transfer, taktik, maç, haber...) kullan; istemciye tablo yazma yetkisi vermek yerine bu yolu izle.
---

# Yeni RPC ekleme

İstemci tablolara **asla** doğrudan yazmaz. Her yazma işlemi `public` şemasında bir RPC'dir.
Önce `supabase-postgres-best-practices` skill'indeki `security-*` kurallarını hatırla.

## Kontrol listesi

1. **Yeni migration dosyası:** `supabase/migrations/NNN_kisa_ad.sql` (bir sonraki numara). Uygulanmış dosyayı düzenleme.
2. **Ad:** İstemcinin çağırdığı fonksiyonlar alt çizgisiz (`place_bid`); iç yardımcılar `_` ile başlar (`_news`, `_my_team`).
3. **Başlık:**
   ```sql
   create or replace function public.ornek(p_game uuid, ...) returns jsonb
   language plpgsql security definer set search_path = '' as $$
   ```
   - `set search_path = ''` zorunlu. Tüm nesneleri şema ile yaz: `public.teams`, `auth.uid()`.
   - Parametreler `p_` önekli (kolon adlarıyla çakışmasın).
4. **Yetki kontrolü (gövdenin ilk satırları):**
   - Oturum: `if auth.uid() is null then raise exception 'Giriş yapmalısın'; end if;`
   - Takım: `me uuid := public._my_team(p_game);` → `null` ise "Bu odada takımın yok".
   - Oda sahibi gerekiyorsa `games.owner = auth.uid()`.
   - Oyun durumu (`lobby` / `active`) kontrolü.
   - Başka bir takımın/oyuncunun satırına dokunuyorsan sahipliğini doğrula. İstemciden gelen hiçbir id'ye güvenme.
5. **Hile önleme:** Para, değer, rating gibi her şeyi sunucuda hesapla; istemciden gelen tutarı sadece "teklif" olarak al ve
   sınırlarını kontrol et (değerin altı, bütçe, rezerve teklifler, kadro 16-30). Yarış durumları için ilgili satırı `for update` ile kilitle.
6. **Dönüş:** Kullanıcı hatası beklenen işlemlerde (transfer gibi) `jsonb_build_object('ok', false, 'msg', '...')` dön;
   gerçek hatalarda `raise exception '...'`. Mesajlar Türkçe, oyuncuya hitap eden dilde. Paraları `public._money(v)` ile yaz.
7. **Haber:** Herkesi ilgilendiren olaylar `public._news(game, null, kind, text)`, kişiye özel olanlar `team_id` ile.
8. **Yetkiler (dosyanın sonu):**
   ```sql
   revoke execute on function public.ornek(uuid, ...) from public, anon;
   grant execute on function public.ornek(uuid, ...) to authenticated;
   -- iç yardımcılar: revoke ... from public, anon, authenticated; (grant yok)
   ```
   Supabase yeni fonksiyonlara varsayılan olarak `anon`'a da execute verir; revoke etmeyi unutma.
9. **Okuma ihtiyacı:** İstemci yeni bir tabloyu okuyacaksa RLS aç ve `for select to authenticated using (public.is_member(game_id))`
   politikası ekle; canlı güncelleme gerekiyorsa `alter publication supabase_realtime add table ...`.
   Yabancı anahtarlara indeks ekle.
10. **Test:** `sql-test` skill'iyle geri alınan DO bloğunda dene: başarılı yol + en az bir yetkisiz çağrı (başka kullanıcı) + bir sınır ihlali.
11. **Uygula ve denetle:** `apply_migration` (kullanıcı onayı, 60 sn), ardından `get_advisors` security ve performance.
12. **İstemci:** `web/` içinde `sb.rpc('ornek', { p_game, ... })` çağrısı; `ok:false` ise `msg`'yi kullanıcıya göster.
    CLAUDE.md'deki RPC/durum bilgisini güncelle.
