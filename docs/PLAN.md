# Menajer Online — Güncelleme Planı

Son güncelleme: 3 Kasım 2026. Durum işaretleri: ⬜ yapılacak · 🟡 sürüyor · ✅ bitti.
Her maddenin yanında **[S]** sunucu (Supabase SQL), **[İ]** istemci (`web/`), **[K]** senin (kullanıcının) yapması gereken bir ayar var.

Öncelik sırası: önce arkadaşlarla gerçekten oynarken çıkan sorunlar, sonra oyunu derinleştiren özellikler, en son görsellik.

---

## Faz 0 — İlk oyun haftası: geri bildirim topla (hemen)

Siteye bakarken ve arkadaşlarla ilk sezonu oynarken gördüğün her şeyi yaz: hata, garip görünen ekran, "şu olsa iyi olurdu".
Bu fazın çıktısı Faz 1'in sırasını belirler.

- ⬜ Takılan/çöken ekranlar, yanlış rakamlar, telefonda taşan yazılar
- ⬜ Maç sonuçları gerçekçi mi (çok gol / çok az gol, güçlü takım hep mi kazanıyor)
- ⬜ Transfer ekonomisi dengeli mi (bütçeler çok mu bol/kıt, açık artırma eğlenceli mi)

## Faz 1 — Oynanabilirlik ✅ (2 Kasım 2026; 1.8 hariç)

Ek olarak: yapay zeka takımları (tek başına oynama), hazırlık maçı, saatli maçların canlı izlenmesi.

Arkadaş grubunda oyunun akıcı dönmesi için gerekenler.

| # | Madde | Neden | Tür |
|---|---|---|---|
| 1.1 | ✅ **"Hazırım" sistemi**: her menajer haftaya hazır olduğunu işaretler, hepsi hazır olunca oda sahibine haber gider (istenirse otomatik oynar) | Oda sahibi kimseyi beklemeden oynatmasın | S + İ |
| 1.2 | ✅ **Otomatik hafta**: oda ayarı "her gün 21:00'de oyna" gibi; `pg_cron` ile | Herkes aynı anda online olmak zorunda kalmasın | S + İ |
| 1.3 | ✅ **Haftanın tüm maçları**: özet ekranında hafta sonuçları + "hepsini izle" | Arkadaşların maçlarını da görmek eğlenceli | İ |
| 1.4 | ✅ **Telefona kurulum (PWA)**: ana ekrana ekle, uygulama gibi açılsın, simge | Linki her seferinde aramamak için | İ |
| 1.5 | ✅ **Yapay zeka kulüplerinden teklif**: her hafta bazı menajer oyuncularına YZ kulüpleri teklif yapar, menajer kabul/ret eder | Satış tarafı da canlı olsun, bütçe dengesi | S + İ |
| 1.6 | ✅ **Transfer dönemi ayarı**: "her zaman açık" / "sadece devre arası ve sezon arası" | Sezon ortası kadro kurma yarışını sınırlamak isteyen gruplar için | S + İ |
| 1.7 | ✅ **Oda sahibini devretme / oyuncuyu odadan çıkarma** (lobide) | Gruptan biri bırakırsa oda tıkanmasın | S + İ |
| 1.8 | **Şifremi unuttum** | Unutan kalırsa hesaba dönebilsin | İ + **K**: Supabase'e kendi SMTP'n (ör. Gmail uygulama şifresi / Resend) — ücretsiz SMTP saatte 2 e-posta |

## Faz 2 — Oyun derinliği ✅ (2 Kasım 2026)

