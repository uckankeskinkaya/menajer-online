// Maç görüntü motoru v2. Football Manager'ın maç motorundan esinlenildi: sahada 22 bağımsız oyuncu (ajan),
// top fiziği (ayakta / havada / sahipsiz / duran top), topa ve talimatlara göre kayan takım şekli, karar veren top sahibi
// (pas hattı, boşluk, ilerleme, ofsayt), pres, top kapma, faul, taç, aut, korner. Sonucu sunucu belirler:
// "yönetmen" sunucudaki şut olaylarını (gol/kurtarış/kaçan) oyunun akışı içinde kurdurur, serbest oyunda şut çıkmaz.
// Koordinat: x 0..PW (m), y 0..PL (m). Ev sahibi y=PL kalesini korur, y=0'a hücum eder. Takım içi ilerleme "g":
// kendi kale çizgisi 0, rakip kale çizgisi 105.
import { slotPositions } from './ui.js';

export const SPM = 3.3; // 1x hızda 1 maç dakikası kaç saniye
export const PL = 105, PW = 68;
const DT = 0.05;
export const FRAME = 52;
// kale, oyuncu dairelerine oranla küçük kalmasın diye gerçeğinden büyük çizilir (12.8 m × 3.6 m)
export const GOAL = 12.8, GOALH = 3.6;
const CX = PW / 2, GOALW = GOAL / 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hyp = Math.hypot;
const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== undefined ? Number(v) : d);

