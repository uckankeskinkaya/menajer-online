// Maç izleyici: sunucudaki olay listesinden (fixtures.events) animasyon üretir.
// 2D kuşbakışı (Canvas): oyuncular içinde forma numarası olan dairelerdir.
// Saha koordinatları 0-1: x en, y boy; ev sahibi y=0 kalesine hücum eder.
import { esc, slotPositions } from './ui.js';
import { matchKits, drawDot, crestSVG, numColor } from './kit.js';

const GOAL_W = 7.32 / 68;      // kale ağzı (saha enine oranla)
const PL = 105, PW = 68;       // metre

function rng(seed) { // mulberry32: aynı maç her izlendiğinde aynı akış
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------- senaryo: top hareketleri ----------------
function buildScript(fx, R) {
  const fh = fx.stats?.fh || '4-4-2', fa = fx.stats?.fa || '4-4-2';
  const base = {
    h: slotPositions(fh).map((p) => ({ x: p.x, y: 0.5 + (p.y - 0.5) * 0.92 })),
    a: slotPositions(fa).map((p) => ({ x: 1 - p.x, y: 0.5 - (p.y - 0.5) * 0.92 })),
  };
  const poss = (fx.stats?.poss?.[0] ?? 50) / 100;
  const evs = (fx.events || []).map((e, i) => ({ ...e, i })).sort((a, b) => a.m - b.m || a.i - b.i);
  let lastT = -1;
  for (const e of evs) { e.t = Math.max(e.m - 0.5 + R() * 0.4, lastT + 1.6); lastT = e.t; }
  const segs = [];
  let t = 0, side = R() < poss ? 'h' : 'a', who = 9, x = 0.5, y = 0.5;
  const goalY = (s) => (s === 'h' ? 0 : 1);
  const fwdSlots = (form) => { const n = form.split('-').map(Number); return Array.from({ length: n[n.length - 1] }, (_, k) => 10 - k); };
  const push = (t1, x1, y1, kind, nside = side, nwho = who) => {
    segs.push({ t0: t, t1, x0: x, y0: y, x1, y1, side: nside, who: nwho, kind });
    t = t1; x = x1; y = y1; side = nside; who = nwho;
  };
  const targetOf = (s, idx, adv) => {
    const b = base[s][idx];
    const dir = s === 'h' ? -1 : 1;
    return { x: clamp(b.x + (R() - 0.5) * 0.12, 0.05, 0.95), y: clamp(b.y + dir * adv + (R() - 0.5) * 0.08, 0.04, 0.96) };
  };
  const passUntil = (tEnd) => {
    while (t < tEnd - 0.35) {
      const dur = 0.25 + R() * 0.35;
      if (t + dur > tEnd) break;
      if (R() < 0.18) side = R() < poss ? 'h' : 'a';
      const idx = 1 + Math.floor(R() * 10);
      const p = targetOf(side, idx, 0.05 + R() * 0.12);
      push(t + dur, p.x, p.y, 'pass', side, idx);
    }
  };
  for (const e of evs) {
    if (e.t - 1.2 > t) passUntil(e.t - 1.2);
    if (e.t < t + 1.2) e.t = t + 1.2;
    const s = e.s;
    const fwd = fwdSlots(s === 'h' ? fh : fa);
    const shooterIdx = e.slot ?? fwd[Math.floor(R() * fwd.length)] ?? 10;
    const gy = goalY(s), dir = s === 'h' ? 1 : -1;
    push(e.t - 0.75, 0.25 + R() * 0.5, gy + dir * (0.3 + R() * 0.1), 'pass', s, 7);
    push(e.t - 0.25, clamp(0.5 + (R() - 0.5) * 0.4, 0.15, 0.85), gy + dir * (0.1 + R() * 0.1), 'carry', s, shooterIdx);
    const other = s === 'h' ? 'a' : 'h';
    if (e.ev === 'goal') {
      const gx = 0.5 + (R() - 0.5) * GOAL_W * 0.8;
      push(e.t, gx, gy - dir * 0.012, 'shot', s, shooterIdx);
      push(e.t + 1.4, gx, gy - dir * 0.012, 'still', s, shooterIdx);
      push(e.t + 1.6, 0.5, 0.5, 'reset', other, 10);
    } else if (e.ev === 'save') {
      const gk = { x: 0.5 + (R() - 0.5) * GOAL_W * 0.7, y: gy + dir * 0.03 };
      push(e.t, gk.x, gk.y, 'shot', s, shooterIdx);
      push(e.t + 0.6, gk.x, gk.y, 'still', other, 0);
      const p = targetOf(other, 1 + Math.floor(R() * 4), 0.05);
      push(e.t + 1.0, p.x, p.y, 'pass', other, 2);
    } else {
      const wide = R() < 0.5 ? 0.5 - GOAL_W * (0.7 + R()) : 0.5 + GOAL_W * (0.7 + R());
      push(e.t, clamp(wide, 0.05, 0.95), gy - dir * 0.02, 'shot', s, shooterIdx);
      push(e.t + 0.6, 0.5 + (R() - 0.5) * 0.2, gy + dir * 0.06, 'reset', other, 0);
    }
  }
  passUntil(95);
  push(Math.max(t + 0.5, 95), x, y, 'still');
  return { segs, base, evs };
}

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
    this.bg = document.createElement('canvas');
    this.bg.width = this.cv.width; this.bg.height = this.cv.height;
    const b = this.bg.getContext('2d');
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    b.fillStyle = '#1f5e25'; b.fillRect(0, 0, this.W, this.H);
    drawPitch(b, this.L, this.T, this.w, this.h);
    drawGoals(b, this.L, this.T, this.w, this.h, gd);
  }
  draw(st) {
    const { ctx, L, T, w, h } = this;
    const X = (x) => L + x * w, Y = (y) => T + y * h;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    const dpr = this.cv.width / this.W; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const size = Math.max(20, w * 0.066);
    const items = [];
    for (const s of ['h', 'a']) st.ply[s].forEach((p, i) => { if (!st.gone.has(st.ids[s][i])) items.push({ s, i, p }); });
    items.sort((a, b) => a.p.y - b.p.y);
    let carrier = null;
    for (const it of items) {
      const kit = it.i === 0 ? st.kits[it.s === 'h' ? 'gkH' : 'gkA'] : st.kits[it.s];
      const isC = st.carrier && st.carrier.s === it.s && st.carrier.i === it.i;
      drawDot(ctx, X(it.p.x), Y(it.p.y), size / 2, kit, st.num(st.ids[it.s][it.i]), { highlight: isC });
      if (isC) carrier = it;
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
    ctx.beginPath(); ctx.ellipse(X(b.x) + b.z * 0.4, Y(b.y) + 2, r, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    const by = Y(b.y) - b.z;
    const gr = ctx.createRadialGradient(X(b.x) - r * 0.4, by - r * 0.4, r * 0.2, X(b.x), by, r);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#cfd6e0');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(X(b.x), by, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1b1f27'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#1b1f27'; ctx.beginPath(); ctx.arc(X(b.x), by, r * 0.35, 0, Math.PI * 2); ctx.fill();
  }
  dispose() {}
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
    return { m: e.m, s: e.s, p: e.p, a: e.a, ev: e.t, slot: slot > 0 ? slot : undefined };
  });
  const startedAgo = fx.kickoff_at ? Date.now() - new Date(fx.kickoff_at) : Infinity;
  let live = startedAgo >= 0 && startedAgo < liveMs;
  const R = rng(fid * 2654435761);
  const SHOTS = ['goal', 'save', 'miss'];
  const { segs, base, evs } = buildScript({ ...fx, events: events.filter((e) => SHOTS.includes(e.ev)) }, R);
  const others = events.filter((e) => !SHOTS.includes(e.ev)).map((e) => ({ ...e, t: e.m + 0.2 }));
  const timeline = [...evs, ...others].sort((a, b) => a.t - b.t);

  root.innerHTML = `
  <div class="mwrap">
    <div class="mboard">
      <div class="mteam">${crestSVG(H, 34)}<b>${esc(H?.name)}</b></div>
      <div class="mscore"><span id="sH">0</span><i>-</i><span id="sA">0</span><small id="mMin">0'</small>${live ? '<small class="livebadge" id="mLive">● CANLI</small>' : ''}</div>
      <div class="mteam r"><b>${esc(A?.name)}</b>${crestSVG(A, 34)}</div>
    </div>
    <div class="mstage" id="mStage"><canvas id="pitchCv"></canvas>
      <div class="mflash" id="mFlash"></div><div class="mover" id="mOver"></div></div>
    <div class="mctrl ${live ? 'is-live' : ''}">
      <button class="btn sm icon" id="mPlay" title="Oynat/durdur">❚❚</button>
      <div class="seg sm" id="mSpeed">${[1, 2, 4, 8].map((s) => `<button data-s="${s}" class="${s === 2 ? 'on' : ''}">${s}x</button>`).join('')}</div>
      <button class="btn sm" id="mEnd" title="Sona atla">⏭</button>
      <button class="btn sm ghost icon" id="mClose" title="Kapat">✕</button>
    </div>
    <div class="mstats" id="mStats"></div>
    <div class="mfeed" id="mFeed"></div>
  </div>`;
  const cv = document.getElementById('pitchCv');
  r2d = new Pitch2D(cv);
  onResize = () => r2d.resize();
  window.addEventListener('resize', onResize);

  let tm = 0, speed = 2, playing = true, last = performance.now(), shown = 0, flashT = 0;
  let pauseT = 0, htShown = false, replay = null, pendingReplay = null;
  const MIN_PER_SEC = 1.0;
  const liveT = () => Math.min(95, ((Date.now() - new Date(fx.kickoff_at)) / liveMs) * 95);
  const ply = { h: base.h.map((p) => ({ ...p })), a: base.a.map((p) => ({ ...p })) };
  const feed = document.getElementById('mFeed');
  let sh = 0, sa = 0;
  const ls = { shots: [0, 0], on: [0, 0] };

  // t anındaki sahadakiler (değişiklik) ve atılanlar
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
  function ballAt(t) {
    let s = segs[0];
    for (let i = 0; i < segs.length; i++) { s = segs[i]; if (segs[i].t1 >= t) break; }
    const k = s.t1 > s.t0 ? clamp((t - s.t0) / (s.t1 - s.t0), 0, 1) : 1;
    const e = s.kind === 'shot' ? k * (2 - k) : k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const lift = s.kind === 'shot' || s.kind === 'pass' ? Math.sin(Math.PI * k) * (s.kind === 'shot' ? 7 : 3) : 0;
    return { x: lerp(s.x0, s.x1, e), y: lerp(s.y0, s.y1, e), z: lift, seg: s, k };
  }
  function movePlayers(b, dt, snap) {
    for (const s of ['h', 'a']) {
      const attacking = b.seg.side === s;
      const dir = s === 'h' ? -1 : 1;
      ply[s].forEach((p, i) => {
        const bs = base[s][i];
        let tx = bs.x + (b.x - 0.5) * (i === 0 ? 0.25 : 0.35);
        let ty = bs.y + (b.y - 0.5) * (i === 0 ? 0.05 : 0.3) + (attacking && i ? dir * 0.07 : 0);
        if (b.seg.side === s && b.seg.who === i && b.seg.kind !== 'reset') { tx = b.seg.x1; ty = b.seg.y1 + dir * -0.015; }
        if (i === 0) { ty = clamp(ty, s === 'h' ? 0.9 : 0.02, s === 'h' ? 0.98 : 0.1); tx = clamp(tx, 0.4, 0.6); }
        const sp = snap ? 1 : Math.min(1, dt * Math.max(1, speed) * 2.2);
        p.x = lerp(p.x, clamp(tx, 0.03, 0.97), sp); p.y = lerp(p.y, clamp(ty, 0.01, 0.99), sp);
      });
    }
  }

  function emit(e, silent) {
    let txt = '', cls = '';
    const team = e.s === 'h' ? H : A;
    const si = e.s === 'h' ? 0 : 1;
    if (e.ev === 'goal') {
      if (e.s === 'h') sh++; else sa++;
      ls.shots[si]++; ls.on[si]++;
      document.getElementById('sH').textContent = sh; document.getElementById('sA').textContent = sa;
      txt = `<b>GOL!</b> ${nm(e.p)}${e.a ? ` <small>(asist: ${nm(e.a)})</small>` : ''}`; cls = 'goal';
      if (!silent) { flash(`GOL! ${names.get(e.p) || ''}`, kits[e.s]); if (!live) pendingReplay = { from: Math.max(0, e.t - 1.3), to: e.t + 0.25, back: e.t + 0.3 }; }
    } else if (e.ev === 'save') { ls.shots[si]++; ls.on[si]++; txt = `Kurtarış! ${nm(e.p)} şutu`; cls = 'save'; }
    else if (e.ev === 'miss') { ls.shots[si]++; txt = `${nm(e.p)} auta attı`; cls = 'miss'; }
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
      ${final && st.motm ? `<div class="motm">⭐ Maçın adamı <b>${nm(st.motm)}</b> <span class="rt hi">${st.rt?.[st.motm] ?? ''}</span></div>` : ''}
      ${final ? `<details class="lineups" open><summary>Kadrolar ve puanlar</summary><div class="lcols">${lineup('h')}${lineup('a')}</div></details>` : ''}`;
  }
  function flash(text, kit) {
    const el = document.getElementById('mFlash');
    el.textContent = text; el.style.background = kit?.c1 || '#16a34a'; el.style.color = kit ? numColor(kit) : '#fff';
    el.classList.add('show'); flashT = 1.6;
  }
  function overlay(html) {
    const el = document.getElementById('mOver');
    el.innerHTML = html || ''; el.classList.toggle('show', !!html);
  }

  function step(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (live) tm = liveT();
    else if (pauseT > 0) { pauseT -= dt; if (pauseT <= 0) overlay(''); }
    else if (playing) tm = Math.min(95, tm + dt * MIN_PER_SEC * (replay ? 0.55 : speed));
    if (flashT > 0) { flashT -= dt; if (flashT <= 0) document.getElementById('mFlash').classList.remove('show'); }
    // gol tekrarı
    if (pendingReplay && flashT < 0.4 && !live) { replay = pendingReplay; pendingReplay = null; tm = replay.from; overlay('<span class="tag rep">TEKRAR</span>'); }
    if (replay && tm >= replay.to) { tm = replay.back; replay = null; overlay(''); }
    if (!replay) while (shown < timeline.length && timeline[shown].t <= tm) emit(timeline[shown++]);
    // ilk yarı sonu
    if (!htShown && tm >= 45 && tm < 46.5 && !replay) {
      htShown = true;
      overlay(`<div class="ht"><small>İLK YARI SONU</small><b>${sh} - ${sa}</b></div>`);
      if (!live) pauseT = 1.8; else setTimeout(() => overlay(''), 4000);
    }
    document.getElementById('mMin').textContent = tm >= 94.9 ? 'MS' : `${Math.min(90, Math.floor(tm))}'${tm > 90 ? '+' : ''}`;
    if (tm >= 95 && (playing || live) && !replay) { playing = false; endLive(); finish(); }
    render(dt);
    raf = requestAnimationFrame(step);
  }
  function render(dt) {
    const b = ballAt(tm);
    movePlayers(b, dt, false);
    const lu = lineupAt(tm);
    const carrier = b.seg.kind !== 'reset' && b.seg.kind !== 'still' && b.k > 0.6 ? { s: b.seg.side, i: b.seg.who } : null;
    const st = { ply, ids: lu.ids, gone: lu.gone, kits, ball: b, carrier, num, name: (id) => names.get(id) || '' };
    r2d.draw(st);
  }
  function endLive() {
    if (!live) return;
    live = false;
    document.getElementById('mLive')?.remove();
    document.querySelector('.mctrl')?.classList.remove('is-live');
  }
  function finish() {
    replay = null; pendingReplay = null; overlay('');
    while (shown < timeline.length) emit(timeline[shown++], true);
    document.getElementById('sH').textContent = fx.hg; document.getElementById('sA').textContent = fx.ag;
    document.getElementById('mMin').textContent = fx.pens ? `MS · pen. ${fx.pens}` : 'MS';
    document.getElementById('mPlay').textContent = '↺';
    statsHtml(true);
  }

  document.getElementById('mPlay').onclick = (e) => {
    if (tm >= 95) {
      tm = 0; shown = 0; sh = sa = 0; htShown = false; ls.shots = [0, 0]; ls.on = [0, 0]; feed.innerHTML = '';
      document.getElementById('sH').textContent = 0; document.getElementById('sA').textContent = 0;
      statsHtml(); playing = true; e.target.textContent = '❚❚'; return;
    }
    playing = !playing; e.target.textContent = playing ? '❚❚' : '▶';
  };
  document.querySelectorAll('#mSpeed button').forEach((b) => (b.onclick = () => { speed = Number(b.dataset.s); document.querySelectorAll('#mSpeed button').forEach((x) => x.classList.toggle('on', x === b)); }));
  document.getElementById('mEnd').onclick = () => { endLive(); tm = 95; playing = false; pauseT = 0; finish(); };
  document.getElementById('mClose').onclick = close;
  statsHtml();
  if (live) {
    tm = liveT();
    while (shown < timeline.length && timeline[shown].t <= tm) emit(timeline[shown++], true);
    if (tm > 46.5) htShown = true;
  }
  movePlayers(ballAt(tm), 0, true);
  raf = requestAnimationFrame(step);

  function close() {
    closed = true;
    cancelAnimationFrame(raf);
    clearTimeout(waitTimer);
    if (onResize) window.removeEventListener('resize', onResize);
    root.classList.remove('show'); root.innerHTML = '';
    onClose?.();
  }
}
