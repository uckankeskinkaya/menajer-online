// Menajer Online — maç görüntüsü simülasyonu.
// Sunucunun ürettiği olaylar (gol/kurtarış/kaçırma, kart, penaltı, serbest vuruş) kesin sonuçtur; bu dosya
// onları gerçekçi bir futbol akışıyla "oynatır". İzlemeden önce bir kez, kare kare hesaplanır; 2D ve 3D aynı kareleri çizer.
// İç zaman saniyedir (1x izleme hızı); dışarıya maç dakikası olarak verilir: dakika = saniye / SPM.
import { slotPositions } from './ui.js';

export const SPM = 3.3;                 // 1x'te bir maç dakikası kaç saniye
export const PL = 105, PW = 68;         // saha (m)
const DT = 0.05;                        // simülasyon adımı (sn)
// kare: 22 oyuncu (x,y) | top x,y,z | topu tutan | yerde yatan | ev kalecisi uzanma | dep. kalecisi uzanma | file
export const FRAME = 44 + 3 + 1 + 1 + 2 + 1;
const JOG = 5.1, RUN = 7.8, SPRINT = 8.9, WALK = 2.0, ACC = 10;
const BUILD = 7.0;                      // önemli andan önce oyun kurulumu (sn)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

export function simulateMatch(fx, events, R, ins = {}) {
  // takım taktikleri: sunucunun maçta kullandığı (stats.tH/tA) varsa o, yoksa takımın tarzı
  const IN = { h: { press: 1, tempo: 1, width: 1, ment: 0, ...(ins.h || {}), ...(fx.stats?.tH || {}) }, a: { press: 1, tempo: 1, width: 1, ment: 0, ...(ins.a || {}), ...(fx.stats?.tA || {}) } };
  const fh = fx.stats?.fh || '4-4-2', fa = fx.stats?.fa || '4-4-2';
  // rol: yanal konum (fx 0..1, ev sahibine göre) ve derinlik (r: 0 defans → 1 forvet)
  const role = (f) => slotPositions(f).map((p) => ({ fx: p.x, r: clamp((0.78 - p.y) / 0.58, 0, 1) }));
  const roles = { h: role(fh), a: role(fa).map((q) => ({ fx: 1 - q.fx, r: q.r })) };
  const sideOf = (j) => (j < 11 ? 'h' : 'a');
  const other = (s) => (s === 'h' ? 'a' : 'h');
  const J = (s, k) => (s === 'h' ? 0 : 11) + k;
  const G = (s, y) => (s === 'h' ? PL - y : y);          // s'nin kendi kalesinden uzaklık
  const Yg = (s, g) => (s === 'h' ? PL - g : g);
  const dirY = (s) => (s === 'h' ? -1 : 1);              // s'nin hücum yönü
  const goalY = (s) => (s === 'h' ? 0 : PL);             // s'nin hücum ettiği kale çizgisi
  const poss = clamp((fx.stats?.poss?.[0] ?? 50) / 100, 0.3, 0.7);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // ---------- olaylar: zamanlar (sn), stiller ----------
  const shots = events.filter((e) => ['goal', 'save', 'miss'].includes(e.ev)).map((e, i) => ({ ...e, i })).sort((a, b) => a.m - b.m || a.i - b.i);
  let last = 3, prev = null;
  for (const e of shots) {
    const rebound = prev && prev.ev === 'save' && !prev.pen && prev.s === e.s && e.m - prev.m <= 1 && !e.pen && !e.fk;
    const gap = !prev ? 0 : rebound ? 2.2 : prev.ev === 'goal' ? 17 : prev.style === 'pen' || prev.style === 'fk' ? 13 : 10.5;
    e.T = Math.max((e.m - 0.5 + R() * 0.4) * SPM, last + gap, e.pen ? 12 : 9);
    e.shooter = J(e.s, e.slot ?? (8 + Math.floor(R() * 3)));
    const u = R(), cw = (IN[e.s].width - 1) * 0.1;
    // sunucunun atak türü (taktiğe göre seçildi) varsa onu oyna
    const kt = e.k === 'cross' ? (u < 0.3 ? 'corner' : 'cross') : e.k === 'thru' || e.k === 'combo' ? 'thru' : e.k === 'long' ? 'long' : null;
    e.style = rebound ? 'rebound' : e.pen ? 'pen' : e.fk ? 'fk' : kt || (u < 0.12 ? 'corner' : u < 0.38 + cw ? 'cross' : u < 0.55 + cw * 0.5 ? 'long' : 'thru');
    if (rebound) prev.parryTo = e;
    last = e.T; prev = e;
  }
  const penF = new Set(events.filter((e) => (e.pen || e.fk) && e.f).map((e) => `${e.m}:${e.f}`));
  const fouls = events.filter((e) => (e.ev === 'yellow' || e.ev === 'red') && !penF.has(`${e.m}:${e.p}`)).sort((a, b) => a.m - b.m);
  for (const f of fouls) f.T = (f.m + 0.2) * SPM;
  const corners = [];
  const T_END = Math.max(95 * SPM, last + 25);
  const N = Math.ceil(T_END / DT) + 2;
  const frames = new Float32Array(N * FRAME);

  // ---------- durum ----------
  const P = [];
  for (let j = 0; j < 22; j++) {
    const s = sideOf(j), ro = roles[s][j % 11];
    const g = j % 11 === 0 ? 4 : 12 + ro.r * 33;
    P.push({ x: ro.fx * PW, y: Yg(s, g), vx: 0, vy: 0, down: 0 });
  }
  const ball = { x: PW / 2, y: PL / 2, z: 0 };
  const gkDive = { h: { v: 0, dir: 0, t0: -9, until: -9 }, a: { v: 0, dir: 0, t0: -9, until: -9 } };
  let ripple = 0, rippleSide = 1;
  let holder = J(R() < poss ? 'h' : 'a', 10), flight = null, loose = null, nextAct = 0.6;
  let dead = null, restart = null, mode = null; // mode: önemli an planı
  let ei = 0, fi = 0, t = 0, fallen = -1;
  let tackleT = 0, cornerClear = null, duelT = -9;
  const offsides = [];                       // ofsayt düdükleri (izleyici akışı için)
  const gotFrom = new Array(22).fill(-1);    // topu kimden aldı (aynı kişiye geri pas az olsun)
  const won = { h: -9, a: -9 };              // takım topu en son ne zaman kazandı (geçiş hücumu)
  let lastSide = null;
  const lunge = {}, side = {}; // ikili mücadele: savunmacı dalışı, hücumcunun sıyrılması
  const gkMove = {}; // kaleci uzanması (kinematik)
  // her oyuncunun kendine özgü küçük sapmaları ve hareket ritmi: kimse sıra hâlinde heykel gibi durmasın
  const pers = Array.from({ length: 22 }, () => ({ ox: (R() - 0.5) * 5, oy: (R() - 0.5) * 5, ph: R() * 6.28, fr: 0.6 + R() * 0.7, run: R() * 6.28 }));

  const possSide = () => (holder !== null ? sideOf(holder) : flight && flight.kind !== 'shot' ? flight.side : loose ? sideOf(loose.to) : null);
  const nearest = (s, pt, skipGK = true, skip = []) => {
    let best = -1, bd = 1e9;
    for (let k = skipGK ? 1 : 0; k < 11; k++) { const j = J(s, k); if (skip.includes(j)) continue; const d = dist(P[j], pt); if (d < bd) { bd = d; best = j; } }
    return best;
  };
  // ofsayt çizgisi (s'nin koordinatında): rakibin en geri saha oyuncusu ya da top
  const offLine = (s) => {
    const o = other(s); let m = 1e9;
    for (let k = 1; k < 11; k++) m = Math.min(m, G(o, P[J(o, k)].y));
    return Math.max(PL / 2, PL - m, G(s, ball.y));
  };

  // ---------- top ----------
  function fly(to, x1, y1, kind, side, speed, arc = 0, opts = {}) {
    const d = Math.hypot(x1 - ball.x, y1 - ball.y);
    flight = { x0: ball.x, y0: ball.y, z0: ball.z, x1, y1, z1: opts.z1 ?? 0, t0: t, t1: t + Math.max(0.12, d / speed), kind, to, side, arc, curve: opts.curve || 0, ...opts };
    holder = null; loose = null;
    return flight;
  }
  function passTo(from, to, opts = {}) {
    const s = sideOf(from), tp = P[to];
    const lead = opts.lead ?? (1.5 + R() * 2.5);
    let x1 = clamp(tp.x + tp.vx * 0.5, 2, PW - 2), y1 = Yg(s, clamp(G(s, tp.y) + lead, 3, PL - 8));
    if (opts.at) { x1 = opts.at.x; y1 = opts.at.y; }
    const d = Math.hypot(x1 - ball.x, y1 - ball.y);
    const lofted = opts.lofted ?? d > 30;
    // ofsayt: pas anında alıcı rakibin sondan ikinci oyuncusunun ve topun önündeyse (kendi yarı sahası hariç)
    const gR = G(s, tp.y), offPos = to % 11 !== 0 && !opts.noOff && gR > PL / 2 && gR > G(s, ball.y) + 0.3 && gR > offLine(s) + 0.25;
    return fly(to, x1, y1, 'pass', s, lofted ? 21 : 17 + Math.min(9, d * 0.3), lofted ? clamp(d * 0.12, 2.5, 7) : 0.15, { curve: opts.curve || 0, from, offPos, offX: tp.x, offY: tp.y });
  }
  const mostAdvanced = (s) => { let b = -1, bg = -1; for (let k = 1; k < 11; k++) { if (roles[s][k].r < 0.85) continue; const g = G(s, P[J(s, k)].y); if (g > bg) { bg = g; b = J(s, k); } } return b; };
  const onside = (j) => G(sideOf(j), P[j].y) <= offLine(sideOf(j)) + 0.2 || G(sideOf(j), P[j].y) <= G(sideOf(j), ball.y);
  // pas hattı: rakiplerin top yoluna en yakın uzaklığı
  function laneGap(from, x1, y1, s) {
    const a = P[from], L2 = (x1 - a.x) ** 2 + (y1 - a.y) ** 2 || 1; let md = 99;
    for (let k = 0; k < 11; k++) {
      const q = P[J(other(s), k)];
      const u = ((q.x - a.x) * (x1 - a.x) + (q.y - a.y) * (y1 - a.y)) / L2;
      if (u < 0.12 || u > 1.02) continue;
      md = Math.min(md, Math.hypot(a.x + u * (x1 - a.x) - q.x, a.y + u * (y1 - a.y) - q.y));
    }
    return md;
  }
  // pas seçimi: ileri, açık, ofsaytta olmayan; gerekirse yana
  let passW = 0; // son seçilen pasın puanı (zayıfsa oyuncu topu sürer)
  function choosePass(from, push, skip = -1, mistime = 0) {
    const s = sideOf(from), g0 = G(s, P[from].y), off = offLine(s);
    const counter = t - won[s] < 4.5;   // top yeni kazanıldı: hızlı, dikine
    let best = -1, bw = -1, near = -1, nd = 1e9;
    for (let k = 1; k < 11; k++) {
      const j = J(s, k); if (j === from || j === skip) continue;
      const d = dist(P[j], P[from]), g = G(s, P[j].y);
      const late = g > off - 0.3; // ofsayt pozisyonunda
      if (!late && d > 5 && d < nd) { nd = d; near = j; }
      if (d < 5 || d > 46) continue;
      if (late && !(mistime && roles[s][k].r > 0.85 && g < off + 3.5 && R() < mistime)) continue; // erken koşu: bazen ofsayta düşer
      const tx = clamp(P[j].x + P[j].vx * 0.5, 2, PW - 2), ty = Yg(s, clamp(g + 2, 3, PL - 8));
      const gap = laneGap(from, tx, ty, s);
      const safe = clamp((gap - 0.9) / 3.2, 0.03, 1);
      const open = clamp(dist(P[nearest(other(s), P[j], false)], P[j]) / 6, 0.15, 1.2);
      const gain = g - g0;
      const kz = (g0 < 35 ? 0.025 : g0 < 70 ? 0.055 : 0.04) * [0.6, 1, 1.5][IN[s].tempo]; // sabırlı / dengeli / direkt
      let w = safe * safe * open * (1 + Math.max(0, gain) * kz * (counter ? 2 : 1) * (push ? 1.4 : 1));
      if (gain < -4) w *= counter ? 0.15 : IN[s].tempo === 0 ? 0.7 : push ? 0.3 : 0.6; // sabırlı oyun topu geri de oynar
      if (g0 > PL * 0.6 && gain < -8) w *= Math.abs(P[j].x - PW / 2) < 18 ? 0.08 : 0.3; // hücumda topu geri, göbeğe atma
      w *= d < 8 ? 0.7 : d <= 30 ? 1 : 0.65;
      if (late) w *= 1.8; // savunma arkasına koşu cazip görünür
      { const wideJ = Math.abs(P[j].x - PW / 2) > 19; // kanat oyunu kanatlara, dar oyun merkeze
        w *= IN[s].width === 2 ? (wideJ ? 1.7 : 0.8) : IN[s].width === 0 ? (wideJ ? 0.6 : 1.25) : 1; }
      if (j === gotFrom[from]) w *= 0.3; // az önce pası veren oyuncuya hemen geri verme
      w *= 0.85 + R() * 0.3;
      if (w > bw) { bw = w; best = j; }
    }
    passW = Math.max(0, bw);
    return best >= 0 ? best : near;
  }

  // ---------- kaleci: açı daraltma, uzanma ----------
  function gkTarget(s, j) { // s: kalecinin takımı (savunan)
    const gy = goalY(other(s)); // savunduğu kale
    const bx = flight ? flight.x1 : ball.x, by = flight ? flight.y1 : ball.y;
    const d = Math.hypot(bx - PW / 2, by - gy);
    let out = d < 40 ? clamp(1.2 + (40 - d) * 0.09, 1.2, 5.5) : clamp(5 + (d - 40) * 0.12, 5, 14);
    if (d < 9) out = 1;
    const ux = (bx - PW / 2) / (d || 1), uy = (by - gy) / (d || 1);
    return { x: clamp(PW / 2 + ux * out, PW / 2 - 9, PW / 2 + 9), y: gy + uy * out };
  }
  function dive(s, dir, dur = 0.38, lie = 0.9) { gkDive[s] = { v: 0, dir, t0: t, until: t + dur + lie, dur }; }

  // ---------- şut ----------
  function shoot(e) {
    const s = e.s, d = other(s), gy = goalY(s), gkj = J(d, 0), gk = P[gkj];
    let x1, y1, z1, speed = e.style === 'cross' || e.style === 'corner' || e.style === 'rebound' && R() < 0.4 ? 17 : e.style === 'pen' ? 24 : e.style === 'fk' ? 23 : 26 + R() * 6;
    const side = R() < 0.5 ? -1 : 1;
    let curve = e.style === 'fk' ? -side * 3 : e.style === 'long' ? (R() - 0.5) * 3 : 0;
    if (e.ev === 'goal') {
      // köşeye: kalecinin uzağına, alçak ya da üst köşe
      const far = gk.x < PW / 2 ? 1 : -1;
      x1 = PW / 2 + (R() < 0.8 ? far : -far) * (2.3 + R() * 1.2);
      z1 = R() < 0.4 ? 1.7 + R() * 0.5 : 0.15 + R() * 0.6;
      y1 = gy;
    } else if (e.ev === 'save') {
      x1 = clamp(gk.x + side * (0.5 + R() * 1.9), PW / 2 - 3.4, PW / 2 + 3.4); z1 = 0.3 + R() * 1.4; y1 = Yg(d, clamp(G(d, gk.y), 0.7, 6)); // kalecinin bulunduğu derinlikte
    } else {
      const over = R() < 0.35;
      x1 = over ? PW / 2 + side * R() * 3 : PW / 2 + side * (4.1 + R() * 3); z1 = over ? 2.7 + R() * 1.2 : 0.3 + R() * 1.2; y1 = gy;
    }
    if (e.ev === 'save') { const dd = Math.hypot(x1 - ball.x, y1 - ball.y); speed = Math.min(speed, dd / 0.6); }
    const f = fly(-1, x1, y1, 'shot', s, speed, 0, { z1, curve, ev: e.ev, ref: e });
    f.arc = e.style === 'fk' ? 1.4 : e.style === 'long' ? 0.8 : 0.2;
    // kaleci tepkisi: kısa gecikme, sonra uzanma
    const need = x1 - gk.x, react = e.style === 'pen' ? 0.02 : 0.12 + R() * 0.1;
    f.gk = { j: gkj, s: d, at: t + react, dir: Math.sign(need) || side, reach: e.ev === 'save' ? 1 : e.ev === 'goal' ? (R() < 0.25 ? -1 : 0.55 + R() * 0.25) : 0.6 };
    if (e.style === 'pen' && e.ev === 'goal' && R() < 0.6) f.gk.dir = -f.gk.dir; // ters köşe
    e.ta = undefined;
    return f;
  }

  // ---------- önemli an planı ----------
  function planAttack(e) {
    const s = e.s, d = other(s);
    mode = { e, s, d, t0: t, step: 0, chain: 0 };
    e.from = t;
    if (e.style !== 'pen' && e.style !== 'fk') e.T = Math.max(e.T, t + 5.5); // geç başladıysa kuruluma zaman tanı
    // kanat oyuncusu (orta için)
    if (e.style === 'cross') {
      let bw = -1, bx = -1;
      for (let k = 2; k < 11; k++) { const j = J(s, k); if (j === e.shooter || roles[s][k].r < 0.4) continue; const dx = Math.abs(P[j].x - PW / 2); if (dx > bx) { bx = dx; bw = j; } }
      e.winger = bw; mode.wx = bw >= 0 && P[bw].x < PW / 2 ? 3.5 : PW - 3.5;
    }
    // şutçunun hedef noktası
    const gy = goalY(s);
    const [wx, d0, dd] = e.style === 'cross' || e.style === 'corner' || e.style === 'rebound' ? [10, 6, 5] : e.style === 'long' ? [24, 21, 6] : [18, 11, 6];
    e.spot = { x: PW / 2 + (R() - 0.5) * wx, y: gy - dirY(s) * (d0 + R() * dd) };
  }

  // ---------- duran top kurulumları ----------
  function setDead(kind, extra = {}) { dead = { kind, t0: t, ...extra }; holder = null; flight = null; loose = null; }
  function kickoff(s) {
    setDead('kickoff');
    restart = { t: t + 0.1, x: PW / 2, y: PL / 2, holder: J(s, 10), kind: 'kickoff' };
  }

  // ---------- ana döngü ----------
  for (let n = 0; n < N; n++) {
    t = n * DT;
    const e = shots[ei];

    // önemli anı başlat
    if (e && !mode && !dead && t >= e.T - BUILD && e.style !== 'rebound') planAttack(e);
    if (e && !mode && e.style === 'rebound' && e.armed) { mode = { e, s: e.s, d: other(e.s), t0: t, step: 0 }; e.from = t; }
    if (e && !mode && e.style === 'rebound' && !e.armed && t > e.T + 12) { e.style = 'thru'; e.T = t + BUILD; }

    // yeniden başlama (santra, kale vuruşu, korner, serbest vuruş, penaltı)
    if (restart && t >= restart.t) {
      const rh = P[restart.holder];
      const ballThere = restart.kind === 'kickoff' || Math.hypot(ball.x - restart.x, ball.y - restart.y) < 0.3;
      if ((dist(rh, restart) > 1.5 || !ballThere) && t < restart.t + (restart.kind === 'corner' ? 10 : 4)) { /* oyuncu ve top yerine varsın */ } else {
        ball.x = restart.x; ball.y = restart.y; ball.z = 0;
        holder = restart.holder; const k = restart.kind; restart = null; dead = null; fallen = -1;
        nextAct = t + (k === 'pen' || k === 'fk' ? 0.6 : k === 'corner' ? 0.7 : 0.35);
        if (k === 'corner') mode && (mode.cornerReady = true);
        if (k === 'pen' || k === 'fk') mode && (mode.kickReady = true);
      }
    }

    // ---- kart faulleri (önemli an dışında) ----
    const fo = fouls[fi];
    if (fo && t >= fo.T && !mode && !dead && !restart) {
      const vic = other(fo.s);
      if (holder !== null && sideOf(holder) === vic) {
        const off = fo.slot !== undefined ? J(fo.s, fo.slot) : nearest(fo.s, P[holder]);
        if (dist(P[off], P[holder]) < 1.4 || t > fo.T + 6) {
          fo.T = t; fi++; fallen = holder; P[holder].down = t + 1.3;
          setDead('foul', { off });
          restart = { t: t + (fo.ev === 'red' ? 4 : 2.6), x: clamp(P[fallen].x, 2, PW - 2), y: clamp(P[fallen].y, 2, PL - 2), holder: fallen, kind: 'free' };
        } else fo.chase = off;
      } else if (t > fo.T + 10) { fo.T = t; fi++; }
    }

    // ---- önemli an: adım adım ----
    if (mode && !dead) {
      const { e: me, s, d } = mode;
      const gy = goalY(s);
      // 1) top bizde değilse kap (pres başarılı / araya girme)
      if (!me.setup && possSide() !== s) {
        if (holder !== null && holder % 11 !== 0 && t >= nextAct) {
          const tk = nearest(s, P[holder]);
          if (dist(P[tk], P[holder]) < 2.5) { holder = tk; nextAct = t + 0.35; tackleT = t; }
        } else if (loose && t - loose.t0 > 0.3) { const a = nearest(s, ball), b2 = nearest(d, ball); if (dist(P[a], ball) < dist(P[b2], ball) + 6) loose.to = a; }
        else if (flight && flight.kind === 'pass' && flight.side !== s && !flight.cut && !flight.gkDist) { // pas araya girer
          const u = (t - flight.t0) / (flight.t1 - flight.t0);
          if (u > 0.3) {
            const mx = lerp(flight.x0, flight.x1, u + 0.15), my = lerp(flight.y0, flight.y1, u + 0.15), cut = nearest(s, { x: mx, y: my });
            flight.cut = true; fly(cut, P[cut].x, P[cut].y, 'pass', s, 18, 0.2);
          }
        }
      }
      // 2) duran top kurulumu: korner / penaltı / serbest vuruş
      if (me.style === 'corner' && !me.setup && possSide() === s && G(s, ball.y) > PL * 0.55 && holder !== null && t > me.T - 5.5) {
        me.setup = true; me.cornered = true; // savunmacı topu çizgiden dışarı çıkarır
        const sx = ball.x < PW / 2 ? -1 : 1, x1 = PW / 2 + sx * (12 + R() * 12);
        const dj = nearest(d, ball); P[dj].down = t + 0.8;
        fly(-1, x1, gy + dirY(s) * 1.5, 'out', d, 16, 1.2, { corner: s });
      }
      if ((me.style === 'pen' || me.style === 'fk') && !me.setup && !me.pre && possSide() === s && holder !== null && t > me.T - 9.5) {
        const F0 = me.fslot !== undefined ? J(d, me.fslot) : -1;
        let W = me.wslot !== undefined ? J(s, me.wslot) : -1;
        if (W < 0 || W % 11 === 0) W = holder % 11 ? holder : J(s, 10);
        const hand = me.c === 'hand';
        const tp = me.style === 'pen' ? { x: PW / 2 + (R() - 0.5) * 16, y: gy - dirY(s) * (15 + R() * 3) } : { x: clamp(ball.x, 16, PW - 16), y: gy - dirY(s) * (23 + R() * 5) };
        me.pre = { W, F: F0 >= 0 ? F0 : nearest(d, P[W]), hand, tp, t0: t, hs: { x: PW / 2 + (R() - 0.5) * 8, y: gy - dirY(s) * 8 } };
        if (hand) { let bj = me.pre.F, bd = 1e9; for (let k = 1; k < 11; k++) { const j = J(d, k), dd2 = dist(P[j], me.pre.hs); if (dd2 < bd) { bd = dd2; bj = j; } } me.pre.F = bj; }
        me.from = Math.min(me.from, t);
      }
      const q = me.pre;
      if (q && !me.setup) {
        // hücumcuya pas, savunmacı dalar / el: orta koluna çarpar
        if (!q.hand && holder !== null && sideOf(holder) === s && holder !== q.W && !q.passed && t >= nextAct && (onside(q.W) || t > q.t0 + 6)) { q.passed = true; passTo(holder, q.W, { at: { x: lerp(P[q.W].x, q.tp.x, 0.6), y: lerp(P[q.W].y, q.tp.y, 0.6) } }); }
        if (q.hand && !q.launched && holder !== null && sideOf(holder) === s && (dist(P[q.F], q.hs) < 2.5 || t > q.t0 + 6)) { q.launched = true; fly(q.F, P[q.F].x, P[q.F].y, 'hand', s, 18, dist(ball, P[q.F]) > 18 ? 2.5 : 0.9); }
        const inBox = Math.abs(P[q.W].x - PW / 2) < 19.5 && G(s, P[q.W].y) > PL - 16.3;
        let blow = false;
        if (!q.hand && holder === q.W && dist(P[q.F], P[q.W]) < 1.3 && (me.style === 'pen' ? inBox : !inBox)) blow = true;
        if (q.hand && q.touched) blow = true;
        if (t > q.t0 + 9 && (q.hand || me.style !== 'pen' || inBox)) blow = true;
        if (t > q.t0 + 15) blow = true; // son çare
        if (blow) {
          me.setup = true; me.setT = t;
          if (!q.hand) { fallen = q.W; P[q.W].down = t + 1.6; }
          const x0 = me.style === 'pen' ? PW / 2 : clamp(ball.x, 14, PW - 14);
          const y0 = me.style === 'pen' ? gy - dirY(s) * 11 : Yg(s, clamp(G(s, ball.y), PL - 30, PL - 20));
          const wall = [];
          if (me.style === 'fk') {
            const gx = PW / 2 - x0, gyy = gy - y0, L = Math.hypot(gx, gyy), ux = gx / L, uy = gyy / L;
            const cand = []; for (let k = 1; k < 11; k++) cand.push(J(d, k));
            cand.sort((a, b) => dist(P[a], { x: x0, y: y0 }) - dist(P[b], { x: x0, y: y0 }));
            cand.slice(0, 4).forEach((j, i) => wall.push({ j, x: x0 + ux * 9.15 - uy * (i - 1.5) * 0.7, y: y0 + uy * 9.15 + ux * (i - 1.5) * 0.7 }));
          }
          setDead(me.style, { side: s, x: x0, y: y0, off: q.F, wall });
          restart = { t: t + (me.style === 'pen' ? 5 : 4), x: x0, y: y0, holder: me.shooter, kind: me.style };
          me.T = Math.max(me.T, restart.t + 0.8);
        }
      }
      // 3) oyun kurulumu ve son pas
      const H = holder;
      if (H !== null && sideOf(H) === s && !dead && t >= nextAct && !q && me.style !== 'pen' && me.style !== 'fk') {
        const tempo = IN[s].tempo, gH = G(s, P[H].y), timeLeft = me.T - t;
        if (me.style === 'corner' && mode.cornerReady) { // korner ortası: golcünün kafasına
          mode.cornerReady = false;
          passTo(H, me.shooter, { at: me.spot, lofted: true, noOff: true }); flight.arc = 4.5; me.delivered = true;
        } else if (me.style === 'corner' && me.setup) { nextAct = t + 0.3; }
        else if (H === me.shooter && me.style !== 'corner') {
          const range = me.style === 'long' ? 36 : 26;
          if (timeLeft > 2.4) { const to = choosePass(H, true, H); if (to >= 0) passTo(H, to); nextAct = t + 0.6; } // erken aldı: dağıt
          else if (G(s, P[H].y) < PL - range - 6 && !me.oneTwo) { // kaleye uzak: ver-kaç
            me.oneTwo = true; const to = choosePass(H, true, H); if (to >= 0) passTo(H, to); me.T = Math.max(me.T, t + 3.2); nextAct = t + 0.6;
          } else nextAct = t + 0.2; // şut anı: kaleye doğru sürer
        } else if (me.style === 'cross' && me.winger >= 0) {
          if (H === me.winger) {
            if ((timeLeft < 1.4 || G(s, P[H].y) > PL - 11) && !onside(me.shooter) && t < me.T + 2) nextAct = t + 0.15;
            else if (timeLeft < 1.4 || G(s, P[H].y) > PL - 11) { const sp = P[me.shooter]; passTo(H, me.shooter, { at: { x: lerp(sp.x, me.spot.x, 0.5), y: Yg(s, clamp(G(s, sp.y) + 2, PL - 16, PL - 5)) }, lofted: true }); flight.arc = 3.5 + R(); me.crossT = t; }
            else nextAct = t + 0.2;
          } else if (timeLeft < 4 + R()) passTo(H, me.winger, { at: { x: mode.wx, y: gy - dirY(s) * (24 + R() * 6) } });
          else { const to = choosePass(H, true, me.shooter); if (to >= 0) passTo(H, to); nextAct = t + 0.6 + R() * 0.4; }
        } else if (timeLeft < 1.7 && (me.style === 'thru' || me.style === 'long') && !onside(me.shooter) && t < me.T + 2) {
          nextAct = t + 0.15; // golcü ofsayttan çıksın
        } else if (timeLeft < 1.7 && (me.style === 'thru' || me.style === 'long')) {
          const sp = P[me.shooter];
          if (me.style === 'thru') passTo(H, me.shooter, { at: { x: clamp(lerp(sp.x, me.spot.x, 0.4), 5, PW - 5), y: Yg(s, clamp(G(s, sp.y) + 5, 10, PL - 9)) }, lofted: dist(P[H], sp) > 32 });
          else passTo(H, me.shooter, { at: { x: sp.x, y: Yg(s, Math.min(G(s, sp.y) + 1.5, PL - 18)) } });
          me.lastPasser = H;
        } else {
          const to = choosePass(H, true, me.shooter);
          if (to >= 0 && (gH < PL - 30 || timeLeft > 3)) { passTo(H, to); mode.chain++; }
          nextAct = t + (0.55 + R() * 0.6) * (1 - (tempo - 1) * 0.25);
        }
      }
      // geç kaldı: golcüye ceza sahasına doğrudan top
      if (!me.done && t > me.T + 1.2 && !dead && holder !== null && sideOf(holder) === s && holder !== me.shooter && !me.rescue && me.spot && me.style !== 'pen' && me.style !== 'fk') {
        if (!onside(me.shooter) && t < me.T + 3) { /* bekle */ } else { me.rescue = true; const sp = P[me.shooter]; passTo(holder, me.shooter, { at: { x: sp.x, y: Yg(s, Math.min(G(s, sp.y) + 3, PL - 9)) }, lofted: dist(P[holder], sp) > 25 }); }
      }
      // 4) şut
      const byline = G(s, ball.y) > PL - 4 && Math.abs(ball.x - PW / 2) > 12; // korner bayrağı / çizgi dibi
      if (!me.done && t >= me.T && !dead && (me.style !== 'pen' && me.style !== 'fk' || me.setup) && (me.style !== 'corner' || !me.cornered || me.delivered) && !byline &&
          ((holder === me.shooter && G(s, ball.y) > PL - (me.style === 'long' ? 36 : me.style === 'fk' ? 33 : 26)) || (t > me.T + 3 && holder !== null && sideOf(holder) === s && G(s, ball.y) > PL - 30) || t > me.T + 9)) {
        if (holder !== me.shooter && holder !== null) me.shooterSwap = holder;
        me.done = true; me.t = t / SPM; me.T = t;
        shoot(me);
      }
    }

    // ---- açık oyun kararları (önemli an dışında) ----
    if (!mode && !dead && !cornerClear && holder !== null && holder % 11 !== 0 && t >= nextAct) {
      const s = sideOf(holder), d = other(s);
      const tempo = IN[s].tempo, gH = G(s, P[holder].y);
      // pres: yakındaki savunmacı topu kapabilir
      const pr = nearest(d, P[holder]);
      const share = s === 'h' ? poss : 1 - poss;
      if (dist(P[pr], P[holder]) < 2 && R() < 0.3 + (0.5 - share) * 0.5 + (IN[d].press - 1) * 0.08) {
        holder = pr; tackleT = t; nextAct = t + 0.5;
      } else if (gH > PL - 30 && R() < 0.55) {
        const u = R(), gy = goalY(s);
        if (u < 0.55) { // orta / içeri top: savunmacı kafayla uzaklaştırır
          const spot = { x: PW / 2 + (R() - 0.5) * 16, y: gy - dirY(s) * (6 + R() * 7) }, hd = nearest(d, spot);
          passTo(holder, hd, { at: { x: P[hd].x, y: P[hd].y }, lofted: true }); flight.arc = 3.5 + R(); flight.side = d; flight.clear = true;
        } else { // savunma arkasına ara pas: kaleci alır ya da top auta çıkar
          const x1 = PW / 2 + (R() - 0.5) * 22;
          fly(-1, x1, gy + dirY(s) * 1.5, 'byline', s, 17, 0.4, { gkSide: d });
        }
        nextAct = t + 0.8;
      } else if (gH > 34 && gH < 76 && R() < 0.24 && (() => { const f = mostAdvanced(s); return f >= 0 && G(s, P[f].y) > offLine(s) - 10; })()) {
        // savunma arkasına ara pas: forvet koşuyu zamanlarsa sarkar, erken kalkarsa ofsayt
        const f = mostAdvanced(s), off = offLine(s), ofs = R() < 0.45;
        passTo(holder, f, { at: { x: clamp(P[f].x + (PW / 2 - P[f].x) * 0.2, 6, PW - 6), y: Yg(s, Math.min(off + 9, PL - 12)) }, lofted: dist(P[holder], P[f]) > 32, noOff: true });
        if (ofs) { flight.offPos = true; flight.offX = P[f].x; flight.offY = Yg(s, Math.max(G(s, P[f].y), off + 0.8)); }
        nextAct = t + 0.8;
      } else {
        const to = choosePass(holder, true, -1, 0.5);
        const space = dist(P[nearest(d, P[holder], false)], P[holder]);
        if (to >= 0 && (passW > 0.18 || space < 4)) {
          // kapalı hatta pas: araya giren savunmacı alır
          const gap = laneGap(holder, P[to].x, P[to].y, s);
          if (gap < 1.3 && R() < 0.55 + (0.5 - share) * 0.4) {
            const cut = nearest(d, { x: (P[holder].x + P[to].x) / 2, y: (P[holder].y + P[to].y) / 2 });
            fly(cut, lerp(P[holder].x, P[to].x, 0.5), lerp(P[holder].y, P[to].y, 0.5), 'pass', d, 16, 0.2);
          } else {
            passTo(holder, to);
            // çizgi dibindeki forvete ara pas: koşu bazen erken, yan hakem bayrak kaldırır
            if (roles[s][to % 11].r > 0.85 && G(s, P[to].y) > offLine(s) - 1.6 && G(s, P[to].y) > PL / 2 + 5 && R() < 0.3) { flight.offPos = true; flight.offX = P[to].x; flight.offY = P[to].y; }
          }
          nextAct = t + (0.5 + R() * 0.7) * (1 - (tempo - 1) * 0.25);
        } else nextAct = t + 0.45; // iyi seçenek yok: topu ileri sürer, az sonra yeniden bakar
      }
    }
    // kaleci topu tutuyorsa: kısa süre sonra oyunu başlatır
    if (holder !== null && holder % 11 === 0 && t >= nextAct && !dead && !mode?.e?.pre) {
      const s = sideOf(holder), d = other(s);
      let to = -1, bw = -1;
      for (let k = 1; k < 11; k++) { // kısa: rakipten en az 9 m uzaktaki defans / orta saha
        const j = J(s, k), dd = dist(P[j], P[holder]); if (dd < 8 || dd > 40) continue;
        const free = dist(P[nearest(d, P[j], false)], P[j]);
        if (free < 9) continue;
        const w = free + (roles[s][k].r < 0.2 ? 4 : 0) + R() * 3; if (w > bw) { bw = w; to = j; }
      }
      if (to >= 0) { passTo(holder, to, { lofted: dist(P[holder], P[to]) > 25, lead: 1, noOff: true }); flight.gkDist = true; }
      else { // uzun: orta sahadaki / forvetteki en boş oyuncuya
        for (let k = 1; k < 11; k++) { const j = J(s, k); if (roles[s][k].r < 0.45) continue; const w = dist(P[nearest(d, P[j], false)], P[j]) + R() * 4; if (w > bw) { bw = w; to = j; } }
        if (to >= 0) {
          passTo(holder, to, { lofted: true, lead: 0.5, noOff: true }); flight.arc = Math.max(flight.arc, 6); flight.gkDist = true;
          if (R() < 0.3) { flight.to = nearest(d, { x: flight.x1, y: flight.y1 }); flight.side = d; } // hava topunu rakip kazanır
        }
      }
      nextAct = t + 0.8;
    }

    // ---- top uçuşu bitti mi ----
    if (flight) {
      const f = flight, u = clamp((t - f.t0) / (f.t1 - f.t0), 0, 1);
      // kaleci uzanması
      if (f.kind === 'shot' && f.gk && t >= f.gk.at && !f.gk.started) {
        f.gk.started = true;
        const reachX = f.gk.reach < 0 ? -1 : 1;
        dive(f.gk.s, f.gk.dir * reachX, 0.36, f.ev === 'save' ? 0.6 : 1.1);
        const g0 = P[f.gk.j];
        const tx2 = f.ev === 'save' ? f.x1 : g0.x + f.gk.dir * reachX * Math.max(0.8, Math.abs(f.x1 - g0.x) * Math.max(0.3, Math.abs(f.gk.reach)));
        const ty2 = f.ev === 'save' ? f.y1 : g0.y;
        gkMove[f.gk.j] = { sx: g0.x, sy: g0.y, tx: clamp(tx2, PW / 2 - 4.2, PW / 2 + 4.2), ty: ty2, at: t, end: Math.max(t + 0.32, t + Math.hypot(tx2 - g0.x, ty2 - g0.y) / 6.5, f.ev === 'save' ? f.t1 : f.t1 + 0.05), lie: t + 1.4 };
      }
      if (u >= 1) {
        flight = null;
        ball.x = f.x1; ball.y = f.y1; ball.z = f.z1;
        if (f.kind === 'shot') {
          const e2 = f.ref; e2.ta = t / SPM;
          const d = other(f.side), gkj = J(d, 0);
          if (f.ev === 'goal') { // ağlar
            ripple = 1; rippleSide = f.y1 < PL / 2 ? 1 : -1;
            fly(-1, clamp(f.x1 + (f.x1 - f.x0) * 0.04, PW / 2 - 3.4, PW / 2 + 3.4), f.y1 + dirY(f.side) * 1.7, 'net', f.side, 7, 0, { z1: 0 });
            flight.z0 = f.z1;
            setDeadKeep('goal', { side: f.side, scorer: e2.shooterSwap ?? e2.shooter, flagX: f.x1 < PW / 2 ? 2.5 : PW - 2.5 });
            restartAfterGoal(d, t + 11);
          } else if (f.ev === 'save') {
            const catchIt = Math.abs(f.x1 - PW / 2) < 2.4 && f.z1 < 1.6 && !e2.parryTo && dist(P[gkj], ball) < 1.2;
            if (catchIt) { holder = gkj; nextAct = t + 1.6; e2.caught = true; }
            else { // çeler: dönen top ya da korner
              const sx = f.x1 < PW / 2 ? -1 : 1;
              if (e2.parryTo) {
                const nx = e2.parryTo; nx.armed = true; nx.T = t + 1.1;
                const pt = { x: PW / 2 + sx * (5 + R() * 4), y: goalY(f.side) - dirY(f.side) * (8 + R() * 4) };
                fly(nx.shooter, pt.x, pt.y, 'pass', f.side, 12, 0.6); nx.spot = pt;
              } else if (R() < 0.55) fly(-1, PW / 2 + sx * (5 + R() * 4), goalY(f.side) + dirY(f.side) * 1.5, 'out', d, 10, 1.4, { corner: f.side });
              else { const pt = { x: PW / 2 + sx * (9 + R() * 6), y: goalY(f.side) - dirY(f.side) * (5 + R() * 6) }; const cl = nearest(d, pt); fly(cl, pt.x, pt.y, 'pass', d, 10, 0.8); }
            }
          } else { // dışarı: kale vuruşu
            setDead('out');
            restart = { t: t + 2.2, x: PW / 2 + (R() - 0.5) * 8, y: goalY(f.side) - dirY(f.side) * 5.5, holder: gkj, kind: 'goalkick' };
          }
          if (mode && mode.e === e2) mode = null, ei++;
          else if (mode === null) ei = Math.max(ei, shots.indexOf(e2) + 1);
        } else if (f.kind === 'net') {
          ball.z = 0;
        } else if (f.kind === 'out') { // korner
          const s2 = f.corner, gy = goalY(s2), cx = f.x1 < PW / 2 ? 0.6 : PW - 0.6;
          let tk = J(s2, 2), bd = 1e9;
          const ce = mode && mode.e.style === 'corner' && mode.e.s === s2 && !mode.e.done ? mode.e : null;
          for (let k = 1; k < 11; k++) { const j = J(s2, k); if (ce && j === ce.shooter) continue; const dd = Math.hypot(P[j].x - cx, P[j].y - (gy - dirY(s2) * 0.6)); if (dd < bd) { bd = dd; tk = j; } } // bayrağa en yakın
          corners.push({ t: t / SPM, s: s2 });
          setDead('corner', { side: s2, ev: ce });
          restart = { t: t + 2.2, x: cx, y: gy - dirY(s2) * 0.6, holder: tk, kind: 'corner' };
          if (!ce) { mode = null; } // olaysız korner: savunma uzaklaştırır
          if (!ce) cornerClear = { s: s2 };
        } else if (f.kind === 'hand') {
          if (mode?.e?.pre) mode.e.pre.touched = true;
          loose = { to: f.to, t0: t, vx: 0, vy: 0 };
        } else if (f.kind === 'byline') { // ara pas fazla uzun: kale vuruşu
          const gkj = J(f.gkSide, 0);
          setDead('out');
          restart = { t: t + 2.2, x: PW / 2 + (R() - 0.5) * 8, y: goalY(f.side) - dirY(f.side) * 5.5, holder: gkj, kind: 'goalkick' };
        } else if (f.offPos && f.to >= 0 && !(mode && mode.s === f.side)) { // ofsayt: yan hakem bayrak kaldırır
          const s2 = f.side, d2 = other(s2);
          offsides.push({ t: t / SPM, s: s2, p: f.to });
          setDead('offside');
          const at = { x: clamp(f.offX, 2, PW - 2), y: clamp(f.offY, 2, PL - 2) };
          restart = { t: t + 2.4, x: at.x, y: at.y, holder: nearest(d2, at), kind: 'free' };
        } else if (f.to >= 0 && dist(P[f.to], ball) < (f.arc > 1 ? 3 : 2.2)) {
          holder = f.to; nextAct = Math.max(nextAct, t + 0.25 + R() * 0.25); if (f.from !== undefined) gotFrom[f.to] = f.from;
          if (f.clear) { // kafayla uzaklaştırma: top orta sahaya, oradaki mücadeleyi yakın olan kazanır
            const s2 = sideOf(f.to), tgt = { x: clamp(ball.x + (R() - 0.5) * 30, 6, PW - 6), y: Yg(s2, clamp(G(s2, ball.y) + 30 + R() * 15, 30, 62)) };
            const mine = nearest(s2, tgt), theirs = nearest(other(s2), tgt);
            const win = dist(P[mine], tgt) < dist(P[theirs], tgt) + 4 ? mine : theirs;
            fly(win, tgt.x, tgt.y, 'pass', s2, 20, 5 + R() * 2);
          }
        }
        else if (f.to >= 0) { const L = Math.hypot(f.x1 - f.x0, f.y1 - f.y0) || 1; loose = { to: f.to, t0: t, vx: (f.x1 - f.x0) / L * 2.5, vy: (f.y1 - f.y0) / L * 2.5 }; }
      }
    }
    // olaysız korner: kafayla uzaklaştırma
    if (cornerClear && holder !== null && !dead && sideOf(holder) !== cornerClear.s) cornerClear = null;
    if (cornerClear && holder !== null && !dead && t >= nextAct && sideOf(holder) === cornerClear.s) {
      const s2 = cornerClear.s, d = other(s2), gy = goalY(s2);
      const spot = { x: PW / 2 + (R() - 0.5) * 14, y: gy - dirY(s2) * (6 + R() * 6) }, hd = nearest(d, spot);
      passTo(holder, hd, { at: { x: P[hd].x, y: P[hd].y }, lofted: true }); flight.arc = 4.5; flight.side = d;
      cornerClear = null;
    }

    // ---- oyuncular ----
    const ps = possSide();
    if (ps && ps !== lastSide) { won[ps] = t; lastSide = ps; }
    const bxm = flight ? flight.x1 : ball.x, bym = flight ? flight.y1 : ball.y;
    // savunma: 1. presçi topa, 2. presçi pas yoluna, diğerleri bölge + adam takibi
    const blk = {};
    for (const s of ['h', 'a']) {
      const own = ps === s, bg = G(s, bym), pr = IN[s].press - 1, wd = IN[s].width - 1;
      const mt = IN[s].ment || 0;
      const line = own ? clamp(bg - 18 + mt * 3, 16, 66) : clamp(bg - 18 + pr * 6 + mt * 3, 8, 38 + pr * 8);
      blk[s] = { own, line, len: own ? 40 : 26 - pr * 3, wid: own ? 0.95 * (1 + wd * 0.07) : 0.66, sh: own ? 0.2 : 0.42, off: offLine(s) };
    }
    let p1 = -1, p2 = -1;
    const marks = new Map();
    if (ps && holder !== null) {
      const ds = other(ps);
      p1 = nearest(ds, P[holder]);
      if (IN[ds].press === 0 && G(ds, ball.y) > PL * 0.55) p1 = -1; // düşük pres: rakip yarı sahada basmaz
      if (IN[ds].press >= 1 || G(ds, ball.y) < PL * 0.4) p2 = nearest(ds, P[holder], true, [p1]);
      // adam takibi: savunma üçte birinde rakip hücumcuları kale tarafından takip et
      const att = []; for (let k = 1; k < 11; k++) { const j = J(ps, k); if (j !== holder && G(ds, P[j].y) < 40) att.push(j); }
      att.sort((a, b) => G(ds, P[a].y) - G(ds, P[b].y));
      const used = new Set([p1, p2]);
      for (const a of att) {
        let best = -1, bd = 1e9;
        for (let k = 1; k < 11; k++) { const j = J(ds, k); if (used.has(j)) continue; const dd = dist(P[j], P[a]); if (dd < bd) { bd = dd; best = j; } }
        if (best >= 0 && bd < 18) { used.add(best); marks.set(best, a); }
      }
    }
    // ikili mücadele: presçi yapışınca müdahaleye dalar; önemli anda hücumcu sıyrılır, açık oyunda bazen top kaybedilir
    if (p1 >= 0 && holder !== null && holder % 11 && !dead && !(mode && mode.e.pre && !mode.e.setup) && t > duelT + 1.6 && dist(P[p1], P[holder]) < 1.5) {
      duelT = t;
      const h = P[holder], hs = sideOf(holder), ax = h.x - P[p1].x, ay = h.y - P[p1].y, L = Math.hypot(ax, ay) || 1;
      lunge[p1] = { until: t + 0.45, x: h.x + ax / L * 2.2, y: h.y + ay / L * 2.2 };
      const keep = mode ? mode.s === hs : R() < 0.62; // önemli anda hücum edecek takım kazanır
      if (keep) { const sd2 = R() < 0.5 ? -1 : 1; side[holder] = { until: t + 0.55, x: clamp(h.x - ay / L * 3 * sd2 + (PW / 2 - h.x) * 0.05, 3, PW - 3), y: h.y + dirY(hs) * 3.5 }; nextAct = Math.max(nextAct, t + 0.5); }
      else { holder = p1; nextAct = t + 0.6; tackleT = t; }
    }
    for (let j = 0; j < 22; j++) {
      const s = sideOf(j), k = j % 11, p = P[j], ro = roles[s][k], bk = blk[s];
      let tx, ty, vmax = JOG;
      // temel: canlı takım şekli — blok topa kayar ve daralır, hatlar kademeli, herkes sürekli küçük hareketler yapar
      const pe = pers[j], own = bk.own, wd2 = IN[s].width - 1;
      const cxs = PW / 2 + (bxm - PW / 2) * (own ? 0.32 : 0.55);
      const wdt = own ? PW * 0.84 * (1 + wd2 * 0.07) : PW * 0.52;
      tx = cxs + (ro.fx - 0.5) * wdt + pe.ox * (ro.r < 0.2 ? 0.4 : 1);
      let early = false; // forvetin erken koşusu (ofsayta düşebilir)
      let g = bk.line + ro.r * bk.len + pe.oy * (ro.r < 0.2 ? 0.25 : 1);
      if (own && ro.r > 0.3) g += Math.abs(ro.fx - 0.5) * 7;                // hücumda kanatlar biraz önde
      if (!own && Math.abs(tx - bxm) > 22) tx += (bxm - tx) * 0.25;         // savunmada uzak taraf içeri kapanır
      tx += Math.sin(t * 0.6 * pe.fr + pe.ph) * 2.2; g += Math.cos(t * 0.5 * pe.fr + pe.ph) * 1.6; // nefes alan şekil
      if (own && holder !== null && sideOf(holder) === s && !dead) {
        const h = P[holder], hg = G(s, h.y);
        if (ro.r > 0.9) { // forvet: bir topa gelir, bir savunma arkasına koşar
          const cyc = Math.sin(t * 0.45 * pe.fr + pe.run);
          if (cyc > 0.86) { g = bk.off + 2; early = true; } else if (cyc > 0.35) { g = Math.max(g, bk.off - 0.8); tx = lerp(tx, PW / 2 + (tx - PW / 2) * 0.6, 0.5); }
          else if (cyc < -0.45) { g = Math.min(g, hg + 11); tx = lerp(tx, h.x, 0.35); }
        } else if (ro.r < 0.15 && Math.abs(ro.fx - 0.5) > 0.3 && hg > PL * 0.5 && Math.sign(h.x - PW / 2) === Math.sign(ro.fx - 0.5)) {
          g = Math.max(g, Math.min(hg + 3, bk.off - 2)); tx = ro.fx < 0.5 ? 4 : PW - 4; // bek bindirmesi
        } else if (ro.r >= 0.3 && ro.r <= 0.8 && dist(p, h) < 28 && j !== holder) { // orta saha: pas üçgeni
          const sideX = (pe.ph > 3.14 ? 1 : -1) * (9 + pe.fr * 4);
          tx = lerp(tx, clamp(h.x + sideX, 4, PW - 4), 0.55); g = lerp(g, hg + (pe.oy > 0 ? 9 : 2), 0.55);
        }
      }
      if (own && t - won[s] < 4.5 && ro.r >= 0.45 && k > 0) { g += 9 * ro.r; } // kontra: öne koşu
      if (bk.own && !early) g = Math.min(g, bk.off - 1.2);
      tx = clamp(tx, 2.5, PW - 2.5);
      ty = Yg(s, clamp(g, 7, PL - 6));
      { // geride kalan oyuncu hücuma / savunmaya koşarak yetişir
        const lag = g - G(s, p.y);
        if (own && (lag > 14 || (lag > 5 && t - won[s] < 4.5))) vmax = SPRINT * 0.95; else if (own && lag > 6) vmax = RUN;
        else if (Math.abs(lag) > 6 || Math.abs(p.x - tx) > 10) vmax = RUN * 0.85;
      }

      if (dead) {
        ({ tx, ty, vmax } = deadTarget(j, s, k, p, ro, tx, ty, vmax));
        if (restart && j === restart.holder && (dead.kind !== 'goal' || t - dead.t0 > 6.5)) { tx = restart.x; ty = restart.y; vmax = dist(p, restart) > 8 ? SPRINT : JOG; }
      } else if (k === 0) {
        const gt = gkTarget(s, j); tx = gt.x; ty = gt.y; vmax = RUN;
        if (flight && flight.kind === 'shot' && flight.gk && flight.gk.j === j && flight.gk.started) { tx = flight.gk.x; ty = flight.gk.y; vmax = 9.5; }
        if (holder === j) { tx = p.x; ty = p.y; }
      } else {
        const me = mode?.e;
        if (j === holder) {
          // top sürme: boşluğa doğru; önemli anda şutçu kaleye, kanatçı çizgiye
          tx = p.x + (PW / 2 - p.x) * 0.05; ty = Yg(s, Math.min(G(s, p.y) + 5, Math.max(G(s, p.y), PL - 22))); vmax = JOG;
          { // baskı varsa topu kendinden uzaklaştırır, önü boşsa hızla taşır
            const op = nearest(other(s), p, false), od = dist(P[op], p);
            if (od < 3.2 && !(mode && mode.s !== s)) { const ax = p.x - P[op].x, ay = p.y - P[op].y, L = Math.hypot(ax, ay) || 1; tx = p.x + ax / L * 4 + (PW / 2 - p.x) * 0.15; ty = p.y + ay / L * 2 + dirY(s) * 2; vmax = JOG * 0.8; }
            else if (od > 7 && G(s, p.y) < PL - 25) { ty = Yg(s, G(s, p.y) + 10); vmax = RUN * (t - won[s] < 4.5 ? 0.95 : 0.82); }
          }
          if (side[j] && t < side[j].until) { tx = side[j].x; ty = side[j].y; vmax = SPRINT; } // çalımla sıyrılış
          tx = clamp(tx, 2, PW - 2); ty = clamp(ty, 2, PL - 2);
          if (me && me.s === s && j === me.winger) { tx = mode.wx; ty = Yg(s, PL - 9); vmax = RUN * 0.8; }
          else if (me && me.s === s && j === me.shooter && me.spot) { tx = me.spot.x; ty = me.spot.y; vmax = JOG; }
          if (me && me.pre && j === me.pre.W) { // pen: ceza sahasına dalar; fk: ceza sahası önünde kalır
            tx = me.pre.tp.x + (PW / 2 - me.pre.tp.x) * 0.3; vmax = JOG;
            ty = me.style === 'pen' ? Yg(s, Math.min(PL - 9, G(s, p.y) + 6)) : Yg(s, Math.min(PL - 21, G(s, p.y) + 3));
            if (me.style === 'pen') vmax = RUN * 0.8;
          }
          if (me && me.setup && (me.style === 'pen' || me.style === 'fk')) { tx = p.x; ty = p.y; vmax = WALK; }
        } else if (flight && flight.kind === 'pass' && flight.to === j) { tx = flight.x1; ty = flight.y1; vmax = SPRINT; }
        else if (loose && loose.to === j) { tx = ball.x; ty = ball.y; vmax = SPRINT; }
        else if (fouls[fi]?.chase === j && holder !== null) { tx = P[holder].x; ty = P[holder].y; vmax = SPRINT; }
        else if (me && me.pre && j === me.pre.F && !me.setup) {
          if (me.pre.hand) { tx = me.pre.launched ? p.x : me.pre.hs.x; ty = me.pre.launched ? p.y : me.pre.hs.y; vmax = RUN; }
          else if (holder === me.pre.W) {
            const W = P[me.pre.W], inBox = G(me.s, W.y) > PL - 16.3;
            if (me.style === 'pen' && !inBox) { tx = W.x + (PW / 2 - W.x) * 0.1; ty = W.y + dirY(me.s) * 2.2; vmax = RUN; }
            else { tx = W.x; ty = W.y; vmax = SPRINT; }
          }
        } else if (me && me.pre && j === me.pre.W && holder !== j) { tx = me.pre.tp.x; ty = flight?.to === j ? me.pre.tp.y : Yg(me.s, Math.min(G(me.s, me.pre.tp.y), offLine(me.s) - 0.7)); vmax = RUN; }
        else if (lunge[j] && t < lunge[j].until) { tx = lunge[j].x; ty = lunge[j].y; vmax = SPRINT; } // müdahaleye dalış
        else if (j === p1) { // topa bas: adamın 1 m önünde, kale tarafında
          const h = P[holder], gl = goalY(other(s));
          const ux = (gl === 0 ? 0 : 0) , dy = gl - h.y, L = Math.abs(dy) || 1;
          tx = h.x + (PW / 2 - h.x) * 0.04 + ux; ty = h.y + (dy / L) * 1.1; vmax = SPRINT;
        } else if (j === p2) { // ikinci baskı: en yakın pas seçeneğinin yolunu kapat
          const opt = nearest(sideOf(holder), P[holder], true, [holder]);
          tx = lerp(P[holder].x, P[opt].x, 0.45); ty = lerp(P[holder].y, P[opt].y, 0.45); vmax = RUN;
        } else if (marks.has(j)) { // adam takibi: kale tarafında 1.8 m
          const a = P[marks.get(j)], gl = goalY(other(s)), dy = gl - a.y, L = Math.hypot(PW / 2 - a.x, dy) || 1;
          tx = lerp(tx, a.x + (PW / 2 - a.x) / L * 1.8, 0.75); ty = lerp(ty, a.y + dy / L * 1.8, 0.75); vmax = RUN;
        } else if (me && me.s === s) { // hücum koşuları
          if (j === me.shooter && me.spot) {
            const late = me.T - t < 2.2, coming = flight?.to === j;
            ty = coming ? me.spot.y : Yg(s, Math.min(G(s, me.spot.y), offLine(s) - 0.7)); tx = me.spot.x; vmax = late || coming ? SPRINT : RUN;
          } else if (j === me.winger) { tx = mode.wx; ty = Yg(s, Math.min(PL - 12, offLine(s) - 1)); vmax = RUN; }
          else if (holder !== null && sideOf(holder) === s && roles[s][k].r > 0.3) { // destek: topun 10-15 m önü/çaprazı
            const h = P[holder]; const side = p.x < h.x ? -1 : 1;
            tx = lerp(tx, clamp(h.x + side * 12, 4, PW - 4), 0.5); ty = Yg(s, Math.min(offLine(s) - 1, Math.max(G(s, ty), G(s, h.y) + 6)));
            vmax = RUN * 0.85;
          }
        }
      }
      if (p.down > t) { tx = p.x; ty = p.y; vmax = 0.01; }
      const gm = gkMove[j];
      if (gm && t <= gm.lie) { // uzanma: hızlı atlayış, sonra yerde
        const u = clamp((t - gm.at) / (gm.end - gm.at), 0, 1), e2 = u * u * (3 - 2 * u);
        p.x = lerp(gm.sx, gm.tx, e2); p.y = lerp(gm.sy, gm.ty, e2); p.vx = 0; p.vy = 0;
        if (holder === j && t > gm.end + 0.4) gkMove[j] = null; // tuttu, kalkar
        continue;
      }
      // hız ve ivme sınırı
      const dx = tx - p.x, dy = ty - p.y, dd = Math.hypot(dx, dy);
      const want = Math.min(vmax, dd * 2.2);
      const dvx = dd > 0.05 ? (dx / dd) * want - p.vx : -p.vx, dvy = dd > 0.05 ? (dy / dd) * want - p.vy : -p.vy;
      const dv = Math.hypot(dvx, dvy), maxdv = ACC * DT;
      const k2 = dv > maxdv ? maxdv / dv : 1;
      p.vx += dvx * k2; p.vy += dvy * k2;
      p.x = clamp(p.x + p.vx * DT, -2, PW + 2); p.y = clamp(p.y + p.vy * DT, -3, PL + 3);
    }

    // ---- top konumu ----
    if (flight) {
      const f = flight, u = clamp((t - f.t0) / (f.t1 - f.t0), 0, 1);
      const e2 = f.kind === 'shot' ? u : f.kind === 'net' ? 1 - (1 - u) * (1 - u) : 1 - (1 - u) * (1 - u) * 0.5 - 0.5 * (1 - u);
      const cx = (f.x0 + f.x1) / 2 + (-(f.y1 - f.y0)) / (Math.hypot(f.x1 - f.x0, f.y1 - f.y0) || 1) * f.curve;
      const cy = (f.y0 + f.y1) / 2 + ((f.x1 - f.x0)) / (Math.hypot(f.x1 - f.x0, f.y1 - f.y0) || 1) * f.curve;
      ball.x = (1 - e2) * (1 - e2) * f.x0 + 2 * (1 - e2) * e2 * cx + e2 * e2 * f.x1;
      ball.y = (1 - e2) * (1 - e2) * f.y0 + 2 * (1 - e2) * e2 * cy + e2 * e2 * f.y1;
      ball.z = Math.max(0, lerp(f.z0 || 0, f.z1 || 0, u) + Math.sin(Math.PI * u) * f.arc);
    } else if (holder !== null) {
      const p = P[holder], sp = Math.hypot(p.vx, p.vy);
      const s = sideOf(holder);
      const ux = sp > 0.4 ? p.vx / sp : 0, uy = sp > 0.4 ? p.vy / sp : dirY(s);
      ball.x = p.x + ux * 0.6; ball.y = p.y + uy * 0.6; ball.z = holder % 11 === 0 && sp < 0.4 ? 1.0 : 0;
    } else if (dead && restart && restart.kind !== 'kickoff' && (Math.abs(ball.x - restart.x) > 0.05 || Math.abs(ball.y - restart.y) > 0.05)) {
      const dx = restart.x - ball.x, dy = restart.y - ball.y, L = Math.hypot(dx, dy), st = Math.min(L, 9 * DT);
      ball.x += dx / L * st; ball.y += dy / L * st; ball.z = Math.max(0, ball.z - DT * 3);
    } else if (loose) {
      ball.x = clamp(ball.x + loose.vx * DT, 0.3, PW - 0.3); ball.y = clamp(ball.y + loose.vy * DT, 0.3, PL - 0.3); ball.z = 0;
      loose.vx *= 0.94; loose.vy *= 0.94;
      if (dist(P[loose.to], ball) < 1.2) { holder = loose.to; loose = null; nextAct = t + 0.3; }
      else if (t - loose.t0 > 0.8) {
        const ls = sideOf(loose.to), a = nearest(ls, ball, false), b2 = nearest(other(ls), ball, false);
        loose.to = dist(P[a], ball) < dist(P[b2], ball) + 3 ? a : b2; loose.t0 = t;
      }
    }
    // kaleci uzanma durumu
    for (const s of ['h', 'a']) {
      const g = gkDive[s];
      if (t >= g.t0 && t <= g.until) g.v = g.dir * clamp((t - g.t0) / g.dur, 0, 1) * (t > g.until - 0.35 ? clamp((g.until - t) / 0.35, 0, 1) : 1);
      else g.v = 0;
    }
    ripple = Math.max(0, ripple - DT * 0.9);

    // ---- kayıt ----
    const o = n * FRAME;
    for (let j = 0; j < 22; j++) { frames[o + j * 2] = P[j].x / PW; frames[o + j * 2 + 1] = P[j].y / PL; }
    frames[o + 44] = ball.x / PW; frames[o + 45] = ball.y / PL; frames[o + 46] = ball.z; frames[o + 47] = holder === null ? -1 : holder;
    let fl = -1; for (let j = 0; j < 22; j++) if (P[j].down > t) { fl = j; break; }
    frames[o + 48] = fl; frames[o + 49] = gkDive.h.v; frames[o + 50] = gkDive.a.v; frames[o + 51] = ripple * rippleSide;
  }

  // ---------- yardımcılar (döngü içinde kullanılır) ----------
  function setDeadKeep(kind, extra) { dead = { kind, t0: t, ...extra }; holder = null; loose = null; }
  function restartAfterGoal(d, at) { restart = { t: at, x: PW / 2, y: PL / 2, holder: J(d, 10), kind: 'kickoff' }; }
  function deadTarget(j, s, k, p, ro, tx, ty, vmax) {
    const dk = dead.kind;
    if (dk === 'goal') {
      const sc = dead.scorer, since = t - dead.t0;
      if (since < 6.5) {
        if (j === sc) return { tx: dead.flagX, ty: goalY(dead.side) - dirY(dead.side) * 3, vmax: RUN };
        if (s === dead.side && k > 0 && dist(P[j], P[sc]) < 30 && k % 3 !== 0) return { tx: P[sc].x + ((j % 5) - 2) * 1.2, ty: P[sc].y - dirY(dead.side) * (1 + (j % 3)), vmax: RUN };
        if (k === 0 && s !== dead.side) return { tx: p.x, ty: p.y, vmax: 0.5 };
        return { tx: p.x + (PW / 2 - p.x) * 0.1, ty: p.y + (PL / 2 - p.y) * 0.15, vmax: WALK };
      }
      // santra için kendi yarı sahasına
      const g2 = k === 0 ? 4 : clamp(10 + ro.r * 38, 8, PL / 2 - 1.5);
      return { tx: ro.fx * PW, ty: Yg(s, g2), vmax: JOG };
    }
    if (dk === 'kickoff') { const g2 = k === 0 ? 4 : clamp(10 + ro.r * 38, 8, PL / 2 - 1.5); return { tx: ro.fx * PW, ty: Yg(s, g2), vmax: JOG }; }
    if (dk === 'corner') {
      const att = s === dead.side, gy = goalY(dead.side), hs = (j * 37) % 11;
      if (dead.ev && j === dead.ev.shooter) return { tx: dead.ev.spot.x + 3, ty: dead.ev.spot.y - dirY(dead.side) * 4, vmax: JOG };
      if (k === 0 && !att) return { tx: PW / 2 + (restart && restart.x < PW / 2 ? -1 : 1) * 1, ty: gy - dirY(dead.side) * 0.5, vmax: JOG };
      if (att && ro.r < 0.2) return { tx: clamp(PW / 2 + (ro.fx - 0.5) * 40, 6, PW - 6), ty: PL / 2 + dirY(dead.side) * 3, vmax: JOG };
      if (k === 0) return { tx: PW / 2, ty: Yg(s, 25), vmax: JOG };
      return { tx: PW / 2 + (hs - 5) * 2.1 + (att ? 0.8 : -0.6), ty: gy - dirY(dead.side) * ((att ? 7 : 5) + ((j * 13) % 7) * 1.3), vmax: JOG };
    }
    if (dk === 'pen' || dk === 'fk') {
      const att = s === dead.side, gy = goalY(dead.side), hs = (j * 37) % 11;
      const w = dead.wall.find((q) => q.j === j);
      if (k === 0 && !att) return { tx: PW / 2 + (dk === 'fk' ? (dead.x < PW / 2 ? -1.2 : 1.2) : 0), ty: gy - dirY(dead.side) * 0.3, vmax: JOG };
      if (k === 0) return { tx: PW / 2, ty: Yg(s, 30), vmax: JOG };
      if (w) return { tx: w.x, ty: w.y, vmax: RUN };
      if (dk === 'pen') { const idx = (k - 1) * 2 + (att ? 0 : 1), dx = (idx - 9.5) * 1.9; return { tx: PW / 2 + dx, ty: gy - dirY(dead.side) * Math.max(17.8, 11 + Math.sqrt(Math.max(0, 83.7 - dx * dx)) + 1.2), vmax: JOG }; }
      return { tx: PW / 2 + (hs - 5) * 2.2 + (att ? 0.7 : -0.5), ty: gy - dirY(dead.side) * ((att ? 9 : 7) + ((j * 13) % 6) * 1.2), vmax: JOG };
    }
    // faul / dışarı / kale vuruşu: oyun durur, herkes yavaşça yerleşir
    if (dk === 'foul' && j === dead.off) return { tx: p.x + 1, ty: p.y, vmax: WALK };
    return { tx: lerp(p.x, tx, 0.5), ty: lerp(p.y, ty, 0.5), vmax: WALK + 1 };
  }

  // dakikaya çevir (izleyici dakika kullanır)
  for (const e of shots) {
    e.t = (e.T ?? 0) / SPM;
    if (e.from !== undefined) e.from /= SPM;
    if (e.setT !== undefined) e.setT /= SPM;
    if (e.crossT !== undefined) e.crossT /= SPM;
  }
  for (const f of fouls) f.tf = f.T / SPM;
  return { frames, N, evs: shots, T_END: T_END / SPM, fouls, corners, offsides, DT };
}

