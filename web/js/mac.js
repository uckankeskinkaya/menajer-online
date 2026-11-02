// Maç izleyici: sunucudaki olay listesinden (fixtures.events) animasyon üretir.
// 2D kuşbakışı (Canvas) ve sevimli 3D (Three.js, istenince yüklenir); ikisi aynı durumdan çizilir, tam senkron.
// Sadece önemli anlar normal hızda gösterilir; aralar hızla geçer. Oyuncular içinde forma numarası olan dairelerdir.
// Saha koordinatları 0-1: x en, y boy; ev sahibi y=0 kalesine hücum eder.
import { esc, slotPositions } from './ui.js';
import { matchKits, drawDot, crestSVG, numColor, lum } from './kit.js';

const GOAL_W = 7.32 / 68;      // kale ağzı (saha enine oranla)
const PL = 105, PW = 68;       // metre

function rng(seed) { // mulberry32: aynı maç her izlendiğinde aynı akış
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------- saha çizimi (2D ve 3D dokusu ortak) ----------------
function drawPitch(ctx, L, T, w, h) {
  // çim: biçilmiş şeritler + hafif doku
  const bands = 14;
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = i % 2 ? '#2d7a33' : '#33873a';
    ctx.fillRect(L, T + (i * h) / bands, w, h / bands + 1);
  }
  const g = ctx.createRadialGradient(L + w / 2, T + h / 2, Math.min(w, h) * 0.2, L + w / 2, T + h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(255,255,255,0.04)'); g.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = g; ctx.fillRect(L, T, w, h);
  const X = (x) => L + x * w, Y = (y) => T + y * h, mx = (m) => (m / PW) * w, my = (m) => (m / PL) * h;
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.lineWidth = Math.max(1.5, w / 260);
  ctx.strokeRect(X(0), Y(0), w, h);
  ctx.beginPath(); ctx.moveTo(X(0), Y(0.5)); ctx.lineTo(X(1), Y(0.5)); ctx.stroke();
  ctx.beginPath(); ctx.arc(X(0.5), Y(0.5), mx(9.15), 0, Math.PI * 2); ctx.stroke();
  const dot = (x, y) => { ctx.beginPath(); ctx.arc(x, y, Math.max(1.8, w / 180), 0, Math.PI * 2); ctx.fill(); };
  dot(X(0.5), Y(0.5));
  for (const top of [true, false]) {
    const y0 = top ? Y(0) : Y(1), d = top ? 1 : -1;
    const bw = mx(40.32), bd = my(16.5), gw = mx(18.32), gd = my(5.5);
    ctx.strokeRect(X(0.5) - bw / 2, top ? y0 : y0 - bd, bw, bd);
    ctx.strokeRect(X(0.5) - gw / 2, top ? y0 : y0 - gd, gw, gd);
    const sy = y0 + d * my(11);
    dot(X(0.5), sy);
    const r = mx(9.15), dy = bd - my(11);
    if (r > dy) {
      const th = Math.acos(dy / r);
      ctx.beginPath();
      if (top) ctx.arc(X(0.5), sy, r, Math.PI / 2 - th, Math.PI / 2 + th);
      else ctx.arc(X(0.5), sy, r, -Math.PI / 2 - th, -Math.PI / 2 + th);
      ctx.stroke();
    }
    for (const cx of [X(0), X(1)]) {
      ctx.beginPath();
      const a0 = top ? (cx === X(0) ? 0 : Math.PI / 2) : (cx === X(0) ? -Math.PI / 2 : Math.PI);
      ctx.arc(cx, y0, mx(1), a0, a0 + Math.PI / 2); ctx.stroke();
    }
  }
}
function drawGoals(ctx, L, T, w, h, depth) {
  const gw = (7.32 / PW) * w;
  for (const top of [true, false]) {
    const x = L + w / 2 - gw / 2, y = top ? T - depth : T + h;
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(x, y, gw, depth);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) { ctx.beginPath(); ctx.moveTo(x + (i * gw) / 10, y); ctx.lineTo(x + (i * gw) / 10, y + depth); ctx.stroke(); }
    for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x, y + (i * depth) / 3); ctx.lineTo(x + gw, y + (i * depth) / 3); ctx.stroke(); }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, w / 160); ctx.strokeRect(x, y, gw, depth);
  }
}

// ---------------- 2D ----------------
class Pitch2D {
  constructor(canvas) { this.cv = canvas; this.ctx = canvas.getContext('2d'); this.resize(); }
  resize() {
    const box = this.cv.parentElement.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = box.width; this.H = box.height;
    this.cv.width = this.W * dpr; this.cv.height = this.H * dpr;
    this.cv.style.width = `${this.W}px`; this.cv.style.height = `${this.H}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const gd = Math.max(7, this.H * 0.018), m = Math.max(10, this.W * 0.035);
    this.L = m; this.T = m + gd; this.w = this.W - 2 * m; this.h = this.H - 2 * (m + gd); this.gd = gd;
    this.dpr = dpr;
    // yayın kamerası: sahanın topun çevresindeki kısmı büyütülerek gösterilir
    this.Z = this.W < 600 ? 1.6 : 1.35;
    if (this.cam) this.cam.snap = true; else this.cam = { x: 0.5, y: 0.5, snap: true };
  }
  draw(st) {
    const { ctx, L, T, w, h, W, H, Z, dpr, cam } = this;
    const X = (x) => L + x * w, Y = (y) => T + y * h;
    // kamera topu yumuşakça izler (sahne geçişinde keser), saha dışına taşmaz
    const tx = clamp(X(st.ball.x), W / (2 * Z), W - W / (2 * Z)), ty = clamp(Y(st.ball.y), H / (2 * Z), H - H / (2 * Z));
    if (cam.snap || Math.hypot(tx - cam.x * W, ty - cam.y * H) > H * 0.3) { cam.x = tx / W; cam.y = ty / H; cam.snap = false; }
    else { cam.x += (tx / W - cam.x) * 0.06; cam.y += (ty / H - cam.y) * 0.06; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1f5e25'; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(dpr * Z, 0, 0, dpr * Z, dpr * (W / 2 - Z * cam.x * W), dpr * (H / 2 - Z * cam.y * H));
    drawPitch(ctx, L, T, w, h);
    drawGoals(ctx, L, T, w, h, this.gd);
    const size = Math.max(14, w * 0.05);
    const items = [];
    for (const s of ['h', 'a']) st.ply[s].forEach((p, i) => { if (!st.gone.has(st.ids[s][i])) items.push({ s, i, p }); });
    items.sort((a, b) => a.p.y - b.p.y);
    let carrier = null;
    for (const it of items) {
      const kit = it.i === 0 ? st.kits[it.s === 'h' ? 'gkH' : 'gkA'] : st.kits[it.s];
      const isC = st.carrier && st.carrier.s === it.s && st.carrier.i === it.i;
      const down = st.fallen && st.fallen.s === it.s && st.fallen.i === it.i;
      if (down) { // yerde: yana yatmış, üstünde çarpışma işareti
        ctx.save(); ctx.translate(X(it.p.x), Y(it.p.y)); ctx.rotate(Math.PI / 2.4); ctx.scale(1, 0.55);
        drawDot(ctx, 0, 0, size / 2, kit, st.num(st.ids[it.s][it.i]));
        ctx.restore();
        ctx.save(); ctx.strokeStyle = '#facc15'; ctx.lineWidth = Math.max(1.5, size * 0.07);
        const cx = X(it.p.x) + size * 0.45, cy = Y(it.p.y) - size * 0.55;
        for (let a = 0; a < 6; a++) { const an = (a / 6) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx + Math.cos(an) * size * 0.12, cy + Math.sin(an) * size * 0.12); ctx.lineTo(cx + Math.cos(an) * size * 0.3, cy + Math.sin(an) * size * 0.3); ctx.stroke(); }
        ctx.restore();
      } else drawDot(ctx, X(it.p.x), Y(it.p.y), size / 2, kit, st.num(st.ids[it.s][it.i]), { highlight: isC });
      if (isC) carrier = it;
      else if (st.showNames) { // soyadı, dairenin altında
        const nm = (st.name(st.ids[it.s][it.i]) || '').split(' ').pop();
        if (nm) {
          ctx.font = `600 ${Math.max(7, size * 0.36)}px Inter, system-ui, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(8,14,26,.75)'; ctx.lineJoin = 'round';
          ctx.strokeText(nm, X(it.p.x), Y(it.p.y) + size * 0.55);
          ctx.fillStyle = '#fff'; ctx.fillText(nm, X(it.p.x), Y(it.p.y) + size * 0.55);
        }
      }
    }
    if (carrier) {
      const name = st.name(st.ids[carrier.s][carrier.i]);
      ctx.font = `600 ${Math.max(10, size * 0.42)}px Inter, system-ui, sans-serif`;
      const tw = ctx.measureText(name).width + 10, x = X(carrier.p.x), y = Y(carrier.p.y) + size * 0.68;
      ctx.fillStyle = 'rgba(8,14,26,.82)';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - tw / 2, y, tw, size * 0.62, 6) : ctx.rect(x - tw / 2, y, tw, size * 0.62); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(name, x, y + size * 0.31);
    }
    const b = st.ball, r = Math.max(3.5, w * 0.014);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(X(b.x) + b.z * 0.8, Y(b.y) + 2, r, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    const by = Y(b.y) - b.z * 2.4;
    const gr = ctx.createRadialGradient(X(b.x) - r * 0.4, by - r * 0.4, r * 0.2, X(b.x), by, r);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#cfd6e0');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(X(b.x), by, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1b1f27'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#1b1f27'; ctx.beginPath(); ctx.arc(X(b.x), by, r * 0.35, 0, Math.PI * 2); ctx.fill();
  }
  dispose() {}
}

// ---------------- maç simülasyonu (izlemeden önce, kare kare, gerçekçi hızlarla) ----------------
// Senaryo zamanı "dakika"dır; normal izleme hızında 1 senaryo dakikası VIEW saniye sürer.
// Oyuncular metre cinsinden, hız ve ivme sınırıyla hareket eder; top pas/şut uçuşlarıyla gider.
// Çıktı: her DT için 22 oyuncunun ve topun konumu + topu tutan oyuncu (2D ve 3D aynı kareleri çizer).
const SIM_DT = 0.02;
const VIEW = 1 / 0.22;          // normal hızda 1 senaryo dakikası ≈ 4.5 sn
const FRAME = 22 * 2 + 5;               // oyuncular (x,y) + top (x,y,z) + tutan + yerde yatan
const JOG = 4.2, RUN = 7.2, WALK = 2.2; // m/s (izleme saniyesi)
const PASS_V = 19, SHOT_V = 30;         // m/s