| # | Madde | Ayrıntı | Tür |
|---|---|---|---|
| 2.1 | ✅ **Maç puanları ve istatistik** | Her oyuncuya maç notu (6.0-10), gol krallığı, asist, en iyi 11, sezonun oyuncusu | S + İ |
| 2.2 | ✅ **Form ve değer değişimi** | İyi oynayanın değeri artar, kötü oynayanınki düşer; formdaki oyuncu maçta biraz daha güçlü | S |
| 2.3 | ✅ **Kartlar ve sakatlıklar** | Kırmızı kart, 5 sarıda ceza, maç içinde sakatlık (1-4 hafta); cezalı/sakat oyuncu ilk 11'e konamaz | S + İ |
| 2.4 | ✅ **Yorgunluk / rotasyon** | Arka arkaya oynayan yorulur (özellikle lig + kupa haftalarında); yedekler anlam kazanır | S + İ |
| 2.5 | ✅ **Maç içi değişiklik kuralları** | Sunucu simülasyonunda 60-75. dk otomatik oyuncu değişikliği (yorgun/kart görmüş) — taktikte "değişiklik planı" | S + İ |
| 2.6 | ✅ **Gelir/gider dengesi** | Maaşlar (değerin %x'i), bilet geliri, sezon sonu sıralama ödülü; böylece "çok oyuncu topla" stratejisi pahalı olur | S |
| 2.7 | ✅ **Yeni sezon** | Sezon bitince aynı odada yeni sezon: yaş +1, genç oyuncular potansiyele doğru gelişir, yaşlılar düşer; emeklilik; kupa/lig şampiyonları geçmişte saklanır | S + İ |
| 2.8 | ✅ **Sezon geçmişi / kupa dolabı** | Odanın şampiyonlar listesi, menajer profili (kaç kupa) | S + İ |

Bu fazda maç motoruna dokunulduğu için her değişiklikten sonra `mac-motoru` + `sql-test` skill'leriyle gol ortalaması (~2.5) ve güç–puan ilişkisi yeniden ölçülecek.

## Faz 3 — Görsellik ✅ (2 Kasım 2026)

Ek olarak: arayüz baştan yeniden tasarlandı; 2D'de oyuncular içinde forma numarası olan daireler.

| # | Madde | Ayrıntı | Tür |
|---|---|---|---|
| 3.1 | ✅ **2D izleyiciyi iyileştir** | Oyuncu isimleri/numaraları, gol tekrarı, devre arası ekranı, ses efektleri (isteğe bağlı) | İ |
| 3.2 | ✅ (kullanıcı isteğiyle geri geldi: sevimli ve 2D ile tam senkron) **3D maç izleme (Three.js)** | Aynı olay listesinden; kamera topu takip eder, 2D/3D geçiş düğmesi. Telefon performansı için basit modeller | İ |
| 3.3 | ✅ **Forma/arma editörü** | Renk + desen (düz, çizgili, yarım) + basit arma; sahada ve listelerde görünür | S + İ |
| 3.4 | ✅ **Oyuncu kartları** | FC tarzı kart görünümü (rating, mevki, 6 özellik) | İ |

## Faz 4 — Teknik bakım (araya serpiştirilir)

| # | Madde | Neden |
|---|---|---|
| 4.1 | SQL testlerini repoya koy (`supabase/tests/`) — her değişiklikte aynı senaryolar | Gerilemeleri yakalamak |
| 4.2 | Tarayıcı uçtan uca testini repoya koy (Playwright betiği, test hesaplarını sonunda silen) | İstemci değişikliklerinden sonra hızlı kontrol |
| 4.3 | Migration geçmişini Supabase ile hizala (003-005 elle uygulandı) | İleride `supabase db push` kullanılırsa çakışmasın |
| 4.4 | Büyük odalarda performans (20 takım, 30 kişilik kadro): sorgu/indeks kontrolü, `get_advisors` | Kalabalık grupta yavaşlamasın |
| 4.5 | Supabase Auth'a Google ile giriş (isteğe bağlı) | Şifre derdi olmasın — **K**: Google Cloud'da OAuth istemcisi açmak gerekir |

---

## Nasıl ilerleyeceğiz

1. Sen siteye bakıp notlarını yazarsın (Faz 0).
2. Notlara göre Faz 1'den maddeleri seçeriz; her oturumda 2-3 madde.
3. Her madde: sunucu tarafı geri alınan testlerle denenir → istemci → canlı sitede iki hesapla deneme → PR → `main` (site birkaç dakikada güncellenir).
4. Silme/yetki gerektiren SQL olursa sana SQL Editor'de çalıştırman için kısa bir komut veririm (Supabase onay penceresi cihazında açılmıyor).
5. Bu dosya her oturum sonunda güncellenir.

## Faz 4 — FM havası ve tek kişilik oyun ✅

| # | Madde | Durum |
|---|---|---|
| 4a | Maçta sadece önemli anlar, normal hızda (⏩ sonraki an) | ✅ |
| 4b | Ana ekranda hızlı hazırlık maçı (iki gerçek kulüp) | ✅ |
| 4c | Tek kişilik kariyer: gerçek lig + gerçek kulüp ya da kurmaca takım | ✅ |
| 4d | Yardımcı antrenör maç önü raporu, yönetim hedefi ve güveni, form | ✅ |
| 4e | FM finansı: oyuncu maaşları, maaş bütçesi, sponsor/TV, bilet, itibar, sezon gelir-gider defteri (Kadro → Finans) | ✅ |
| 4f | Gerçek kulüp renkleri; yıldızlar lig içi sıra + Avrupa seviyesi | ✅ |
| 4g | Gerçekçi maç görüntüsü: kare kare simülasyon (hız/ivme sınırı, takım bloğu, ofsayt çizgisi, ara pas, serbest top, korner, faul/serbest vuruş, seri penaltı oynatma, anlatım satırları, korner/faul istatistiği, maç içi penaltı ve direkt serbest vuruş (baraj), atak türleri: kornerden kafa, kanattan orta + kafa, uzaktan şut, ara pas, son üçte birde geri pas yok), 2D yakın yayın kamerası, 3D gerçek oranlar | ✅ |
| 4h | Takım talimatları: pres / tempo / genişlik (maç motoru + Taktik ekranı + maç görüntüsü); YZ takımlarına kalıcı tarz; yardımcı antrenör rakip analizi | ✅ |
| 4i | Maç görüntüsü yeniden yazıldı (sim.js): oyun kurulumu, pres + adam takibi, kaleci uzanması/tutma/çelme, dönen top, file dalgası, gol sevinci, daha hızlı 1x | ✅ |
| 4j | Moral + basın toplantısı, sözleşmeler (uzatma / bedelsiz ayrılık), altyapıdan genç oyuncular | ✅ |
| 4k | Devre arası kararları (kariyer): maç 45'te durur, takım konuşması, değişiklik, oyun anlayışı, talimat | ✅ |
| 4l | Kariyerde Avrupa kupası: lig ilk 2-4'ü + Avrupa devleri, 4 grup + rövanşlı eleme + final, ödüller, Lig → Avrupa sekmesi, kupa dolabında Avrupa | ✅ |
| 4m | Antrenman: haftalık odak (genel/hücum/orta saha/savunma/fizik) + yoğunluk; gençler gelişim puanıyla güçlenir, yoğunlukta sakatlık/moral bedeli (Kadro → Antrenman) | ✅ |
| 4n | Oynama süresi (maçta oynayan gence ek gelişim, kenarda kalan önemli oyuncuya moral cezası) + transferde gözlemci raporu (kadroya katkı, potansiyel, yaş; 1-5 yıldız) | ✅ |
| 4o | Kiralık oyuncu: YZ kulüplerinden sezon sonuna kadar kiralama (bedel %10, maaş sende, en fazla 4), satılamaz, sezon sonunda döner | ✅ |
| 4p | Maç görüntüsü: tüm saha + yatay ekranda yatay saha, skor şeridi, canlı topa sahip olma; kaleci dağıtımı takımda kalır (%55 → ~%99, uzun topların bir kısmı hava topunda kaybedilir), son üçte birde geri pas %27 → %14, orta saha topa yakın (−11.8 → −7.5 m), ataklar orta/ara pasla sonuçlanır; 3D kamera yeni açılar | ✅ |
| 4q | Arayüz yenilendi (TEMA v2): kulüp renginde vurgu, oyun menüsü tipografisi, yatay ekran/tablet/masaüstü için yan menü ve sütunlu panolar; form rozeti hatası ve eksik oyuncu verisinde çökme düzeltildi | ✅ |
| 4r | Maç sahası her ekranda yatay ve geniş (tribünlü, açık çim), yatay ekranda tam yükseklik, tam ekran (yatay kilit) düğmesi | ✅ |
| 4s | Maç görüntüsü: ofsayt kuralı (yan hakem, serbest vuruş, akış + istatistik), pas mantığı (kapalı hatta pas %42 → %19, aynı kişiye geri pas %18 → %6, ofsaytta top alma %5.8 → %0.6), kontra hücum ve daha hızlı tempo | ✅ |