// t (dakika) anındaki kare, iki kare arası yumuşak geçiş
export function frameAt(sim, tMin, out) {
  const f = clamp((tMin * SPM) / sim.DT, 0, sim.N - 2);
  const i = Math.floor(f), a = f - i, o0 = i * FRAME, o1 = o0 + FRAME, F = sim.frames;
  for (let j = 0; j < 22; j++) {
    const s = j < 11 ? 'h' : 'a', k = j % 11;
    out.ply[s][k].x = F[o0 + j * 2] + (F[o1 + j * 2] - F[o0 + j * 2]) * a;
    out.ply[s][k].y = F[o0 + j * 2 + 1] + (F[o1 + j * 2 + 1] - F[o0 + j * 2 + 1]) * a;
  }
  out.ball.x = F[o0 + 44] + (F[o1 + 44] - F[o0 + 44]) * a;
  out.ball.y = F[o0 + 45] + (F[o1 + 45] - F[o0 + 45]) * a;
  out.ball.z = F[o0 + 46] + (F[o1 + 46] - F[o0 + 46]) * a;
  const h = F[o0 + 47];
  out.carrier = h < 0 ? null : { s: h < 11 ? 'h' : 'a', i: h % 11 };
  const fj = F[o0 + 48];
  out.fallen = fj < 0 ? null : { s: fj < 11 ? 'h' : 'a', i: fj % 11 };
  out.dive = { h: F[o0 + 49] + (F[o1 + 49] - F[o0 + 49]) * a, a: F[o0 + 50] + (F[o1 + 50] - F[o0 + 50]) * a };
  out.ripple = F[o0 + 51];
  return out;
}
// t (dakika) anında topu tutan oyuncu (0-21, yoksa -1)
export function holderAt(sim, tMin) {
  const i = clamp(Math.floor((tMin * SPM) / sim.DT), 0, sim.N - 1);
  return sim.frames[i * FRAME + 47];
}
