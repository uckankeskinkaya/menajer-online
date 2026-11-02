# Menajer Online

Arkadaşlarla oynanan, web tabanlı online futbol menajerlik oyunu. Takımlar kurmaca, oyuncular gerçek (EA FC 26, 9 lig, 4.647 oyuncu).

- **İstemci:** `web/` (düz HTML + JavaScript + supabase-js, build yok). GitHub Pages'te yayınlanır (`.github/workflows/pages.yml`).
- **Sunucu:** Supabase. Şema ve oyun mantığı `supabase/migrations/` altında; tüm yazma işlemleri `security definer` RPC'lerle.
- **Yerelde çalıştırma:** `cd web && python3 -m http.server 8000` → http://localhost:8000

Ayrıntılar ve kararlar: `CLAUDE.md`.