function simulateMatch(fx, events, R) {
  const fh = fx.stats?.fh || '4-4-2', fa = fx.stats?.fa || '4-4-2';
  const base = {
    h: slotPositions(fh).map((p) => ({ x: p.x, y: 0.5 + (p.y - 0.5) * 0.92 })),
    a: slotPositions(fa).map((p) => ({ x: 1 - p.x, y: 0.5 - (p.y - 0.5) * 0.92 })),
  };
  const role = (f) => slotPositions(f).map((p) => ({ fx: p.x, r: Math.max(0, Math.min(1, (0.78 - p.y) / 0.58)) }));
  const roles = { h: role(fh), a: role(fa).map((q) => ({ fx: 1 - q.fx, r: q.r })) };
  const sideOf = (j) => (j < 11 ? 'h' : 'a');
  const G = (s, y) => (s === 'h' ? PL - y : y);   // kendi kalesinden uzaklık
  const Yg = (s, g) => (s === 'h' ? PL - g : g);
  // ofsayt çizgisi (s'nin hücum ettiği yönde, s koordinatında): rakibin en geri saha oyuncusu
  const offLine = (s) => {
    const o = s === 'h' ? 'a' : 'h'; let m = 1e9;
    for (let k = 1; k < 11; k++) m = Math.min(m, G(o, P[J(o, k)].y));
    return Math.max(PL / 2, PL - m, G(s, ball.y));
  };
  const slotOf = (j) => j % 11;
  const J = (s, k) => (s === 'h' ? 0 : 11) + k;
  const dirY = (s) => (s === 'h' ? -1 : 1);            // hücum yönü (y)
  const goalLine = (s) => (s === 'h' ? 0 : 1);         // s'nin hücum ettiği kale çizgisi
  const B = (j) => base[sideOf(j)][slotOf(j)];
  const poss = Math.min(0.7, Math.max(0.3, (fx.stats?.poss?.[0] ?? 50) / 100));

  // olay zamanları: dakikaya yakın, aralarında hücum + kutlama için yeterli boşluk
  const shots = events.filter((e) => ['goal', 'save', 'miss'].includes(e.ev)).map((e, i) => ({ ...e, i })).sort((a, b) => a.m - b.m || a.i - b.i);
  let last = 0.6, lastGoal = false;
  for (const e of shots) {
    e.t = Math.max(e.m - 0.4 + R() * 0.3, last + (lastGoal ? 2.9 : 2.0)); last = e.t; lastGoal = e.ev === 'goal';
    e.shooter = (e.s === 'h' ? 0 : 11) + (e.slot ?? (8 + Math.floor(R() * 3)));
    const u = R(); e.style = e.pen ? 'pen' : e.fk ? 'fk' : u < 0.12 ? 'corner' : u < 0.38 ? 'cross' : u < 0.55 ? 'long' : 'thru'; // korner / kanattan orta / uzaktan şut / ara pas
  }
  const penF = new Set(events.filter((e) => (e.pen || e.fk) && e.f).map((e) => `${e.m}:${e.f}`));
  const fouls = events.filter((e) => (e.ev === 'yellow' || e.ev === 'red') && !penF.has(`${e.m}:${e.p}`)).sort((a, b) => a.m - b.m);
  for (const f of fouls) f.tf = f.m + 0.2;
  let fi = 0, corner = null, fallen = -1, fallT = 0;
  const corners = []; // istatistik: korner anları
  const T_END = Math.max(95, last + 14);
  const N = Math.ceil(T_END / SIM_DT) + 2;
  const frames = new Float32Array(N * FRAME);

  // durum (metre)
  const P = [];
  for (let j = 0; j < 22; j++) { const b = B(j); P.push({ x: b.x * PW, y: (0.5 + (b.y - 0.5) * 0.5) * PL, vx: 0, vy: 0 }); }
  const ball = { x: PW / 2, y: PL / 2, z: 0 };
  let holder = J(R() < poss ? 'h' : 'a', 10), flight = null, nextAct = 0.25, dead = null, ei = 0, restart = null;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let loose = null; // pas varış noktasında alıcı yoksa top serbest yuvarlanır, alıcı koşup alır
  const possSide = () => (holder !== null ? sideOf(holder) : flight ? flight.side : loose ? sideOf(loose.to) : null);
  const nearest = (s, pt, skipGK = true, skip = -1) => {
    let best = -1, bd = 1e9;
    for (let k = skipGK ? 1 : 0; k < 11; k++) { const j = J(s, k); if (j === skip) continue; const d = dist(P[j], pt); if (d < bd) { bd = d; best = j; } }
    return best;
  };
  const progress = (s, y) => (s === 'h' ? 1 - y / PL : y / PL); // 0 kendi kalesi → 1 rakip kalesi

  function startFlight(to, x1, y1, kind, side, dur, arc) {
    flight = { x0: ball.x, y0: ball.y, x1, y1, t0: t, t1: t + dur, kind, to, side, arc };
    holder = null; loose = null;
  }
  function pass(from, forceTo = -1, interceptBy = null, through = false) {
    const s = sideOf(from);
    let to = forceTo;
    if (to < 0) {
      // aday: ileri, açık, 10-35 m arası; son üçte birde sebepsiz ilerleme yok (şut sadece olaylarda)
      const deep = progress(s, P[from].y) > 0.62;
      let tot = 0; const w = [];
      for (let k = 1; k < 11; k++) {
        const j = J(s, k); if (j === from) { w.push(0); continue; }
        const d = dist(P[j], P[from]);
        const opp = nearest(s === 'h' ? 'a' : 'h', P[j], false);
        const open = Math.min(1, dist(P[opp], P[j]) / 8);
        const fwd = progress(s, P[j].y) - progress(s, P[from].y);
        if (G(s, P[j].y) > offLine(s) + 0.3) { w.push(0); continue; } // ofsayt
        const back = fwd < -0.04;
        let wt = (d > 8 && d < 38 ? 1 : 0.15) * (0.3 + open) * (deep ? (back ? 0 : Math.abs(fwd) < 0.06 ? 1.3 : 0.7) : (back ? 0.35 : 1 + fwd * 3));
        w.push(Math.max(0.001, wt)); tot += Math.max(0.001, wt);
      }
      if (deep && tot < 0.25 && interceptBy === null) return false; // iyi seçenek yok: geri dönmek yerine topu saklar, yana sürer
      let r = R() * tot; to = J(s, 1);
      for (let k = 1; k < 11; k++) { r -= w[k - 1]; if (r <= 0) { to = J(s, k); break; } }
    }
    const tp = P[to];
    const lead = 2 + R() * 3;
    let x1 = Math.min(PW - 2, Math.max(2, tp.x + (R() - 0.5) * 4));
    let y1 = Yg(s, Math.min(PL - 8, G(s, tp.y) + lead));
    let target = to;
    if (through) { // ara pas: koşunun önüne, kaleye en az 9 m
      x1 = clamp(tp.x + (PW / 2 - tp.x) * 0.15, 4, PW - 4);
      y1 = Yg(s, Math.min(PL - 9, G(s, tp.y) + 4 + R() * 3));
    }
    if (interceptBy !== null) { // araya giren: pas yolunun ortasında
      const f = 0.45 + R() * 0.3;
      x1 = ball.x + (x1 - ball.x) * f; y1 = ball.y + (y1 - ball.y) * f; target = interceptBy;
    }
    const d = Math.hypot(x1 - ball.x, y1 - ball.y);
    startFlight(target, x1, y1, 'pass', interceptBy !== null ? sideOf(interceptBy) : s, d / (PASS_V * VIEW) + 0.03, d > 25 ? Math.min(6, d * 0.12) : 0.3);
  }

  let t = 0;
  for (let n = 0; n < N; n++) {
    t = n * SIM_DT;
    const ev = shots[ei];
    // ---- top / karar
    if (restart && t >= restart.t && Math.hypot(P[restart.holder].x - restart.x, P[restart.holder].y - restart.y) > 1.6 && t < restart.t + 2) restart.t = t + SIM_DT; // kullanacak oyuncu yerine varsın
    if (restart && t >= restart.t) { // santra, kale vuruşu, korner, serbest vuruş
      ball.x = restart.x; ball.y = restart.y; ball.z = 0; flight = null; holder = restart.holder;
      nextAct = t + 0.25; if (restart.corner) { corner = { side: sideOf(restart.holder), ev: restart.cev }; nextAct = t + 0.3; }
      restart = null; dead = null; loose = null; fallen = -1;
    }
    // korner ortası: ceza sahasındaki savunmacı kafayla uzaklaştırır
    if (corner && corner.ev && holder !== null && t >= nextAct) { // gol/şut olayı: orta golcünün kafasına
      const sp = shotSpot(corner.ev), d = Math.hypot(sp.x - ball.x, sp.y - ball.y);
      startFlight(corner.ev.shooter, sp.x, sp.y, 'pass', corner.side, d / (PASS_V * 0.8 * VIEW) + 0.05, 4.5);
      corner = null;
    }
    if (corner && holder !== null && t >= nextAct) {
      const dfn = corner.side === 'h' ? 'a' : 'h', gl = goalLine(corner.side) * PL;
      const spot = { x: PW / 2 + (R() - 0.5) * 14, y: gl - dirY(corner.side) * (6 + R() * 6) };
      const hd = nearest(dfn, spot);
      const d = Math.hypot(P[hd].x - ball.x, P[hd].y - ball.y);
      startFlight(hd, P[hd].x, P[hd].y, 'pass', dfn, d / (PASS_V * 0.8 * VIEW) + 0.05, 4.5);
      corner = null;
    }
    // faul: kart gören oyuncunun takımı, topu tutan rakibi düşürür; serbest vuruş
    const fo = fouls[fi];
    if (fo && t >= fo.tf) {
      const nv = shots[ei];
      const busy = dead || corner || restart || (flight && flight.kind === 'shot') || (nv && t >= nv.t - 1.8);
      if (busy || holder === null) fo.tf = t + 0.1;
      else {
        const vic = fo.s === 'h' ? 'a' : 'h';
        const victim = sideOf(holder) === vic ? holder : nearest(vic, P[holder]);
        if (victim !== holder && dist(P[victim], ball) > 3) { fo.tf = t + 0.1; } else {
        holder = victim; fo.tf = t; fi++;
        dead = { kind: 'foul', off: fo.slot !== undefined ? J(fo.s, fo.slot) : nearest(fo.s, P[victim]) };
        restart = { t: t + (fo.ev === 'red' ? 1.0 : 0.6), x: clamp(P[victim].x, 2, PW - 2), y: clamp(P[victim].y, 2, PL - 2), holder: victim, kick: true };
        }
      }
    }
    if (ev && !ev.done && t >= ev.t && !dead && (!(ev.style === 'pen' || ev.style === 'fk') || ev.setT !== undefined || t >= ev.t + 4) && ((holder === ev.shooter && G(ev.s, ball.y) > PL - (ev.style === 'long' || ev.style === 'fk' ? 31 : 25)) || (t >= ev.t + 1.6 && holder !== null && sideOf(holder) === ev.s && G(ev.s, P[holder].y) > PL * 0.62) || t >= ev.t + 4)) {
      // gecikme olduysa sonraki olayları kaydır (gol sonrası santraya yer kalsın)
      ev.t = t;
      let lt = t, lg = ev.ev === 'goal';
      for (let q = ei + 1; q < shots.length; q++) { shots[q].t = Math.max(shots[q].t, lt + (lg ? 2.9 : 2.0)); lt = shots[q].t; lg = shots[q].ev === 'goal'; }
      // ŞUT: şutçu yerinde kalır, sadece top gider
      const s = ev.s, gl = goalLine(s) * PL, dfn = s === 'h' ? 'a' : 'h', gk = J(dfn, 0);
      let x1, y1;
      if (ev.ev === 'goal') { x1 = PW / 2 + (R() - 0.5) * 6; y1 = gl + dirY(s) * 1.2; }
      else if (ev.ev === 'save') { x1 = clamp(P[gk].x + (R() - 0.5) * 3, PW / 2 - 3.6, PW / 2 + 3.6); y1 = P[gk].y; } // kalecinin uzanabileceği yere
      else { x1 = PW / 2 + (R() < 0.5 ? -1 : 1) * (4.5 + R() * 5); y1 = gl + dirY(s) * 2.5; }
      const d = Math.hypot(x1 - ball.x, y1 - ball.y);
      const head = ev.style === 'cross' || ev.style === 'corner', hv = head ? 0.6 : ev.style === 'fk' ? 0.8 : 1;
      startFlight(ev.ev === 'save' ? gk : -1, x1, y1, 'shot', s, d / (SHOT_V * hv * VIEW) + 0.02, head ? 0.5 : ev.style === 'fk' ? 2.6 : ev.style === 'pen' ? 0.6 : R() < 0.4 ? 1.6 : 0.4);
      flight.ev = ev.ev; flight.side = s; flight.ref = ev;
      ev.done = true; ei++;
    }
    if (flight && t >= flight.t1) {
      ball.x = flight.x1; ball.y = flight.y1; ball.z = 0;
      const f = flight; flight = null;
      if (f.kind === 'shot') {
        f.ref.ta = t; // top kaleye/kaleciye ulaştı
        const dfn = f.side === 'h' ? 'a' : 'h';
        if (f.ev === 'goal') { dead = { kind: 'goal' }; restart = { t: t + 1.45, x: PW / 2, y: PL / 2, holder: J(dfn, 10) }; }
        else if (f.ev === 'save' && R() < 0.35) { // kaleci çeler, top kornere
          const sx = R() < 0.5 ? -1 : 1, gl = goalLine(f.side) * PL;
          startFlight(-1, PW / 2 + sx * (6 + R() * 6), gl + dirY(f.side) * 1.5, 'deflect', f.side, 0.15, 1.2);
        } else if (f.ev === 'save') { holder = J(dfn, 0); nextAct = t + 0.45; }
        else { dead = { kind: 'out' }; const gk = J(dfn, 0); restart = { t: t + 0.5, x: PW / 2 + (R() - 0.5) * 8, y: goalLine(f.side) * PL - dirY(f.side) * 5.5, holder: gk, kick: true }; }
      } else if (f.kind === 'hand') { // kola çarptı: top savunmacının önüne düşer
        const ce = shots[ei]; if (ce && ce.pre) ce.pre.touched = true;
        loose = { to: f.to, vx: 0, vy: 0, t0: t };
      } else if (f.kind === 'deflect') {
        const s = f.side, gl = goalLine(s) * PL, cx = f.x1 < PW / 2 ? 0.6 : PW - 0.6;
        let tk = J(s, 2), bd = 1e9; // korneri kanattaki oyuncu kullanır
        for (let k = 2; k < 11; k++) { const d = Math.abs(P[J(s, k)].x - cx) + Math.abs(G(s, P[J(s, k)].y) - PL) * 0.3; if (d < bd) { bd = d; tk = J(s, k); } }
        const ce = f.cev && !f.cev.done ? f.cev : undefined;
        if (ce && tk === ce.shooter) tk = J(s, tk % 11 === 2 ? 3 : 2);
        dead = { kind: 'corner', side: s, ev: ce }; corners.push({ t, s });
        restart = { t: t + 1.1, x: cx, y: gl - dirY(s) * 0.6, holder: tk, kick: true, corner: true, cev: ce };
      } else if (dist(P[f.to], ball) < 1.4) { holder = f.to; nextAct = t + 0.12 + R() * 0.22; }
      else { const L = Math.hypot(f.x1 - f.x0, f.y1 - f.y0) || 1; loose = { to: f.to, vx: ((f.x1 - f.x0) / L) * 3, vy: ((f.y1 - f.y0) / L) * 3, t0: t }; }
    }
    { const pe = shots[ei];
      // 1) pozisyon: faulde hücumcu topla sürer ve savunmacı ona dalar; elde orta/şut savunmacının koluna çarpar
      if (pe && (pe.style === 'pen' || pe.style === 'fk') && pe.setT === undefined && !pe.pre && !dead && !restart && !corner && holder !== null && sideOf(holder) === pe.s && k0ok(pe)) {
        const s = pe.s, dfn = s === 'h' ? 'a' : 'h', gl = goalLine(s) * PL;
        let F = pe.fslot !== undefined ? J(dfn, pe.fslot) : -1;
        let Wp = pe.wslot !== undefined ? J(s, pe.wslot) : -1;
        if (Wp < 0 || Wp === J(s, 0)) Wp = holder !== J(s, 0) ? holder : J(s, 10);
        if (F < 0) F = nearest(dfn, P[Wp]);
        const hand = pe.c === 'hand';
        const tp = pe.style === 'pen'
          ? { x: PW / 2 + (R() - 0.5) * 16, y: Yg(s, PL - 14 - R() * 2) }
          : { x: clamp(ball.x, 16, PW - 16), y: Yg(s, PL - 27 - R() * 3) };
        pe.pre = { F, W: Wp, hand, tp, t0: t, hs: { x: PW / 2 + (R() - 0.5) * 8, y: Yg(s, PL - 8) } };
        if (hand) { // el: ceza sahasındaki en yakın savunmacı top yoluna girer
          let bj = F, bd = 1e9; for (let k = 1; k < 11; k++) { const j = J(dfn, k), d = dist(P[j], pe.pre.hs); if (d < bd) { bd = d; bj = j; } }
          pe.pre.F = bj;
        } else if (holder === Wp) pe.pre.passed = true;
      }
      if (pe && pe.pre && pe.pre.hand && !pe.pre.launched && pe.setT === undefined && holder !== null && sideOf(holder) === pe.s
          && (dist(P[pe.pre.F], pe.pre.hs) < 3 || t > pe.pre.t0 + 1.2)) { // orta/şut savunmacının koluna
        const q = pe.pre; q.launched = true;
        const d = dist(P[q.F], ball);
        startFlight(q.F, P[q.F].x, P[q.F].y, 'hand', pe.s, d / (PASS_V * VIEW) + 0.06, d > 18 ? 2.2 : 0.9);
      }
      // hücumcu boş alana koşar, varınca pas gelir
      if (pe && pe.pre && !pe.pre.passed && !pe.pre.hand && pe.setT === undefined && holder !== null && sideOf(holder) === pe.s && holder !== pe.pre.W
          && (dist(P[pe.pre.W], pe.pre.tp) < 7 || t > pe.pre.t0 + 1.1)) {
        const q = pe.pre; q.passed = true;
        const tx2 = (P[q.W].x + q.tp.x) / 2, ty2 = (P[q.W].y + q.tp.y) / 2, d = Math.hypot(tx2 - ball.x, ty2 - ball.y);
        startFlight(q.W, tx2, ty2, 'pass', pe.s, d / (PASS_V * VIEW) + 0.04, d > 25 ? 3 : 0.3);
      }
      // 2) temas: savunmacı hücumcuya yetişti (ya da el), düdük
      let blow = false;
      if (pe && pe.pre && pe.setT === undefined && !dead) {
        const q = pe.pre;
        const inBox = G(pe.s, P[q.W].y) > PL - 16.3 && Math.abs(P[q.W].x - PW / 2) < 19.5;
        if (!q.hand && holder === q.W && dist(P[q.F], P[q.W]) < 1.3 && (pe.style === 'pen' ? inBox : !inBox)) blow = true;
        if (q.hand && q.touched) blow = true;
        if (t > q.t0 + 2.8) blow = true; // güvenlik: hakem yine de çalar
      }
      if (blow) {
        const s = pe.s, dfn = s === 'h' ? 'a' : 'h', gl = goalLine(s) * PL;
        pe.setT = t; // faulün anı (izlemede düdük)
        const off = pe.pre.F;
        if (!pe.pre.hand) { fallen = pe.pre.W; fallT = t; }
        let x0, y0;
        if (pe.style === 'pen') { x0 = PW / 2; y0 = gl - dirY(s) * 11; }
        else { x0 = clamp(ball.x, 14, PW - 14); y0 = Yg(s, clamp(G(s, ball.y), PL - 30, PL - 20)); }
        dead = { kind: pe.style, side: s, x: x0, y: y0, off, wall: [] };
        if (pe.style === 'fk') { // baraj: kaleye bakan çizgide 9.15 m, 4 savunmacı
          const gx = PW / 2 - x0, gy = gl - y0, L = Math.hypot(gx, gy), ux = gx / L, uy = gy / L;
          const cand = []; for (let k = 1; k < 11; k++) cand.push(J(dfn, k));
          cand.sort((a, b) => dist(P[a], { x: x0, y: y0 }) - dist(P[b], { x: x0, y: y0 }));
          cand.slice(0, 4).forEach((j, i) => dead.wall.push({ j, x: x0 + ux * 9.15 + (-uy) * (i - 1.5) * 0.75, y: y0 + uy * 9.15 + ux * (i - 1.5) * 0.75 }));
        }
        restart = { t: t + (pe.style === 'pen' ? 1.6 : 1.3), x: x0, y: y0, holder: pe.shooter, kick: true };
        pe.t = Math.max(pe.t, restart.t + 0.2);
        pe.whereX = ball.x; pe.whereY = ball.y;
        holder = null; flight = null; loose = null;
      }
    }
    { const ce = shots[ei];
      if (ce && ce.style === 'corner' && !ce.cornered && t >= ce.t - 2.3 && t < ce.t - 0.6 && G(ce.s, ball.y) > PL * 0.6 && !dead && !restart && !corner && !(flight && flight.kind !== 'pass')) {
        ce.cornered = true; // savunmacı topu kendi çizgisinden dışarı çıkarır
        const sx = ball.x < PW / 2 ? -1 : 1, gl = goalLine(ce.s) * PL;
        const x1 = PW / 2 + sx * (12 + R() * 14), y1 = gl + dirY(ce.s) * 1.5, d = Math.hypot(x1 - ball.x, y1 - ball.y);
        startFlight(-1, x1, y1, 'deflect', ce.s, d / (PASS_V * VIEW) + 0.05, d > 20 ? 3 : 0.8);
        flight.cev = ce;
      }
    }
    // hücum hazırlığı: sıradaki olayın takımı topu alır, kaleye ilerler, son anda topu şutçuya verir
    const nev = shots[ei];
    const attack = nev && t >= nev.t - 1.4 && !dead;
    const preOn = nev && nev.pre && nev.setT === undefined;
    if (holder !== null && !dead && !preOn) {
      const s = sideOf(holder);
      if (attack && s !== nev.s && t >= nextAct) { // top kaybı: en yakın rakip kapar
        const tk = nearest(nev.s, P[holder]);
        if (dist(P[tk], ball) < 1.6) { holder = tk; nextAct = t + 0.15; } else { loose = { to: tk, vx: 0, vy: 0, t0: t }; holder = null; }
      } else if (attack && s === nev.s) {
        const shooter = nev.shooter;
        if (nev.style === 'cross' && nev.winger === undefined) { // ortayı açacak kanat oyuncusu
          let bw = -1, bx = -1;
          for (let k = 2; k < 11; k++) { const j = J(s, k); if (j === shooter || roles[s][k].r < 0.45) continue; const dx = Math.abs(P[j].x - PW / 2); if (dx > bx) { bx = dx; bw = j; } }
          nev.winger = bw; nev.wx = bw >= 0 && P[bw].x < PW / 2 ? 4 : PW - 4;
        }
        const wg = nev.style === 'cross' ? nev.winger : -1;
        if (wg >= 0 && holder === wg && t >= nev.t - 0.35 && t >= nextAct) { // orta: havadan şutçunun koşu yoluna
          const sp = shotSpot(nev), d = Math.hypot(sp.x - ball.x, sp.y - ball.y);
          startFlight(shooter, sp.x, sp.y, 'pass', s, d / (PASS_V * 0.85 * VIEW) + 0.05, 3.5 + R() * 1.5);
        } else if (wg >= 0 && holder !== wg && holder !== shooter && t < nev.t - 0.45 && t >= nextAct) {
          const d = dist(P[wg], ball); // kanada aç
          startFlight(wg, nev.wx, Yg(s, Math.min(PL - 14, G(s, P[wg].y) + 6)), 'pass', s, d / (PASS_V * VIEW) + 0.04, d > 25 ? 3 : 0.3);
        } else if (wg >= 0 && holder === wg) { /* kanat oyuncusu çizgiye iner */ }
        else if (t >= nev.t - 0.4 && holder !== shooter && t >= nextAct) pass(holder, shooter, null, nev.style !== 'long');
        else if (t >= nextAct && holder !== shooter) {
          // ileri pas: rakip kaleye en yakın oyunculardan biri
          let best = -1, bp = -1;
          for (let k = 2; k < 11; k++) { const j = J(s, k); if (j === holder) continue; const pr = progress(s, P[j].y) + R() * 0.15; if (pr > bp) { bp = pr; best = j; } }
          if (best >= 0 && G(s, P[best].y) > G(s, P[holder].y) - 3) pass(holder, best); else nextAct = t + 0.15;
        }
      } else if (t >= nextAct) {
        const ps = sideOf(holder);
        const share = ps === 'h' ? poss : 1 - poss;
        const deepNow = progress(ps, P[holder].y) > 0.68;
        const intercept = R() < (deepNow ? 0.45 : 0.1) + (0.5 - share) * 0.25;
        if (intercept) { const opp = nearest(ps === 'h' ? 'a' : 'h', P[holder]); pass(holder, -1, opp); }
        else if (pass(holder) === false) nextAct = t + 0.12;
      }
    }
    // ---- oyuncular: takım bloğu (topa ve topa sahip olmaya göre), ofsayt çizgisi
    const ps = possSide();
    const presser = holder !== null ? nearest(sideOf(holder) === 'h' ? 'a' : 'h', P[holder]) : -1;
    const bxm = flight ? flight.x1 : ball.x, bym = flight ? flight.y1 : ball.y;
    const blk = {};
    for (const s of ['h', 'a']) {
      const own = ps === s, bg = G(s, bym);
      const line = own ? clamp(bg - 32, 20, 52) : clamp(bg - 20, 10, 38);
      blk[s] = { own, line, len: own ? 40 : 28, wid: own ? 0.96 : 0.7, sh: own ? 0.18 : 0.38, off: offLine(s) };
    }
    for (let j = 0; j < 22; j++) {
      const s = sideOf(j), k = slotOf(j), b = B(j), p = P[j], ro = roles[s][k], bk = blk[s];
      let tx, ty, vmax = JOG;
      if (dead && j === fallen && t < (shots[ei]?.setT ?? -9) + 0.7) { tx = p.x; ty = p.y; vmax = 0.05; } // yerde yatıyor
      else if (dead && dead.kind === 'corner') { // korner: ceza sahasında kalabalık
        const att = s === dead.side, gl = goalLine(dead.side) * PL, hs = (j * 37) % 11;
        if (dead.ev && j === dead.ev.shooter) { const sp = shotSpot(dead.ev); tx = sp.x + 2; ty = sp.y - dirY(s) * 3; } // golcü arka direğe yakın bekler
        else if (att && ro.r < 0.2) { tx = clamp(PW / 2 + (ro.fx - 0.5) * 40, 6, PW - 6); ty = Yg(s, PL * 0.52); }
        else if (!att && k > 0 && ro.r > 0.95 && k === roles[s].reduce((m, q, i) => (q.r >= roles[s][m].r ? i : m), 1)) { tx = PW / 2; ty = Yg(s, 38); }
        else { tx = PW / 2 + (hs - 5) * 2.1 + (att ? 0.8 : -0.6); ty = gl - dirY(dead.side) * ((att ? 7 : 5) + ((j * 13) % 7) * 1.3); }
        vmax = JOG;
      } else if (dead && (dead.kind === 'pen' || dead.kind === 'fk')) {
        const att = s === dead.side, gl = goalLine(dead.side) * PL, hs = (j * 37) % 11;
        const w = dead.wall.find((q) => q.j === j);
        if (k === 0 && !att) { tx = PW / 2 + (dead.kind === 'fk' ? (dead.x < PW / 2 ? -1.2 : 1.2) : 0); ty = gl - dirY(dead.side) * 0.3; }
        else if (k === 0) { tx = PW / 2; ty = Yg(s, 30); }
        else if (w) { tx = w.x; ty = w.y; }
        else if (j === dead.off && dead.kind === 'fk') { tx = dead.x + 2; ty = dead.y - dirY(dead.side) * 3; }
        else if (dead.kind === 'pen') { // ceza sahası çizgisinin ve yayın dışında, yan yana
          const idx = (k - 1) * 2 + (att ? 0 : 1), dx = (idx - 9.5) * 1.9;
          tx = PW / 2 + dx; ty = gl - dirY(dead.side) * Math.max(17.8, 11 + Math.sqrt(Math.max(0, 9.15 * 9.15 - dx * dx)) + 1.2);
        } else { tx = PW / 2 + (hs - 5) * 2.2 + (att ? 0.7 : -0.5); ty = gl - dirY(dead.side) * ((att ? 9 : 7) + ((j * 13) % 6) * 1.2); }
        vmax = JOG;
      } else if (dead && dead.kind === 'foul') { // faul: oyun durur, faulü yapan oyuncu yerinde
        tx = p.x; ty = p.y; vmax = WALK;
        if (j === dead.off) { tx = ball.x + 1.2; ty = ball.y + 1.2; }
      } else if (dead) { // gol sonrası / top dışarıda: kendi yarı sahasına yürü
        const kick = dead.kind === 'goal';
        tx = b.x * PW; ty = (kick ? 0.5 + (b.y - 0.5) * 0.45 : b.y + (bym / PL - 0.5) * 0.25) * PL;
        if (kick) ty = s === 'h' ? Math.max(ty, PL * 0.52) : Math.min(ty, PL * 0.48);
        vmax = kick ? WALK + 1 : JOG;
      } else {
        tx = clamp(PW / 2 + (ro.fx - 0.5) * 1.45 * PW * bk.wid + (bxm - PW / 2) * bk.sh, 3, PW - 3);
        let g = bk.line + ro.r * bk.len;
        if (bk.own) g = Math.min(g, bk.off - 1.2);          // ofsayta düşme
        g = clamp(g, 8, PL - 7);
        ty = Yg(s, g);
        vmax = Math.abs(G(s, p.y) - g) > 12 ? RUN * 0.8 : JOG;
      }
      if (k === 0) { // kaleci: çizgisinde, topa göre kayar
        const gl = s === 'h' ? PL : 0;
        tx = Math.min(PW / 2 + 5, Math.max(PW / 2 - 5, PW / 2 + (ball.x - PW / 2) * 0.18));
        ty = gl + (s === 'h' ? -1 : 1) * (2.5 + Math.abs(ball.y - gl) * 0.04 + (blk[s].own ? Math.max(0, G(s, bym) - 45) * 0.18 : 0));
        if (flight && flight.kind === 'shot' && flight.to === j) { tx = flight.x1; ty = flight.y1; vmax = RUN; }
      }
      if (!dead) {
        if (preOn && j === nev.pre.W && holder !== j && !(flight && flight.to === j)) { tx = nev.pre.tp.x; ty = nev.pre.tp.y; vmax = RUN * 0.9; } // boşa koşu
        else if (preOn && j === holder && j === nev.pre.W) { // düşürülecek hücumcu kaleye doğru sürer
          const q = nev.pre; tx = q.tp.x + (PW / 2 - q.tp.x) * 0.3; ty = Yg(s, Math.min(PL - 8, G(s, q.tp.y) + 6)); vmax = JOG * 0.75;
        } else if (preOn && j === nev.pre.F && nev.pre.hand) { // top yoluna girer, sonra durur
          if (nev.pre.launched) { tx = p.x; ty = p.y; vmax = WALK; } else { tx = nev.pre.hs.x; ty = nev.pre.hs.y; vmax = RUN * 0.85; }
        } else if (preOn && j === nev.pre.F && nev.style === 'pen' && holder === nev.pre.W && !(G(s === 'h' ? 'a' : 'h', P[nev.pre.W].y) > PL - 16.3)) {
          const Wq = P[nev.pre.W]; tx = Wq.x + (PW / 2 - Wq.x) * 0.1; ty = Wq.y + dirY(s === 'h' ? 'a' : 'h') * 2.2; vmax = RUN * 0.8; // kaleyle adam arasında
        } else if (preOn && j === nev.pre.F && !nev.pre.hand && holder === nev.pre.W) { // savunmacı topa/adama dalar
          tx = P[nev.pre.W].x; ty = P[nev.pre.W].y; vmax = RUN;
        } else if (j === holder && nev && (nev.style === 'pen' || nev.style === 'fk') && nev.setT !== undefined) { tx = p.x; ty = p.y; vmax = WALK; } // duran top: vuruşa hazırlanır
        else if (j === holder && attack && nev.style === 'cross' && j === nev.winger) { // çizgiye doğru sürer
          tx = nev.wx; ty = Yg(s, PL - 12); vmax = JOG;
        } else if (j === holder) { // top sürme: hücum yönüne ağır ağır
          tx = p.x + (PW / 2 - p.x) * 0.05; ty = Yg(s, Math.min(G(s, p.y) + 3, Math.max(G(s, p.y), PL - 20))); vmax = JOG * 0.8;
          if (G(s, p.y) > PL - 22) tx = p.x + (p.x < PW / 2 ? 4 : -4); // ceza sahası önünde yana sürer
          if (attack && s === nev.s && k > 0) { const sp = shotSpot(nev); tx = sp.x; ty = Yg(s, Math.min(G(s, sp.y), blk[s].off + 3)); vmax = JOG; }
        } else if (flight && flight.kind === 'pass' && flight.to === j) { tx = flight.x1; ty = flight.y1; vmax = RUN; }
        else if (loose && loose.to === j) { tx = ball.x; ty = ball.y; vmax = RUN; }
        else if (j === presser) { const d = dist(p, ball); if (d > 2) { tx = ball.x; ty = ball.y; vmax = RUN * 0.85; } }
        else if (attack && nev.style === 'cross' && j === nev.winger) { tx = nev.wx; ty = Yg(s, Math.min(PL - 14, blk[s].off - 1)); vmax = RUN * 0.8; }
        else if (attack && j === nev.shooter) {
          const sp = shotSpot(nev); tx = sp.x;
          ty = Yg(s, Math.min(G(s, sp.y), blk[s].off - 0.8)); vmax = RUN * 0.8; // pas çıkana kadar çizgide
        }
      }
      if (restart && j === restart.holder) { // santrayı / kale vuruşunu kullanacak oyuncu oraya yürür
        tx = restart.x; ty = restart.y + (restart.kick ? 0 : 0.8); vmax = Math.hypot(p.x - tx, p.y - ty) > 8 ? RUN * 0.85 : JOG;
      }
      // hız ve ivme sınırı
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
      const want = Math.min(vmax, d * 1.6);
      const dvx = d > 0.05 ? (dx / d) * want : 0, dvy = d > 0.05 ? (dy / d) * want : 0;
      const a = Math.min(1, SIM_DT * VIEW * 3.2);
      p.vx += (dvx - p.vx) * a; p.vy += (dvy - p.vy) * a;
      p.x = Math.min(PW + 3, Math.max(-3, p.x + p.vx * SIM_DT * VIEW));
      p.y = Math.min(PL + 3, Math.max(-3, p.y + p.vy * SIM_DT * VIEW));
    }
    // ---- top konumu
    if (flight) {
      const u = Math.min(1, (t - flight.t0) / (flight.t1 - flight.t0));
      const e = flight.kind === 'shot' ? u : 1 - (1 - u) * (1 - u) * 0.6 - 0.4 * (1 - u); // pas hafif yavaşlar
      ball.x = flight.x0 + (flight.x1 - flight.x0) * e; ball.y = flight.y0 + (flight.y1 - flight.y0) * e;
      ball.z = Math.sin(Math.PI * u) * flight.arc;
    } else if (holder !== null) {
      const p = P[holder], sp = Math.hypot(p.vx, p.vy);
      const ux = sp > 0.3 ? p.vx / sp : 0, uy = sp > 0.3 ? p.vy / sp : dirY(sideOf(holder));
      ball.x = p.x + ux * 0.7; ball.y = p.y + uy * 0.7; ball.z = 0;
    } else if (loose) {
      ball.x = clamp(ball.x + loose.vx * SIM_DT * VIEW, 0.5, PW - 0.5); ball.y = clamp(ball.y + loose.vy * SIM_DT * VIEW, 0.5, PL - 0.5); ball.z = 0;
      loose.vx *= 0.97; loose.vy *= 0.97;
      if (dist(P[loose.to], ball) < 1.2) { holder = loose.to; loose = null; nextAct = t + 0.1 + R() * 0.15; }
      else if (t - loose.t0 > 0.5 && !(nev && nev.pre && nev.setT === undefined && loose.to === nev.pre.W)) { // alıcı yetişemedi: topa en yakın oyuncu
        let bj = 0, bd = 1e9; for (let j = 0; j < 22; j++) { const d = dist(P[j], ball); if (d < bd) { bd = d; bj = j; } }
        loose.to = bj; loose.t0 = t;
      }
    }
    // ---- kayıt
    const o = n * FRAME;
    for (let j = 0; j < 22; j++) { frames[o + j * 2] = P[j].x / PW; frames[o + j * 2 + 1] = P[j].y / PL; }
    frames[o + 44] = ball.x / PW; frames[o + 45] = ball.y / PL; frames[o + 46] = ball.z; frames[o + 47] = holder === null ? -1 : holder; frames[o + 48] = fallen >= 0 && t < fallT + 0.75 ? fallen : -1;
  }
  function k0ok(e) { // kurulum zamanı: olaydan biraz önce, top rakip yarı sahadayken (ya da süre dolunca)
    if (t < e.t - 2.3) return false;
    return G(e.s, ball.y) > PL * (e.style === 'pen' ? 0.7 : 0.6) || t >= e.t - 0.4;
  }
  function fSlot(e, dfn) { return e.fslot; }
  function shotSpot(e) {
    if (!e.spot) {
      const [wx, d0, dd] = e.style === 'corner' ? [12, 5, 6] : e.style === 'cross' ? [10, 6, 5] : e.style === 'long' ? [26, 21, 7] : [22, 11, 8];
      e.spot = { x: PW / 2 + (R() - 0.5) * wx, y: goalLine(e.s) * PL - dirY(e.s) * (d0 + R() * dd) };
    }
    return e.spot;
  }
  return { frames, N, evs: shots, T_END, fouls, corners };
}
// Türkçe ek: isme ünlü uyumuyla belirtme (-ı/-i/-u/-ü) ya da ayrılma (-dan/-den/-tan/-ten) eki
function trEk(name, kind) {
  const tr = { 'ü': '1', 'ö': '2', 'ç': '3', 'ş': '4', 'ğ': '5' }, back2 = { 1: 'ü', 2: 'ö', 3: 'ç', 4: 'ş', 5: 'ğ' };
  const n = String(name || '').toLocaleLowerCase('tr').replace(/[üöçşğ]/g, (c) => tr[c]).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[1-5]/g, (d) => back2[d]).replace(/[^a-zçğıöşü]/g, '');
  const vs = n.match(/[aeıioöuü]/g), lv = vs ? vs[vs.length - 1] : 'e';
  const back = 'aıou'.includes(lv), round = 'ouöü'.includes(lv);
  if (kind === 'acc') return `'${/[aeıioöuü]$/.test(n) ? 'y' : ''}${back ? (round ? 'u' : 'ı') : (round ? 'ü' : 'i')}`;
  return `'${/[çfhkpsşt]$/.test(n) ? 't' : 'd'}${back ? 'a' : 'e'}n`;
}
// seri penaltı: kurallara uygun ve sunucudaki skorla (ör. "4-3") birebir biten atış dizisi
function shootout(pens, R) {
  const m = /^(\d+)-(\d+)$/.exec(String(pens || '').trim());
  if (!m) return null;
  const PH = +m[1], PA = +m[2];
  for (let tries = 0; tries < 40000; tries++) {
    const k = []; let h = 0, a = 0, nh = 0, na = 0, done = false;
    while (!done && k.length < 40) {
      for (const s of ['h', 'a']) {
        const g = R() < 0.76;
        if (s === 'h') { nh++; h += g; } else { na++; a += g; }
        k.push({ s, res: g ? 'goal' : R() < 0.6 ? 'save' : 'miss' });
        if (nh <= 5 && na <= 5) { // ilk 5 atış: matematiksel olarak bittiyse dur
          if (h + (5 - nh) < a || a + (5 - na) < h) { done = true; break; }
        } else if (nh === na && h !== a) { done = true; break; } // ani ölüm
        if (nh === 5 && na === 5 && h !== a) { done = true; break; }
      }
    }
    if (done && h === PH && a === PA) return k;
  }
  return null;
}
// t anındaki kare (iki kare arası yumuşak geçiş)
function frameAt(sim, t, out) {
  const f = Math.max(0, Math.min(sim.N - 2, t / SIM_DT));
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
  return out;
}