export function simulateMatch(fx, events, R, ins = {}) {
  const tacOf = (a, b) => { const o = { ...(a || {}), ...(b || {}) }; return { press: clamp(num(o.press, 1), 0, 2), tempo: clamp(num(o.tempo, 1), 0, 2), width: clamp(num(o.width, 1), 0, 2), ment: clamp(num(o.ment, 0), -2, 2) }; };
  const IN = [tacOf(ins.h, fx.stats?.tH), tacOf(ins.a, fx.stats?.tA)];
  const forms = [fx.stats?.fh || '4-4-2', fx.stats?.fa || '4-4-2'];
  const target = clamp((fx.stats?.poss?.[0] ?? 50) / 100, 0.3, 0.7); // ev sahibinin topla oynama payı
  const SD = ['h', 'a'], TM = (s) => (s === 'a' ? 1 : 0), J = (s, k) => TM(s) * 11 + k;
  const Y = (tm, g) => (tm ? g : PL - g); // takım içi ilerleme <-> saha y (kendi tersi)
  const rnd = (a, b) => a + R() * (b - a);

  // ---- oyuncular ----
  const P = [];
  for (let tm = 0; tm < 2; tm++) {
    let sp = []; try { sp = slotPositions(forms[tm]); } catch { sp = slotPositions('4-4-2'); }
    if (sp.length !== 11) sp = slotPositions('4-4-2');
    sp.forEach((q, k) => {
      const r = clamp((0.78 - q.y) / 0.58, 0, 1);
      P.push({ j: tm * 11 + k, tm, k, fx: tm ? 1 - q.x : q.x, r, line: k === 0 ? 0 : r < 0.2 ? 1 : r > 0.8 ? 3 : 2,
        x: CX, y: PL / 2, vx: 0, vy: 0, tx: CX, ty: PL / 2, sp: 5, pace: 0.94 + R() * 0.12, out: false, cd: 0, down: 0, dec: 0, free: 0, from: null, rcv: null, drib: 0, ph: R() * 6.28 });
    });
  }
  const team = [P.slice(0, 11), P.slice(11)];
  const GK = [P[0], P[11]];
  const dist = (a, b) => hyp(a.x - b.x, a.y - b.y);
  const G = (p) => Y(p.tm, p.y);
  function nearest(tm, x, y, skip, noGk) { let b = null, bd = 1e9; for (const p of team[tm]) { if (p.out || p === skip || (noGk && p.k === 0) || p.down > t) continue; const d = hyp(p.x - x, p.y - y); if (d < bd) { bd = d; b = p; } } return b; }
  function nearD(tm, x, y) { let bd = 1e9; for (const p of team[tm]) { if (p.out) continue; const d = hyp(p.x - x, p.y - y); if (d < bd) bd = d; } return bd; }
  // rakiplerin pas hattına en yakın uzaklığı
  function lane(tm, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1; let bd = 9;
    for (const o of team[1 - tm]) { if (o.out) continue; const u = clamp(((o.x - x0) * dx + (o.y - y0) * dy) / L2, 0.12, 1); const d = hyp(o.x - (x0 + dx * u), o.y - (y0 + dy * u)); if (d < bd) bd = d; }
    return bd;
  }

  // ---- durum ----
  let t = 0;
  const ball = { x: CX, y: PL / 2, z: 0, vx: 0, vy: 0, st: 'dead', own: null, f: null };
  let pt = 0;          // topa sahip (ya da en son sahip olan) takım
  let touch = 0;       // topa son dokunan takım
  let D = null;        // duran top
  let plan = null;     // yönetmenin o an kurdurduğu şut
  let force = -1;      // bu takım topu kazanmalı (plan ya da kart için)
  let prot = -1, protU = 0; // sahipsiz topu sadece bu takım alabilir
  let counterU = 0;    // kontra koşusu bitişi
  let celeb = null;    // gol sevinci
  let fallen = -1, fallenU = 0;
  let ripple = 0, rippleSide = 1;
  const dive = [{ v: 0, dir: 0, t0: 0, t1: 0, until: -1, amp: 0 }, { v: 0, dir: 0, t0: 0, t1: 0, until: -1, amp: 0 }];
  const held = [0, 0];
  const OFF = [60, 60]; // hücum eden takım için ofsayt çizgisi (g)
  const corners = [], offsides = [], efouls = [], passes = [], tackles = [];

  // ---- olay hazırlığı (sunucudan gelen şutlar ve kartlar) ----
  const shots = events.filter((e) => e.ev === 'goal' || e.ev === 'save' || e.ev === 'miss').sort((a, b) => a.m - b.m);
  const LEAD = { thru: 8.5, long: 7.5, cross: 10, corner: 13, fk: 11.5, pen: 16.5, rebound: 2.2, snap: 5.5 }; // şuttan kaç sn önce atak kurulmaya başlar
  const penF = new Set(shots.filter((e) => (e.pen || e.fk) && e.f != null).map((e) => `${e.m}:${e.f}`));
  const fouls = events.filter((e) => (e.ev === 'yellow' || e.ev === 'red') && !penF.has(`${e.m}:${e.p}`)).sort((a, b) => a.m - b.m);
  {
    let last = -99, prev = null;
    for (const e of shots.concat(fouls).sort((a, b) => a.m - b.m)) {
      if (e.ev === 'yellow' || e.ev === 'red') { // kart: iki atak arasında kendine ayrılmış birkaç saniye
        e.T = Math.max((e.m - 0.3 + R() * 0.5) * SPM, last + 6.5, 8); e.tf = e.T / SPM; last = e.T + 1.5; continue;
      }
      const tm = TM(e.s);
      const rebound = !!prev && prev.ev === 'save' && !prev.pen && prev.s === e.s && e.m - prev.m <= 1 && !e.pen && !e.fk && !prev.parryTo;
      e.shooter = J(e.s, e.slot > 0 && e.slot < 11 ? e.slot : 8 + Math.floor(R() * 3));
      const u = R(), cw = (IN[tm].width - 1) * 0.1;
      e.style = rebound ? 'rebound' : e.pen ? 'pen' : e.fk ? 'fk'
        : e.k === 'cross' ? (u < 0.3 ? 'corner' : 'cross') : e.k === 'thru' || e.k === 'combo' ? 'thru' : e.k === 'long' ? 'long'
        : e.ev === 'miss' && u < 0.36 ? 'snap' : u < 0.45 ? 'corner' : u < 0.66 + cw ? 'cross' : u < 0.8 + cw * 0.5 ? 'long' : 'thru';
      e.L = LEAD[e.style];
      const gap = rebound ? 2.2 : e.L + (prev ? (prev.ev === 'goal' ? 9.5 : 2) : 1.5);
      e.T = Math.max((e.m - 0.5 + R() * 0.4) * SPM, last + gap, e.L + 2.5);
      if (rebound) prev.parryTo = e;
      last = e.T; prev = e;
    }
  }
  const lastEv = Math.max(shots.length ? shots[shots.length - 1].T : 0, fouls.length ? fouls[fouls.length - 1].T : 0);
  const T_END = Math.max(95 * SPM, lastEv + 25);
  const N = Math.ceil(T_END / DT) + 2;
  const frames = new Float32Array(N * FRAME);
  const HT = 45.4 * SPM; let htDone = false;

  // ---- top ----
  function give(p) {
    if (ball.st !== 'held' || ball.own !== p) { if (p.tm !== pt && !plan) counterU = t + 4.5; }
    ball.st = 'held'; ball.own = p; ball.f = null; ball.z = 0; pt = p.tm; touch = p.tm;
    p.dec = t + 0.35 + R() * 0.3; p.drib = 0; p.rcv = null; p.got = t;
  }
  // topu (x1,y1)'e gönder. o: spd hız, pk tepe yüksekliği, rcv alıcı, kind, then(varışta), z0/z1, lose (rakibe gidecek), dur
  function kick(x1, y1, o = {}) {
    const d = hyp(x1 - ball.x, y1 - ball.y), dur = o.dur || Math.max(0.2, d / (o.spd || 17));
    const by = ball.own;
    ball.f = { x0: ball.x, y0: ball.y, x1, y1, t0: t, t1: t + dur, pk: o.pk || 0, z0: o.z0 || 0, z1: o.z1 || 0, rcv: o.rcv || null, kind: o.kind || 'pass', then: o.then || null,
      tm: by ? by.tm : (o.tm ?? touch), by, lose: !!o.lose, off: !!o.off, tried: new Set(), log: o.log || null };
    ball.st = 'fly'; ball.own = null; touch = ball.f.tm;
    if (o.rcv) o.rcv.rcv = { x: x1, y: y1, until: t + dur + 0.6 };
    return dur;
  }
  function loose(vx, vy) { ball.st = 'loose'; ball.own = null; ball.f = null; ball.vx = vx; ball.vy = vy; ball.z = 0; }
  // duran top: tip ko|throw|gk|corner|fk|pen
  function dead(type, tm, x, y, wait, o = {}) {
    ball.st = 'dead'; ball.own = null; ball.f = null; ball.vx = ball.vy = 0;
    if (!o.keep) { ball.x = x; ball.y = y; ball.z = 0; }
    let taker = o.taker || null;
    if (!taker || taker.out) taker = type === 'gk' ? (GK[tm].out ? nearest(tm, x, y) : GK[tm]) : nearest(tm, x, y, null, true);
    D = { type, tm, x, y, at: t + wait, t0: t, taker, plan: !!o.plan, show: o.keep ? t + (o.showIn || 0) : 0 };
    pt = tm; touch = tm;
    for (const p of P) { p.rcv = null; p.drib = 0; }
  }
  function possBias(tm) { // topu fazla tutan takımdan top daha kolay alınır: sunucunun topla oynama oranına yaklaşır
    const s = held[0] + held[1]; if (s < 5) return 1;
    const share = held[tm] / s, want = tm ? 1 - target : target;
    return clamp(1 + (share - want) * 14, 0.2, 3.2);
  }

  // ---- takım şekli ----
  function offLines() {
    for (let tm = 0; tm < 2; tm++) {
      let a = -1, b = -1; // rakibin en gerideki iki oyuncusu (bu takımın ilerleme ekseninde en ilerideki iki rakip)
      for (const o of team[1 - tm]) { if (o.out) continue; const g = Y(tm, o.y); if (g > a) { b = a; a = g; } else if (g > b) b = g; }
      OFF[tm] = Math.max(52.5, b, Y(tm, ball.y));
    }
  }
  const go = (p, x, g, sp) => { p.tx = clamp(x, 0.8, PW - 0.8); p.ty = Y(p.tm, clamp(g, 0.5, 104.5)); p.sp = sp; };
  const goW = (p, x, y, sp) => { p.tx = clamp(x, 0.5, PW - 0.5); p.ty = clamp(y, 0.5, PL - 0.5); p.sp = sp; };
  function koShape(tm) {
    for (const p of team[tm]) {
      if (p.out) continue;
      if (p.k === 0) { go(p, CX, 5, 4.5); continue; }
      let g = Math.min(9 + p.r * 40, 51.2); const x = CX + (p.fx - 0.5) * 60;
      if (D && D.type === 'ko' && D.tm !== tm && hyp(x - CX, g - 52.5) < 10.5) g = 41.5;
      go(p, x, g, 5.6);
    }
    if (D && D.type === 'ko' && D.tm === tm) {
      const mate = team[tm].filter((p) => !p.out && p !== D.taker && p.k).sort((a, b) => b.r - a.r)[0];
      if (mate) go(mate, CX + (tm ? -4 : 4), 51.6, 5.6);
    }
  }
  function shape(tm) {
    if ((D && D.type === 'ko') || (celeb && celeb.tm !== tm)) return koShape(tm);
    const I = IN[tm], att = pt === tm, bg = Y(tm, ball.y), bx = ball.x, cnt = att && t < counterU, off = OFF[tm];
    let back, front;
    if (att) {
      back = clamp(bg - 21 + I.ment * 3, 16, 60);
      front = Math.min(Math.max(bg + 17, 60 + I.ment * 3), 90, off - 0.9);
      if (front < back + 12) back = front - 12;
    } else {
      back = clamp(bg - 15 + I.press * 3, 7, 46 + I.press * 4);
      if (bg < back + 2) back = Math.max(5, bg - 4);
      front = back + 27 - I.press * 2;
    }
    const wid = att ? (44 + I.width * 9) * 1.45 : 60 - I.press * 2;
    for (const p of team[tm]) {
      if (p.out) continue;
      if (p.k === 0) { // kaleci: top uzaksa öne çıkar, yaklaştıkça çizgisine döner
        const g = clamp(2.5 + (bg - 22) * 0.13, 2.2, att ? 18 : 13), near = bg < 30;
        go(p, CX + clamp((bx - CX) * (near ? 0.22 : 0.08), -4.4, 4.4), g, 4.2); continue;
      }
      let g, x;
      if (att) {
        g = back + p.r * (front - back);
        if (p.line === 1 && Math.abs(p.fx - 0.5) > 0.27) g += 6 + I.width * 2.5; // bekler bindirir
        if (p.line === 2) g += Math.sin(t * 0.5 + p.ph) * 2.5;
        if (p.line === 3) g += Math.sin(t * 0.7 + p.ph) * 2.2;
        g = Math.min(g, Math.max(off - 0.9, bg));
        if (p.line === 3 && !plan && bg > 40 && Math.sin(t * 0.21 + p.ph * 5) > 0.72) g = off + 1.6; // erken çıkış: ofsayta düşer
        x = CX + (p.fx - 0.5) * wid + (bx - CX) * 0.14 + Math.cos(t * 0.4 + p.ph) * 1.5;
      } else {
        g = p.line === 1 ? back + Math.abs(p.fx - 0.5) * 1.5 : back + p.r * (front - back);
        x = CX + (p.fx - 0.5) * wid + (bx - CX) * 0.5;
        x = clamp(x, 5, PW - 5);
      }
      const far = hyp(x - p.x, Y(tm, g) - p.y) > 9;
      go(p, x, g, (cnt && p.line >= 2 ? 7.4 : far ? 6.3 : 4.5) * p.pace);
    }
    // pres: topa en yakın oyuncu(lar) baskıya gider
    if (!att && !D && !celeb) {
      const tx = ball.st === 'fly' && ball.f.kind === 'pass' ? ball.f.x1 : ball.x, ty = ball.st === 'fly' && ball.f.kind === 'pass' ? ball.f.y1 : ball.y;
      const hi = I.press === 0 && bg > 66 && force !== tm ? 0 : (I.press === 2 || bg < 32 || force === tm ? 2 : 1);
      if (hi) {
        const c = team[tm].filter((p) => !p.out && p.k && p.down <= t).sort((a, b) => hyp(a.x - tx, a.y - ty) - hyp(b.x - tx, b.y - ty));
        const own = Y(tm, 0) - ty; const sg = Math.sign(own) || 1; // kendi kalesi yönü
        if (c[0]) goW(c[0], tx, ty + sg * 0.5, 7.5 * c[0].pace);
        if (hi > 1 && c[1] && hyp(c[1].x - tx, c[1].y - ty) < 16) goW(c[1], tx + (c[1].x < tx ? -2.5 : 2.5), ty + sg * 3.5, 6.8 * c[1].pace);
      }
      if (ball.st === 'held' && ball.own.k === 0) for (const p of team[tm]) if (!p.out && p.k && Y(1 - tm, p.y) < 20) go(p, p.x, 82, 5); // kaleci tuttu: ceza sahasını boşalt
    }
    // duran topta rakip mesafesi
    if (D && D.tm !== tm) {
      const rm = D.type === 'throw' ? 3.5 : D.type === 'gk' ? 0 : 9.6;
      for (const p of team[tm]) { if (p.out || !rm) continue; const dx = p.tx - D.x, dy = p.ty - D.y, d = hyp(dx, dy); if (d < rm) { const k = rm / (d || 1); const own = Math.sign(Y(tm, 0) - D.y) || 1; goW(p, D.x + (d ? dx * k : 0), D.y + (d ? dy * k : own * rm), 6); } }
      if (D.type === 'gk') for (const p of team[tm]) if (!p.out && p.k && Y(D.tm, p.ty) < 20) p.ty = Y(D.tm, 20);
    }
  }
  function carry(c) { // top sahibi: boşluğa doğru sürer
    if (c.k === 0) { go(c, c.x, Math.max(G(c), 6), 2.5); return; }
    const g = G(c), inPlan = plan && plan.tm === c.tm;
    let x = c.x + (CX - c.x) * 0.06, o = null, od = 7;
    for (const q of team[1 - c.tm]) { if (q.out) continue; const d = dist(q, c); if (d < od && Y(c.tm, q.y) > g - 1) { od = d; o = q; } }
    if (o) x += (c.x >= o.x ? 1 : -1) * 6;
    if (c.wide) x = c.wide;
    const run = c.drib > t || inPlan;
    go(c, x, Math.min(g + (run ? 9 : 3), c.gmax ?? (inPlan ? 97 : 82)), (run ? 5.9 : 3.2) * c.pace);
  }
  function chase() { // sahipsiz top / pas alıcısı / duran top kullanıcısı
    for (const p of P) if (!p.out && p.rcv && t < p.rcv.until && ball.st === 'fly') goW(p, p.rcv.x, p.rcv.y, 8 * p.pace);
    if (ball.st === 'loose') for (let tm = 0; tm < 2; tm++) { if (prot >= 0 && t < protU && prot !== tm) continue; const p = nearest(tm, ball.x, ball.y); if (p) goW(p, ball.x + ball.vx * 0.3, ball.y + ball.vy * 0.3, 7.8 * p.pace); }
    if (ball.st === 'held') carry(ball.own);
    if (D && D.taker && !D.plan && t > D.show) { const k = D.type === 'ko' ? 0 : 0.6, own = Math.sign(Y(D.tm, 0) - D.y) || 1; goW(D.taker, D.x, D.y + (D.type === 'throw' || D.type === 'corner' ? 0 : own * k), 6.4); }
  }
  function celebrate() {
    const s = celeb.sh; const cx = s.x < CX ? 5 : PW - 5;
    go(s, cx, 98, 6.2);
    let i = 0; for (const p of team[celeb.tm]) { if (p.out || p === s || p.k === 0) continue; i++; if (i > 6) { continue; } goW(p, s.x + Math.cos(i * 1.05) * 2.2, s.y + Math.sin(i * 1.05) * 2.2, 6.6); }
  }
  function move(p) {
    if (p.out) { p.x = -4; p.y = PL / 2 + (p.tm ? -6 : 6) - p.k * 0.01; p.vx = p.vy = 0; return; }
    if (p.down > t) { p.vx *= 0.7; p.vy *= 0.7; return; }
    const dx = p.tx - p.x, dy = p.ty - p.y, d = hyp(dx, dy);
    const sp = Math.min(p.sp, d * 2.6);
    let ax = (d > 0.01 ? (dx / d) * sp : 0) - p.vx, ay = (d > 0.01 ? (dy / d) * sp : 0) - p.vy;
    const a = hyp(ax, ay), am = 11 * DT;
    if (a > am) { ax *= am / a; ay *= am / a; }
    p.vx += ax; p.vy += ay; p.x += p.vx * DT; p.y += p.vy * DT;
  }
  function separate() { // aynı noktaya yığılmayı önle
    for (let i = 0; i < 22; i++) { const a = P[i]; if (a.out) continue; for (let k = i + 1; k < 22; k++) { const b = P[k]; if (b.out) continue; const dx = b.x - a.x, dy = b.y - a.y, d = hyp(dx, dy); if (d < 0.9 && d > 0.001) { const u = (0.9 - d) * 0.5 / d; a.x -= dx * u; a.y -= dy * u; b.x += dx * u; b.y += dy * u; } } }
  }

  // ---- pas, karar, mücadele ----
  const guarded = (tm) => !!plan && plan.tm === tm && plan.st !== 'gain'; // yönetmenin kurduğu atak: top kaptırılmaz
  function pass(c, m, o = {}) {
    const d0 = dist(c, m), loft = o.loft ?? d0 > 27, spd = o.spd || (loft ? 17.5 : clamp(11 + d0 * 0.36, 13, 20));
    const fl = d0 / spd;
    let x = m.x + m.vx * fl * 0.85, y = m.y + m.vy * fl * 0.85;
    const err = o.sure ? 0 : (R() < 0.05 ? 3.5 : 0.5) * (1 + d0 / 40);
    x = clamp(x + (R() - 0.5) * 2 * err, 1, PW - 1); y = clamp(y + (R() - 0.5) * 2 * err, 1, PL - 1);
    const lg = { t: t / SPM, s: SD[c.tm], ok: false, j: c.j }; passes.push(lg);
    m.from = c;
    return kick(x, y, { spd, pk: loft ? 1.2 + d0 * 0.09 : 0, rcv: m, kind: 'pass', lose: o.lose, off: o.off, log: lg });
  }
  function clearBy(o) { // uzaklaştırma
    ball.own = null; touch = o.tm;
    kick(clamp(o.x + rnd(-14, 14), 2, PW - 2), Y(o.tm, clamp(G(o) + rnd(18, 32), 6, 100)), { spd: 19, pk: 4.5, kind: 'clear', tm: o.tm });
  }
  function offside(m) {
    offsides.push({ t: t / SPM, s: SD[m.tm], p: m.j });
    dead('fk', 1 - m.tm, m.x, m.y, 2.8);
  }
  function land(f) {
    const dx = f.x1 - f.x0, dy = f.y1 - f.y0, d = hyp(dx, dy) || 1;
    if (outCheck()) return;
    if (f.kind === 'pass') {
      const m = f.rcv;
      if (f.lose) { const o = nearest(1 - f.tm, ball.x, ball.y); if (o && hyp(o.x - ball.x, o.y - ball.y) < 5) give(o); else { loose(dx / d * 2, dy / d * 2); prot = 1 - f.tm; protU = t + 4; } return; }
      if (f.pk > 2 && !guarded(f.tm)) { // hava topu mücadelesi
        const o = nearest(1 - f.tm, ball.x, ball.y);
        if (o && hyp(o.x - ball.x, o.y - ball.y) < 3 && R() < 0.45 * possBias(f.tm)) { if (R() < 0.5) give(o); else clearBy(o); return; }
      }
      if (m && !m.out && hyp(m.x - ball.x, m.y - ball.y) < (guarded(f.tm) ? 5.5 : 2.8)) { if (f.off) return offside(m); f.log.ok = true; give(m); return; }
    }
    loose(dx / d * 3, dy / d * 3);
  }
  function outCheck() {
    if (ball.x < 0 || ball.x > PW) { dead('throw', 1 - touch, clamp(ball.x, 0.3, PW - 0.3), clamp(ball.y, 2, PL - 2), 2.3); return true; }
    if (ball.y < 0 || ball.y > PL) {
      const def = ball.y < 0 ? 1 : 0;
      if (touch === def) { corners.push({ t: t / SPM, s: SD[1 - def] }); dead('corner', 1 - def, ball.x < CX ? 0.4 : PW - 0.4, ball.y < 0 ? 0.4 : PL - 0.4, 4.2); }
      else dead('gk', def, CX + (ball.x < CX ? -5 : 5), Y(def, 5.5), 3.6);
      return true;
    }
    return false;
  }
  function crossFree(c) { // serbest oyunda orta: savunma ya da kaleci kazanır
    const tm = c.tm, x = CX + rnd(-7, 7), y = Y(tm, rnd(93, 98)), gk = GK[1 - tm];
    passes.push({ t: t / SPM, s: SD[tm], ok: false, j: c.j });
    const claim = !gk.out && R() < 0.35; if (claim) gk.rcv = { x, y, until: t + 3 };
    kick(x, y, { spd: 16, pk: 4.2, kind: 'cross', then: () => {
      if (claim && hyp(gk.x - ball.x, gk.y - ball.y) < 5) { gk.x = ball.x; gk.y = ball.y; give(gk); gk.dec = t + 2.2; gk.free = t + 4; return; }
      const o = nearest(1 - tm, ball.x, ball.y, null, true); if (o) clearBy(o); else loose(0, 0);
    } });
  }
  function decide(c) {
    const tm = c.tm, I = IN[tm], g = G(c), off = OFF[tm], inPlan = guarded(tm);
    if (force === 1 - tm && t > c.free && !inPlan) { // top kaybı: hatalı pas
      const o = nearest(1 - tm, c.x, Y(tm, g + 9), null, true);
      if (o) { const lg = { t: t / SPM, s: SD[tm], ok: false, j: c.j }; passes.push(lg); kick(o.x, o.y, { spd: 15, rcv: o, kind: 'pass', lose: true, log: lg }); return; }
    }
    if (inPlan && planDecide(c)) return;
    if (!inPlan && !plan && c.k && t > c.free && R() < (possBias(tm) - 1.25) * 0.22) { // topu fazla tutan takım: hatalı pas, top rakibe
      const o = nearest(1 - tm, c.x, Y(tm, g + 12), null, true);
      if (o) { const lg = { t: t / SPM, s: SD[tm], ok: false, j: c.j }; passes.push(lg); kick(o.x, o.y, { spd: 15, rcv: o, kind: 'pass', lose: true, log: lg }); return; }
    }
    const pr = nearD(1 - tm, c.x, c.y);
    if (c.k === 0) { // kaleci: yakın boş savunmacı ya da uzun top
      let m = null, bs = 5.5;
      for (const q of team[tm]) { if (q.out || q.line !== 1) continue; const o = nearD(1 - tm, q.x, q.y); if (o > bs && dist(q, c) < 32) { bs = o + R() * 3; m = q; } }
      if (m && R() < 0.75 - (I.tempo - 1) * 0.15) { pass(c, m, { sure: true, loft: false }); return; }
      const fw = team[tm].filter((q) => !q.out && q.line >= 2 && G(q) <= off); m = fw[Math.floor(R() * fw.length)] || nearest(tm, c.x, c.y, c);
      if (m) pass(c, m, { loft: true }); return;
    }
    let best = null, bs = -1e9, bo = false;
    for (const m of team[tm]) {
      if (m === c || m.out || m.down > t) continue;
      const mg = G(m), d = dist(c, m);
      if (d < 4.5 || d > 46) continue;
      if (m.k === 0 && (g > 32 || pr > 5 || inPlan)) continue;
      const offs = mg > off + 0.2 && mg > g + 0.5;
      if (offs && (inPlan || R() > 0.6)) continue;
      const prog = mg - g, open = Math.min(nearD(1 - tm, m.x, m.y), 9), ln = lane(tm, c.x, c.y, m.x, m.y);
      let s = prog * (0.4 + I.ment * 0.04 + (I.tempo - 1) * 0.07 + (t < counterU ? 0.25 : 0) + (inPlan ? 0.2 : 0)) + open * 0.9 + Math.min(ln, 4) * 1.5 - Math.abs(d - 15) * 0.12 + R() * 4.5;
      s += (I.width - 1) * Math.abs(m.fx - 0.5) * 7;
      if (m === c.from) s -= 7;                       // aldığı kişiye geri verme
      if (prog < -12 && g > 68) s -= 9;               // hücum bölgesinden uzun geri pas yok
      if (ln < 1.3 && d < 27 && !inPlan) s -= 9;      // hat kapalı
      if (d > 27) s -= 3.5 - (I.tempo - 1);
      if (mg > 85 && Math.abs(m.x - CX) < 18) s -= inPlan ? 12 : 5;
      if (inPlan && mg > 80) s -= 6;
      if (m.k === 0) s -= 6;
      if (s > bs) { bs = s; best = m; bo = offs; }
    }
    let sd = -1e9; // topu sürme
    if (g < (inPlan ? 74 : 80)) {
      let sp = 9; for (const q of team[1 - tm]) { if (q.out) continue; const d = dist(q, c); if (d < sp && Y(tm, q.y) > g - 1) sp = d; }
      sd = 1.2 + sp * 0.75 + R() * 3 - (pr < 2 ? 3 : 0) + (t < counterU ? 2 : 0) - (c.line === 1 && g < 35 ? 2 : 0);
    }
    if (!inPlan && g > 76 && Math.abs(c.x - CX) > 17 && R() < 0.45) return crossFree(c);
    if (!inPlan && pr < 2.2 && g < 30 && bs < 1) { passes.push({ t: t / SPM, s: SD[tm], ok: false, j: c.j }); return clearBy(c); }
    if (!best || sd > bs) { c.drib = t + rnd(0.7, 1.3); c.dec = c.drib; return; }
    pass(c, best, { off: bo, sure: inPlan });
  }
  let card = null; // kart görecek oyuncu faul yapmaya gidiyor
  function foul(o, c, f) {
    fallen = c.j; fallenU = t + 2.3; c.down = t + 2.1; c.vx = c.vy = 0;
    if (f) { f.T = t; f.tf = t / SPM; f.done = true; f.vis = true; if (f.ev === 'red') ((card && card.to) || o).outAt = t + 2.8; card = null; }
    else efouls.push({ t: t / SPM, tf: t / SPM, s: SD[o.tm], e: true });
    dead('fk', c.tm, c.x, Y(c.tm, Math.min(G(c), 86)), 3.4);
  }
  function tackling() {
    const c = ball.own; if (!c || t < c.free || c.k === 0) return;
    const safe = guarded(c.tm), g = G(c);
    for (const o of team[1 - c.tm]) {
      if (o.out || o.cd > t || o.down > t || o.k === 0 || dist(o, c) > 1.5) continue;
      o.cd = t + 1.5;
      if (card && card.pl === o) { foul(o, c, card.f); return; }
      if (safe) continue;
      const p = force === o.tm ? 1 : 0.26 * possBias(c.tm) * (g > 80 ? 2.4 : 1) * (c.drib > t ? 1.25 : 1);
      if (R() >= p) continue;
      tackles.push({ t: t / SPM, s: SD[o.tm] });
      if (force !== o.tm && !plan && g < 86 && g > 14 && R() < 0.075) { foul(o, c); return; }
      if (force === o.tm || R() < 0.6) give(o); else { touch = o.tm; loose((R() - 0.5) * 8, (R() - 0.5) * 8); }
      return;
    }
  }
  function restart() {
    const k = D.taker;
    if (D.show) { if (t < D.show) return; ball.x = D.x; ball.y = D.y; ball.z = 0; }
    if (t < D.at) return;
    const late = t > D.at + (D.type === 'ko' ? 1.4 : 4);
    if (hyp(k.x - D.x, k.y - D.y) > 1.7 && !late) return;
    if (D.type === 'ko' && !late) for (const p of P) if (!p.out && p.k && Y(p.tm, p.y) > 53.5) return; // herkes kendi yarısında
    const ty = D.type; D = null; give(k); k.free = t + 1.8; k.from = null;
    if (ty === 'ko') { const m = team[k.tm].filter((p) => !p.out && p.line === 2).sort((a, b) => dist(a, k) - dist(b, k))[0] || nearest(k.tm, k.x, k.y, k, true); if (m) pass(k, m, { sure: true, loft: false }); }
    else if (ty === 'corner') crossFree(k);
    else k.dec = t + 0.15;
  }

  // ---- yönetmen: sunucudaki şut olayını oyunun içinde kurdurur ----
  let qi = 0;
  const NEED = { thru: 5, long: 4.5, snap: 3.5, cross: 8, corner: 10.5, fk: 10.5, pen: 16, rebound: 0 };
  function startPlan(e) {
    const tm = TM(e.s);
    let sh = P[e.shooter];
    if (sh.out || sh.k === 0) sh = team[tm].filter((p) => !p.out && p.k).sort((a, b) => b.r - a.r)[0] || sh;
    e.shooter = sh.j; e.from = t / SPM;
    const snap = e.style === 'snap', st = snap ? 'long' : e.style, sx = sh.fx > 0.52 ? 1 : sh.fx < 0.48 ? -1 : (R() < 0.5 ? -1 : 1);
    plan = { e, tm, sh, st: 'gain', t0: t, style: st, stage: 0, set: null, S: null, wg: null, w: null, fo: null, Z: null, hold: e.T - 3 };
    if (st === 'thru') plan.S = { x: CX + sx * rnd(0.5, 9), g: rnd(85, 92) };
    else if (st === 'long') plan.S = snap ? { x: CX + rnd(-14, 14), g: rnd(68, 76) } : { x: CX + rnd(-11, 11), g: rnd(75, 81) };
    else plan.S = { x: CX + rnd(-5, 5), g: rnd(95, 98.5) };
    if (st === 'cross' || st === 'corner') {
      const c = team[tm].filter((p) => !p.out && p.k && p !== sh).sort((a, b) => Math.abs(b.fx - 0.5) + b.r * 0.25 - Math.abs(a.fx - 0.5) - a.r * 0.25);
      plan.wg = c[R() < 0.6 ? 0 : 1] || c[0] || sh; plan.wx = plan.wg.fx > 0.5 ? PW - 4.5 : 4.5; e.winger = plan.wg.j;
      plan.hold = e.T - (st === 'cross' ? 7.2 : 11);
    }
    if (st === 'fk' || st === 'pen') {
      let w = e.wslot > 0 && e.wslot < 11 ? P[J(e.s, e.wslot)] : null;
      if (!w || w.out) w = team[tm].filter((p) => !p.out && p.k).sort((a, b) => b.r - a.r)[0];
      plan.w = w;
      const fo = e.fslot > 0 && e.fslot < 11 ? P[(1 - tm) * 11 + e.fslot] : null; plan.fo = fo && !fo.out ? fo : null;
      plan.Z = st === 'pen' ? { x: CX + rnd(-9, 9), g: rnd(91, 97) } : { x: CX + rnd(-13, 13), g: rnd(74, 82) };
      plan.hold = e.T - (st === 'pen' ? 15.5 : 10);
    }
  }
  function reachS(fl) { // şutörün yetişebileceği noktaya çek
    const sh = plan.sh, S = plan.S, tm = plan.tm; let Sy = Y(tm, S.g);
    const r = 7.2 * sh.pace * fl + 0.8, d = hyp(S.x - sh.x, Sy - sh.y);
    if (d > r) { const k = r / d; S.x = sh.x + (S.x - sh.x) * k; Sy = sh.y + (Sy - sh.y) * k; S.g = Y(tm, Sy); }
    return Sy;
  }
  function planDecide(c) { // son pasa az kala top sahibi bekler; şutör topu son 4 saniyede bırakmaz
    const st = plan.style, solo = c === plan.sh && t > plan.e.T - 4 && (st === 'thru' || st === 'long' || st === 'rebound');
    if (plan.st === 'final' || t > plan.hold || solo) { c.dec = t + 0.4; c.drib = t + 0.5; return true; }
    return false;
  }
  function cross(c) {
    const e = plan.e, sh = plan.sh, S = plan.S;
    const fl = Math.max(0.75, hyp(S.x - ball.x, Y(plan.tm, S.g) - ball.y) / 15.5), Sy = reachS(fl);
    e.crossT = t / SPM; passes.push({ t: t / SPM, s: SD[plan.tm], ok: true, j: c.j });
    ball.own = c; plan.st = 'final';
    kick(S.x, Sy, { dur: fl, pk: 3.4, z1: 2.1, kind: 'cross', rcv: sh, then: () => { if (hyp(sh.x - ball.x, sh.y - ball.y) < 3.6) shoot(true); else { ball.z = 0; loose(0, 0); } } });
  }
  function setFoul() {
    const e = plan.e, tm = plan.tm, w = plan.w, pen = plan.style === 'pen';
    if (e.c !== 'hand' && w && hyp(w.x - ball.x, w.y - ball.y) < 4.5) { fallen = w.j; fallenU = t + 2.4; w.down = t + 2.2; w.vx = w.vy = 0; }
    e.setT = t / SPM;
    let g = Y(tm, ball.y);
    if (pen) dead('pen', tm, CX, Y(tm, 94), Math.max(4, e.T - t), { taker: plan.sh, plan: true, keep: true, showIn: 2.6 });
    else { if (g > 86 && Math.abs(ball.x - CX) < 22) g = 85; dead('fk', tm, clamp(ball.x, 4, PW - 4), Y(tm, clamp(g, 66, 99)), Math.max(3, e.T - t), { taker: plan.sh, plan: true }); }
    e.T = Math.max(e.T, D.at); plan.set = plan.style; plan.stage = 1;
  }
  function setPiece() {
    const e = plan.e, sh = plan.sh;
    if (!D) { plan.set = null; return; }
    if (D.show && t >= D.show) { ball.x = D.x; ball.y = D.y; ball.z = 0; D.show = 0; }
    if (plan.set === 'corner') {
      const k = D.taker;
      if (t >= D.at && (hyp(k.x - D.x, k.y - D.y) < 2 || t > D.at + 1.5)) { D = null; plan.set = null; cross(k); }
      return;
    }
    if (t >= e.T && (hyp(sh.x - D.x, sh.y - D.y) < 2.4 || t > e.T + 1.5)) { ball.x = D.x; ball.y = D.y; D = null; plan.set = null; touch = plan.tm; shoot(false); }
  }
  function director() {
    if (!plan) { if (qi < shots.length && t >= shots[qi].T - shots[qi].L + (card ? 2.5 : 0) && !celeb) startPlan(shots[qi++]); else return; }
    const e = plan.e, tm = plan.tm, sh = plan.sh, T = e.T, st = plan.style;
    if (plan.st === 'shot') return;
    if (t > T + 7) { D = null; plan.set = null; ball.x = sh.x; ball.y = sh.y; give(sh); plan.st = 'final'; } // emniyet: şut mutlaka çıkar
    const mine = ball.st === 'held' && ball.own.tm === tm;
    if (plan.st === 'gain') {
      if (D) { if (!D.plan) D.at = Math.min(D.at, t + (D.tm === tm ? 1 : 0.6)); return; }
      if (mine || (ball.st === 'fly' && ball.f.tm === tm && ball.f.kind === 'pass' && !ball.f.lose && !ball.f.off)) { plan.st = 'build'; return; }
      if (possBias(tm) > 1.15 && t < T - NEED[e.style] && !(ball.st === 'held' && G(ball.own) > 70)) return; // topu fazla tutan takım: atak geç başlar, top rakipte kalır
      force = tm; prot = tm; protU = t + 1;
      if (ball.st === 'fly' && ball.f.tm !== tm && ball.f.kind === 'pass') ball.f.lose = true;
      if (t > plan.t0 + (e.style === 'snap' ? 1.2 : 3.5)) {
        const p = nearest(tm, ball.x, ball.y, null, true);
        if (p && ball.st === 'held' && t > ball.own.free) { const lg = { t: t / SPM, s: SD[1 - tm], ok: false, j: ball.own.j }; passes.push(lg); kick(p.x, p.y, { spd: 16, rcv: p, kind: 'pass', lose: true, log: lg }); }
        else if (p && t > plan.t0 + 7) { D = null; ball.x = p.x; ball.y = p.y; give(p); }
      }
      return;
    }
    prot = tm; protU = t + 1;
    if (plan.set) return setPiece();
    if (plan.st === 'final') {
      const has = ball.st === 'held' && ball.own === sh, near = ball.st === 'loose' && hyp(sh.x - ball.x, sh.y - ball.y) < 1.8;
      if ((has || near) && t >= T - 0.05) return shoot(false);
      if (t > T + 2.6 && !has) {
        if (mine) kick(sh.x, sh.y, { spd: 20, rcv: sh, kind: 'pass', log: {} });
        else if (ball.st === 'loose' || t > T + 5) { D = null; ball.x = sh.x; ball.y = sh.y; give(sh); }
      }
      return;
    }
    // kurulum
    if (ball.st === 'held' && !mine) { plan.st = 'gain'; plan.t0 = t - 2; return; }
    if (D) { if (D.tm !== tm) { D.tm = tm; D.taker = nearest(tm, D.x, D.y, null, true) || D.taker; pt = tm; } D.at = Math.min(D.at, t + 1); return; }
    if (!mine) return;
    const c = ball.own;
    if (st === 'fk' || st === 'pen') {
      const w = plan.w, Z = plan.Z, t1 = T - (st === 'pen' ? 14.5 : 9);
      if (t < t1) return;
      if (c === w) { c.dec = t + 9; if (st === 'pen' ? (G(c) > 90 || t > t1 + 2.5) : (G(c) > 73 || t > t1 + 1.2)) setFoul(); return; }
      const zy = Y(tm, Math.min(Z.g, Math.max(OFF[tm] + 4, G(w) + 3)));
      if (plan.fo) plan.fo.rcv = { x: Z.x, y: zy, until: t + 3 };
      passes.push({ t: t / SPM, s: SD[tm], ok: true, j: c.j });
      kick(Z.x, zy, { spd: 17, pk: hyp(Z.x - c.x, zy - c.y) > 28 ? 3 : 0, rcv: w, kind: 'pass', log: {}, then: setFoul });
      return;
    }
    if (st === 'corner') {
      if (t < T - 9.5) return;
      const x = c.x < CX ? CX - rnd(8, 14) : CX + rnd(8, 14), left = x < CX, wg = plan.wg;
      passes.push({ t: t / SPM, s: SD[tm], ok: false, j: c.j });
      kick(x, Y(tm, rnd(93, 97)), { spd: 19, pk: 1.6, kind: 'cross', then: () => {
        touch = 1 - tm; // savunma kornere çeldi
        kick(x + (left ? -4 : 4), Y(tm, 106.2), { dur: 0.7, pk: 1.5, kind: 'out', tm: 1 - tm, then: () => {
          corners.push({ t: t / SPM, s: SD[tm] }); e.cornered = true;
          const cx = left ? 0.4 : PW - 0.4, cy = Y(tm, 104.6), fl = Math.max(0.75, hyp(plan.S.x - cx, Y(tm, plan.S.g) - cy) / 15.5);
          const tk = nearest(tm, cx, cy, sh, true); if (tk) e.winger = tk.j;
          dead('corner', tm, cx, cy, Math.max(4.5, T - fl - 0.1 - t), { taker: tk, plan: true });
          if (D.at + fl + 0.1 > e.T) e.T = D.at + fl + 0.1;
          plan.set = 'corner'; plan.stage = 1;
        } });
      } });
      plan.stage = 0.5; plan.st = 'build';
      return;
    }
    if (st === 'cross') {
      const wg = plan.wg;
      if (c === wg || t > T - 2.2) { // kanatta: ortayı zamanında kes
        if (c === sh) { plan.st = 'final'; return; }
        const fl = Math.max(0.75, hyp(plan.S.x - c.x, Y(tm, plan.S.g) - c.y) / 15.5);
        c.dec = t + 9;
        if (t >= T - fl - 0.1) cross(c);
        return;
      }
      if (t >= T - 6 && !wg.out) { passes.push({ t: t / SPM, s: SD[tm], ok: true, j: c.j }); c.dec = t + 9; wg.from = c;
        kick(plan.wx, Y(tm, Math.min(G(wg) + 6, OFF[tm] + 6, 90)), { spd: 18, pk: dist(c, wg) > 28 ? 3 : 0, rcv: wg, kind: 'pass', log: {} }); }
      return;
    }
    // ara pası / uzaktan şut: son pas şutörün koşu yoluna, şutör sürüp tam zamanında vurur
    if (c === sh) { if (t > T - 4) plan.st = 'final'; return; }
    const S = plan.S, Sy = Y(tm, S.g), dS = hyp(S.x - sh.x, Sy - sh.y);
    const rr = Math.min(1, (7 * sh.pace * (hyp(S.x - c.x, Sy - c.y) / 17.5) + 0.8) / (dS || 1));
    const rx = sh.x + (S.x - sh.x) * rr, ry = sh.y + (Sy - sh.y) * rr;
    const d = hyp(rx - c.x, ry - c.y), spd = d > 30 ? 19 : 17.5, fl = Math.max(0.35, d / spd);
    if (t >= T - fl - dS * (1 - rr) / 6.2 - 0.25) {
      passes.push({ t: t / SPM, s: SD[tm], ok: true, j: c.j });
      sh.from = c; plan.st = 'final';
      kick(rx, ry, { spd, pk: d > 30 ? 1.2 + d * 0.08 : 0, rcv: sh, kind: 'pass', log: {} });
    }
  }
  function shoot(head) {
    const e = plan.e, tm = plan.tm, gk = GK[1 - tm], gy = Y(tm, PL), ev = e.ev;
    const sg = R() < 0.5 ? -1 : 1; let gx, gz, post = false;
    if (ev === 'goal') { gx = CX + sg * rnd(1.6, GOALW - 0.6); gz = rnd(0.2, 2.7); }
    else if (ev === 'save') { gx = CX + sg * rnd(0.6, 4.2); gz = rnd(0.3, 2.3); }
    else if (R() < 0.12) { post = true; gx = CX + sg * (GOALW + 0.05); gz = rnd(0.3, 1.6); }
    else if (R() < 0.42) { gx = CX + sg * rnd(0, 4.6); gz = rnd(4.3, 6.6); }
    else { gx = CX + sg * rnd(GOALW + 1.4, GOALW + 5.5); gz = rnd(0.2, 2); }
    ball.own = null; ball.z = 0;
    const d = hyp(gx - ball.x, gy - ball.y), fl = clamp(d / (head ? 16 : e.style === 'pen' ? 22 : 26), 0.24, 1.15);
    e.t = t / SPM; e.ta = (t + fl) / SPM; e.head = !!head;
    const dv = dive[1 - tm], dir = Math.sign(gx - gk.x) || sg;
    let ddir = dir; const amp = ev === 'save' ? 1 : ev === 'goal' ? rnd(0.55, 0.8) : gz > 3 ? 0.25 : 0.5;
    if (e.style === 'pen' && ev === 'goal' && R() < 0.55) ddir = -dir; // ters köşe
    if (!gk.out) Object.assign(dv, { dir: ddir, t0: t + fl * 0.3, t1: t + fl, until: t + fl + (ev === 'save' ? 0.7 : 1.1), amp });
    plan.gkx = ev === 'save' ? gx : gk.x + ddir * amp * 2.6; plan.st = 'shot';
    kick(gx, gy, { dur: fl, pk: e.style === 'fk' ? 1.7 : head ? 0.3 : d > 22 ? 1.1 : 0.25, z0: head ? 2.1 : 0.15, z1: gz, kind: 'shot', tm, then: () => resolve(e, tm, gx, gy, gz, post, sg) });
  }
  function resolve(e, tm, gx, gy, gz, post, sg) {
    const def = 1 - tm, gk = GK[def], out = Math.sign(gy - PL / 2);
    plan = null; touch = tm;
    if (e.ev === 'goal') {
      ripple = 1; rippleSide = gy < PL / 2 ? 1 : -1;
      celeb = { tm, sh: P[e.shooter], until: t + 3.8 };
      kick(gx + sg * 0.3, gy + out * 1.7, { dur: 0.25, z0: gz, z1: 0.1, kind: 'net', tm, then: () => dead('ko', def, CX, PL / 2, 8.2, { keep: true, showIn: 4.6 }) });
      return;
    }
    if (e.ev === 'save' && !gk.out) {
      gk.x += (gx - gk.x) * 0.8; touch = def;
      const r = e.parryTo, u = R();
      if (r) { // çelinen top: dönen topa ikinci şut
        let rs = P[r.shooter]; if (rs.out || rs.k === 0) rs = P[e.shooter]; r.shooter = rs.j;
        r.T = Math.max(r.T, t + 1.5); r.from = e.t;
        const Q = { x: clamp(rs.x + (CX - rs.x) * 0.35, CX - 13, CX + 13), g: clamp(G(rs) + 1.5, 84, 94) };
        plan = { e: r, tm, sh: rs, st: 'final', t0: t, style: 'rebound', stage: 0, set: null, S: Q, hold: 0 }; qi = Math.max(qi, shots.indexOf(r) + 1);
        kick(Q.x, Y(tm, Q.g), { dur: Math.max(0.6, r.T - t - 0.15), pk: 1.5, z0: gz, kind: 'parry', tm: def, rcv: rs });
        return;
      }
      if (u < 0.55) { ball.z = 0; give(gk); gk.dec = t + 2.4; gk.free = t + 5; }
      else if (u < 0.85) kick(gx + sg * rnd(4, 9), gy + out * 2, { dur: 0.5, pk: 1, z0: gz, kind: 'parry', tm: def, then: () => { corners.push({ t: t / SPM, s: SD[tm] }); dead('corner', tm, sg < 0 ? 0.4 : PW - 0.4, gy < 50 ? 0.4 : PL - 0.4, 4.4); } });
      else { kick(clamp(gx + sg * rnd(8, 16), 3, PW - 3), gy - out * rnd(6, 14), { dur: 0.8, pk: 1.5, z0: gz, kind: 'parry', tm: def }); prot = def; protU = t + 3; }
      return;
    }
    if (post || e.ev === 'save') { kick(clamp(gx + sg * rnd(2, 9), 3, PW - 3), gy - out * rnd(7, 15), { dur: 0.8, pk: 0.8, z0: gz, kind: 'parry', tm: def }); prot = def; protU = t + 3; return; }
    kick(gx + (gx - CX) * 0.15, gy + out * 5, { dur: 0.3, z0: gz, z1: gz * 0.6, kind: 'net', tm, then: () => dead('gk', def, CX + sg * 5, Y(def, 5.5), 4.2) });
  }
  function planShape() {
    if (!plan) return;
    const tm = plan.tm, sh = plan.sh, S = plan.S, st = plan.st, off = OFF[tm], gk = GK[1 - tm];
    if (st === 'shot') { if (!gk.out) goW(gk, plan.gkx, Y(1 - tm, 0.9), 9.5); return; }
    if (st === 'gain' || (st !== 'final' && ball.st === 'loose')) return;
    const sty = plan.style, setp = sty === 'fk' || sty === 'pen';
    if (plan.set) {
      const k = D && D.taker, sx = D ? D.x : ball.x, sy = D ? D.y : ball.y, gy = Y(tm, PL);
      if (plan.set === 'corner') {
        if (k) goW(k, sx, sy, 7.4);
        const at = team[tm].filter((p) => !p.out && p.k && p !== k && p !== sh).sort((a, b) => b.r - a.r);
        at.forEach((p, i) => { if (i < 4) go(p, CX + (i - 1.5) * 3.4, 91.5 + (i % 2) * 4, 6.2); else if (i < 6) go(p, CX + (i === 4 ? -9 : 9), 82, 6); else go(p, CX + (i - 7) * 14, 62, 6); });
        go(sh, S.x + (S.x < CX ? 2.5 : -2.5), S.g - 6.5, 6.4);
        team[1 - tm].filter((p) => !p.out && p.k).forEach((p, i) => { if (i < 7) goW(p, CX + (i - 3) * 2.9, gy + (tm ? -1 : 1) * (4.5 + (i % 3) * 3), 6.2); else if (i < 9) goW(p, CX + (i === 7 ? -10 : 10), gy + (tm ? -1 : 1) * 17, 6); else goW(p, CX, gy + (tm ? -1 : 1) * 32, 6); });
        if (!gk.out) goW(gk, CX + (sx < CX ? -1 : 1), gy + (tm ? -1 : 1) * 1, 4);
        return;
      }
      const dx = CX - sx, dy = gy - sy, dd = hyp(dx, dy) || 1, ux = dx / dd, uy = dy / dd;
      const run = t > plan.e.T - 0.6;
      goW(sh, sx - ux * (run ? 0.4 : 2.8), sy - uy * (run ? 0.4 : 2.8), run ? 6 : 5);
      if (plan.set === 'fk') { // baraj
        const wl = team[1 - tm].filter((p) => !p.out && p.k).sort((a, b) => hyp(a.x - sx, a.y - sy) - hyp(b.x - sx, b.y - sy)).slice(0, dd < 30 ? 4 : 2);
        wl.forEach((p, i) => goW(p, sx + ux * 9.15 - uy * (i - (wl.length - 1) / 2) * 0.8, sy + uy * 9.15 + ux * (i - (wl.length - 1) / 2) * 0.8, 6.5));
      } else { // penaltı: herkes ceza sahası dışına
        let i = 0;
        for (const p of P) { if (p.out || p === sh || p === gk) continue; if (p.k === 0) continue; const g = Y(tm, p.ty); if ((g > 87.6 && Math.abs(p.tx - CX) < 21) || hyp(p.tx - sx, p.ty - sy) < 9.6) { i++; goW(p, CX + (i % 2 ? -1 : 1) * (3.5 + i * 1.3), Y(tm, 86.8 - (i % 3) * 1.4), 6); } }
        if (!gk.out) goW(gk, CX, Y(1 - tm, 0.5), 5);
      }
      return;
    }
    if (st === 'final') {
      if (ball.own === sh) { const sy = Y(tm, S.g), d = hyp(S.x - sh.x, sy - sh.y); if (d > 1) goW(sh, S.x, sy, clamp(d / Math.max(0.3, plan.e.T - t), 3, 6.6)); else go(sh, sh.x, G(sh) + 1, 2.5); }
      else if (ball.st === 'loose') goW(sh, ball.x, ball.y, 8.4 * sh.pace);
      else goW(sh, S.x, Y(tm, S.g), 8.4 * sh.pace);
      return;
    }
    if (setp) { const w = plan.w; if (ball.own !== w && !w.rcv) go(w, plan.Z.x, Math.min(off - 1.2, plan.Z.g), 6.6); else if (ball.own === w) go(w, plan.Z.x, plan.Z.g, 6); return; }
    if (ball.own === sh) goW(sh, S.x, Y(tm, Math.min(S.g, 96)), 6);
    else if (!sh.rcv) go(sh, S.x + (sh.fx < 0.5 ? -2.5 : 2.5), Math.min(off - 1.3, S.g - (sty === 'cross' || sty === 'corner' ? 9 : sty === 'long' ? 0 : 2.5)), 6.6);
    const wg = plan.wg;
    if (wg && sty === 'cross' && wg !== sh) { if (ball.own === wg) go(wg, plan.wx, Math.min(G(wg) + 9, 96), 6.3); else if (!wg.rcv) go(wg, plan.wx, Math.min(off - 1.2, 84), 7); }
  }

  // ---- kartlar: sunucudaki sarı/kırmızı kart, sahada gerçek bir faulle verilir ----
  let fi = 0, cf = -1;
  function cardStep() {
    while (fi < fouls.length && fouls[fi].done) fi++;
    card = null;
    if (fi >= fouls.length) return;
    const f = fouls[fi]; if (t < f.T - 4.5) return;
    const ftm = TM(f.s), sl = f.slot >= 0 && f.slot < 11 ? P[J(f.s, f.slot)] : null;
    const skip = () => { f.done = true; f.T = t; f.tf = t / SPM; if (f.ev === 'red' && sl && !sl.out) sl.outAt = t + 0.5; };
    if (t > f.T + 3.5 || (sl && (sl.out || sl.k === 0))) return skip();
    if (plan) { if (t > f.T) skip(); return; }
    if (celeb || D) return;
    if (ball.st !== 'held') { if (ball.st === 'loose') { prot = 1 - ftm; protU = t + 0.5; } return; }
    const c = ball.own, g = G(c);
    if (c.tm === ftm) { cf = 1 - ftm; return; } // önce top rakibe geçmeli
    if (c.k === 0 || g > 84 || g < 12) return;
    let o = sl;
    if (!o || (dist(o, c) > 14 && t > f.T - 2.5)) o = nearest(ftm, c.x, c.y, null, true);
    if (!o) return skip();
    card = { f, pl: o, to: sl }; o.cd = Math.min(o.cd, t); goW(o, c.x, c.y, 9.2 * o.pace);
    if (dist(o, c) < 8 && t >= c.free) c.lock = t + 0.3; // faul gelene kadar topu tutar
  }
  function place() { for (const p of P) { if (p.out) continue; p.x = p.tx; p.y = p.ty; p.vx = p.vy = 0; p.down = 0; p.rcv = null; } }

  // ---- başlangıç ----
  koShape(0); koShape(1); place();
  dead('ko', 0, CX, PL / 2, 1.2);

  // ---- ana döngü ----
  for (let n = 0; n < N; n++) {
    t = n * DT;
    for (const p of P) {
      if (p.rcv && (t > p.rcv.until || ball.st !== 'fly')) p.rcv = null;
      if (p.outAt && t >= p.outAt && !p.out) {
        p.out = true; if (ball.own === p) loose(0, 0);
        if (D && D.taker === p) D.taker = nearest(p.tm, D.x, D.y, p, true) || D.taker;
      }
    }
    if (!htDone && t >= HT && !plan && !celeb) { htDone = true; fallen = -1; dead('ko', 1, CX, PL / 2, 3.2); koShape(0); koShape(1); place(); }
    offLines();
    director();
    force = plan && plan.st === 'gain' ? plan.tm : cf;
    shape(0); shape(1);
    if (celeb) { if (t < celeb.until) celebrate(); else celeb = null; }
    chase();
    planShape();
    cf = -1; cardStep();
    for (const p of P) move(p);
    separate();

    // top
    if (ball.st === 'held') {
      const c = ball.own;
      if (c.out) loose(0, 0);
      else {
        const v = hyp(c.vx, c.vy), ux = v > 0.4 ? c.vx / v : 0, uy = v > 0.4 ? c.vy / v : (c.tm ? 1 : -1);
        ball.x = clamp(c.x + ux * 0.55, 0.1, PW - 0.1); ball.y = clamp(c.y + uy * 0.55, 0.1, PL - 0.1); ball.z = 0;
        held[c.tm] += DT;
        const pr = t > c.got + 0.3 && t >= (c.pd || 0) && nearD(1 - c.tm, c.x, c.y) < 1.8;
        if ((t >= c.dec || pr) && t >= (c.lock || 0)) { c.pd = t + 0.5; decide(c); }
        if (ball.st === 'held') tackling();
      }
    } else if (ball.st === 'fly') {
      const f = ball.f, u = clamp((t - f.t0) / (f.t1 - f.t0), 0, 1);
      ball.x = f.x0 + (f.x1 - f.x0) * u; ball.y = f.y0 + (f.y1 - f.y0) * u;
      ball.z = Math.max(0, f.z0 + (f.z1 - f.z0) * u + f.pk * 4 * u * (1 - u));
      let cut = false;
      if (f.kind === 'pass' && ball.z < 1.6 && u > 0.15 && u < 1 && (f.lose || !guarded(f.tm))) {
        for (const o of team[1 - f.tm]) {
          if (o.out || o.down > t || f.tried.has(o) || hyp(o.x - ball.x, o.y - ball.y) > 1.2) continue;
          f.tried.add(o);
          if (f.lose || R() < 0.45 * possBias(f.tm)) { give(o); cut = true; break; }
        }
      }
      if (!cut && u >= 1) { if (f.then) f.then(); else land(f); }
    } else if (ball.st === 'loose') {
      ball.x += ball.vx * DT; ball.y += ball.vy * DT; ball.vx *= 0.955; ball.vy *= 0.955;
      if (!outCheck()) {
        let b = null, bd = 1.15;
        for (const p of P) {
          if (p.out || p.down > t) continue;
          if (prot >= 0 && t < protU && p.tm !== prot) continue;
          if (plan && plan.st === 'final' && p !== plan.sh && p.tm === plan.tm) continue;
          const d = hyp(p.x - ball.x, p.y - ball.y); if (d < bd) { bd = d; b = p; }
        }
        if (b) give(b);
      }
    } else if (D && !D.plan) restart();

    for (let i = 0; i < 2; i++) {
      const dv = dive[i];
      if (t < dv.until) dv.v = t < dv.t0 ? 0 : clamp((t - dv.t0) / Math.max(0.05, dv.t1 - dv.t0), 0, 1) * dv.amp * dv.dir;
      else dv.v *= 0.86;
    }
    if (ripple > 0) ripple = Math.max(0, ripple - DT * 0.9);
    if (fallen >= 0 && t > fallenU) fallen = -1;

    const o = n * FRAME;
    for (let j = 0; j < 22; j++) { frames[o + j * 2] = P[j].x / PW; frames[o + j * 2 + 1] = P[j].y / PL; }
    frames[o + 44] = ball.x / PW; frames[o + 45] = ball.y / PL; frames[o + 46] = ball.z;
    frames[o + 47] = ball.st === 'held' ? ball.own.j : -1; frames[o + 48] = fallen;
    frames[o + 49] = dive[0].v; frames[o + 50] = dive[1].v; frames[o + 51] = ripple * rippleSide;
  }
  for (const f of fouls) if (!f.done) f.tf = Math.min(f.tf, 94.5);
  for (const e of shots) if (e.style === 'snap') { e.style = 'long'; e.snap = true; }
  return { frames, N, evs: shots, T_END: T_END / SPM, fouls: fouls.concat(efouls), corners, offsides, DT, passes, tackles, held };
}

