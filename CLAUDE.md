# Menajer Online

Arkadaşlar arası, web tabanlı, online futbol menajerlik oyunu. Herkes kurmaca bir takım yönetir, oyuncular gerçek (EA FC 26).

**Kullanıcıyla her zaman Türkçe konuş.** Oyun arayüzü, hata mesajları (`raise exception`, `msg`) ve haber metinleri Türkçe.
Kod tanımlayıcıları (tablo, kolon, fonksiyon adları) İngilizce kalabilir; mevcut adlandırmaya uy.

## Kararlar

- **Teknoloji:** Düz web (HTML + JavaScript + `supabase-js`). Godot YOK, build adımı/framework yok. GitHub Pages'te yayınlanır (repo `menajer-online`, istemci `web/` klasöründe).
- **Backend:** Supabase projesi `menajer-online`, ref `idpfttetphmjcmnodpdw`, bölge eu-central-1.
  - URL: `https://idpfttetphmjcmnodpdw.supabase.co`
  - Publishable key (istemcide kullanılabilir): `sb_publishable_vY0fA-KsME4MU6bw9o8Enw_LEAsjLkC`
  - `service_role`/secret key ASLA istemciye veya repoya girmez.
- **Hile önleme:** Tüm yazma işlemleri `security definer` RPC'lerle yapılır. Tablolarda RLS açık; `authenticated` sadece okur
  ve sadece üyesi olduğu odanın satırlarını görür (`public.is_member(game_id)`). İstemci hiçbir tabloya doğrudan insert/update/delete yapmaz.
- **Oyuncular:** EA FC 26, 9 lig (ENG ESP GER FRA ITA NED POR TUR BEL), 4.647 oyuncu `real_players`'ta yüklü.
  Veri: `data/build_players.py` (kaynak: github.com/ismailoksuz/EAFC26-DataHub `data/players.csv`). Kalecilerde
  pac/sho/pas/dri/dfn/phy = diving/handling/kicking/reflexes/positioning/speed.