// ---------------- 3D (sevimli, 2D ile aynı durumdan çizilir) ----------------
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
function badgeCanvas(kit, num) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  drawDot(c.getContext('2d'), 64, 64, 50, kit, num);
  return c;
}
class Pitch3D {
  async init(host, st) {
    const THREE = (this.THREE = await import(THREE_URL));
    this.host = host;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(r.domElement);
    const scene = (this.scene = new THREE.Scene());
    // gökyüzü: yumuşak dikey geçiş
    const sky = document.createElement('canvas'); sky.width = 4; sky.height = 256;
    const sg = sky.getContext('2d'); const gr = sg.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#7cc4ff'); gr.addColorStop(0.6, '#c9e9ff'); gr.addColorStop(1, '#eaf7ff');
    sg.fillStyle = gr; sg.fillRect(0, 0, 4, 256);
    const skyTex = new THREE.CanvasTexture(sky); skyTex.colorSpace = THREE.SRGBColorSpace;
    scene.background = skyTex;
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.3, 500);
    scene.add(new THREE.HemisphereLight('#ffffff', '#7fb87a', 1.6));
    const sun = new THREE.DirectionalLight('#fff6e0', 1.4); sun.position.set(-40, 80, 30); scene.add(sun);
    // zemin + saha
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(PW + 60, PL + 60), new THREE.MeshLambertMaterial({ color: '#3f9b4a' }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; scene.add(ground);
    const tc = document.createElement('canvas'); tc.width = 680; tc.height = 1050;
    drawPitch(tc.getContext('2d'), 0, 0, 680, 1050);
    const tex = new THREE.CanvasTexture(tc); tex.anisotropy = 8; tex.colorSpace = THREE.SRGBColorSpace;
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(PW, PL), new THREE.MeshLambertMaterial({ map: tex }));
    pitch.rotation.x = -Math.PI / 2; scene.add(pitch);
    // renkli tribünler (oyuncak gibi basamaklar)
    const standCols = [st.kits.h.c1, '#ffffff', st.kits.a.c1, '#f4d35e'];
    const addStand = (x, z, w, d, rotY) => {
      for (let k = 0; k < 4; k++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, 2.4), new THREE.MeshLambertMaterial({ color: standCols[k % 4] }));
        const g = new THREE.Group(); g.add(m); m.position.set(0, 0.8 + k * 1.6, -k * 2.4);
        g.position.set(x, 0, z); g.rotation.y = rotY; scene.add(g);
      }
    };
    addStand(-PW / 2 - 9, 0, PL + 6, 0, Math.PI / 2); addStand(PW / 2 + 9, 0, PL + 6, 0, -Math.PI / 2);
    addStand(0, -PL / 2 - 9, PW + 6, 0, 0); addStand(0, PL / 2 + 9, PW + 6, 0, Math.PI);
    // kaleler
    const postMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const netMat = new THREE.MeshBasicMaterial({ color: '#ffffff', wireframe: true, transparent: true, opacity: 0.45 });
    for (const zs of [-1, 1]) {
      const z = (zs * PL) / 2, g = new THREE.Group();
      for (const xs of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 2.44, 12), postMat); p.position.set((xs * 7.32) / 2, 1.22, z); g.add(p); }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 7.32, 12), postMat); bar.rotation.z = Math.PI / 2; bar.position.set(0, 2.44, z); g.add(bar);
      const net = new THREE.Mesh(new THREE.BoxGeometry(7.32, 2.44, 2, 12, 4, 3), netMat); net.position.set(0, 1.22, z + zs * 1); g.add(net);
      scene.add(g);
    }
    const blob = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
      const g = x.createRadialGradient(32, 32, 4, 32, 32, 30); g.addColorStop(0, 'rgba(0,0,0,.45)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c); })();
    this.shadowMat = new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false });
    this.badgeCache = new Map();
    this.players = { h: [], a: [] };
    for (const s of ['h', 'a']) for (let i = 0; i < 11; i++) this.players[s].push(this.makePlayer(st, s, i));
    // top: beyaz, siyah beşgenli
    const bc = document.createElement('canvas'); bc.width = 128; bc.height = 64; const bx = bc.getContext('2d');
    bx.fillStyle = '#fff'; bx.fillRect(0, 0, 128, 64); bx.fillStyle = '#1b1f27';
    for (const [x, y] of [[16, 16], [48, 40], [80, 16], [112, 40], [32, 56], [96, 56]]) { bx.beginPath(); bx.arc(x, y, 7, 0, Math.PI * 2); bx.fill(); }
    const btex = new THREE.CanvasTexture(bc); btex.colorSpace = THREE.SRGBColorSpace;
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 16), new THREE.MeshLambertMaterial({ map: btex }));
    scene.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), this.shadowMat); this.ballShadow.rotation.x = -Math.PI / 2; scene.add(this.ballShadow);
    this.camT = new THREE.Vector3(0, 0, 0);
    this.t = 0;
    this.resize();
  }
  badge(kit, num) {
    const key = `${kit.c1}${kit.c2}${num}`;
    if (!this.badgeCache.has(key)) {
      const t = new this.THREE.CanvasTexture(badgeCanvas(kit, num)); t.colorSpace = this.THREE.SRGBColorSpace;
      this.badgeCache.set(key, new this.THREE.SpriteMaterial({ map: t, depthTest: false }));
    }
    return this.badgeCache.get(key);
  }
  makePlayer(st, s, i) {
    const THREE = this.THREE;
    const g = new THREE.Group();
    const kit = i === 0 ? st.kits[s === 'h' ? 'gkH' : 'gkA'] : st.kits[s];
    // sevimli oyuncak oyuncu: kısa kapsül gövde, büyük kafa
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 0.7, 6, 14), new THREE.MeshLambertMaterial({ color: kit.c1 }));
    body.position.y = 1.35; g.add(body);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.64, 0.22, 16), new THREE.MeshLambertMaterial({ color: kit.c2 }));
    band.position.y = 1.55; g.add(band);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 16), new THREE.MeshLambertMaterial({ color: '#f1c9a5' }));
    head.position.y = 2.55; g.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.64, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2.2), new THREE.MeshLambertMaterial({ color: ['#2b1d14', '#5a3b22', '#d9b36c', '#111111'][(i + (s === 'h' ? 0 : 2)) % 4] }));
    hair.position.y = 2.6; g.add(hair);
    for (const xs of [-0.22, 0.22]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), new THREE.MeshBasicMaterial({ color: '#1b1f27' }));
      eye.position.set(xs, 2.6, 0.56); g.add(eye);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.35, 4, 8), new THREE.MeshLambertMaterial({ color: lum(kit.c1) > 0.6 ? '#1f2937' : kit.c2 }));
      leg.position.set(xs, 0.45, 0); g.add(leg);
      const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshLambertMaterial({ color: '#1b1f27' }));
      shoe.scale.set(1, 0.6, 1.4); shoe.position.set(xs, 0.1, 0.08); g.add(shoe);
    }
    const sp = new THREE.Sprite(this.badge(kit, st.num(st.ids[s][i])));
    sp.scale.set(2.4, 2.4, 1); sp.position.y = 4.6; sp.renderOrder = 10; g.add(sp);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), this.shadowMat); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.02; g.add(sh);
    g.scale.setScalar(0.6);   // ~1.85 m: kale (2.44 m) ile gerçek oran
    g.userData = { sp, id: st.ids[s][i], kit, phase: Math.random() * 6 };
    this.scene.add(g);
    return g;
  }
  resize() {
    const b = this.host.getBoundingClientRect();
    this.renderer.setSize(b.width, b.height);
    this.camera.aspect = b.width / Math.max(1, b.height); this.camera.updateProjectionMatrix();
  }
  draw(st, dt) {
    this.t += dt;
    const W = (x) => (x - 0.5) * PW, Z = (y) => (y - 0.5) * PL;
    for (const s of ['h', 'a']) st.ply[s].forEach((p, i) => {
      const g = this.players[s][i];
      const id = st.ids[s][i];
      g.visible = !!id && !st.gone.has(id);
      if (g.userData.id !== id && id) { g.userData.sp.material = this.badge(g.userData.kit, st.num(id)); g.userData.id = id; }
      const nx = W(p.x), nz = Z(p.y);
      const dx = nx - g.position.x, dz = nz - g.position.z;
      const moving = Math.hypot(dx, dz) > 0.02;
      if (moving) g.rotation.y = Math.atan2(dx, dz);
      const down = st.fallen && st.fallen.s === s && st.fallen.i === i;
      g.position.set(nx, down ? 0.25 : moving ? Math.abs(Math.sin(this.t * 12 + g.userData.phase)) * 0.12 : 0, nz);
      g.rotation.z = down ? Math.PI / 2 : 0;
      const isC = st.carrier && st.carrier.s === s && st.carrier.i === i;
      g.userData.sp.scale.setScalar(isC ? 3 : 2.4);
    });
    const b = st.ball;
    this.ball.position.set(W(b.x), 0.26 + b.z, Z(b.y));
    this.ball.rotation.x += dt * 8;
    this.ballShadow.position.set(W(b.x), 0.03, Z(b.y));
    // yayın kamerası: 2D ile aynı anı, tribün açısından takip eder
    let k = Math.min(1, dt * 2.4);
    if (Math.abs(Z(b.y) - this.camT.z) > 25) k = 1; // sahne geçişinde kamera kesme yapar
    this.camT.x = lerp(this.camT.x, W(b.x) * 0.6, k);
    this.camT.z = lerp(this.camT.z, Z(b.y), k);
    const portrait = this.camera.aspect < 1;
    this.camera.position.set(this.camT.x - (portrait ? 28 : 34), portrait ? 23 : 18, this.camT.z * (portrait ? 0.93 : 0.9));
    this.camera.lookAt(this.camT.x, 0, this.camT.z);
    this.renderer.render(this.scene, this.camera);
  }
  dispose() { try { this.renderer.dispose(); this.renderer.domElement.remove(); } catch { /* yok */ } }
}

