---
name: mac-motoru
description: Menajer Online maç simülasyon motoru (_team_power, _pick_shooter, _sim_fixture, _resolve_cup, play_next_round) ve istemcideki 2D maç izleyicinin olay sözleşmesi. Maç sonuçlarını, gol ortalamasını, taktik/mentalite etkisini, kupa/penaltı mantığını değiştirirken veya maç izleme ekranını yazarken kullan.
---

# Maç motoru

Kaynak: `supabase/migrations/004_transfer_mac.sql` (değişiklikler yeni bir migration'da `create or replace` ile yapılır).

## Akış

`play_next_round(game)` (sadece oda sahibi) → `resolve_transfers()` → oynanmamış en küçük `round`'daki her fikstür için
`_sim_fixture` → galibiyet/beraberlik/mağlubiyet primi (`win_bonus`, `draw_bonus`, `loss_bonus`) → `current_round` güncelle →
`_resolve_cup` → hiç maç kalmadıysa `status = 'finished'` + şampiyon haberi.

## Takım gücü: `_team_power(team)` → jsonb

- İlk 11 geçersizse (`cardinality<>11` ya da kadroda olmayan oyuncu) `_auto_lineup` kullanılır.
- Slotlar `_slots(formation)`: GK, DEF×n, MID×(ortadaki sayıların toplamı), FWD×son sayı.
- Etkin rating: mevkisinde `ovr`; kaleci↔oyuncu takası `ovr×0.5`; diğer mevki dışı `ovr×0.85`.
- `def` = DEF ortalaması × (1 − mentalite×0.03) · `mid` = MID ortalaması × (0.9 + 0.033×nMID) ·
  `att` = FWD ortalaması × (0.92 + 0.04×nFWD) × (1 + mentalite×0.04) · `gk` = kalecinin etkin ratingi.
  Eksik slotlar 40 ile doldurulur.
- `shooters`: GK hariç her oyuncu `{id, w, q}`; ağırlık `w` = (FWD 3.0 / MID 1.3 / DEF 0.35) × sho/70, kalite `q` = (sho+ovr)/2.

## Dakika döngüsü: `_sim_fixture(fixture)`

90-94 dakika. Her dakika:
1. Topa sahip olan: `ph = mid_h² / (mid_h² + mid_a²) + 0.03` (ev sahibi avantajı).
2. Şut ihtimali: `0.22 × ratio⁵`, `ratio = (att×0.6 + mid×0.4) / rakip_def`.
3. Şutör `_pick_shooter` (ağırlıklı rastgele). İsabet `0.45`. Gol: `0.30 × (q / rakip_gk)³`.
4. Şut yoksa %1.2 sarı kart (savunan takım).

**Ayar sabitleri:** `0.22` (şut sıklığı), `0.45` (isabet), `0.30` (gol). Hedef: **maç başına ~2.5 gol**, ~10-12 şut/takım,
ev sahibi kazanma ~%45, beraberlik ~%25. Üs `⁵` ve `³` güç farkının etkisini belirler; büyütmek favoriyi güçlendirir.
Ölçüm için `sql-test` skill'indeki gol ortalaması bölümünü kullan; tek değişiklikte tek sabiti oynat.

## Çıktı sözleşmesi (istemci buna güvenir; değiştirirsen istemciyi de güncelle)

`fixtures.hg`, `fixtures.ag`, `played = true`

`fixtures.events`: zamana göre sıralı dizi
```json
{"m": 23, "t": "goal", "s": "h", "p": 209331, "a": 231747}
```
- `m` dakika (1-90; uzatma 90 olarak yazılır) · `t` `goal | save | miss | yellow` · `s` `h | a` (olayın sahibi; sarı kartta kartı gören takım)
- `p` oyuncu id (`real_players.id`) · `a` asist yapan (sadece gol, olmayabilir)

`fixtures.stats`:
```json
{"poss": [54, 46], "shots": [12, 9], "on": [5, 3], "lh": [11 id], "la": [11 id], "fh": "4-4-2", "fa": "4-3-3"}
```
`lh`/`la` ilk 11'ler slot sırasıyla (`_slots(fh)` ile eşleşir), 2D izleyici oyuncuları bu dizilişe göre yerleştirir.

## Kupa

- `games.cup`: `{round, alive: [team], byes: [team], pending, gap, champion?}`.
- `_gen_cup_round`: 2'nin kuvvetine tamamlamak için ilk turda bay geçenler; final tek maç, diğer turlar `cup_legs`.
- `_resolve_cup`: tüm ayakları oynanmış eşleşmede toplam skor, eşitse penaltı (`pens` = "4-3", son ayağa yazılır) ve `winner`.
  Tur bitince bir sonraki tur `current_round + gap` haftasına (sadece kupa formatında +1) çekilir.

## 2D izleyici (web)

Olaylardan animasyon üret: dakikayı zamana ölçekle (ör. 90 dk ≈ 60-90 sn, hızlandırma seçeneği), olaylar arasında topu
orta sahada rastgele pas zinciriyle gezdir, olay anında topu ilgili kaleye götür: `goal` filelere, `save` kalecide durur,
`miss` kale dışına. Skor tabelası, dakika, olay akışı metni. Kuşbakışı Canvas, mobilde dikey saha.
