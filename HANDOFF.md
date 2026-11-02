# Menajer Online — devir notu (2026-11-02)

Arkadaşlar arası, web tabanlı, online futbol menajerlik oyunu. Herkes kurmaca bir takım yönetir,
oyuncular gerçek (EA FC 26). Kullanıcı Türkçe konuşuyor; oyun arayüzü Türkçe.

## Kararlar
- **Teknoloji:** Düz web (HTML + JavaScript, supabase-js), Godot YOK. GitHub Pages'te yayınlanacak.
- **Backend:** Supabase projesi `menajer-online`, ref `idpfttetphmjcmnodpdw`, eu-central-1.
  URL: https://idpfttetphmjcmnodpdw.supabase.co · publishable key: `sb_publishable_vY0fA-KsME4MU6bw9o8Enw_LEAsjLkC`
- Tüm yazma işlemleri `security definer` RPC'lerle yapılır; tablolarda RLS açık, authenticated sadece okur (hile önleme).
- Ligler: İngiltere, İspanya, Almanya, Fransa, İtalya, Hollanda, Portekiz, Türkiye, Belçika (kodlar ENG ESP GER FRA ITA NED POR TUR BEL).
- Format seçilebilir: `league` / `cup` / `league_cup`, lig tek/çift devre, kupa tek maç/rövanşlı, takım sayısı, bütçe, kadro kademeleri.

## Durum
| Adım | Durum |
|---|---|
| 001_tablolar.sql | ✅ Supabase'e uygulandı |
| 002_fc26_ozellikler.sql | ✅ uygulandı; 4.647 FC 26 oyuncusu `real_players`'a yüklendi |
| 003_oyun_mantigi.sql | ❌ UYGULANMADI (onay süresi doldu) — sıradaki iş |
| 004_transfer_mac.sql | ❌ UYGULANMADI, test edilmedi |
| Web istemcisi | ❌ başlanmadı |
| GitHub repo + Pages | ❌ kullanıcı `gh auth login` yapmalı |
| Supabase Auth ayarı | ❌ Dashboard → Authentication → Sign In / Providers → Email → **"Confirm email" KAPAT** (arkadaşlar e-posta doğrulamadan girebilsin; yoksa varsayılan SMTP saatte 2 e-posta sınırına takılır) |

Temizlik: `public.tmp_import_players(jsonb)` fonksiyonu duruyor ama yetkisi kaldırıldı; istenirse `drop function` ile silinebilir.

## Veri modeli (özet)
- `real_players` (id, name, full_name, positions, grp GK/DEF/MID/FWD, ovr, pot, age, nat, club, lg, val, pac sho pas dri dfn phy — kalecilerde bu 6 alan kalecilik özellikleri)
- `profiles` (auth.users insert trigger'ı, kullanıcı adı `raw_user_meta_data.username`'den)
- `games` (oda: name, 6 haneli `code`, owner, status lobby/active/finished, settings jsonb, current_round, cup jsonb)
- `teams` (game_id, owner, name, short, color1/2, budget, formation, mentality -2..2, lineup int[11])
- `squads` (game_id, player_id, team_id, value, bought_for) — satır yoksa oyuncu "yapay zeka kulübünde"
- `offers` (bidder, seller null = yapay zeka açık artırması, amount, status, note, expires_at)
- `fixtures` (comp league/cup, round, cup_round, leg, tie, home, away, hg, ag, pens, winner, events jsonb, stats jsonb)
- `news` (team_id null = herkese) · realtime: offers, news, fixtures, games

## RPC'ler (003 + 004)
create_game, update_settings, join_game(code,...), leave_game, delete_game, start_game (kademelere göre rastgele kadro
dağıtımı: kaleciler 2, kalanlar ~%39 DEF %33 MID gerisi FWD; varsayılan S1 A3 B6 C6 D4 = 20 oyuncu),
set_tactics, place_bid, respond_offer, cancel_offer, sell_to_ai (değerin %75'i), resolve_transfers (pg_cron her dakika),
play_next_round (oda sahibi; maç simülasyonu + gelir + kupa turu), standings.

**Transfer yapay zekası:**
- Menajerin oyuncusu: değerinin altında teklif reddedilir; teklif sahibine gider, o kabul/ret eder. Rakip teklif sahiplerine haber gider.
- Yapay zeka kulübünün oyuncusu: istenen fiyat = değer × (1 + %0-20 sabit sapma, ≤23 yaş +%10, ≥32 yaş −%10).
  Altındaki teklif = karşı teklif mesajı. Üstündeyse `bid_minutes` (10 dk) açık artırma başlar; geçmek için +%5;
  son dakikada gelen teklif süreyi 1 dk uzatır. Bütçe, aktif tekliflerle rezerve edilir.

**Maç motoru:** dakika dakika olasılık. Orta saha üstünlüğü topa sahip olmayı, (hücum×0.6+orta×0.4)/savunma şut ihtimalini,
şutör kalitesi/kaleci gol ihtimalini belirler. Mentalite hücumu artırır, savunmayı düşürür. Mevki dışı oyuncu %85 (kaleci %50).
events: `{m,t:goal|save|miss|yellow,s:h|a,p,a}` → 2D izleyici bunlardan animasyon üretecek.

## Sıradaki adımlar
1. 003 ve 004'ü uygula (`apply_migration`), hataları düzelt. Test: `DO $$ ... raise exception '<sonuç>' $$` ile
   (sahte `request.jwt.claims` + auth.users test kullanıcıları; sonunda exception atıp her şeyi geri al).
   Gol ortalaması ~2.5 olmalı; değilse `_sim_fixture` içindeki 0.22 / 0.45 / 0.30 sabitlerini ayarla.
2. `get_advisors` (security) çalıştır.
3. Web istemcisi (`web/`): giriş/kayıt (kullanıcı adı + e-posta), oda kur/katıl (kod ile), lobi + ayarlar,
   kadro, taktik (diziliş + ilk 11 sürükle-bırak), transfer pazarı (filtre: lig, mevki, rating, fiyat),
   teklifler (gelen/giden, canlı), fikstür/puan durumu/kupa ağacı, haberler, maç izleme (Canvas 2D kuşbakışı).
   Mobil öncelikli tasarım.
4. GitHub repo `menajer-online` + GitHub Pages (Actions ile `web/` klasörü).
5. Sonra: 3D maç izleme (Three.js), oyuncu değer değişimi, sakatlık/form, yeni sezon.