// ---------------- izleyici ----------------
export async function openMatch(sb, fid, { teamById, liveMs = 540000, onClose }) {
  const root = document.getElementById('match');
  root.innerHTML = `<div class="mwrap"><div class="loading">Maç yükleniyor…</div></div>`;
  root.classList.add('show');
  let closed = false, raf = 0, waitTimer = 0, onResize = null, r2d = null;
  let fx = null;
  // maç henüz oynanmadıysa (saati gelmedi / sunucu birazdan oynatacak) bekle
  for (;;) {
    const { data, error } = await sb.from('fixtures').select('*').eq('id', fid).maybeSingle();
    if (closed) return;
    if (error || !data) { root.innerHTML = `<div class="mwrap"><p>Maç bulunamadı</p><button class="btn" id="mClose">Kapat</button></div>`; document.getElementById('mClose').onclick = close; return; }
    if (data.played) { fx = data; break; }
    const H0 = teamById.get(data.home), A0 = teamById.get(data.away);
    const k = data.kickoff_at ? new Date(data.kickoff_at) : null;
    root.innerHTML = `<div class="mwrap"><div class="mboard"><div class="mteam">${crestSVG(H0, 34)}<b>${esc(H0?.name)}</b></div><div class="mscore"><span>-</span></div><div class="mteam r"><b>${esc(A0?.name)}</b>${crestSVG(A0, 34)}</div></div>
      <div class="card center"><p>${k && k > Date.now() ? `⏰ Maç <b>${k.toLocaleString('tr-TR', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}</b>'da başlayacak.` : '⚽ Maç başlıyor…'}</p>
      <p class="muted small">Bu ekran açık kalırsa maç başlayınca canlı yayın kendiliğinden açılır.</p></div>
      <button class="btn" id="mClose">Kapat</button></div>`;
    document.getElementById('mClose').onclick = close;
    await new Promise((r) => (waitTimer = setTimeout(r, k && k - Date.now() > 60000 ? 30000 : 4000)));
    if (closed) return;
  }
  const st0 = fx.stats || {};
  const ids = [...(st0.lh || []), ...(st0.la || []), ...Object.keys(st0.rt || {}).map(Number), ...(fx.events || []).flatMap((e) => [e.p, e.a])].filter(Boolean);
  const names = new Map(), shirts = new Map();
  if (ids.length) {
    const uniq = [...new Set(ids)];
    const [{ data: pl }, { data: sq }] = await Promise.all([
      sb.from('real_players').select('id,name').in('id', uniq),
      sb.from('squads').select('player_id,shirt').eq('game_id', fx.game_id).in('player_id', uniq),
    ]);
    pl?.forEach((p) => names.set(p.id, p.name));
    sq?.forEach((q) => q.shirt && shirts.set(q.player_id, q.shirt));
  }
  if (closed) return;
  const H = teamById.get(fx.home), A = teamById.get(fx.away);
  const nm = (id) => esc(names.get(id) || '?');
  const kits = matchKits(H, A);
  const startH = (st0.lh || []).slice(0, 11), startA = (st0.la || []).slice(0, 11);
  const fallbackNum = (id) => { const ih = startH.indexOf(id), ia = startA.indexOf(id); return ih >= 0 ? ih + 1 : ia >= 0 ? ia + 1 : ''; };
  const num = (id) => shirts.get(id) ?? fallbackNum(id);

  const events = (fx.events || []).map((e) => {
    const lu = (e.s === 'h' ? startH : startA);
    const slot = lu.indexOf(e.p);
    return { m: e.m, s: e.s, p: e.p, a: e.a, ev: e.t, slot: slot > 0 ? slot : undefined, pen: !!e.pen, fk: !!e.fk, f: e.f, c: e.c, w: e.w,
      wslot: e.w && lu.indexOf(e.w) > 0 ? lu.indexOf(e.w) : undefined,
      fslot: e.f ? ((e.s === 'h' ? startA : startH).indexOf(e.f) > 0 ? (e.s === 'h' ? startA : startH).indexOf(e.f) : undefined) : undefined };
  });
  const startedAgo = fx.kickoff_at ? Date.now() - new Date(fx.kickoff_at) : Infinity;
  let live = startedAgo >= 0 && startedAgo < liveMs;
  const R = rng(fid * 2654435761);
  const SHOTS = ['goal', 'save', 'miss'];
  const sim = simulateMatch(fx, events, R);
  const evs = sim.evs;
  const others = events.filter((e) => !SHOTS.includes(e.ev)).map((e) => ({ ...e, t: e.tf ?? e.m + 0.2 }));
  // duran top anları: düdük (penaltı / serbest vuruş)
  for (const e of evs) if (e.setT !== undefined) others.push({ m: e.m, t: e.setT, s: e.s, ev: e.style === 'pen' ? 'penfoul' : 'fkfoul', p: e.f, a: e.p, w: e.w, c: e.c });
  const timeline = [...evs, ...others].sort((a, b) => a.t - b.t);
  // korner/faul sayıları: sahada görülenler + görünmeyen anlar (şut ve topa sahip olmaya göre, maça özel sabit)
  const setp = [];
  for (const c of sim.corners) setp.push({ t: c.t, s: c.s, k: 'c' });
  for (const f of sim.fouls) if (f.tf < 95) setp.push({ t: f.tf, s: f.s, k: 'f' });
  for (const e of evs) if (e.setT !== undefined) setp.push({ t: e.setT, s: e.s === 'h' ? 'a' : 'h', k: 'f' });
  {
    const R2 = rng(fid * 13 + 7), stt = fx.stats || {};
    for (const [i, sd] of [[0, 'h'], [1, 'a']]) {
      const have = (k) => setp.filter((x) => x.s === sd && x.k === k).length;
      const wantC = Math.round((stt.shots?.[i] ?? 8) * 0.42 + R2() * 2.5);
      const wantF = Math.round(8 + R2() * 6 + ((stt.poss?.[1 - i] ?? 50) - 50) * 0.12);
      for (let n = have('c'); n < wantC; n++) setp.push({ t: 1 + R2() * 92, s: sd, k: 'c' });
      for (let n = have('f'); n < wantF; n++) setp.push({ t: 1 + R2() * 92, s: sd, k: 'f' });
    }
  }
  const styleName = { thru: 'Ara pas', cross: 'Kanat ortası', long: 'Uzaktan', corner: 'Korner', pen: 'Penaltı', fk: 'Serbest vuruş' };

  // ---- önemli anlar: goller, kurtarışlar, kırmızı kartlar ve birkaç kaçırma normal hızda; aralar hızla geçer ----
  const CLIP_RATE = 0.22;   // normal hız: senaryo dakikası / sn (bir pas ~1.5 sn)
  const GAP_RATE = 9;       // aralarda saat: maç dakikası / sn
  const misses = evs.filter((e) => e.ev === 'miss');
  const pickedMiss = new Set(misses.filter(() => R() < 0.35).slice(0, 4).concat(misses.filter((e) => e.m >= 85).slice(0, 1)));
  let clips = [];
  for (const e of evs) {
    if (e.ev === 'goal' || e.ev === 'save' || pickedMiss.has(e)) clips.push({ from: (e.pre ? Math.min(e.pre.t0 - 0.3, e.t - 1.35) : e.setT !== undefined ? Math.min(e.setT - 0.5, e.t - 1.35) : e.t - 1.35), to: e.t + (e.ev === 'goal' ? 1.3 : 0.6), e, goal: e.ev === 'goal' });
  }
  for (const e of others) if (e.ev === 'red') clips.push({ from: e.t - 0.7, to: e.t + 0.3, e });
  clips.sort((a, b) => a.from - b.from);
  clips = clips.reduce((acc, c) => { const p = acc[acc.length - 1]; if (p && c.from < p.to) { p.to = Math.max(p.to, c.to); p.goal = p.goal || c.goal; } else acc.push({ ...c }); return acc; }, []);
  const clipEv = new Set(clips.flatMap((c) => evs.filter((e) => e.t >= c.from && e.t <= c.to)));
  // ---- anlatım: önemli anlarda topun geçtiği oyunculardan üretilen satırlar ----
  {
    const pick = (a) => a[Math.floor(R() * a.length)];
    const who = (t, j) => { const lu = lineupAt(t); const id = lu.ids[j < 11 ? 'h' : 'a'][j % 11]; return id ? (names.get(id) || '').split(' ').pop() : ''; };
    for (const e of evs) {
      if (!clipEv.has(e)) continue;
      const t0 = Math.max(0.1, (e.pre ? e.pre.t0 : e.t - 1.3)), t1 = e.setT ?? e.t;
      const seq = [];
      for (let t = t0; t < t1; t += SIM_DT) {
        const h = sim.frames[Math.floor(t / SIM_DT) * FRAME + 47];
        if (h >= 0 && (h < 11 ? 'h' : 'a') === e.s && (!seq.length || seq[seq.length - 1].j !== h)) seq.push({ t, j: h });
      }
      const say = (t, txt) => txt && others.push({ m: e.m, t, s: e.s, ev: 'comm', txt });
      const first = seq[0], passer = seq.length > 1 ? seq[seq.length - 2] : null, sh = who(e.t, e.shooter);
      if (first && first.j !== e.shooter && e.style !== 'corner') say(first.t, pick([`${who(first.t, first.j)} topu aldı, ${esc((e.s === 'h' ? H : A)?.name || '')} hücumda`, `${who(first.t, first.j)} ileri taşıyor`, `${who(first.t, first.j)} oyunu kuruyor`]));
      if (e.style === 'cross' && e.winger >= 0) say(t1 - 0.45, pick([`${who(t1, e.winger)} çizgiye indi… ortayı yaptı!`, `${who(t1, e.winger)} kanattan ortaladı`]));
      else if (e.style === 'thru' && passer) say(passer.t + 0.05, pick([`${who(passer.t, passer.j)} ara pası verdi, ${sh} kaçtı!`, `${who(passer.t, passer.j)}${trEk(who(passer.t, passer.j), 'abl')} savunma arkasına harika pas`]));
      else if (e.style === 'long') say(t1 - 0.25, pick([`${sh} ceza sahası dışından deniyor…`, `${sh} uzaktan vurmak için yer arıyor`]));
      else if (e.style === 'corner' && e.cornered) say(t1 - 0.5, 'Korner… top ceza sahasına geliyor');
      else if (e.style === 'pen') say(e.t - 0.3, `${sh} topun başında… koşuyor…`);
      else if (e.style === 'fk') say(e.t - 0.3, `${sh} serbest vuruşun başında, baraj hazır`);
      if (e.style === 'cross' || e.style === 'corner') say(e.t - 0.05, `${sh} kafayı vurdu!`);
      else if (e.style !== 'pen' && e.style !== 'fk') say(e.t - 0.05, pick([`${sh} vuruyor!`, `${sh} şutunu çekti!`, `${sh} kaleyi yokluyor!`]));
    }
    timeline.length = 0; timeline.push(...[...evs, ...others].sort((a, b) => a.t - b.t));
  }

  root.innerHTML = `
  <div class="mwrap">
    <div class="mboard"><button class="mclose" id="mClose" title="Kapat">✕</button>
      <div class="mteam">${crestSVG(H, 34)}<b>${esc(H?.name)}</b></div>
      <div class="mscore"><span id="sH">0</span><i>-</i><span id="sA">0</span><small id="mMin">0'</small>${live ? '<small class="livebadge" id="mLive">● CANLI</small>' : ''}</div>
      <div class="mteam r"><b>${esc(A?.name)}</b>${crestSVG(A, 34)}</div>
    </div>
    <div class="mstage" id="mStage"><canvas id="pitchCv"></canvas><div class="m3d" id="m3d"></div>
      <div class="mphase" id="mPhase"></div><div class="mflash" id="mFlash"></div><div class="mover" id="mOver"></div></div>
    <div class="mctrl ${live ? 'is-live' : ''}">
      <button class="btn sm icon" id="mPlay" title="Oynat/durdur">❚❚</button>
      <div class="seg sm" id="mSpeed">${[1, 2, 4].map((s) => `<button data-s="${s}" class="${s === 1 ? 'on' : ''}">${s}x</button>`).join('')}</div>
      <div class="seg sm" id="mMode"><button data-m="2d" class="on">2D</button><button data-m="3d">3D</button></div>
      <button class="btn sm" id="mNames" title="Oyuncu isimleri">Aa</button>
      <button class="btn sm" id="mNext" title="Sonraki an">⏩</button>
      <button class="btn sm" id="mEnd" title="Sona atla">⏭</button>
    </div>
    <div class="mstats" id="mStats"></div>
    <div class="mfeed" id="mFeed"></div>
  </div>`;
  const cv = document.getElementById('pitchCv');
  const host3d = document.getElementById('m3d');
  r2d = new Pitch2D(cv);
  let r3d = null, mode = '2d';
  onResize = () => { r2d.resize(); r3d?.resize(); };
  window.addEventListener('resize', onResize);

  // oynatma durumu: clock = ekrandaki maç dakikası, tm = sahada oynatılan senaryo zamanı
  let clock = 0, tm = 0, speed = 1, playing = true, last = performance.now(), shown = 0, flashT = 0, pauseT = 0;
  let ci = 0, phase = 'gap', clip = null, replay = null, htShown = false, ended = false;
  const liveT = () => Math.min(95, ((Date.now() - new Date(fx.kickoff_at)) / liveMs) * 95);
  const frame = { ply: { h: Array.from({ length: 11 }, () => ({ x: 0, y: 0 })), a: Array.from({ length: 11 }, () => ({ x: 0, y: 0 })) }, ball: { x: 0.5, y: 0.5, z: 0 }, carrier: null };
  const feed = document.getElementById('mFeed');
  let sh = 0, sa = 0;
  const ls = { shots: [0, 0], on: [0, 0] };
  let statMin = -1;

  function lineupAt(t) {
    const cur = { h: [...startH], a: [...startA] };
    const gone = new Set();
    for (const e of others) {
      if (e.t > t) break;
      if (e.ev === 'sub') { const i = cur[e.s].indexOf(e.p); if (i >= 0) cur[e.s][i] = e.a; }
      else if (e.ev === 'red') gone.add(e.p);
      else if (e.ev === 'injury' && !others.some((x) => x.ev === 'sub' && x.p === e.p && x.t >= e.t - 0.01)) gone.add(e.p);
    }
    while (cur.h.length < 11) cur.h.push(null); while (cur.a.length < 11) cur.a.push(null);
    return { ids: cur, gone };
  }
  function emit(e, silent) {
    if (e.ev === 'comm') { // anlatım sadece önemli an oynarken
      if (phase === 'clip' && !replay) feed.insertAdjacentHTML('afterbegin', `<div class="fe comm"><span class="fm">${Math.min(90, Math.round(e.m))}'</span><span class="ft">${esc(e.txt)}</span></div>`);
      return;
    }
    let txt = '', cls = '';
    const team = e.s === 'h' ? H : A;
    const si = e.s === 'h' ? 0 : 1;
    if (e.ev === 'goal') {
      if (e.s === 'h') sh++; else sa++;
      ls.shots[si]++; ls.on[si]++;
      document.getElementById('sH').textContent = sh; document.getElementById('sA').textContent = sa;
      const how = e.pen ? ' <small>(penaltı)</small>' : e.fk ? ' <small>(serbest vuruş)</small>' : '';
      txt = `<b>GOL!</b> ${nm(e.p)}${how}${e.a && !e.pen && !e.fk ? ` <small>(asist: ${nm(e.a)})</small>` : ''}`; cls = 'goal';
      if (!silent) flash(`GOL! ${names.get(e.p) || ''}`, kits[e.s]);
    } else if (e.ev === 'save') { ls.shots[si]++; ls.on[si]++; txt = e.pen ? `<b>Penaltı kurtarıldı!</b> ${nm(e.p)}` : e.fk ? `Kurtarış! ${nm(e.p)} serbest vuruşu` : `Kurtarış! ${nm(e.p)} şutu`; cls = 'save'; }
    else if (e.ev === 'miss') { ls.shots[si]++; txt = e.pen ? `<b>${nm(e.p)} penaltıyı kaçırdı!</b>` : e.fk ? `${nm(e.p)} serbest vuruşu dışarı attı` : `${nm(e.p)} auta attı`; cls = 'miss'; }
    else if (e.ev === 'penfoul') {
      const why = e.c === 'hand' ? (e.p ? `${nm(e.p)} ceza sahasında elle oynadı` : 'ceza sahasında el') : (e.p ? `${nm(e.p)}, ${e.w ? nm(e.w) + trEk(names.get(e.w), 'acc') : 'rakibini'} ceza sahasında düşürdü` : 'ceza sahasında faul');
      txt = `<b>PENALTI!</b> ${why}`; cls = 'pen';
      if (!silent) flash(e.c === 'hand' ? 'PENALTI! · EL' : 'PENALTI! · FAUL', { c1: '#111827', c2: '#facc15' });
    } else if (e.ev === 'fkfoul') {
      txt = `Faul: ${e.p ? nm(e.p) : 'savunmacı'}${e.w ? `, ${nm(e.w)}${trEk(names.get(e.w), 'acc')} düşürdü` : ''} · serbest vuruş`; cls = 'fk';
      if (!silent) flash('FAUL · SERBEST VURUŞ', { c1: '#111827', c2: '#f59e0b' });
    }
    else if (e.ev === 'yellow') { txt = `${nm(e.p)}`; cls = 'yellow'; }
    else if (e.ev === 'red') { txt = `<b>Kırmızı kart!</b> ${nm(e.p)}`; cls = 'red'; if (!silent) flash(`KIRMIZI KART · ${names.get(e.p) || ''}`, { c1: '#dc2626', c2: '#ffffff' }); }
    else if (e.ev === 'injury') { txt = `${nm(e.p)} sakatlandı`; cls = 'injury'; }
    else if (e.ev === 'sub') { txt = `<span class="in">▲ ${nm(e.a)}</span> <span class="out">▼ ${nm(e.p)}</span>`; cls = 'sub'; }
    feed.insertAdjacentHTML('afterbegin', `<div class="fe ${cls}"><span class="fm">${Math.min(90, Math.round(e.m))}'</span><span class="fi"></span>${crestSVG(team, 16)}<span class="ft">${txt}</span></div>`);
    statsHtml();
  }
  function statsHtml(final) {
    const st = fx.stats || {};
    const bar = (a, b, label, isPct) => {
      const tot = Number(a) + Number(b) || 1;
      return `<div class="srow"><b>${a}${isPct ? '%' : ''}</b><div class="sbar"><span>${label}</span><i style="width:${(a / tot) * 100}%;background:${kits.h.c1}"></i><i style="width:${(b / tot) * 100}%;background:${kits.a.c1}"></i></div><b>${b}${isPct ? '%' : ''}</b></div>`;
    };
    const lineup = (sd) => {
      const start = (sd === 'h' ? st.lh : st.la) || [];
      const subs = (fx.events || []).filter((e) => e.t === 'sub' && e.s === sd);
      const out = new Set(subs.map((e) => e.p));
      const line = (id, sub) => `<div class="lp ${id === st.motm ? 'star' : ''}"><span class="no">${num(id)}</span><span class="nmx">${sub ? '↳ ' : ''}${nm(id)}${out.has(id) ? ' <i class="out">▼</i>' : ''}${id === st.motm ? ' ⭐' : ''}</span>${st.rt?.[id] != null ? `<b class="rt ${st.rt[id] >= 7.5 ? 'hi' : st.rt[id] < 6 ? 'lo' : ''}">${Number(st.rt[id]).toFixed(1)}</b>` : ''}</div>`;
      return `<div><div class="lhead">${crestSVG(sd === 'h' ? H : A, 18)} ${esc((sd === 'h' ? st.fh : st.fa) || '')}</div>${start.map((id) => line(id)).join('')}${subs.map((e) => line(e.a, true)).join('')}</div>`;
    };
    document.getElementById('mStats').innerHTML = `
      ${final ? bar(st.poss?.[0] ?? 50, st.poss?.[1] ?? 50, 'Topa sahip olma', true) : ''}
      ${bar(final ? st.shots?.[0] ?? ls.shots[0] : ls.shots[0], final ? st.shots?.[1] ?? ls.shots[1] : ls.shots[1], 'Şut')}
      ${bar(final ? st.on?.[0] ?? ls.on[0] : ls.on[0], final ? st.on?.[1] ?? ls.on[1] : ls.on[1], 'İsabetli şut')}
      ${(() => { const upto = final ? 999 : clock, cnt = (sd, k) => setp.filter((x) => x.s === sd && x.k === k && x.t <= upto).length;
        return bar(cnt('h', 'c'), cnt('a', 'c'), 'Korner') + bar(cnt('h', 'f'), cnt('a', 'f'), 'Faul'); })()}
      ${final ? (() => { // şutların nereden geldiği
        const row = (sd) => Object.entries(styleName).map(([k, n]) => [n, evs.filter((e) => e.s === sd && e.style === k).length, evs.filter((e) => e.s === sd && e.style === k && e.ev === 'goal').length]).filter((x) => x[1] > 0)
          .map(([n, c, g]) => `<span class="chip">${n} <b>${c}</b>${g ? ` · ${g} gol` : ''}</span>`).join('') || '<span class="muted">—</span>';
        return `<div class="stypes"><small>Şutların kaynağı</small><div>${crestSVG(H, 16)} ${row('h')}</div><div>${crestSVG(A, 16)} ${row('a')}</div></div>`; })() : ''}
      ${final && st.motm ? `<div class="motm">⭐ Maçın adamı <b>${nm(st.motm)}</b> <span class="rt hi">${st.rt?.[st.motm] ?? ''}</span></div>` : ''}
      ${final ? `<details class="lineups" open><summary>Kadrolar ve puanlar</summary><div class="lcols">${lineup('h')}${lineup('a')}</div></details>` : ''}`;
  }
  function flash(text, kit) {
    const el = document.getElementById('mFlash');
    el.textContent = text; el.style.background = kit?.c1 || '#16a34a'; el.style.color = kit ? numColor(kit) : '#fff';
    el.classList.add('show'); flashT = 1.8;
  }
  function overlay(html) { const el = document.getElementById('mOver'); el.innerHTML = html || ''; el.classList.toggle('show', !!html); }
  function phaseLabel(txt) { const el = document.getElementById('mPhase'); el.textContent = txt || ''; el.classList.toggle('show', !!txt); }

  // sıradaki olayları yayınla: önemli an olayları sahnede (tm), diğerleri saatle (clock)
  function pump() {
    while (shown < timeline.length) {
      const e = timeline[shown];
      const due = clipEv.has(e) ? (tm >= (e.ta ?? e.t) && phase === 'clip') || clock > e.t + 1.2 : clock >= e.t;
      if (!due) break;
      emit(e, !(clipEv.has(e) || e.ev === 'red'));
      shown++;
    }
  }
  function startClip(c) {
    clip = c; phase = 'clip'; tm = c.from; clock = Math.max(clock, c.from);
    phaseLabel('');
    document.getElementById('mStage').classList.add('cut');
    setTimeout(() => document.getElementById('mStage')?.classList.remove('cut'), 250);
  }
  function nextClipIndex() { while (ci < clips.length && clips[ci].to < clock - 0.2) ci++; return ci; }

  function step(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (flashT > 0) { flashT -= dt; if (flashT <= 0) document.getElementById('mFlash').classList.remove('show'); }
    if (pauseT > 0) { pauseT -= dt; if (pauseT <= 0) overlay(''); }
    else if ((playing || live) && !ended) advance(dt);
    // ilk yarı sonu
    if (!htShown && clock >= 45 && phase !== 'clip' && phase !== 'pens') {
      htShown = true;
      if (clock < 48) {
      overlay(`<div class="ht"><small>İLK YARI SONU</small><b>${sh} - ${sa}</b></div>`);
      if (!live) pauseT = 2; else setTimeout(() => overlay(''), 4000);
      } // ileri atlandıysa devre arası gösterilmez
    }
    document.getElementById('mMin').textContent = ended ? (fx.pens ? `MS · pen. ${fx.pens}` : 'MS') : phase === 'pens' ? 'PEN' : `${Math.min(90, Math.floor(clock))}'${clock > 90 ? '+' : ''}`;
    if (!ended && Math.floor(clock) !== statMin) { statMin = Math.floor(clock); statsHtml(); } // korner/faul sayaçları
    render(dt);
    raf = requestAnimationFrame(step);
  }
  function advance(dt) {
    if (phase === 'pens') { advancePens(dt * (live ? 1 : speed)); return; }
    const sp = live ? 1 : speed;
    if (live) clock = Math.max(clock, liveT());
    if (phase === 'clip') {
      if (replay) {
        tm += dt * CLIP_RATE * 0.5 * sp;
        if (tm >= replay.to) { replay = null; overlay(''); endClip(); }
      } else {
        tm += dt * CLIP_RATE * sp;
        if (!live) clock = Math.max(clock, Math.min(tm, 90));
        if (tm >= clip.to) {
          if (clip.goal && !live) { replay = { to: (clip.e.ta ?? clip.e.t) + 0.25 }; tm = clip.e.t - 0.6; overlay('<span class="tag rep">TEKRAR</span>'); }
          else endClip();
        }
      }
    } else {
      // ara: sahada sakin oyun normal hızda, saat hızla bir sonraki ana koşar
      const i = nextClipIndex();
      const nxt = clips[i];
      if (!live) clock = Math.min(nxt ? nxt.from : 95, clock + dt * GAP_RATE * sp);
      const cap = nxt ? nxt.from - 0.1 : 95;
      tm = Math.min(cap, tm + dt * CLIP_RATE * sp);
      phaseLabel(nxt && !live && clock < nxt.from - 1 ? '⏩' : '');
      if (nxt && clock >= nxt.from) { ci = i + 1; startClip(nxt); }
      else if (!nxt && clock >= (live ? 95 : 94.9)) { if (!startPens()) finish(); }
      if (!nxt) tm = Math.min(tm, sim.T_END - 0.1);
    }
    pump();
  }
  function endClip() { phase = 'gap'; tm = clip.to; clip = null; }
  function render(dt) {
    let fr = frame, lu;
    if (phase === 'pens') { fr = pensState(); lu = pens.lu; }
    else { frameAt(sim, tm, frame); lu = lineupAt(Math.max(tm, phase === 'clip' ? tm : clock)); }
    const st = { ply: fr.ply, ids: lu.ids, gone: lu.gone, kits, ball: fr.ball, carrier: fr.carrier, fallen: fr.fallen, num, name: (id) => names.get(id) || '', showNames };
    if (mode === '3d' && r3d?.ready) r3d.draw(st, dt); else r2d.draw(st);
  }
  function endLive() {
    if (!live) return;
    live = false;
    document.getElementById('mLive')?.remove();
    document.querySelector('.mctrl')?.classList.remove('is-live');
  }
  // ---- seri penaltı: kale üst tarafta, oyuncular orta çizgide, atıcı sırayla gelir ----
  let pens = null;
  const KICK = 3.4; // sn / atış
  function startPens() {
    if (!fx.pens || pens?.done) return false;
    const ks = shootout(fx.pens, rng(fid * 7 + 3));
    if (!ks) return false;
    const lu = lineupAt(95);
    const order = { h: [], a: [] };
    for (const s of ['h', 'a']) for (const k of [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]) if (!lu.gone.has(lu.ids[s][k])) order[s].push(k);
    const cnt = { h: 0, a: 0 }, PR = rng(fid * 11 + 5);
    for (const k of ks) {
      k.slot = order[k.s][cnt[k.s]++ % order[k.s].length];
      const side = PR() < 0.5 ? -1 : 1;
      k.tx = 0.5 + side * (k.res === 'miss' ? 4.4 + PR() * 1.2 : 1.6 + PR() * 1.8) / PW;
      k.over = k.res === 'miss' && PR() < 0.4; if (k.over) k.tx = 0.5 + side * PR() * 2.5 / PW;
      k.dive = k.res === 'save' ? side : (PR() < 0.35 ? side : -side); // kurtarışta doğru köşe
    }
    pens = { ks, i: 0, t: 0, h: 0, a: 0, lu, done: false, said: -1 };
    phase = 'pens'; clip = null; replay = null; overlay(''); clock = 95;
    while (shown < timeline.length) emit(timeline[shown++], true);
    document.getElementById('sH').textContent = fx.hg; document.getElementById('sA').textContent = fx.ag;
    document.getElementById('mMin').textContent = 'PEN';
    phaseLabel('Penaltılar 0 - 0');
    return true;
  }
  function advancePens(dt) {
    pens.t += dt;
    const k = pens.ks[pens.i];
    if (pens.t >= 2.15 && pens.said !== pens.i) { // sonuç
      pens.said = pens.i;
      if (k.res === 'goal') pens[k.s]++;
      overlay(`<span class="tag">${k.res === 'goal' ? 'GOL' : k.res === 'save' ? 'KURTARDI' : 'KAÇIRDI'} · ${esc(names.get(pens.lu.ids[k.s][k.slot]) || '')}</span>`);
      phaseLabel(`Penaltılar ${pens.h} - ${pens.a}`);
    }
    if (pens.t >= KICK) {
      overlay(''); pens.t = 0; pens.i++;
      if (pens.i >= pens.ks.length) { pens.done = true; phase = 'gap'; finish(); }
    }
  }
  function pensState() {
    const k = pens.ks[Math.min(pens.i, pens.ks.length - 1)], u = pens.t;
    const ply = { h: [], a: [] }, dfn = k.s === 'h' ? 'a' : 'h';
    for (const s of ['h', 'a']) for (let i = 0; i < 11; i++) {
      // orta çizgide yan yana; kaleciler: savunan kalede, diğeri kenarda
      let x = 0.22 + (i / 10) * 0.56, y = s === 'h' ? 0.47 : 0.53;
      if (i === 0) { x = s === dfn ? 0.5 : 0.12; y = s === dfn ? 0.012 : 0.5; }
      ply[s].push({ x, y });
    }
    const spotY = 11 / PL, ball = { x: 0.5, y: spotY, z: 0 };
    const kp = ply[k.s][k.slot], home = { x: kp.x, y: kp.y };
    const walk = clamp(u / 1.1, 0, 1), run = clamp((u - 1.2) / 0.45, 0, 1);
    kp.x = lerp(home.x, 0.5 - 0.02, walk); kp.y = lerp(home.y, spotY + 0.06, walk); // yürür, geri çekilir
    if (run > 0) { kp.x = lerp(0.48, 0.495, run); kp.y = lerp(spotY + 0.06, spotY + 0.012, run); }
    const gk = ply[dfn][0], fl = clamp((u - 1.65) / 0.4, 0, 1);
    if (fl > 0) {
      const ty = k.res === 'save' ? 0.016 : k.over ? -0.006 : -0.01;
      ball.x = lerp(0.5, k.tx, fl); ball.y = lerp(spotY, ty, fl); ball.z = k.over ? fl * 3.2 : Math.sin(Math.PI * fl * 0.5) * 0.9;
      gk.x = 0.5 + k.dive * clamp((u - 1.62) / 0.35, 0, 1) * (k.res === 'save' ? Math.abs(k.tx - 0.5) : 2.6 / PW);
      if (u > 2.1 && k.res === 'goal') { ball.z = 0.2; }
    }
    const carrier = u < 1.65 ? { s: k.s, i: k.slot } : null;
    return { ply, ball, carrier };
  }
  function finish() {
    if (ended) return;
    if (phase === 'pens') { pens.done = true; phase = 'gap'; }
    ended = true; endLive();
    replay = null; overlay(''); phaseLabel('');
    clock = 95;
    while (shown < timeline.length) emit(timeline[shown++], true);
    document.getElementById('sH').textContent = fx.hg; document.getElementById('sA').textContent = fx.ag;
    document.getElementById('mPlay').textContent = '↺';
    statsHtml(true);
  }
  function restart() {
    pens = null;
    ended = false; clock = 0; tm = 0; ci = 0; phase = 'gap'; clip = null; replay = null; shown = 0; sh = sa = 0; htShown = false;
    ls.shots = [0, 0]; ls.on = [0, 0]; feed.innerHTML = '';
    document.getElementById('sH').textContent = 0; document.getElementById('sA').textContent = 0;
    statsHtml(); playing = true; document.getElementById('mPlay').textContent = '❚❚';
  }

  document.getElementById('mPlay').onclick = (e) => {
    if (ended) return restart();
    playing = !playing; e.target.textContent = playing ? '❚❚' : '▶';
  };
  document.querySelectorAll('#mSpeed button').forEach((b) => (b.onclick = () => { speed = Number(b.dataset.s); document.querySelectorAll('#mSpeed button').forEach((x) => x.classList.toggle('on', x === b)); }));
  document.getElementById('mNext').onclick = () => {
    if (ended || live) return;
    pauseT = 0; overlay('');
    if (phase === 'clip') { replay = null; tm = clip.to; endClip(); }
    const nxt = clips[nextClipIndex()];
    if (phase === 'pens') finish();
    else if (nxt) { clock = nxt.from; ci++; startClip(nxt); pump(); } else if (!startPens()) finish();
  };
  document.querySelectorAll('#mMode button').forEach((b) => (b.onclick = async () => {
    const m = b.dataset.m;
    document.querySelectorAll('#mMode button').forEach((x) => x.classList.toggle('on', x === b));
    mode = m;
    document.getElementById('mStage').classList.toggle('is3d', m === '3d');
    try { localStorage.setItem('mac-mod', m); } catch { /* yok */ }
    if (m === '3d' && !r3d) {
      overlay('<span class="tag">3D yükleniyor…</span>');
      try {
        r3d = new Pitch3D();
        await r3d.init(host3d, { kits, ids: lineupAt(clock).ids, num });
        r3d.ready = true; overlay('');
      } catch {
        overlay(''); mode = '2d'; r3d = null;
        document.getElementById('mStage').classList.remove('is3d');
        document.querySelectorAll('#mMode button').forEach((x) => x.classList.toggle('on', x.dataset.m === '2d'));
        alert('3D görünüm bu cihazda açılamadı.');
      }
    } else if (m === '3d') r3d.resize();
    else r2d.resize();
  }));
  let showNames = false;
  try { showNames = localStorage.getItem('mac-isim') === '1'; } catch { /* yok */ }
  const namesBtn = document.getElementById('mNames');
  namesBtn.classList.toggle('on', showNames);
  namesBtn.onclick = () => {
    showNames = !showNames; namesBtn.classList.toggle('on', showNames);
    try { localStorage.setItem('mac-isim', showNames ? '1' : '0'); } catch { /* yok */ }
  };
  document.getElementById('mEnd').onclick = () => { pauseT = 0; finish(); };
  document.getElementById('mClose').onclick = close;
  statsHtml();
  if (live) {
    clock = liveT();
    while (shown < timeline.length && timeline[shown].t <= clock - 0.3) emit(timeline[shown++], true);
    if (clock > 46) htShown = true;
    tm = clock;
    nextClipIndex();
  }
  raf = requestAnimationFrame(step);
  try { if (localStorage.getItem('mac-mod') === '3d') document.querySelector('#mMode button[data-m="3d"]').click(); } catch { /* yok */ }

  function close() {
    closed = true;
    cancelAnimationFrame(raf);
    clearTimeout(waitTimer);
    if (onResize) window.removeEventListener('resize', onResize);
    r3d?.dispose();
    root.classList.remove('show'); root.innerHTML = '';
    onClose?.();
  }
}