export function frameAt(sim, tMin, out) {
  const f = clamp((tMin * SPM) / sim.DT, 0, sim.N - 2);
  const i = Math.floor(f), a = f - i, o0 = i * FRAME, o1 = o0 + FRAME, F = sim.frames;
  const lerp = (k) => F[o0 + k] + (F[o1 + k] - F[o0 + k]) * a;
  for (let j = 0; j < 22; j++) {
    const s = j < 11 ? 'h' : 'a', k = j % 11;
    out.ply[s][k].x = lerp(j * 2); out.ply[s][k].y = lerp(j * 2 + 1);
  }
  out.ball.x = lerp(44); out.ball.y = lerp(45); out.ball.z = lerp(46);
  const h = F[o0 + 47]; out.carrier = h < 0 ? null : { s: h < 11 ? 'h' : 'a', i: h % 11 };
  const fj = F[o0 + 48]; out.fallen = fj < 0 ? null : { s: fj < 11 ? 'h' : 'a', i: fj % 11 };
  out.dive = { h: lerp(49), a: lerp(50) }; out.ripple = F[o0 + 51];
  return out;
}
export function holderAt(sim, tMin) {
  const i = clamp(Math.floor((tMin * SPM) / sim.DT), 0, sim.N - 1);
  return sim.frames[i * FRAME + 47];
}