- **Modlar:** ana ekranda Hızlı maç (iki gerçek kulüp), Kariyer (tek kişilik: gerçek kulüp ya da kurmaca takım + YZ rakipler, `schedule: manual`, "Devam et"; menajerin maçı 45'te durur, devre arası kararları `play_second_half`), Arkadaşlarla (oda). FM havası: Özet'te sıradaki maç + yardımcı antrenör raporu, yönetim hedefi/güveni (istemcide kadro gücü sıralamasından), puan durumunda form.
- **Takımlar kurmaca.** Oda kurulur, arkadaşlar 6 haneli kodla katılır. `settings.bots` kadar yapay zeka takımı başlarken eklenir (`teams.is_bot`, `owner` null); teklife anında karar verir. Sezonda ayrılan/çıkarılan menajerin takımı YZ'ye geçer.
- **Format seçilebilir:** `league` / `cup` / `league_cup`; lig tek/çift devre (`legs`); kupa tek maç/rövanşlı (`cup_legs`, final hep tek maç);
  takım sayısı (`max_teams`); bütçe (`start_budget`). Ayarlar `games.settings`, varsayılanlar `_default_settings()`.
- **Kadro dağıtımı:** Başlangıçta herkese kademelerden (S 85+, A 80-84, B 75-79, C 70-74, D 60-69) eşit sayıda rastgele oyuncu
  (varsayılan S1 A3 B6 C6 D4 = 20; 2 kaleci, kalanlar ~%39 DEF, %33 MID, gerisi FWD).
- **Transfer yapay zekası:**
  - Yapay zeka kulübünün oyuncusu (`squads`'ta satırı yok): istenen fiyat = değer × (1 + %0-20 sabit sapma; ≤23 yaş +%10, ≥32 yaş −%10).
    Altındaki teklife karşı teklif mesajı döner. Teklif kabul edilince **10 dk açık artırma** başlar (`bid_minutes`); geçmek için **+%5**;
    son dakikadaki teklif süreyi 1 dk uzatır. Bütçe aktif tekliflerle rezerve edilir.
  - Menajerden menajere: değerin altına teklif yapılamaz; karar satıcıda (kabul/ret). Teklif `offer_hours` (24 saat) geçerli.
  - Yapay zekaya satış: değerin %75'i, anında. Kadro sınırı 16-30.
- **Maçlar sunucuda simüle edilir.** Varsayılan `schedule: auto`: her gün bir hafta, her maçın kendi saati (`fixtures.kickoff_at`, ilk maç `kickoff` 11:00, `gap_min` 10 dk, `tz` Europe/Istanbul); pg_cron her dakika `_auto_tick()` ile saati gelen maçı oynatır. İstemci maçı kickoff'tan itibaren 9 dakika "canlı" oynatır (skor bu sürede gizli). `manual` modda oda sahibi `play_next_round` der ya da herkes `set_ready` olunca oynar. Hazırlık maçı: `comp = 'friendly'`, puan/prim yok. Sonuç `fixtures.events` olay listesi
  (`{m, t: goal|save|miss|yellow|red|injury|sub, s: h|a, p, a}`; sub'da p çıkan a giren) ve `fixtures.stats` (`rt` oyuncu puanları, `motm`) olarak kaydedilir. Maç motoru sabitleri: şut 0.22, gol 0.275; moral ±%1.8 (büyütme: kazanan güçlenir, gol ortalaması patlar); maç başına ~0.28 penaltı (olayda `pen: true, c: foul|hand, f: faul yapan, w: düşürülen`; faul ihtimali hücumcunun `dri` / savunmacının `dfn` oranına bağlı), şutların %5'i direkt serbest vuruş (`fk: true, f, w`) (bkz. `mac-motoru` skill'i; skill'deki eski sabitler 004 dönemine ait). İstemci bunu sadece önemli anları (goller, kurtarışlar, kırmızı kartlar, birkaç kaçırma) normal hızda oynatır, aralar hızla geçer; görüntü `web/js/sim.js`'te kare kare simüle edilir (v2, ajan tabanlı: 22 bağımsız oyuncu + top fiziği + takım şekli + pas/pres/top kapma kararları; sunucunun şut ve kart olaylarını "yönetmen" oyunun akışı içinde kurdurur, serbest oyunda şut çıkmaz; topa sahip olma `stats.poss`'a yaklaştırılır; çıktıda `passes`/`tackles`/`fouls`/`corners`/`offsides`; ölçüm: ~93 pas/maç %78 isabet, olay gecikmesi ortanca 3 dk; aşağıdaki ayrıntıların bir kısmı v1'den) (ofsayt kuralı: pas anında rakibin sondan ikinci oyuncusunun ve topun önündeki alıcı → yan hakem, serbest vuruş, `sim.offsides`, maç başına ~1.4; pas seçimi açık hat + ilerleme + aynı kişiye geri pas cezası; top kazanılınca 4.5 sn kontra koşusu) (1x'te 1 maç dakikası = `SPM` 3.3 sn; önemli an öncesi ~8.5 sn oyun kurulumu, pres/adam takibi, kaleci açı daraltma + uzanma/tutma/çelme, dönen top, ağ dalgası, gol sevinci); 2D Canvas (tüm saha, kamera takibi yok; saha her ekranda yatay ve geniş, ev sahibi solda, iki yanda tribün; yatay ekranda sahne ekranı doldurur, tam ekran düğmesi Android'de yataya kilitler; üstte skor şeridi, altta canlı topa sahip olma çubuğu; oyuncular içinde forma numarası olan daireler, `squads.shirt`) ve sevimli 3D (dikeyde kale arkası, yatayda tribün açısı) (Three.js 0.160.0, istenince yüklenir) aynı durumdan çizilir, tam senkron; kale oyuncu dairelerine oranla küçük kalmasın diye büyütülmüş çizilir (`GOAL` 13.6 m × `GOALH` 3.8 m, şut hedefleri buna göre). Hedef: maç başına ~2.5 gol.
- **Auth:** e-posta + şifre, kullanıcı adı `raw_user_meta_data.username` → `profiles` (trigger `handle_new_user`).
  Dashboard'da "Confirm email" kapalı, e-posta sağlayıcısı açık.
- **Realtime:** publishable key ile kanal anon katılır; kanal açmadan önce `sb.realtime.setAuth(access_token)` şart, yoksa RLS hiçbir olayı geçirmez.

## Durum

| Adım | Durum |
|---|---|
| 001_tablolar, 002_fc26_ozellikler | ✅ uygulandı, oyuncular yüklü |
| 003_oyun_mantigi | ✅ uygulandı (kullanıcı SQL Editor'den) ve test edildi |
| 004_transfer_mac | ✅ uygulandı (maç motoru `execute_sql`, transfer+yetkiler kullanıcı SQL Editor'den `supabase/elle/004_kalan.sql`), test edildi |
| 005_mac_ayari | ✅ uygulandı: gol sabiti 0.25, şut sabiti 0.21 → 560 maçta 2.49 gol/maç |
| 006_canli_maclar | ✅ kullanıcı SQL Editor'den uyguladı: YZ takımları, saatli otomatik maçlar (`_auto_tick`, pg_cron `auto-matches` her dakika), hazırlık maçı, hazırım, YZ teklifleri, transfer dönemi, oda yönetimi |
| 007_yz_renkleri | ✅ `execute_sql` ile |
| 008_faz2 | ✅ kullanıcı SQL Editor'den: maç puanları (`stats.rt`, `motm`), kondisyon/form/gelişim (`squads.fitness/form/ovr_delta`), kart cezası/sakatlık (`ban`/`injury`/`yellows`), maç içi değişiklik, maaş/bilet/ödül, `new_season`, `player_stats`, `games.season/history` |
| 011_kariyer | ✅ kullanıcı SQL Editor'den: `club_list`, `quick_match` (ana ekrandan gerçek kulüplerle hazırlık maçı, `settings.sandbox` gizli oda), `start_career` (gerçek lig + gerçek kulüp kariyeri, `settings.career`) |
| 013_kulup_renkleri | ✅ `execute_sql`: büyük kulüplerin gerçek renkleri `_club_team` içinde |
| 014_itibar | ✅ `execute_sql`: 012'de atlanan hafta sonu maaş/sponsor bloğu +  itibar lig içi sıraya göre (1.→5, 2-3.→4, 4.→3, ilk yarı→2, kalan→1) |
| 012_finans | ✅ kullanıcı SQL Editor'den (çok satırlı bir değiştirme kopyalamada bozulup atlandı, 014 tamamladı). FM finansı: `squads.wage` (değerin %0.22'si/hafta, transferde yeniden), `teams.wage_budget/weekly_income/ticket/reputation/fin` (sezon defteri), `_setup_finances` (kariyerlerde kadro değerine göre), maaş bütçesi `place_bid`'de kontrol |
| 010_forma | ✅ kullanıcı SQL Editor'den uyguladı: `squads.shirt` (trigger ile otomatik), `teams.kit` (desen/arma/sembol), `set_kit` |
| 009_dinlenme | ✅ `execute_sql`: günlük dinlenme +20, gol sabiti 0.29 → 540 maçta 2.55 gol/maç |
| 015_penalti | ✅ `execute_sql`: maç içi penaltı (ceza sahasında faul/el, faulü yapana bazen kart), direkt serbest vuruş şutları, gol sabiti 0.275 → 380 maçlık ölçümlerde ~2.53 gol/maç (eski 2.44), 0.29 penaltı/maç, %75 penaltı golü |
| 016_penalti_sebep | ✅ `execute_sql`: penaltının sebebi (faul %~87 / el), faul ihtimali dripling/savunma oranına göre, serbest vuruşta faul yapan/düşürülen, faule bazen sarı; 3×380 maçta ~2.51 gol, 0.28 penaltı/maç |
| 017_talimatlar | ✅ kullanıcı SQL Editor'den (girintiler bozuldu, `set_instr` `execute_sql` ile dosyadaki haliyle yeniden yazıldı): `teams.instr` (pres/tempo/genişlik 0-2), `set_instr` RPC, `offers_player_id_idx` |
| 018_talimat_etkisi | ✅ `execute_sql`: `_power` talimatları okur (`to_jsonb(t)->'instr'`, kolon yoksa normal), pres +%35 kart / +4 yorgunluk; karışık talimatlarla ~2.6 gol/maç |
| 019_yz_tarz | ✅ `execute_sql`: YZ takımlarına kimlikten türetilen kalıcı tarz (`_power`; istemcide `teamStyle` aynı hesap) |
| 020_moral_sozlesme | ✅ kullanıcı SQL Editor'den (girintiler bozuldu, `answer_press`/`renew_contract` `execute_sql` ile dosyadaki haliyle yeniden yazıldı): `squads.morale` (0-100), `squads.contract` (kalan yıl, 0 = sezon sonu biter), `teams.press_fx`, `answer_press`, `renew_contract` |
| 021_moral_etkisi | ✅ `execute_sql`: `_power` moral ±%4.5, `_sim_fixture` maç sonu moral |
| 022_yeni_sezon | ✅ kullanıcı SQL Editor'den (girinti farkı dışında aynı; canlıda sezon sonu + yeni sezon test edildi): `new_season` sözleşme bitişi (bedelsiz ayrılık) + altyapıdan 2 genç + moral sıfırlama |
| 023_moral_ayar | ✅ `execute_sql`: moral etkisi ±%1.8 (021'deki ±%4.5 kartopu etkisiyle gol ortalamasını 4.2'ye çıkarmıştı), maç sonu ±4, her maç 70'e %10 dönüş → canlıda 380 maçta 2.66 gol |
| 024_devre_arasi | ✅ kullanıcı SQL Editor'den (girinti farkı dışında aynı): `play_second_half(p_game, p_talk, p_mentality, p_lineup)` (takım konuşması ±%3, aynı mevkiye en fazla kalan hak kadar değişiklik, YZ gerideyse hücum) |
| 025_iki_yari | ✅ `execute_sql` (md5 yerel kopyayla aynı; canlıda tarayıcıdan uçtan uca denendi): `_sim_fixture` 45'te durabilir (`stats.stop`), durum `stats.ht`; `_play_round` kariyerde menajerin maçını durdurur ve haftayı bekletir; `_play_fixture` ödülleri maç bitince; `_auto_tick` devre arasındakini atlar |
| 026_avrupa + 027_avrupa_yetki | ✅ 026 fonksiyonları `execute_sql` ile (önce yeni 8 fonksiyon `check_function_bodies = off`, 027'den sonra mevcut 6'sı; md5 yerel kopyayla aynı), 027 (alter + revoke, kısa) kullanıcı SQL Editor'den (026'yı telefondan yapıştırmak boşluklar yüzünden bozulmuştu). Canlıda geri alınan Juventus kariyeriyle tam sezon test edildi. Kariyerde Avrupa kupası: 16 takım (kariyer liginden 4/3/2 + diğer liglerin en güçlü kulüpleri `teams.guest`, ligde/iç kupada oynamaz), 4 grup çift devre + rövanşlı çeyrek/yarı + tek maç final, `fixtures.comp = 'euro'` (`cup_round` 0 grup/1 çeyrek/2 yarı/3 final, grupta `tie` = grup), durum `games.euro` (`rounds`, `groups`, `stage`, `champion`, sezon sonu `next`), `euro_table` RPC, ödüller `_euro_prize`, bilet 2.5 kat |
| 028_antrenman + 029_antrenman_yetki | ✅ 028 `execute_sql` (önce `set_training`/`_train_week`, 029'dan sonra `_after_round`; md5 yerel kopyayla aynı), 029 (kolonlar + yetkiler) kullanıcı SQL Editor'den. Canlıda geri alınan Barcelona kariyeriyle (yoğun + orta saha) sezon test edildi: +30 gelişim (MID +24), YZ ~+10, 2.61 gol. Antrenman: `teams.training` {focus genel/hucum/ortasaha/savunma/fizik, int 0 hafif/1 normal/2 yoğun}, `squads.xp` (100 = +1 güç, değer %6); dinlenme +26/+20/+14 (fizik +4), antrenman sakatlığı %0/%4/%12, moral iki haftada bir ±1. Yerelde: yoğun+hücum Chelsea sezonda +22 gelişim, normal YZ ~+10, hafif +2; lig 2.64 gol |
| 030_oyun_suresi | ✅ `execute_sql` (md5 yerel kopyayla aynı): `_train_week` maçta oynayan gençlere ek xp (≤23 +3, ≤26 +1), menajer takımlarında kadronun en iyi 14'ünden sağlam/dinç olup oynamayanın morali −2/hafta, yoğun antrenman sakatlığı %9. Yerelde BVB sezonu: moraller 59-70, YZ ~+14.5 gelişim, 2.28/2.56 gol (tek sezon dalgalanması) |
| 031_kiralik + 032_kiralik_yetki | ✅ `loan_player` `execute_sql` (032'den önce; ilk denemede 032 bu fonksiyon olmadığı için tümden geri alındı), 032 (kolonlar `squads.loan_from/loan_team`, `_loan_guard` + `_end_loans` (gövdesinde delete olduğu için kullanıcıda), tetikleyici `squads_loan_guard`, yetkiler) kullanıcı SQL Editor'den, sonra `_after_round` (sezon sonunda `_end_loans`, YZ teklifleri kiralığa yok) `execute_sql`; md5 yerel kopyayla aynı. Canlıda geri alınan Chelsea kariyeriyle sezon + yeni sezon + oda silme test edildi. Kiralama: YZ kulübünden ya da YZ takımının ilk 11 dışı oyuncusundan (kadrosu >18), bedel değerin %10'u, maaş kiralayanda, en fazla 4, sezon sonu döner; kiralık oyuncu satılamaz (tetikleyici) |
| 033_yonetim | ✅ `execute_sql`: kariyerde yönetim güveni `settings.board` {season, team, target, n, rank, conf, warned, pos} (`_board_update` her hafta `_after_round`'dan; beklenen puan hedefe göre 2.2→0.8/maç), uyarılar, kovulma (`_sack`: takım YZ'ye, `settings.jobless` teklifleri `_job_pool`), sezon sonu büyük kulüp teklifleri `settings.job_offers`, `take_job` RPC. İstemci: Özet'te gerçek güven, kovulunca "İş teklifleri" ekranı |
| 035_taktik | ✅ `execute_sql`: `_power2(team, lineup, tac)` (taktik + eşleşme özellikleri wing/air/pace/fbdef/cbair/dpace/midtech/lsh), `_ai_tactic` (YZ rakibe göre: güçlüye kontra, zayıfa baskı, iyi kanatçıyla geniş), `_team_tactic` |
| 036_mac_ici | ✅ `execute_sql` (md5 yerel kopyayla aynı; canlıda ve tarayıcıda uçtan uca denendi): `_sim_fixture` taktik motoru (atak türü cross/thru/long/combo taktiğe göre, başarı eşleşmeye göre, olayda `k`/`ty`; YZ 60/72/82'de skora göre oyun anlayışı değiştirir, olay `tac`; `stats.tH/tA`), `stats.ht.next` kaldığı dakika, `stats.hold` sona kadar oyna ama sonuçlandırma; `_sim_run` 5 dakikada bir `stats.snaps`; `match_change` (izlenen dakikadan sonraki kayda geri sarar, değişiklik + taktik uygular, yeniden oynar), `finish_match`; `play_second_half` ikinci yarıyı beklemede oynar; `_play_round` menajer maçını `_sim_run(…,45)`, bekleyen maçı "Devam et"te sonuçlandırır. Ölçüm: 2.54 gol, ev %40, beraberlik %24, güç–sıra korelasyonu 0.79 |
| 037_yetkiler | ✅ kullanıcı SQL Editor'den (`has_function_privilege` ile doğrulandı): 033/035/036'nın iç fonksiyonlarına revoke, `take_job`/`match_change`/`finish_match` grant |
| Web istemcisi (`web/`) | ✅ yayında; 2 kullanıcıyla uçtan uca test edildi (kayıt→oda→lobi→başlat→taktik→açık artırma→menajer teklifi→hafta→maç izleme→lig/kupa). Test verisi silindi |
| GitHub Pages | ✅ "Deploy from a branch" (main, kök). Kökteki `index.html` → `web/`'e yönlendirir; `.nojekyll` ile Jekyll kapalı. Adres: https://uckankeskinkaya.github.io/menajer-online/ |
| `get_advisors` | ✅ sadece beklenen uyarı: authenticated'ın oyun RPC'lerini çağırabilmesi (tasarım gereği). anon hiçbir fonksiyonu çağıramaz |

003-005 Supabase'in migration geçmişinde (`list_migrations`) görünmez; elle/`execute_sql` ile uygulandılar. Kaynak doğru olan bu dosyalardır. GitHub Raw sayfası birkaç dakika önbellekte tutar: değişen bir dosyayı kullanıcıya verme, yeni numaralı dosya aç. Telefondan kopyalamada çok satırlı metinlerdeki art arda boşluklar bozulabiliyor: kullanıcıya verilecek dosyada `replace` ile çok satırlı blok değiştirme yerine tek satırlık eşleşmeler ya da tam `create or replace` kullan; uyguladıktan sonra `pg_get_functiondef` ile doğrula.
`execute_sql`'de `delete`, `revoke`, `create extension` gibi ifadeler (fonksiyon gövdesindeki `delete` dahil) onay ister (60 sn) ve kullanıcının cihazında bu pencere AÇILMIYOR: böyle SQL'i kullanıcıya SQL Editor'de çalıştırması için ver; `create or replace function` ve DO bloklarındaki testler onaysız geçer.
Aynı istekte hem değişiklik hem `raise exception`'lı test gönderme: exception değişikliği de geri alır.

Arayüz teması (v2, `app.css` sonundaki "TEMA v2"): maç günü / menajer oyunu havası; düz paneller, dar büyük harfli başlıklar (Barlow Condensed), eğik kesik butonlar/sekmeler; vurgu rengi `--acc` oyundaki takımın forma rengi (`setAccent`, koyu renkte ikinci renk, o da koyuysa limon yeşili). Ekran sınıfı `view v-<sekme>` (`setScreen`). 960 px üstü: solda dikey menü; 1100 px üstü Özet/ana ekran/lig sütunlu pano, Pazar'da filtreler solda, Taktik'te saha yanda. Emoji yerine `ICON` SVG'leri.

İstemci ekranları (mobil öncelikli): giriş/kayıt, oda kur/katıl, lobi + ayarlar, kadro, taktik (diziliş + ilk 11),
transfer pazarı (lig/mevki/rating/fiyat filtresi), teklifler (gelen/giden, canlı), fikstür/puan durumu/kupa ağacı, haberler, 2D maç izleme.

Yol haritası: `docs/PLAN.md` (fazlar ve maddeler; her oturum sonunda güncelle).

## Veri modeli (özet)

`real_players` · `profiles` · `games` (code, owner, status lobby/active/finished, settings, current_round, cup) ·
`teams` (budget, formation, mentality -2..2, lineup int[11], instr {press,tempo,width} 0..2, training {focus,int}) · `squads` (satır yoksa oyuncu yapay zeka kulübünde; morale, contract, xp, loan_from/loan_team = kiralık) ·
`offers` (seller null = yapay zeka açık artırması; bidder null + `ai_club` = YZ kulübünün menajere teklifi) · `fixtures` (comp league/cup, round, cup_round, leg, tie, hg, ag, pens, winner, events, stats) ·
`news` (team_id null = herkese). Kariyerde Avrupa: `teams.guest` (sadece Avrupa'da oynayan misafir kulüp; lig/kupa/puan durumu/istatistik dışı), `games.euro`, `fixtures.comp = 'euro'`. Realtime: games, offers, news, fixtures, teams, squads.

## Çalışma kuralları

- Migration'lar `supabase/migrations/NNN_ad.sql`; Supabase'e uygulanan SQL ile dosya birebir aynı olmalı. Uygulanmış bir migration'ı
  değiştirme, yeni numaralı dosya ekle.
- Supabase MCP `apply_migration`/`execute_sql` kullanıcı onayı ister ve **60 sn** içinde cevap gelmezse zaman aşımına düşer;
  göndermeden önce kullanıcıya haber ver.
- Kullanıcıya verilen dosyadaki `revoke/grant` satırlarının hedeflediği fonksiyonların hepsi canlıda önceden var olmalı (yoksa SQL Editor bütün dosyayı geri alır).
- Uzun fonksiyonları kullanıcıya SQL Editor için verme (telefondan yapıştırınca bozuluyor): fonksiyonları `execute_sql` ile sen uygula, kullanıcıya sadece kısa tek satırlık `alter`/`revoke` dosyası ver. Henüz olmayan kolona dayanan fonksiyonu önceden yüklemek için `set check_function_bodies = off;`.
- Denemeleri `execute_sql` ile geri alınan `DO` bloklarında yap (bkz. `sql-test` skill'i), migration'ı en son uygula.
- Onay gerektiren (delete/drop/revoke/alter) değişiklikleri önce yerel Postgres kopyasında test et: `apt-get install postgresql-16-cron`, initdb, `auth` şeması + `auth.uid()` + `anon/authenticated` rolleri taklidi, 001-00N migration'ları, oyuncuları `data/` veya yüklenen players.json'dan yükle. Sonra dosyayı kullanıcıya Raw bağlantısıyla SQL Editor için ver.
- Yeni RPC eklerken `rpc-ekle`, maç motoruna dokunurken `mac-motoru` skill'ini izle. Postgres/Supabase işlerinde
  `supabase` ve `supabase-postgres-best-practices` skill'leri geçerli.
- Şema/fonksiyon değişikliğinden sonra `get_advisors` (security + performance) çalıştır.
- İstemci: tek sayfa, framework yok; `supabase-js` CDN'den sabit sürümle. Paket eklenirse sürüm sabitlenir.
