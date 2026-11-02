// 2D kuşbakışı maç izleyici. Sunucudaki olay listesinden (fixtures.events) animasyon üretir.
// Ev sahibi yukarı (y=0 kalesine) hücum eder. Koordinatlar 0-1 arası saha birimi.
import { esc, slotPositions, teamDot } from './ui.js';

const GOAL_W = 0.14; // kale ağzı genişliği (saha genişliğine oranla)

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
  // olayları aynı dakikada çakışmayacak şekilde dağıt
  const evs = (fx.events || []).map((e, i) => ({ ...e, i })).sort((a, b) => a.m - b.m || a.i - b.i);
  let lastT = -1;
  for (const e of evs) { e.t = Math.max(e.m - 0.5 + R() * 0.4, lastT + 1.6); lastT = e.t; }
  const segs = []; // {t0,t1,x0,y0,x1,y1,side,who,kind}
  let t = 0, side = R() < poss ? 'h' : 'a', who = 9, x = 0.5, y = 0.5;
  const goalY = (s) => (s === 'h' ? 0 : 1);         // s takımının hücum ettiği kale çizgisi
  const fwdSlots = (s, form) => { const n = form.split('-').map(Number); const last = n[n.length - 1]; return Array.from({ length: last }, (_, k) => 10 - k); };
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
      // top kaybı ihtimali
      if (R() < 0.18) side = R() < poss ? 'h' : 'a';
      const idx = 1 + Math.floor(R() * 10);
      const p = targetOf(side, idx, 0.05 + R() * 0.12);
      push(t + dur, p.x, p.y, 'pass', side, idx);
    }
  };
  // e.ev: olay türü (goal|save|miss), e.t: animasyon zamanı (dakika)
  for (const e of evs) {
    if (e.t - 1.2 > t) passUntil(e.t - 1.2);
    if (e.t < t + 1.2) e.t = t + 1.2; // önceki olayın animasyonu bitmeden başlamasın
    const s = e.s;
    // hücum: rakip ceza sahası çevresine pas, şutçu topu sürer, şut
    const fwd = fwdSlots(s, s === 'h' ? fh : fa);
    const shooterIdx = e.slot ?? fwd[Math.floor(R() * fwd.length)] ?? 10;
    const gy = goalY(s), dir = s === 'h' ? 1 : -1;
    const mid = { x: 0.25 + R() * 0.5, y: gy + dir * (0.3 + R() * 0.1) };
    push(e.t - 0.75, mid.x, mid.y, 'pass', s, 7);
    const shot = { x: clamp(0.5 + (R() - 0.5) * 0.4, 0.15, 0.85), y: gy + dir * (0.1 + R() * 0.1) };
    push(e.t - 0.25, shot.x, shot.y, 'carry', s, shooterIdx);
    const ev = e.ev;
    if (ev === 'goal') {
      push(e.t, 0.5 + (R() - 0.5) * GOAL_W * 0.8, gy - dir * 0.012, 'shot', s, shooterIdx);
      push(e.t + 1.4, 0.5 + (R() - 0.5) * GOAL_W * 0.8, gy - dir * 0.012, 'still', s, shooterIdx);
      const other = s === 'h' ? 'a' : 'h';
      push(e.t + 1.6, 0.5, 0.5, 'reset', other, 10);
    } else if (ev === 'save') {
      const gk = { x: 0.5 + (R() - 0.5) * GOAL_W * 0.7, y: gy + dir * 0.03 };
      push(e.t, gk.x, gk.y, 'shot', s, shooterIdx);
      const other = s === 'h' ? 'a' : 'h';
      push(e.t + 0.6, gk.x, gk.y, 'still', other, 0);
      const p = targetOf(other, 1 + Math.floor(R() * 4), 0.05);
      push(e.t + 1.0, p.x, p.y, 'pass', other, 2);
    } else {
      const wide = R() < 0.5 ? 0.5 - GOAL_W * (0.7 + R()) : 0.5 + GOAL_W * (0.7 + R());
      push(e.t, clamp(wide, 0.05, 0.95), gy - dir * 0.02, 'shot', s, shooterIdx);
      const other = s === 'h' ? 'a' : 'h';
      push(e.t + 0.6, 0.5 + (R() - 0.5) * 0.2, gy + dir * 0.06, 'reset', other, 0);
    }
  }
  passUntil(95);
  push(Math.max(t + 0.5, 95), x, y, 'still');
  return { segs, base, evs };
}

// ---------------- izleyici ----------------
export async function openMatch(sb, fid, { teamById, liveMs = 540000, onClose }) {
  const root = document.getElementById('match');
  root.innerHTML = `<div class="mwrap"><div class="loading">Maç yükleniyor…</div></div>`;
  root.classList.add('show');
  let closed = false, raf = 0, waitTimer = 0, onResize = null;
  let fx = null;
  // maç henüz oynanmadıysa (saati gelmedi / sunucu birazdan oynatacak) bekle
  for (;;) {
    const { data, error } = await sb.from('fixtures').select('*').eq('id', fid).maybeSingle();
    if (closed) return;
    if (error || !data) { root.innerHTML = `<div class="mwrap"><p>Maç bulunamadı</p><button class="btn" id="mClose">Kapat</button></div>`; document.getElementById('mClose').onclick = close; return; }
    if (data.played) { fx = data; break; }
    const H0 = teamById.get(data.home), A0 = teamById.get(data.away);
    const k = data.kickoff_at ? new Date(data.kickoff_at) : null;
    root.innerHTML = `<div class="mwrap center"><div class="mhead"><div class="mteam">${teamDot(H0)}<b>${esc(H0?.name)}</b></div><div class="mscore">-</div><div class="mteam r"><b>${esc(A0?.name)}</b>${teamDot(A0)}</div></div>
      <div class="card"><p>${k && k > Date.now() ? `⏰ Maç <b>${k.toLocaleString('tr-TR', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}</b>'da başlayacak.` : '⚽ Maç başlıyor…'}</p>
      <p class="muted small">Bu ekran açık kalırsa maç başlayınca canlı yayın kendiliğinden açılır.</p></div>
      <button class="btn" id="mClose">Kapat</button></div>`;
    document.getElementById('mClose').onclick = close;
    await new Promise((r) => (waitTimer = setTimeout(r, k && k - Date.now() > 60000 ? 30000 : 4000)));
    if (closed) return;
  }
  const ids = [...(fx.stats?.lh || []), ...(fx.stats?.la || []), ...(fx.events || []).flatMap((e) => [e.p, e.a])].filter(Boolean);
  const names = new Map();
  if (ids.length) {
    const { data } = await sb.from('real_players').select('id,name').in('id', [...new Set(ids)]);
    data?.forEach((p) => names.set(p.id, p.name));
  }
  const H = teamById.get(fx.home), A = teamById.get(fx.away);
  const nm = (id) => esc(names.get(id) || '?');
  // olay türünü 'ev' alanına taşı; 't' zaman olarak kullanılacak. Şutçunun slotunu bul.
  const events = (fx.events || []).map((e) => {
    const lu = (e.s === 'h' ? fx.stats?.lh : fx.stats?.la) || [];
    const slot = lu.indexOf(e.p);
    return { m: e.m, s: e.s, p: e.p, a: e.a, ev: e.t, slot: slot > 0 ? slot : undefined };
  });
  const startedAgo = fx.kickoff_at ? Date.now() - new Date(fx.kickoff_at) : Infinity;
  let live = startedAgo >= 0 && startedAgo < liveMs;
  const R = rng(fid * 2654435761);
  const shotEvents = events.filter((e) => e.ev !== 'yellow');
  const { segs, base, evs } = buildScript({ ...fx, events: shotEvents }, R);
  const cards = events.filter((e) => e.ev === 'yellow').map((e) => ({ ...e, t: e.m }));
  const timeline = [...evs, ...cards].sort((a, b) => a.t - b.t);

  root.innerHTML = `
  <div class="mwrap">
    <div class="mhead">
      <div class="mteam">${teamDot(H)}<b>${esc(H?.name)}</b></div>
      <div class="mscore"><span id="sH">0</span> - <span id="sA">0</span><small id="mMin">0'</small>${live ? '<small class="livebadge" id="mLive">🔴 CANLI</small>' : ''}</div>
      <div class="mteam r"><b>${esc(A?.name)}</b>${teamDot(A)}</div>
    </div>
    <div class="mcanvas"><canvas id="pitchCv"></canvas><div class="mflash" id="mFlash"></div></div>
    <div class="mctrl ${live ? 'is-live' : ''}">
      <button class="btn sm" id="mPlay">⏸</button>
      <div class="seg sm" id="mSpeed">${[1, 2, 4, 8].map((s) => `<button data-s="${s}" class="${s === 2 ? 'on' : ''}">${s}x</button>`).join('')}</div>
      <button class="btn sm" id="mEnd">Sona atla ⏭</button>
      <button class="btn sm ghost" id="mClose">✕</button>
    </div>
    <div class="mstats" id="mStats"></div>
    <div class="mfeed" id="mFeed"></div>
  </div>`;
  const cv = document.getElementById('pitchCv');
  const ctx = cv.getContext('2d');
  let W = 0, Hh = 0;
  const resize = () => {
    const box = cv.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = box.width; Hh = box.height;
    cv.width = W * dpr; cv.height = Hh * dpr; cv.style.width = `${W}px`; cv.style.height = `${Hh}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  onResize = resize;
  window.addEventListener('resize', resize);

  let tm = 0, speed = 2, playing = true, last = performance.now(), shown = 0, flashT = 0;
  const MIN_PER_SEC = 1.0; // tekrar izlemede 1x: 1 maç dakikası = 1 sn
  const LIVE_RATE = 95 / (liveMs / 1000); // canlıda gerçek zamana bağlı
  const liveT = () => Math.min(95, ((Date.now() - new Date(fx.kickoff_at)) / liveMs) * 95);
  const ply = { h: base.h.map((p) => ({ ...p })), a: base.a.map((p) => ({ ...p })) };
  const feed = document.getElementById('mFeed');
  let sh = 0, sa = 0;
  const ls = { shots: [0, 0], on: [0, 0] };

  function ballAt(t) {
    let s = segs[0];
    for (let i = 0; i < segs.length; i++) { if (segs[i].t1 >= t) { s = segs[i]; break; } s = segs[i]; }
    const k = s.t1 > s.t0 ? clamp((t - s.t0) / (s.t1 - s.t0), 0, 1) : 1;
    const e = s.kind === 'shot' ? k * (2 - k) : k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    return { x: lerp(s.x0, s.x1, e), y: lerp(s.y0, s.y1, e), seg: s, k };
  }

  function emit(e, silent) {
    let txt = '', cls = '';
    const team = e.s === 'h' ? H : A;
    if (e.ev === 'goal') {
      if (e.s === 'h') sh++; else sa++;
      ls.shots[e.s === 'h' ? 0 : 1]++; ls.on[e.s === 'h' ? 0 : 1]++;
      document.getElementById('sH').textContent = sh; document.getElementById('sA').textContent = sa;
      txt = `⚽ <b>GOL!</b> ${nm(e.p)}${e.a ? ` <small>(asist: ${nm(e.a)})</small>` : ''}`; cls = 'goal';
      if (!silent) flash(`GOL! ${names.get(e.p) || ''}`, team);
    } else if (e.ev === 'save') { ls.shots[e.s === 'h' ? 0 : 1]++; ls.on[e.s === 'h' ? 0 : 1]++; txt = `🧤 Kurtarış! ${nm(e.p)} şutu`; }
    else if (e.ev === 'miss') { ls.shots[e.s === 'h' ? 0 : 1]++; txt = `💨 ${nm(e.p)} auta attı`; }
    else if (e.ev === 'yellow') { txt = `🟨 ${nm(e.p)}`; cls = 'card'; }
    feed.insertAdjacentHTML('afterbegin', `<div class="fe ${cls} ${e.s}"><span class="fm">${Math.min(90, Math.round(e.m))}'</span>${teamDot(team)} ${txt}</div>`);
    statsHtml();
  }
  function statsHtml(final) {
    const st = fx.stats || {};
    const p = final ? st.poss || [50, 50] : null;
    document.getElementById('mStats').innerHTML = `
      ${p ? `<div class="srow"><b>${p[0]}%</b><span>Topa sahip olma</span><b>${p[1]}%</b></div>` : ''}
      <div class="srow"><b>${final ? st.shots?.[0] ?? ls.shots[0] : ls.shots[0]}</b><span>Şut</span><b>${final ? st.shots?.[1] ?? ls.shots[1] : ls.shots[1]}</b></div>
      <div class="srow"><b>${final ? st.on?.[0] ?? ls.on[0] : ls.on[0]}</b><span>İsabetli şut</span><b>${final ? st.on?.[1] ?? ls.on[1] : ls.on[1]}</b></div>
      ${final ? `<details class="lineups"><summary>Kadrolar</summary><div class="lcols"><div>${(st.lh || []).map((id) => `<div>${nm(id)}</div>`).join('')}<small>${esc(st.fh || '')}</small></div><div>${(st.la || []).map((id) => `<div>${nm(id)}</div>`).join('')}<small>${esc(st.fa || '')}</small></div></div></details>` : ''}`;
  }
  function flash(text, team) {
    const el = document.getElementById('mFlash');
    el.textContent = text; el.style.background = team?.color1 || '#0a0'; el.style.color = team?.color2 || '#fff';
    el.classList.add('show'); flashT = 1.6;
  }

  function step(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (live) tm = liveT();
    else if (playing) tm = Math.min(95, tm + dt * MIN_PER_SEC * speed);
    if (flashT > 0) { flashT -= dt; if (flashT <= 0) document.getElementById('mFlash').classList.remove('show'); }
    while (shown < timeline.length && timeline[shown].t <= tm) emit(timeline[shown++]);
    document.getElementById('mMin').textContent = tm >= 94.9 ? 'MS' : tm >= 45 && tm < 46 ? 'İY' : `${Math.min(90, Math.floor(tm))}'${tm > 90 ? '+' : ''}`;
    if (tm >= 95 && (playing || live)) { playing = false; endLive(); finish(); }
    draw(dt);
    raf = requestAnimationFrame(step);
  }
  function endLive() {
    if (!live) return;
    live = false;
    document.getElementById('mLive')?.remove();
    document.querySelector('.mctrl')?.classList.remove('is-live');
  }
  function finish() {
    while (shown < timeline.length) emit(timeline[shown++]);
    document.getElementById('sH').textContent = fx.hg; document.getElementById('sA').textContent = fx.ag;
    document.getElementById('mMin').textContent = fx.pens ? `MS · pen. ${fx.pens}` : 'MS';
    document.getElementById('mPlay').textContent = '↺';
    statsHtml(true);
  }

  function draw(dt) {
    const pad = 10, w = W - pad * 2, h = Hh - pad * 2;
    const X = (x) => pad + x * w, Y = (y) => pad + y * h;
    // çim
    ctx.fillStyle = '#2f7d32'; ctx.fillRect(0, 0, W, Hh);
    for (let i = 0; i < 10; i++) { if (i % 2) { ctx.fillStyle = '#2b742e'; ctx.fillRect(0, Y(i / 10), W, h / 10); } }
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(X(0), Y(0), w, h);
    ctx.beginPath(); ctx.moveTo(X(0), Y(0.5)); ctx.lineTo(X(1), Y(0.5)); ctx.stroke();
    ctx.beginPath(); ctx.arc(X(0.5), Y(0.5), w * 0.13, 0, Math.PI * 2); ctx.stroke();
    for (const top of [true, false]) {
      const y0 = top ? 0 : 1, d = top ? 1 : -1;
      ctx.strokeRect(X(0.2), Y(top ? 0 : 1 - 0.16), w * 0.6, h * 0.16);
      ctx.strokeRect(X(0.36), Y(top ? 0 : 1 - 0.06), w * 0.28, h * 0.06);
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.fillRect(X(0.5 - GOAL_W / 2), Y(y0) - (top ? 5 : 0), w * GOAL_W, 5);
      void d;
    }
    const b = ballAt(tm);
    // oyuncular: formasyon yeri + topa doğru kayma + topu alan oyuncu topa koşar
    for (const s of ['h', 'a']) {
      const team = s === 'h' ? H : A;
      const attacking = b.seg.side === s;
      const dir = s === 'h' ? -1 : 1;
      ply[s].forEach((p, i) => {
        const bs = base[s][i];
        let tx = bs.x + (b.x - 0.5) * (i === 0 ? 0.25 : 0.35);
        let ty = bs.y + (b.y - 0.5) * (i === 0 ? 0.05 : 0.3) + (attacking && i ? dir * 0.07 : 0);
        if (b.seg.side === s && b.seg.who === i && b.seg.kind !== 'reset') { tx = b.seg.x1; ty = b.seg.y1 + dir * -0.015; }
        if (i === 0) { ty = clamp(ty, s === 'h' ? 0.9 : 0.02, s === 'h' ? 0.98 : 0.1); tx = clamp(tx, 0.4, 0.6); }
        const sp = Math.min(1, dt * speed * 2.2);
        p.x = lerp(p.x, clamp(tx, 0.03, 0.97), sp); p.y = lerp(p.y, clamp(ty, 0.01, 0.99), sp);
        const r = Math.max(6, w * 0.022);
        ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), r, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? (s === 'h' ? '#ffd600' : '#00e5ff') : team?.color1 || '#c00';
        ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = team?.color2 || '#fff'; ctx.stroke();
      });
    }
    // top + gölge
    const lift = b.seg.kind === 'shot' || b.seg.kind === 'pass' ? Math.sin(Math.PI * b.k) * (b.seg.kind === 'shot' ? 6 : 3) : 0;
    ctx.beginPath(); ctx.ellipse(X(b.x), Y(b.y) + 2, 4, 2, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
    ctx.beginPath(); ctx.arc(X(b.x), Y(b.y) - lift, 4.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke();
  }

  document.getElementById('mPlay').onclick = (e) => {
    if (tm >= 95) { tm = 0; shown = 0; sh = sa = 0; ls.shots = [0, 0]; ls.on = [0, 0]; feed.innerHTML = ''; document.getElementById('sH').textContent = 0; document.getElementById('sA').textContent = 0; statsHtml(); playing = true; e.target.textContent = '⏸'; return; }
    playing = !playing; e.target.textContent = playing ? '⏸' : '▶';
  };
  document.querySelectorAll('#mSpeed button').forEach((b) => (b.onclick = () => { speed = Number(b.dataset.s); document.querySelectorAll('#mSpeed button').forEach((x) => x.classList.toggle('on', x === b)); }));
  document.getElementById('mEnd').onclick = () => { endLive(); tm = 95; playing = false; finish(); };
  document.getElementById('mClose').onclick = close;
  statsHtml();
  if (live) { // yayına ortadan katıldıysa önceki olayları sessizce işle
    tm = liveT();
    while (shown < timeline.length && timeline[shown].t <= tm) emit(timeline[shown++], true);
  }
  raf = requestAnimationFrame(step);
  void LIVE_RATE;

  function close() {
    closed = true;
    cancelAnimationFrame(raf);
    clearTimeout(waitTimer);
    if (onResize) window.removeEventListener('resize', onResize);
    root.classList.remove('show'); root.innerHTML = '';
    onClose?.();
  }
}
