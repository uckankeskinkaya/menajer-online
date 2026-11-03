// MENAJER ONLINE — istemci. Tüm yazma işlemleri RPC ile; tablolar sadece okunur.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, LEAGUES, GROUPS, FORMATIONS, MENTALITY } from './config.js';
import {
  $, $$, esc, money, parseMoney, ovrBadge, grpBadge, teamDot, toast, errText, modal, confirmBox,
  timeLeft, ago, slots, slotPositions, teamStyle,
} from './ui.js';
import { openMatch } from './mac.js';
import { crestSVG, shirtSVG, dotHTML, kitOf, PATTERNS, CRESTS, SYMBOLS } from './kit.js';

// çizim simgeleri (emoji yerine)
const ICON = {
  ozet: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  kadro: '<path d="M8 3l-5 3 2 5 2-1v11h10V10l2 1 2-5-5-3a3 3 0 0 1-8 0z"/>',
  pazar: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  teklif: '<path d="M4 7h16M4 7l3-3M4 7l3 3M20 17H4m16 0l-3-3m3 3l-3 3"/>',
  lig: '<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
  home: '<path d="M3 11l9-7 9 7M5 10v10h14V10"/>',
  out: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l4-4-4-4M14 12H3"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  cup: '<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 4.5h-5L8 10zM12 7V3M16 10l4-1.5M14.5 14.5l2.5 3.5M9.5 14.5L7 18M8 10L4 8.5"/>',
};
const icon = (k, sz = 22) => `<svg class="ico" width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------- durum ----------------
const S = {
  user: null, profile: null,
  gameId: null, game: null, teams: [], teamById: new Map(), myTeam: null, usernames: new Map(),
  own: new Map(),          // player_id -> squads satırı (bu odada)
  players: new Map(),      // player_id -> real_players satırı (önbellek)
  offers: [], fixtures: [], friendlies: [], news: [], standings: [], liveSig: '', pstats: new Map(),
  tab: 'ozet', sub: {}, channel: null, draft: null,
  mk: { q: '', lg: '', grp: '', min: 70, max: 99, price: '', owner: 'all', sort: 'ovr', rows: [], page: 0, more: false },
  lastResolve: 0, loading: false,
};
window.__S = S; // hata ayıklama için

const view = () => $('#view');
const setScreen = (k) => { const v = $('#view'); if (v) v.className = `view v-${k}`; };
// arayüzün vurgu rengi: takımın forma rengi (koyu renkse ikinci renk, o da koyuysa varsayılan)
function setAccent(t) {
  const r = document.documentElement.style;
  const L = (c) => { const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(c || ''); if (!m) return -1; const [a, b, d] = m.slice(1).map((x) => parseInt(x, 16) / 255); return 0.2126 * a + 0.7152 * b + 0.0722 * d; };
  const c = t ? [t.color1, t.color2].find((x) => L(x) >= 0.2 && L(x) <= 0.92) : null;
  if (!c) { r.removeProperty('--acc'); r.removeProperty('--acc-ink'); return; }
  r.setProperty('--acc', c); r.setProperty('--acc-ink', L(c) > 0.5 ? '#0b0d12' : '#ffffff');
}
const me = () => S.myTeam;
const isOwner = () => S.game && S.user && S.game.owner === S.user.id;
const tname = (id) => S.teamById.get(id)?.name ?? '?';
const tshort = (id) => S.teamById.get(id)?.short ?? '?';
const pname = (id) => S.players.get(id)?.name ?? `#${id}`;
// oyuncunun bu odadaki hali: gelişimle rating, sezonla yaş, kondisyon/sakatlık/ceza
function pv(id) {
  const p = S.players.get(id);
  if (!p) return null;
  const sq = S.own.get(id);
  return { ...p, base: p.ovr, ovr: p.ovr + (sq?.ovr_delta || 0), age: p.age + (S.game?.season || 1) - 1, sq, st: S.pstats.get(id) };
}
const unavailable = (sq) => sq && (sq.injury > 0 || sq.ban > 0);
const MORALE = (m) => (m >= 85 ? ['😃', 'Çok iyi'] : m >= 70 ? ['🙂', 'İyi'] : m >= 55 ? ['😐', 'Normal'] : m >= 40 ? ['😕', 'Kötü'] : ['😠', 'Çok kötü']);
const moraleIcon = (sq) => (sq && sq.morale !== undefined ? `<span class="mo" title="Moral: ${MORALE(sq.morale)[1]} (${sq.morale})">${MORALE(sq.morale)[0]}</span>` : '');
const contractTxt = (c) => (c <= 0 ? 'bu sezon bitiyor' : `${c} yıl daha`);
// sözleşme uzatma maliyeti (sunucudaki renew_contract ile aynı hesap)
function renewCost(sq, years) {
  const nw = Math.round((Math.max(Number(sq.wage || 0), wageOf(Number(sq.value))) * (1.08 + 0.03 * years) * (sq.morale < 55 ? 1.1 : 1)) / 1000) * 1000;
  return { nw, bonus: nw * 6 };
}
function statusBadges(sq) {
  if (!sq) return '';
  return `${sq.injury > 0 ? `<span class="tag bad" title="Sakat">🚑 ${sq.injury}h</span>` : ''}${sq.ban > 0 ? `<span class="tag bad" title="Cezalı">🟥 ${sq.ban}m</span>` : ''}${sq.yellows >= 4 ? '<span class="tag warn" title="Bir sarı daha cezalı">🟨4</span>' : ''}${sq.loan_from ? `<span class="tag cup" title="${esc(sq.loan_from)} kulübünden sezon sonuna kadar kiralık">🤝 Kiralık</span>` : sq.contract !== undefined && sq.contract <= 0 ? '<span class="tag warn" title="Sözleşmesi bu sezon bitiyor">📝</span>' : ''}`;
}
const fitBar = (f) => `<span class="fit" title="Kondisyon %${f}"><i style="width:${f}%" class="${f >= 80 ? 'hi' : f >= 60 ? 'mid' : 'lo'}"></i></span>`;
const bidderName = (o) => (o.bidder ? tname(o.bidder) : `🤖 ${o.ai_club || 'Yapay zeka kulübü'}`);

async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  return data;
}
// jsonb {ok,msg} dönen RPC'ler için
async function act(fn, args, { quiet } = {}) {
  try {
    const r = await rpc(fn, args);
    if (r && typeof r === 'object' && 'ok' in r) {
      toast(r.msg, r.ok ? 'ok' : 'err');
      if (r.ok) await reload();
      return r;
    }
    if (!quiet) toast('Tamam', 'ok');
    await reload();
    return { ok: true, data: r };
  } catch (e) {
    toast(errText(e), 'err');
    return { ok: false, msg: errText(e) };
  }
}

// ---------------- yönlendirme ----------------
function parseHash() {
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return p;
}
window.addEventListener('hashchange', route);

async function route() {
  const p = parseHash();
  if (!S.user) { if (p[0] !== 'giris') return go('giris'); return renderAuth(); }
  if (p[0] === 'giris') return go('');
  if (p[0] === 'oda' && p[1]) {
    if (S.gameId !== p[1]) await enterGame(p[1]);
    if (!S.game) return go('');
    if (p[2] === 'mac' && p[3]) {
      renderGame();
      return openMatch(sb, Number(p[3]), { teamById: S.teamById, liveMs: LIVE_MS, myTeam: me()?.id, onClose: () => go(`oda/${S.gameId}/${S.tab}`) });
    }
    if (p[2]) S.tab = p[2];
    return renderGame();
  }
  leaveGame();
  return renderHome();
}
function go(path) {
  const h = `#/${path}`;
  if (location.hash === h) route(); else location.hash = h;
}

// ---------------- giriş / kayıt ----------------
function renderAuth(mode = 'giris') {
  setHeader(''); setAccent(null); setScreen('auth');
  view().innerHTML = `
  <div class="auth card">
    <h1 class="logo">${icon('ball', 34)}<span>Menajer <i>Online</i></span></h1>
    <p class="muted center">Arkadaşlarınla gerçek FC 26 oyuncularıyla menajerlik</p>
    <div class="seg" id="authSeg">
      <button data-m="giris" class="${mode === 'giris' ? 'on' : ''}">Giriş</button>
      <button data-m="kayit" class="${mode === 'kayit' ? 'on' : ''}">Kayıt ol</button>
    </div>
    <form id="authForm" class="form">
      ${mode === 'kayit' ? `<label>Kullanıcı adı<input name="username" required minlength="3" maxlength="20" autocomplete="username" placeholder="ör. kartal"></label>` : ''}
      <label>E-posta<input name="email" type="email" required autocomplete="email"></label>
      <label>Şifre<input name="password" type="password" required minlength="6" autocomplete="${mode === 'kayit' ? 'new-password' : 'current-password'}"></label>
      <button class="btn primary big" type="submit">${mode === 'kayit' ? 'Kayıt ol' : 'Giriş yap'}</button>
    </form>
  </div>`;
  $$('#authSeg button').forEach((b) => (b.onclick = () => renderAuth(b.dataset.m)));
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      if (mode === 'kayit') {
        const u = f.username.trim();
        if (!/^[\p{L}\p{N}_.-]{3,20}$/u.test(u)) throw new Error('Kullanıcı adı 3-20 karakter; harf, rakam, _ . - olabilir');
        const { data, error } = await sb.auth.signUp({ email: f.email.trim(), password: f.password, options: { data: { username: u } } });
        if (error) throw error;
        if (!data.session) { toast('Kayıt oldu ama e-posta doğrulaması açık. Oda sahibine haber ver.', 'err'); return; }
        toast('Hoş geldin!', 'ok');
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
        if (error) throw error;
      }
    } catch (err) { toast(errText(err), 'err'); } finally { btn.disabled = false; }
  };
}

function setHeader(title, sub = '') {
  $('#hdrTitle').innerHTML = title;
  $('#hdrSub').innerHTML = sub;
  $('#hdrUser').innerHTML = S.user ? `<button class="btn ghost sm icon" id="btnHome" title="Odalarım">${icon('home', 20)}</button><button class="btn ghost sm icon" id="btnOut" title="Çıkış">${icon('out', 20)}</button>` : '';
  if (S.user) {
    $('#btnHome').onclick = () => go('');
    $('#btnOut').onclick = async () => { if (await confirmBox('Çıkış yapılsın mı?', 'Çıkış')) await sb.auth.signOut(); };
  }
}

// ---------------- ana sayfa: odalarım ----------------
async function renderHome() {
  setHeader(`<span class="brand">${icon('ball', 24)}<span>Menajer <i>Online</i></span></span>`, S.profile ? `Menajer <b>${esc(S.profile.username)}</b>` : '');
  $('#nav').innerHTML = '';
  setAccent(null); setScreen('home');
  view().innerHTML = `<div class="loading">Yükleniyor…</div>`;
  const { data, error } = await sb.from('teams').select('id,name,short,color1,color2,game_id,games(id,name,code,status,current_round,owner,settings)')
    .eq('owner', S.user.id).order('created_at', { ascending: false });
  if (error) { view().innerHTML = `<div class="card err">${esc(errText(error))}</div>`; return; }
  const st = { lobby: 'Lobide', active: 'Sezon sürüyor', finished: 'Bitti' };
  const games = data.filter((t) => !t.games?.settings?.sandbox);
  const careers = games.filter((t) => t.games?.settings?.career);
  const rooms = games.filter((t) => !t.games?.settings?.career);
  const row = (t) => `<a class="lrow" href="#/oda/${t.game_id}">
        ${teamDot(t, 28)}<div class="grow"><b>${esc(t.games?.name)}</b><small>${esc(t.name)} · ${st[t.games?.status] || ''}${t.games?.status === 'active' ? ` · ${(t.games.settings?.season || 1) > 1 ? `${t.games.settings.season}. sezon ` : ''}${t.games.current_round}. hafta` : ''}</small></div>
        ${t.games?.settings?.career ? '<span class="tag">Kariyer</span>' : `<span class="code">${esc(t.games?.code)}</span>`}
      </a>`;
  view().innerHTML = `
  <section class="modes">
    <button class="mode-card quick" id="btnQuick"><span class="mc-ic">${icon('bolt', 30)}</span><b>Hızlı maç</b><small>İki gerçek kulübü seç, hemen izle</small></button>
    <button class="mode-card career" id="btnCareer"><span class="mc-ic">${icon('cup', 30)}</span><b>Kariyer</b><small>Tek başına: gerçek kulüp ya da kendi takımın</small></button>
    <a class="mode-card friends" href="#arkadas" id="btnFriends"><span class="mc-ic">${icon('users', 30)}</span><b>Arkadaşlarla</b><small>Oda kur ya da kodla katıl</small></a>
  </section>
  ${careers.length ? `<section class="card"><h2>Kariyerlerim</h2><div class="list">${careers.map(row).join('')}</div></section>` : ''}
  <section class="card">
    <h2>Odalarım</h2>
    ${rooms.length ? `<div class="list">${rooms.map(row).join('')}</div>` : `<p class="muted">Henüz bir odan yok. Yeni oda kur ya da arkadaşının kodunu gir.</p>`}
  </section>
  <section class="card" id="arkadas">
    <h2>Odaya katıl</h2>
    <form id="joinForm" class="form">
      <label>Oda kodu<input name="code" required maxlength="6" minlength="6" placeholder="ABC123" class="codein" autocomplete="off"></label>
      ${teamFields('#0050d0', '#ffffff')}
      <button class="btn primary" type="submit">Katıl</button>
    </form>
  </section>
  <section class="card">
    <h2>Yeni oda kur</h2>
    <form id="newForm" class="form">
      <label>Oda adı<input name="room" required minlength="3" maxlength="40" placeholder="Cuma Ligi"></label>
      ${teamFields('#d00000', '#ffffff')}
      <label>Format<select name="format">
        <option value="league">Lig</option><option value="cup">Kupa</option><option value="league_cup">Lig + Kupa</option></select></label>
      <p class="muted small">Diğer ayarları (devre, bütçe, kadro, ligler) lobide değiştirebilirsin.</p>
      <button class="btn primary" type="submit">Oda kur</button>
    </form>
  </section>`;
  $('#btnQuick').onclick = quickMatchModal;
  $('#btnCareer').onclick = careerModal;
  $('#btnFriends').onclick = (e) => { e.preventDefault(); $('#arkadas').scrollIntoView({ behavior: 'smooth' }); };
  $('#joinForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!checkTeam(f)) return;
    try {
      const id = await rpc('join_game', { p_code: f.code.trim().toUpperCase(), p_team: f.team.trim(), p_short: f.short.trim(), p_c1: f.c1, p_c2: f.c2 });
      go(`oda/${id}`);
    } catch (err) { toast(errText(err), 'err'); }
  };
  $('#newForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.room.trim().length < 3) return toast('Oda adı en az 3 karakter', 'err');
    if (!checkTeam(f)) return;
    try {
      const id = await rpc('create_game', { p_name: f.room.trim(), p_settings: { format: f.format }, p_team: f.team.trim(), p_short: f.short.trim(), p_c1: f.c1, p_c2: f.c2 });
      go(`oda/${id}`);
    } catch (err) { toast(errText(err), 'err'); }
  };
}
// ---------------- kulüp listesi (hızlı maç / kariyer) ----------------
async function clubs() {
  if (!S.clubs) {
    const { data, error } = await sb.rpc('club_list');
    if (error) throw error;
    S.clubs = data;
  }
  return S.clubs;
}
// yıldızlar: lig içi sıraya göre (1. → 5, 2-3. → 4, 4. → 3, ilk yarı → 2, kalan → 1) ve Avrupa seviyesi (bütün ligler)
const leagueStarsN = (rank, n) => (rank === 1 ? 5 : rank <= 3 ? 4 : rank <= Math.max(4, Math.ceil(n * 0.22)) ? 3 : rank <= Math.ceil(n / 2) ? 2 : 1);
const globalStarsN = (pw) => (pw >= 83 ? 5 : pw >= 80 ? 4 : pw >= 76 ? 3 : pw >= 74 ? 2 : 1);
const starsHTML = (n, cls = '') => `<span class="stars ${cls}">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span>`;
function clubPicker(id, list, lg, sel) {
  const lgs = Object.keys(LEAGUES);
  return `<div class="row2"><select id="${id}Lg">${lgs.map((k) => `<option value="${k}" ${k === lg ? 'selected' : ''}>${LEAGUES[k]}</option>`).join('')}</select>
    <select id="${id}Cl">${list.filter((c) => c.lg === lg).map((c) => `<option value="${esc(c.club)}" ${c.club === sel ? 'selected' : ''}>${esc(c.club)} (${c.power})</option>`).join('')}</select></div>`;
}
async function quickMatchModal() {
  let list;
  try { list = await clubs(); } catch (e) { return toast(errText(e), 'err'); }
  const top = (lg) => list.filter((c) => c.lg === lg);
  const st = { h: { lg: 'TUR', cl: top('TUR')[0]?.club }, a: { lg: 'TUR', cl: top('TUR')[1]?.club } };
  modal(`<h2>⚡ Hızlı maç</h2><p class="muted small">Gerçek kadrolarla bir hazırlık maçı. Sonuç hiçbir oyuna işlenmez.</p>
    <label>Ev sahibi</label><div id="qH"></div>
    <div class="vs">VS</div>
    <label>Deplasman</label><div id="qA"></div>
    <button class="btn ghost sm" id="qRnd">🎲 Rastgele derbi</button>
    <button class="btn primary big" id="qGo">Maçı başlat</button><button class="btn ghost" data-close>Vazgeç</button>`, {
    onMount: (box, close) => {
      const draw = (k) => {
        $(`#q${k === 'h' ? 'H' : 'A'}`, box).innerHTML = clubPicker(`q${k}`, list, st[k].lg, st[k].cl);
        $(`#q${k}Lg`, box).onchange = (e) => { st[k].lg = e.target.value; st[k].cl = top(st[k].lg)[k === 'h' ? 0 : 1]?.club; draw(k); };
        $(`#q${k}Cl`, box).onchange = (e) => { st[k].cl = e.target.value; };
      };
      draw('h'); draw('a');
      $('#qRnd', box).onclick = () => {
        const lg = Object.keys(LEAGUES)[Math.floor(Math.random() * 9)];
        const t4 = top(lg).slice(0, 4).sort(() => Math.random() - 0.5);
        st.h = { lg, cl: t4[0].club }; st.a = { lg, cl: t4[1].club }; draw('h'); draw('a');
      };
      $('#qGo', box).onclick = async (e) => {
        e.target.disabled = true; e.target.textContent = 'Maç oynanıyor…';
        try {
          const r = await rpc('quick_match', { p_home: st.h.cl, p_away: st.a.cl });
          if (!r.ok) { toast(r.msg, 'err'); e.target.disabled = false; e.target.textContent = 'Maçı başlat'; return; }
          close();
          const { data: tms } = await sb.from('teams').select('*').eq('game_id', r.game);
          openMatch(sb, r.fixture, { teamById: new Map((tms || []).map((x) => [x.id, x])), liveMs: LIVE_MS, onClose: () => renderHome() });
        } catch (err) { toast(errText(err), 'err'); e.target.disabled = false; e.target.textContent = 'Maçı başlat'; }
      };
    },
  });
}
async function careerModal() {
  let list = [];
  try { list = await clubs(); } catch { list = []; }
  let lg = 'TUR', type = list.length ? 'real' : 'fake', sel = null;
  modal(`<h2>🏆 Yeni kariyer</h2>
    <div class="seg wide" id="cType"><button data-t="real" class="${type === 'real' ? 'on' : ''}">Gerçek kulüp</button><button data-t="fake" class="${type === 'fake' ? 'on' : ''}">Kendi takımım</button></div>
    <div id="cBody"></div>`, {
    onMount: (box, close) => {
      const draw = () => {
        if (type === 'real' && !list.length) { $('#cBody', box).innerHTML = '<p class="muted">Gerçek kulüp listesi şu an yüklenemedi. Kendi takımınla başlayabilirsin.</p>'; return; }
        if (type === 'real') {
          const cl = list.filter((c) => c.lg === lg);
          $('#cBody', box).innerHTML = `<label>Lig<select id="cLg">${Object.entries(LEAGUES).map(([k, l]) => `<option value="${k}" ${k === lg ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <p class="muted small">Bir kulüp seç. Ligin diğer ${cl.length - 1} kulübü gerçek kadrolarıyla yapay zeka olacak. Bütçe kulübün kadro değerine göre.</p>
            <p class="muted small">Büyük yıldızlar lig içindeki yeri, küçükler Avrupa seviyesini gösterir.</p>
            <div class="list scroll clubs">${cl.map((c, i) => `<div class="lrow ${c.club === sel ? 'sel' : ''}" data-c="${esc(c.club)}"><span class="rank">${i + 1}</span><div class="grow"><b>${esc(c.club)}</b><small>${c.players} oyuncu · güç ${c.power} · Avrupa ${starsHTML(globalStarsN(c.power), 'mini')}</small></div>${starsHTML(leagueStarsN(i + 1, cl.length))}</div>`).join('')}</div>
            <button class="btn primary big" id="cGo" ${sel ? '' : 'disabled'}>${sel ? `${esc(sel)} ile başla` : 'Kulüp seç'}</button>`;
          $('#cLg', box).onchange = (e) => { lg = e.target.value; sel = null; draw(); };
          $$('.clubs .lrow', box).forEach((r) => (r.onclick = () => { sel = r.dataset.c; draw(); }));
          $('#cGo', box).onclick = async (e) => {
            e.target.disabled = true; e.target.textContent = 'Lig kuruluyor…';
            try {
              const r = await rpc('start_career', { p_lg: lg, p_club: sel });
              if (!r.ok) { toast(r.msg, 'err'); draw(); return; }
              close(); go(`oda/${r.game}`);
            } catch (err) { toast(errText(err), 'err'); draw(); }
          };
        } else {
          $('#cBody', box).innerHTML = `<form id="cForm" class="form">
            ${teamFields('#7c3aed', '#ffffff')}
            <div class="row2"><label>Lig büyüklüğü<select name="n">${[8, 10, 12, 16, 18, 20].map((n) => `<option ${n === 12 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            <label>Bütçe<select name="b">${[25e6, 50e6, 100e6, 200e6].map((v) => `<option value="${v}" ${v === 50e6 ? 'selected' : ''}>${money(v)}</option>`).join('')}</select></label></div>
            <p class="muted small">Herkese aynı kademelerden rastgele oyuncu dağıtılır; rakipler yapay zeka.</p>
            <button class="btn primary big" type="submit">Başla</button></form>`;
          $('#cForm', box).onsubmit = async (e) => {
            e.preventDefault();
            const f = Object.fromEntries(new FormData(e.target));
            if (!checkTeam(f)) return;
            const btn = e.target.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Lig kuruluyor…';
            try {
              const id = await rpc('create_game', { p_name: `${f.team.trim().slice(0, 28)} kariyeri`.slice(0, 40), p_settings: { career: true, bots: Number(f.n) - 1, max_teams: Number(f.n), schedule: 'manual', format: 'league_cup', legs: 2, start_budget: Number(f.b), first_day: 'today' }, p_team: f.team.trim(), p_short: f.short.trim(), p_c1: f.c1, p_c2: f.c2 });
              await rpc('start_game', { p_game: id });
              close(); go(`oda/${id}`);
            } catch (err) { toast(errText(err), 'err'); btn.disabled = false; btn.textContent = 'Başla'; }
          };
        }
      };
      $$('#cType button', box).forEach((b) => (b.onclick = () => { type = b.dataset.t; $$('#cType button', box).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
      draw();
    },
  });
}

function teamFields(c1, c2) {
  return `<div class="row2">
    <label class="grow">Takım adın<input name="team" required minlength="3" maxlength="30" placeholder="Kartallar SK"></label>
    <label class="w80">Kısa<input name="short" required minlength="2" maxlength="4" placeholder="KRT" class="upper"></label>
  </div>
  <div class="row2"><label>Renk 1<input type="color" name="c1" value="${c1}"></label><label>Renk 2<input type="color" name="c2" value="${c2}"></label></div>`;
}
function checkTeam(f) {
  const n = (f.team || '').trim(), s = (f.short || '').trim();
  if (n.length < 3 || n.length > 30) { toast('Takım adı 3-30 karakter olmalı', 'err'); return false; }
  if (s.length < 2 || s.length > 4) { toast('Kısaltma 2-4 karakter olmalı', 'err'); return false; }
  return true;
}

// ---------------- oda verisi ----------------
async function enterGame(id) {
  leaveGame();
  S.gameId = id;
  S.tab = 'ozet';
  S.sub = {};
  S.draft = null;
  S.mk.rows = [];
  view().innerHTML = `<div class="loading">Oda yükleniyor…</div>`;
  await reload();
  if (!S.game) { toast('Oda bulunamadı ya da üyesi değilsin', 'err'); S.gameId = null; return; }
  subscribe(id);
}
function leaveGame() {
  if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
  S.gameId = null; S.game = null; S.myTeam = null;
}

async function fetchPlayers(ids) {
  const need = [...new Set(ids)].filter((id) => id && !S.players.has(id));
  for (let i = 0; i < need.length; i += 150) {
    const { data, error } = await sb.from('real_players').select('*').in('id', need.slice(i, i + 150));
    if (error) throw error;
    data.forEach((p) => S.players.set(p.id, p));
  }
}

async function reload() {
  const id = S.gameId;
  if (!id) return;
  try {
    const [g, t, q, o, f, n] = await Promise.all([
      sb.from('games').select('*').eq('id', id).maybeSingle(),
      sb.from('teams').select('*').eq('game_id', id).order('created_at'),
      sb.from('squads').select('*').eq('game_id', id),
      sb.from('offers').select('*').eq('game_id', id).order('created_at', { ascending: false }).limit(300),
      sb.from('fixtures').select('id,comp,round,cup_round,leg,tie,home,away,hg,ag,pens,played,winner,kickoff_at,ht:stats->ht->>vh').eq('game_id', id).order('round').order('kickoff_at', { nullsFirst: false }).order('id'),
      sb.from('news').select('*').eq('game_id', id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(80),
    ]);
    for (const r of [g, t, q, o, f, n]) if (r.error) throw r.error;
    if (S.gameId !== id) return;
    S.game = g.data;
    S.teams = t.data;
    S.teamById = new Map(t.data.map((x) => [x.id, x]));
    S.myTeam = t.data.find((x) => x.owner === S.user.id) || null;
    S.own = new Map(q.data.map((x) => [x.player_id, x]));
    S.offers = o.data;
    S.fixtures = f.data.filter((x) => x.comp !== 'friendly');
    S.friendlies = f.data.filter((x) => x.comp === 'friendly').sort((a, b) => b.id - a.id);
    S.news = n.data;
    const owners = t.data.map((x) => x.owner).filter((x) => x && !S.usernames.has(x));
    if (owners.length) {
      const { data } = await sb.from('profiles').select('id,username').in('id', owners);
      data?.forEach((p) => S.usernames.set(p.id, p.username));
    }
    await fetchPlayers([...q.data.map((x) => x.player_id), ...o.data.map((x) => x.player_id)]);
    if (S.game?.status !== 'lobby' && hasLeague()) {
      const { data, error } = await sb.rpc('standings', { p_game: id });
      if (!error) S.standings = data;
    }
    S.euroTable = [];
    if (S.game?.euro?.groups) {
      const { data, error } = await sb.rpc('euro_table', { p_game: id });
      if (!error) S.euroTable = data;
    }
    if (S.game?.status !== 'lobby') {
      const { data, error } = await sb.rpc('player_stats', { p_game: id });
      if (!error) { S.pstats = new Map(data.map((x) => [x.player_id, x])); await fetchPlayers(data.map((x) => x.player_id)); }
    }
  } catch (e) { toast(errText(e), 'err'); }
}
const hasLeague = () => ['league', 'league_cup'].includes(S.game?.settings?.format);
const setting = (k, d) => S.game?.settings?.[k] ?? d;
const isAuto = () => setting('schedule', 'manual') === 'auto';
export const LIVE_MS = 9 * 60 * 1000; // canlı yayın süresi (90 dk = 9 gerçek dakika)
const liveState = (f) => {
  if (!f?.kickoff_at) return f?.played ? 'done' : 'wait';
  const dt = Date.now() - new Date(f.kickoff_at);
  if (dt < 0) return 'wait';
  if (dt < LIVE_MS) return 'live';
  return f.played ? 'done' : 'live';
};
const kickTxt = (iso) => new Date(iso).toLocaleString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const kickTime = (iso) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
function windowOpen() {
  if (S.game?.status !== 'active') return false;
  if (setting('transfer_window', 'always') === 'always') return true;
  const half = Math.floor(Math.max(0, ...S.fixtures.filter((f) => f.comp === 'league').map((f) => f.round)) / 2);
  return S.game.current_round === 0 || S.game.current_round === half;
}
const hasCup = () => ['cup', 'league_cup'].includes(S.game?.settings?.format);
const hasEuro = () => !!S.game?.euro?.groups;
const leagueTeams = () => S.teams.filter((x) => !x.guest); // misafir (sadece Avrupa'da oynayan) kulüpler hariç
const EURO_ST = ['Grup', 'Çeyrek final', 'Yarı final', 'Final'];
const compLabel = (f) => f.comp === 'cup' ? `Kupa ${f.cup_round}. tur` : f.comp === 'euro' ? `Avrupa · ${f.cup_round === 0 ? `${String.fromCharCode(64 + f.tie)} Grubu ${f.leg}. maç` : EURO_ST[f.cup_round] + (f.cup_round < 3 ? (f.leg === 2 ? ' rövanş' : ' ilk maç') : '')}` : `${f.round}. hafta`;

let reloadTimer;
async function subscribe(id) {
  // Realtime, RLS'i kullanıcının JWT'siyle değerlendirir; publishable key ile bu otomatik gitmiyor.
  const { data: { session } } = await sb.auth.getSession();
  if (session) await sb.realtime.setAuth(session.access_token);
  if (S.gameId !== id) return;
  const ch = sb.channel(`oda-${id}`);
  const onChange = (payload) => {
    if (payload.table === 'news' && payload.eventType === 'INSERT' && payload.new && S.game?.status !== 'lobby') {
      const nw = payload.new;
      if (nw.team_id && nw.team_id === me()?.id) toast(nw.text, 'info');
      else if (['champion', 'auction', 'transfer'].includes(nw.kind)) toast(nw.text, 'info');
    }
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => { await reload(); if (S.gameId === id) refresh(); }, 350);
  };
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${id}` }, onChange);
  for (const table of ['teams', 'squads', 'offers', 'fixtures', 'news']) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `game_id=eq.${id}` }, onChange);
  }
  ch.subscribe();
  S.channel = ch;
}

// açık artırma sayaçları + süresi dolanları sonuçlandır
setInterval(() => {
  $$('[data-exp]').forEach((el) => (el.textContent = timeLeft(el.dataset.exp)));
  if (S.game && S.game.status !== 'lobby') {
    const all = [...S.fixtures, ...S.friendlies];
    const sig = all.map((f) => `${f.id}:${liveState(f)}`).join(',');
    if (S.liveSig && sig !== S.liveSig) {
      const mineLive = all.find((f) => liveState(f) === 'live' && (f.home === me()?.id || f.away === me()?.id) && !S.liveSig.includes(`${f.id}:live`));
      if (mineLive) toast(`⚽ Maçın başladı! Özet'ten canlı izle`, 'ok');
      if (!$('#match').classList.contains('show') && ['ozet', 'lig'].includes(S.tab)) refresh();
    }
    S.liveSig = sig;
  }
  if (S.game?.status === 'active' && Date.now() - S.lastResolve > 8000 &&
      S.offers.some((o) => o.status === 'active' && new Date(o.expires_at) <= Date.now())) {
    S.lastResolve = Date.now();
    sb.rpc('resolve_transfers').then(async () => { await reload(); refresh(); });
  }
}, 1000);

// veri değişince ekranı tazele (pazarda formu bozmadan sadece listeyi)
function refresh() {
  if (!S.game) return;
  if ($('#modal').classList.contains('show') && $('#modal [data-live]')) return; // açık teklif penceresini bozma
  if (S.game.status !== 'lobby' && S.tab === 'pazar' && $('#mkList')) { renderMarketList(); updateHeader(); return; }
  renderGame();
}

// ---------------- oda ekranı ----------------
const TABS = [
  ['ozet', 'ozet', 'Özet'], ['kadro', 'kadro', 'Kadro'], ['pazar', 'pazar', 'Pazar'], ['teklif', 'teklif', 'Teklifler'], ['lig', 'lig', 'Lig'],
];
function updateHeader() {
  const t = me();
  const sub = t ? `${esc(t.name)}${S.game.status === 'lobby' ? ' · lobi' : ` · <b>${money(t.budget)}</b>`}${S.game.status === 'active' ? ` · ${(S.game.season || 1) > 1 ? `S${S.game.season} ` : ''}${S.game.current_round}. hafta` : ''}` : '';
  setHeader(`${t ? `<span class="hcrest">${crestSVG(t, 30)}</span>` : ''}<span>${esc(S.game.name)}</span>`, sub);
}
function renderGame() {
  if (!S.game) return;
  updateHeader();
  setAccent(me());
  setScreen(S.game.status === 'lobby' ? 'lobby' : S.tab);
  if (S.game.status === 'lobby') { $('#nav').innerHTML = ''; return renderLobby(); }
  const pend = S.offers.filter((o) => o.status === 'active' && o.seller === me()?.id).length;
  $('#nav').innerHTML = TABS.map(([k, ic, lb]) =>
    `<a href="#/oda/${S.gameId}/${k}" class="${S.tab === k ? 'on' : ''}"><span>${icon(ic)}</span>${lb}${k === 'teklif' && pend ? `<i class="badge">${pend}</i>` : ''}</a>`).join('');
  ({ ozet: renderOzet, kadro: renderKadro, pazar: renderPazar, teklif: renderTeklif, lig: renderLig }[S.tab] || renderOzet)();
}

// ---------------- lobi ----------------
function renderLobby() {
  const s = S.game.settings;
  const own = isOwner();
  const dis = own ? '' : 'disabled';
  const sq = s.squad || {};
  const sqTotal = ['S', 'A', 'B', 'C', 'D'].reduce((a, k) => a + Number(sq[k] || 0), 0);
  view().innerHTML = `
  <section class="card center">
    <p class="muted">Arkadaşlarına bu kodu gönder</p>
    <div class="bigcode" id="code">${esc(S.game.code)}</div>
    <div class="row center"><button class="btn sm" id="btnCopy">Kodu kopyala</button>${navigator.share ? '<button class="btn sm" id="btnShare">Paylaş</button>' : ''}</div>
  </section>
  <section class="card">
    <h2>Takımlar (${S.teams.length}/${s.max_teams})</h2>
    <div class="list">${S.teams.map((t) => `<div class="lrow">${teamDot(t)}<div class="grow"><b>${esc(t.name)}</b> <small>${esc(t.short)}</small><small>${esc(S.usernames.get(t.owner) || '')}${t.owner === S.game.owner ? ' 👑' : ''}</small></div>
      ${t.owner === S.user.id ? `<button class="btn sm" id="btnKit">Forma</button>` : ''}
      ${own && t.owner !== S.user.id ? `<button class="btn sm ghost danger" data-kick="${t.id}">Çıkar</button>` : ''}</div>`).join('')}</div>
    ${Number(s.bots || 0) > 0 ? `<p class="muted small">+ ${Math.min(Number(s.bots), s.max_teams - S.teams.length)} yapay zeka takımı başlarken eklenecek 🤖</p>` : ''}
  </section>
  <section class="card">
    <h2>Ayarlar ${own ? '' : '<small class="muted">(sadece oda sahibi değiştirebilir)</small>'}</h2>
    <form id="setForm" class="form">
      <div class="row2">
        <label>Format<select name="format" ${dis}>${[['league', 'Lig'], ['cup', 'Kupa'], ['league_cup', 'Lig + Kupa']].map(([v, l]) => `<option value="${v}" ${s.format === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Takım sınırı<input type="number" name="max_teams" min="2" max="20" value="${s.max_teams}" ${dis}></label>
      </div>
      <div class="row2">
        <label>Lig<select name="legs" ${dis}><option value="1" ${s.legs == 1 ? 'selected' : ''}>Tek devre</option><option value="2" ${s.legs == 2 ? 'selected' : ''}>Çift devre</option></select></label>
        <label>Kupa<select name="cup_legs" ${dis}><option value="1" ${s.cup_legs == 1 ? 'selected' : ''}>Tek maç</option><option value="2" ${s.cup_legs == 2 ? 'selected' : ''}>Rövanşlı</option></select></label>
      </div>
      <div class="row2">
        <label>Başlangıç bütçesi<select name="start_budget" ${dis}>${[25e6, 50e6, 75e6, 100e6, 150e6, 200e6, 300e6].map((v) => `<option value="${v}" ${s.start_budget == v ? 'selected' : ''}>${money(v)}</option>`).join('')}</select></label>
        <label>Açık artırma süresi<select name="bid_minutes" ${dis}>${[2, 5, 10, 15, 30, 60].map((v) => `<option value="${v}" ${s.bid_minutes == v ? 'selected' : ''}>${v} dk</option>`).join('')}</select></label>
      </div>
      <div class="row2">
        <label>Yapay zeka takımı<input type="number" name="bots" min="0" max="19" value="${s.bots ?? 0}" ${dis}></label>
        <label>Transfer dönemi<select name="transfer_window" ${dis}><option value="always" ${s.transfer_window !== 'breaks' ? 'selected' : ''}>Her zaman açık</option><option value="breaks" ${s.transfer_window === 'breaks' ? 'selected' : ''}>Sezon başı + devre arası</option></select></label>
      </div>
      <fieldset><legend>Maç programı</legend>
        <div class="row2">
          <label>Mod<select name="schedule" ${dis}><option value="auto" ${s.schedule !== 'manual' ? 'selected' : ''}>Saatinde otomatik</option><option value="manual" ${s.schedule === 'manual' ? 'selected' : ''}>Elle / herkes hazır olunca</option></select></label>
          <label>İlk gün<select name="first_day" ${dis}><option value="today" ${s.first_day === 'today' ? 'selected' : ''}>Bugün</option><option value="tomorrow" ${s.first_day !== 'today' ? 'selected' : ''}>Yarın</option></select></label>
        </div>
        <div class="row2">
          <label>İlk maç saati<input type="time" name="kickoff" value="${esc(s.kickoff || '11:00')}" ${dis}></label>
          <label>Maç arası<select name="gap_min" ${dis}>${[10, 15, 20, 30, 60].map((v) => `<option value="${v}" ${Number(s.gap_min ?? 10) === v ? 'selected' : ''}>${v} dk</option>`).join('')}</select></label>
        </div>
        <p class="muted small">Otomatik modda her gün bir hafta oynanır; her maçın kendi saati vardır (ör. 11:00, 11:10, 11:20…). Online olan canlı izler, sonradan da izlenebilir.</p>
      </fieldset>
      <label class="chk"><input type="checkbox" name="ai_offers" ${s.ai_offers !== false ? 'checked' : ''} ${dis}> Yapay zeka kulüpleri oyuncularıma teklif yapabilir</label>
      <fieldset><legend>Başlangıç kadrosu (kademe başına oyuncu) · toplam <b id="sqTotal">${sqTotal}</b></legend>
        <div class="tiers">${[['S', '85+'], ['A', '80-84'], ['B', '75-79'], ['C', '70-74'], ['D', '60-69']].map(([k, r]) =>
          `<label><span class="ovr r-${k.toLowerCase()}">${k}</span><small>${r}</small><input type="number" name="sq_${k}" min="0" max="12" value="${sq[k] ?? 0}" ${dis}></label>`).join('')}</div>
        <p class="muted small">Toplam 16-30 olmalı. Herkese her kademeden aynı sayıda rastgele oyuncu verilir (2 kaleci dahil).</p>
      </fieldset>
      <fieldset><legend>Oyuncu havuzu (ligler)</legend>
        <div class="checks">${Object.entries(LEAGUES).map(([k, l]) => `<label><input type="checkbox" name="lg" value="${k}" ${(s.leagues || []).includes(k) ? 'checked' : ''} ${dis}>${l}</label>`).join('')}</div>
      </fieldset>
      ${own ? '<button class="btn" type="submit">Ayarları kaydet</button>' : ''}
    </form>
  </section>
  <section class="card">
    ${own ? `<button class="btn primary big" id="btnStart" ${S.teams.length + Number(s.bots || 0) < 2 ? 'disabled' : ''}>Sezonu başlat</button>
      <p class="muted small center">${S.teams.length + Number(s.bots || 0) < 2 ? 'En az 2 takım gerekli — tek başınaysan yapay zeka takımı ekle.' : 'Başlayınca kadrolar dağıtılır ve fikstür çekilir; yeni takım katılamaz.'}</p>
      <button class="btn danger ghost" id="btnDel">Odayı sil</button>`
    : `<p class="muted center">Oda sahibinin sezonu başlatması bekleniyor…</p><button class="btn danger ghost" id="btnLeave">Odadan ayrıl</button>`}
  </section>`;
  $('#btnKit') && ($('#btnKit').onclick = kitEditor);
  $('#btnCopy').onclick = () => navigator.clipboard?.writeText(S.game.code).then(() => toast('Kod kopyalandı', 'ok'));
  $('#btnShare') && ($('#btnShare').onclick = () => navigator.share({ title: 'Menajer Online', text: `"${S.game.name}" odama katıl! Kod: ${S.game.code}`, url: location.origin + location.pathname }));
  const form = $('#setForm');
  form.oninput = () => {
    $('#sqTotal').textContent = ['S', 'A', 'B', 'C', 'D'].reduce((a, k) => a + Number(form[`sq_${k}`].value || 0), 0);
    if ($('#btnStart')) $('#btnStart').disabled = S.teams.length + Number(form.bots.value || 0) < 2;
  };
  if (own) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const ns = settingsFromForm(form);
      if (!ns) return;
      const r = await act('update_settings', { p_game: S.gameId, p_settings: ns }, { quiet: true });
      if (r.ok) { toast('Ayarlar kaydedildi', 'ok'); renderGame(); }
    };
    $('#btnStart').onclick = async () => {
      const ns = settingsFromForm(form);
      if (!ns) return;
      const total = Math.min(ns.max_teams, S.teams.length + ns.bots);
      if (!(await confirmBox(`${total} takımla sezon başlasın mı?${ns.bots ? ` (${total - S.teams.length} yapay zeka)` : ''}`, 'Başlat'))) return;
      try {
        await rpc('update_settings', { p_game: S.gameId, p_settings: ns });
        await rpc('start_game', { p_game: S.gameId });
        toast('Sezon başladı!', 'ok');
        await reload(); renderGame();
      } catch (err) { toast(errText(err), 'err'); }
    };
    $$('[data-kick]').forEach((b) => (b.onclick = async () => {
      if (!(await confirmBox(`${tname(b.dataset.kick)} odadan çıkarılsın mı?`, 'Çıkar'))) return;
      await act('kick_team', { p_game: S.gameId, p_team: b.dataset.kick }); renderGame();
    }));
    $('#btnDel').onclick = async () => {
      if (!(await confirmBox('Oda ve içindeki her şey silinsin mi?', 'Sil'))) return;
      try { await rpc('delete_game', { p_game: S.gameId }); go(''); } catch (err) { toast(errText(err), 'err'); }
    };
  } else {
    $('#btnLeave').onclick = async () => {
      if (!(await confirmBox('Odadan ayrılmak istiyor musun?', 'Ayrıl'))) return;
      try { await rpc('leave_game', { p_game: S.gameId }); go(''); } catch (err) { toast(errText(err), 'err'); }
    };
  }
}
function settingsFromForm(form) {
  const squad = {};
  let tot = 0;
  for (const k of ['S', 'A', 'B', 'C', 'D']) { squad[k] = Math.max(0, Math.min(12, Number(form[`sq_${k}`].value) || 0)); tot += squad[k]; }
  if (tot < 16 || tot > 30) { toast('Başlangıç kadrosu toplamı 16-30 olmalı', 'err'); return null; }
  const leagues = $$('input[name=lg]:checked', form).map((x) => x.value);
  if (!leagues.length) { toast('En az bir lig seç', 'err'); return null; }
  const mt = Number(form.max_teams.value);
  if (mt < Math.max(2, S.teams.length) || mt > 20) { toast(`Takım sınırı ${Math.max(2, S.teams.length)}-20 olmalı`, 'err'); return null; }
  const bots = Math.max(0, Math.min(19, Number(form.bots.value) || 0));
  if (!/^\d{2}:\d{2}$/.test(form.kickoff.value)) { toast('İlk maç saatini seç', 'err'); return null; }
  return {
    format: form.format.value, legs: Number(form.legs.value), cup_legs: Number(form.cup_legs.value), max_teams: mt,
    start_budget: Number(form.start_budget.value), bid_minutes: Number(form.bid_minutes.value), squad, leagues,
    bots, transfer_window: form.transfer_window.value, schedule: form.schedule.value, first_day: form.first_day.value,
    kickoff: form.kickoff.value, gap_min: Number(form.gap_min.value), ai_offers: form.ai_offers.checked,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Istanbul',
  };
}

// ---------------- FM: güç, form, yönetim, asistan ----------------
const isCareer = () => !!S.game?.settings?.career;
function teamPower(id) { // en iyi 16 oyuncunun ortalaması (gelişim dahil)
  const o = [...S.own.values()].filter((x) => x.team_id === id).map((x) => pv(x.player_id)?.ovr || 0).sort((a, b) => b - a).slice(0, 16);
  return o.length ? o.reduce((a, b) => a + b, 0) / o.length : 0;
}
function lineupPower(id) {
  const t = S.teamById.get(id);
  const ids = t?.lineup?.length === 11 ? t.lineup : [...S.own.values()].filter((x) => x.team_id === id).map((x) => x.player_id);
  const o = ids.map((x) => pv(x)?.ovr || 0).sort((a, b) => b - a).slice(0, 11);
  return o.length ? Math.round(o.reduce((a, b) => a + b, 0) / o.length) : 0;
}
function formOf(id, n = 5) {
  return S.fixtures.filter((f) => f.played && f.comp === 'league' && (f.home === id || f.away === id) && liveState(f) === 'done').slice(-n)
    .map((f) => { const gf = f.home === id ? f.hg : f.ag, ga = f.home === id ? f.ag : f.hg; return gf > ga ? 'G' : gf < ga ? 'M' : 'B'; });
}
const formHTML = (arr) => `<span class="fguide">${arr.map((r) => `<i class="f-${r}">${r}</i>`).join('')}</span>`;
function boardInfo() {
  if (!hasLeague() || !me()) return null;
  const ranked = leagueTeams().map((t) => ({ id: t.id, p: teamPower(t.id) })).sort((a, b) => b.p - a.p);
  const n = ranked.length, rank = ranked.findIndex((x) => x.id === me().id) + 1;
  const target = rank === 1 ? 1 : rank <= Math.ceil(n * 0.25) ? Math.ceil(n * 0.25) : rank <= Math.ceil(n / 2) ? Math.ceil(n / 2) : rank <= Math.ceil(n * 0.8) ? Math.ceil(n * 0.75) : n - 2;
  const label = target === 1 ? 'Şampiyonluk' : target <= Math.ceil(n * 0.25) ? `İlk ${target}` : target <= Math.ceil(n / 2) ? `İlk ${target} (üst yarı)` : target < n - 2 ? `Orta sıralar (ilk ${target})` : 'Ligde kalmak';
  const pos = S.standings.findIndex((x) => x.team_id === me().id) + 1;
  const played = S.standings.find((x) => x.team_id === me().id)?.o || 0;
  const pts = formOf(me().id).reduce((a, r) => a + (r === 'G' ? 3 : r === 'B' ? 1 : 0), 0);
  let conf = 60;
  if (played) conf = Math.max(3, Math.min(99, 60 + (target - pos) * 6 + (pts - 7) * 3));
  const mood = conf >= 80 ? 'Çok memnun' : conf >= 60 ? 'Memnun' : conf >= 40 ? 'Endişeli' : conf >= 20 ? 'Huzursuz' : 'Sabrı tükeniyor';
  return { rank, n, target, label, pos, played, conf, mood };
}
function nextMyFixture() { return myFixtures().find((f) => !f.played && liveState(f) === 'wait'); }
function assistantReport(f) {
  const t = me(); if (!f || !t) return '';
  const opp = f.home === t.id ? f.away : f.home;
  const o = S.teamById.get(opp);
  const ours = lineupPower(t.id), theirs = lineupPower(opp);
  const key = [...S.own.values()].filter((x) => x.team_id === opp).map((x) => pv(x.player_id)).filter(Boolean).sort((a, b) => b.ovr - a.ovr)[0];
  const mine = [...S.own.values()].filter((x) => x.team_id === t.id);
  const inj = mine.filter((x) => x.injury > 0).length, ban = mine.filter((x) => x.ban > 0).length;
  const tired = t.lineup.filter((id) => (S.own.get(id)?.fitness ?? 100) < 70).length;
  const badIn11 = t.lineup.filter((id) => unavailable(S.own.get(id))).length;
  const oPos = S.standings.findIndex((x) => x.team_id === opp) + 1;
  const diff = ours - theirs;
  const advice = diff >= 4 ? 'Kağıt üstünde üstünüz. Hücum anlayışıyla baskı kurmak mantıklı.' : diff <= -4 ? 'Rakip daha güçlü. Dengeli ya da savunma anlayışıyla kontra arayalım.' : 'Güçler denk; ayrıntılar belirleyecek. Dengeli oynayalım.';
  // rakibin oyun tarzı ve ona karşı öneri
  const os = teamStyle(o), L3 = (v, x) => x[v] ?? x[1];
  const styleTxt = [L3(os.press, ['geride bekleyen', '', 'önde basan']), L3(os.tempo, ['sabırlı', '', 'hızlı ve direkt']), L3(os.width, ['ortadan oynayan', '', 'kanatları kullanan'])].filter(Boolean).join(', ') || 'dengeli';
  const counter = os.press === 2 ? 'Önde basıyorlar, savunmalarının arkası boş: hızlı tempo ve ara paslar işe yarar.'
    : os.press === 0 ? 'Geride bekliyorlar: kanatları kullanıp ortalarla zorlayalım, sabırsızlanmayalım.'
    : os.width === 2 ? 'Kanatlardan çok orta yapıyorlar; dar savunup ceza sahasını kalabalık tutalım.'
    : os.tempo === 2 ? 'Topu çabuk ileri taşıyorlar; orta sahada basıp pas akışlarını keselim.'
    : os.tempo === 0 ? 'Topu ayaklarında tutmayı seviyorlar; önde basarak hata yaptırabiliriz.' : '';
  const lines = [
    `<b>${esc(o?.name)}</b> ${esc(o?.formation || '')} oynuyor${oPos ? `, ligde ${oPos}. sırada` : ''}. Form: ${formOf(opp).length ? formHTML(formOf(opp)) : '—'}`,
    `Oyun tarzı: ${esc(styleTxt)}.${counter ? ` ${counter}` : ''}`,
    `İlk 11 gücü: biz <b>${ours}</b> · onlar <b>${theirs}</b>`,
    key ? `En tehlikeli oyuncuları <b>${esc(key.name)}</b> (${key.ovr}, ${esc(key.positions.split(',')[0])}).` : '',
    inj || ban ? `Kadromuzda ${inj ? `${inj} sakat` : ''}${inj && ban ? ', ' : ''}${ban ? `${ban} cezalı` : ''} oyuncu var.` : 'Sakat ya da cezalı oyuncumuz yok.',
    badIn11 ? `<span class="warn">⚠️ İlk 11'de oynayamayacak ${badIn11} oyuncu var, taktiği güncelle.</span>` : '',
    tired ? `İlk 11'de ${tired} oyuncunun kondisyonu %70'in altında; rotasyon düşün.` : '',
    (() => { const ex = mine.filter((x) => x.contract !== undefined && x.contract <= 0).length, sad = mine.filter((x) => x.morale !== undefined && x.morale < 45).length;
      return [ex ? `${ex} oyuncunun sözleşmesi bu sezon bitiyor; uzatmazsan sezon sonunda bedelsiz gider.` : '', sad ? `${sad} oyuncunun morali bozuk 😕 (forma şansı ve sonuçlar etkiliyor).` : ''].filter(Boolean).join(' '); })(),
    `<i>${advice}</i>`,
  ].filter(Boolean);
  return `<div class="assist"><div class="as-head"><span class="as-av">🧑‍💼</span><div><b>Yardımcı antrenör</b><small>Maç önü raporu</small></div></div><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul></div>`;
}

// ---------------- forma ve arma editörü ----------------
function kitEditor() {
  const t = me();
  if (!t) return;
  const k = kitOf(t);
  const d = { c1: k.c1, c2: k.c2, pattern: k.pattern, crest: k.crest, symbol: k.symbol };
  const team = () => ({ ...t, color1: d.c1, color2: d.c2, kit: { pattern: d.pattern, crest: d.crest, symbol: d.symbol } });
  const chips = (id, obj, cur) => `<div class="chips" id="${id}">${Object.entries(obj).map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  modal(`<h2>Forma ve arma</h2>
    <div class="kitprev" id="kPrev"></div>
    <div class="row2"><label>Ana renk<input type="color" id="kC1" value="${d.c1}"></label><label>İkinci renk<input type="color" id="kC2" value="${d.c2}"></label></div>
    <label>Desen</label>${chips('kPat', PATTERNS, d.pattern)}
    <label>Arma şekli</label>${chips('kCr', CRESTS, d.crest)}
    <label>Arma sembolü</label>${chips('kSym', Object.fromEntries(SYMBOLS.map((x) => [x, x || esc(t.short)])), d.symbol)}
    <button class="btn primary big" id="kSave">Kaydet</button><button class="btn ghost" data-close>Vazgeç</button>`, {
    onMount: (box, close) => {
      const draw = () => { $('#kPrev', box).innerHTML = `${shirtSVG(team(), { num: 10, size: 120 })}${crestSVG(team(), 96)}`; };
      draw();
      $('#kC1', box).oninput = (e) => { d.c1 = e.target.value; draw(); };
      $('#kC2', box).oninput = (e) => { d.c2 = e.target.value; draw(); };
      for (const [id, key] of [['kPat', 'pattern'], ['kCr', 'crest'], ['kSym', 'symbol']]) {
        $$(`#${id} button`, box).forEach((b) => (b.onclick = () => { d[key] = b.dataset.v; $$(`#${id} button`, box).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
      }
      $('#kSave', box).onclick = async () => {
        const r = await act('set_kit', { p_game: S.gameId, p_c1: d.c1, p_c2: d.c2, p_pattern: d.pattern, p_crest: d.crest, p_symbol: d.symbol });
        if (r.ok) { close(); renderGame(); }
      };
    },
  });
}

// ---------------- özet ----------------
function myFixtures() {
  const id = me()?.id;
  return S.fixtures.filter((f) => f.home === id || f.away === id);
}
function fxRow(f, { showRound } = {}) {
  const h = S.teamById.get(f.home), a = S.teamById.get(f.away);
  const mine = f.home === me()?.id || f.away === me()?.id;
  const st = liveState(f);
  const link = st === 'live' || f.played;
  const score = st === 'live' ? `<b class="score live">CANLI</b>`
    : f.played ? `<b class="score">${f.hg} - ${f.ag}</b>`
    : `<span class="score muted">${f.kickoff_at ? kickTime(f.kickoff_at) : '-'}</span>`;
  const tag = f.comp === 'cup' ? `<span class="tag cup">Kupa ${f.cup_round}.tur${f.leg === 2 ? ' rövanş' : ''}</span>`
    : f.comp === 'euro' ? `<span class="tag euro">🌍 ${esc(compLabel(f).replace('Avrupa · ', ''))}</span>`
    : f.comp === 'friendly' ? '<span class="tag">Hazırlık</span>' : '';
  return `<${link ? `a href="#/oda/${S.gameId}/mac/${f.id}"` : 'div'} class="fx ${mine ? 'mine' : ''} ${st === 'live' ? 'is-live' : ''}">
    ${showRound && f.comp !== 'friendly' ? `<small class="rnd">${f.round}.h${f.kickoff_at && !f.played ? ' ' + new Date(f.kickoff_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) : ''}</small>` : ''}
    <span class="tm r">${esc(h?.name)} ${teamDot(h)}</span>${score}<span class="tm">${teamDot(a)} ${esc(a?.name)}</span>
    ${tag}${f.pens && st !== 'live' ? `<small class="pens">pen. ${esc(f.pens)}</small>` : ''}${link ? `<span class="watch">${st === 'live' ? '🔴' : '▶'}</span>` : ''}
  </${link ? 'a' : 'div'}>`;
}
function newsItem(n) {
  const ic = { transfer: '🔁', auction: '🔨', outbid: '⚠️', offer: '💌', rival: '⚔️', champion: '🏆', round: '📅', cup: '🏆', start: '🚀', join: '👋', info: 'ℹ️' }[n.kind] || '📰';
  return `<div class="news ${n.team_id ? 'priv' : ''}"><span>${ic}</span><div>${esc(n.text)}<small>${ago(n.created_at)}</small></div></div>`;
}
// maç sonu basın toplantısı: son resmi maç için bir kez (sunucudaki answer_press ile aynı sorular/cevaplar)
const PRESS = {
  w: ['Galibiyet sonrası duyguların neler?', ['Oyuncularımla gurur duyuyorum.', 'Ayaklarımız yere basmalı, daha yolun başındayız.', 'Kazandık ama oyundan memnun değilim.']],
  d: ['Beraberlik hakkında ne söylersin?', ['Bir puan da değerli, oyuncularım mücadele etti.', 'İki puan kaybettik, bunu kabul edemem.', 'Hakem kararları sonucu etkiledi.']],
  l: ['Bu yenilgiyi nasıl değerlendiriyorsun?', ['Sorumluluk tamamen bende.', 'Oyuncularım beni hayal kırıklığına uğrattı.', 'Bu yenilgiden ders çıkaracağız, kafalar dik.']],
};
function pressCard(t, mine) {
  if (!t || !('press_fx' in t)) return '';
  const done = mine.filter((f) => f.played && liveState(f) === 'done')
    .sort((a, b) => String(b.kickoff_at || '').localeCompare(String(a.kickoff_at || '')) || b.round - a.round || b.id - a.id)[0];
  if (!done || t.press_fx === done.id) return '';
  const gf = done.home === t.id ? done.hg : done.ag, ga = done.home === t.id ? done.ag : done.hg;
  const [q, opts] = PRESS[gf > ga ? 'w' : gf === ga ? 'd' : 'l'];
  return `<section class="card press"><h2>🎙️ Basın toplantısı</h2>
    <p class="small muted">${esc(tname(done.home))} ${done.hg} - ${done.ag} ${esc(tname(done.away))}</p>
    <p><b>${q}</b></p>
    <div class="col">${opts.map((o, i) => `<button class="btn" data-press="${i}">“${esc(o)}”</button>`).join('')}</div>
    <p class="small muted">Cevabın kadronun moralini etkiler; sözlerin haberlere düşer.</p></section>`;
}
function renderOzet() {
  const t = me();
  const nextR = S.fixtures.find((f) => !f.played)?.round;
  const mine = myFixtures();
  const live = [...S.fixtures, ...S.friendlies].filter((f) => liveState(f) === 'live');
  const next = mine.filter((f) => !f.played && liveState(f) === 'wait').slice(0, 3);
  const last = mine.filter((f) => f.played && liveState(f) === 'done').slice(-3).reverse();
  const roundFx = nextR ? S.fixtures.filter((f) => f.round === nextR) : [];
  const sq = [...S.own.values()].filter((x) => x.team_id === t?.id);
  const lineupOvr = t?.lineup?.length ? Math.round(t.lineup.reduce((a, id) => a + (pv(id)?.ovr || 0), 0) / t.lineup.length) : 0;
  const lastPlayed = S.fixtures.filter((f) => f.round === S.game.current_round && liveState(f) === 'done');
  const humans = S.teams.filter((x) => !x.is_bot);
  const readyN = humans.filter((x) => x.ready_round === nextR).length;
  const amReady = t?.ready_round === nextR;
  const active = S.game.status === 'active';
  const firstKick = roundFx.map((f) => f.kickoff_at).filter(Boolean).sort()[0];
  const opps = S.teams.filter((x) => x.id !== t?.id);
  const myFriendly = S.friendlies.filter((f) => f.home === t?.id || f.away === t?.id).slice(0, 3);
  view().innerHTML = `
  ${S.game.status === 'finished' ? `<section class="card champ">🏆 ${S.game.season || 1}. sezon bitti! ${S.standings[0] && hasLeague() ? `Lig şampiyonu: <b>${esc(S.standings[0].name)}</b>` : ''} ${S.game.cup?.champion ? `· Kupa: <b>${esc(tname(S.game.cup.champion))}</b>` : ''} ${S.game.euro?.champion ? `· Avrupa: <b>${esc(tname(S.game.euro.champion))}</b>` : ''}
    ${isOwner() ? `<button class="btn primary big" id="btnSeason" style="margin-top:10px">▶ ${(S.game.season || 1) + 1}. sezonu başlat</button><p class="small">Oyuncular bir yaş büyür; gençler gelişir, yaşlılar düşer, bazıları emekli olur. Kadrolar ve bütçeler kalır.</p>` : '<p class="small">Yeni sezonu oda sahibi başlatır.</p>'}</section>` : ''}
  ${(() => { const p = mine.find((f) => !f.played && f.ht != null); return p ? `<section class="card press"><h2>⏸ Devre arası</h2><p>${esc(tname(p.home))} <b>${p.hg ?? 0} - ${p.ag ?? 0}</b> ${esc(tname(p.away))}</p><p class="small muted">İkinci yarı senin kararını bekliyor: takım konuşması, değişiklik, taktik.</p><button class="btn primary" id="btnHT" data-f="${p.id}">Soyunma odasına git</button></section>` : ''; })()}
  ${pressCard(t, mine)}
  ${live.length ? `<section class="card live-card"><h2>🔴 Şu an canlı</h2>${live.map((f) => fxRow(f)).join('')}</section>` : ''}
  <section class="card hero">
    <div class="hero-kit">${shirtSVG(t, { num: '', size: 64 })}${crestSVG(t, 54)}</div>
    <div class="grow"><h2>${esc(t?.name)}</h2><small>${(S.game.season || 1)}. sezon · ${S.game.status === 'active' ? `${S.game.current_round}. hafta` : S.game.status === 'finished' ? 'sezon bitti' : ''}</small></div>
    <button class="btn sm" id="btnKit">Forma</button>
  </section>
  <section class="card stats4">
    <div><small>${isCareer() ? 'Transfer' : 'Bütçe'}</small><b>${money(t?.budget)}</b></div>
    <div><small>Kadro</small><b>${sq.length}</b></div>
    <div><small>İlk 11 gücü</small><b>${lineupOvr || '-'}</b></div>
    <div><small>Sıra</small><b>${hasLeague() ? (S.standings.findIndex((x) => x.team_id === t?.id) + 1 || '-') + '.' : '-'}</b></div>
  </section>
  ${(() => {
    const f = active ? nextMyFixture() : null;
    if (!f) return '';
    const opp = S.teamById.get(f.home === t.id ? f.away : f.home);
    const home = f.home === t.id;
    return `<section class="card nextmatch">
      <div class="nm-head"><small>SIRADAKİ MAÇ · ${compLabel(f)}${home ? ' · İç saha' : ' · Deplasman'}</small>
        <small>${f.kickoff_at && isAuto() ? kickTxt(f.kickoff_at) : ''}</small></div>
      <div class="nm-teams"><div>${crestSVG(t, 52)}<b>${esc(t.name)}</b>${formHTML(formOf(t.id))}</div><span class="nm-vs">VS</span><div>${crestSVG(opp, 52)}<b>${esc(opp?.name)}</b>${formHTML(formOf(opp?.id))}</div></div>
      ${assistantReport(f)}
    </section>`;
  })()}
  ${(() => {
    const b = boardInfo();
    if (!b || S.game.status === 'lobby') return '';
    return `<section class="card board"><div class="row between"><h2>Yönetim</h2><small>${b.mood}</small></div>
      <p class="small">Sezon hedefi: <b>${b.label}</b> <span class="muted">(kadro gücünde ${b.rank}./${b.n})</span>${b.played ? ` · şu an <b>${b.pos}.</b>` : ''}</p>
      <div class="conf"><i style="width:${b.conf}%" class="${b.conf >= 60 ? 'hi' : b.conf >= 35 ? 'mid' : 'lo'}"></i></div><small>Yönetim güveni %${b.conf}</small></section>`;
  })()}
  ${active && nextR && isCareer() ? `
  <section class="card"><button class="btn primary big" id="btnNext">▶ Devam et — ${nextR}. hafta (${roundFx.length} maç)</button>
    <p class="muted small center">Haftanın bütün maçları oynanır; senin maçını önemli anlarıyla izlersin.</p></section>` : ''}
  ${active && nextR && !isCareer() ? `
  <section class="card">
    <h2>${nextR}. hafta</h2>
    ${isAuto() && firstKick ? `<p>⏰ Maçlar <b>${kickTxt(firstKick)}</b>'da başlıyor, ${setting('gap_min', 10)} dk arayla. Taktiğin maç saatinde kilitlenir.</p>
      <div class="list">${roundFx.map((f) => fxRow(f)).join('')}</div>` : ''}
    ${!isAuto() ? `<p class="muted small">Hazır olanlar: <b>${readyN}/${humans.length}</b> ${humans.map((x) => `<span class="tag ${x.ready_round === nextR ? 'on' : ''}">${esc(x.short)}</span>`).join(' ')}</p>
      <button class="btn ${amReady ? '' : 'primary'} big" id="btnReady">${amReady ? '✓ Hazırsın (geri al)' : 'Hazırım'}</button>
      <p class="muted small center">Herkes hazır olunca hafta kendiliğinden oynanır.</p>` : ''}
    ${isOwner() && !isCareer() ? `<button class="btn ${isAuto() ? 'ghost' : ''}" id="btnNext">▶ ${nextR}. haftayı ${isAuto() ? 'şimdi ' : ''}oynat (${roundFx.length} maç)</button>` : ''}
  </section>` : ''}
  ${!windowOpen() && active ? `<p class="muted small center">🔒 Transfer dönemi kapalı. Sezon başında ve devre arasında açılır.</p>` : ''}
  ${lastPlayed.length ? `<section class="card"><h2>${S.game.current_round}. hafta sonuçları</h2>${lastPlayed.map((f) => fxRow(f)).join('')}</section>` : ''}
  ${next.length ? `<section class="card"><h2>Sıradaki maçların</h2>${next.map((f) => fxRow(f, { showRound: true })).join('')}</section>` : ''}
  ${last.length ? `<section class="card"><h2>Son maçların</h2>${last.map((f) => fxRow(f, { showRound: true })).join('')}</section>` : ''}
  ${active ? `<section class="card"><h2>Hazırlık maçı</h2>
    <p class="muted small">Hemen başlar, canlı izlersin. Puana ve bütçeye etkisi yok — taktik denemek için.</p>
    <div class="row"><select id="frOpp" class="grow">${opps.map((x) => `<option value="${x.id}">${esc(x.name)}${x.is_bot ? ' 🤖' : ''}</option>`).join('')}</select>
    <button class="btn primary" id="btnFriendly">Oyna</button></div>
    ${myFriendly.length ? `<div class="list">${myFriendly.map((f) => fxRow(f)).join('')}</div>` : ''}
  </section>` : ''}
  <section class="card"><h2>Haberler</h2><div id="newsList">${S.news.slice(0, 25).map(newsItem).join('') || '<p class="muted">Henüz haber yok</p>'}</div></section>
  ${S.game.status !== 'lobby' && !isCareer() ? `<section class="card"><h2>Oda</h2>
    ${isOwner() ? `
      <label>Oda sahipliğini devret<div class="row"><select id="ownSel" class="grow">${humans.filter((x) => x.owner !== S.user.id).map((x) => `<option value="${x.id}">${esc(x.name)} (${esc(S.usernames.get(x.owner) || '')})</option>`).join('') || '<option value="">Başka menajer yok</option>'}</select><button class="btn" id="btnOwn">Devret</button></div></label>
      <label>Takımı yapay zekaya devret (oyuncu bıraktıysa)<div class="row"><select id="kickSel" class="grow">${humans.filter((x) => x.owner !== S.user.id).map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('') || '<option value="">Başka menajer yok</option>'}</select><button class="btn danger" id="btnKick">Devret</button></div></label>`
    : `<button class="btn danger ghost" id="btnLeave2">Odadan ayrıl (takımın yapay zekaya geçer)</button>`}
  </section>` : ''}`;
  $('#btnNext') && ($('#btnNext').onclick = async (e) => {
    if (isAuto() && !isCareer() && !(await confirmBox('Maçlar saatini beklemeden şimdi oynansın mı?', 'Şimdi oynat'))) return;
    e.target.disabled = true;
    e.target.textContent = 'Maçlar oynanıyor…';
    try {
      const r = await rpc('play_next_round', { p_game: S.gameId });
      await reload();
      if (r.halftime) { toast('Devre arası: kararını ver', 'ok'); go(`oda/${S.gameId}/mac/${r.halftime}`); return; }
      const myf = S.fixtures.find((f) => f.round === r.round && (f.home === me()?.id || f.away === me()?.id));
      toast(`${r.round}. hafta oynandı (${r.played} maç)`, 'ok');
      if (myf) go(`oda/${S.gameId}/mac/${myf.id}`); else renderGame();
    } catch (err) { toast(errText(err), 'err'); renderGame(); }
  });
  $('#btnKit') && ($('#btnKit').onclick = kitEditor);
  $('#btnHT') && ($('#btnHT').onclick = (e) => go(`oda/${S.gameId}/mac/${e.target.dataset.f}`));
  $$('[data-press]').forEach((b) => (b.onclick = async () => {
    $$('[data-press]').forEach((x) => (x.disabled = true));
    const r = await act('answer_press', { p_game: S.gameId, p_choice: Number(b.dataset.press) }, { quiet: true });
    if (!r?.ok) $$('[data-press]').forEach((x) => (x.disabled = false)); else renderGame();
  }));
  $('#btnSeason') && ($('#btnSeason').onclick = async () => {
    if (!(await confirmBox(`${(S.game.season || 1) + 1}. sezon başlasın mı?`, 'Başlat'))) return;
    await act('new_season', { p_game: S.gameId }); renderGame();
  });
  $('#btnReady') && ($('#btnReady').onclick = async () => { await act('set_ready', { p_game: S.gameId, p_ready: !amReady }); renderGame(); });
  $('#btnFriendly') && ($('#btnFriendly').onclick = async (e) => {
    e.target.disabled = true;
    try {
      const r = await rpc('friendly_match', { p_game: S.gameId, p_opponent: $('#frOpp').value });
      if (!r.ok) { toast(r.msg, 'err'); e.target.disabled = false; return; }
      await reload();
      go(`oda/${S.gameId}/mac/${r.fixture}`);
    } catch (err) { toast(errText(err), 'err'); e.target.disabled = false; }
  });
  $('#btnOwn') && ($('#btnOwn').onclick = async () => {
    const id = $('#ownSel').value; if (!id) return;
    if (!(await confirmBox(`Oda sahipliği ${tname(id)} menajerine devredilsin mi? Geri alamazsın.`, 'Devret'))) return;
    await act('transfer_ownership', { p_game: S.gameId, p_team: id }); renderGame();
  });
  $('#btnKick') && ($('#btnKick').onclick = async () => {
    const id = $('#kickSel').value; if (!id) return;
    if (!(await confirmBox(`${tname(id)} artık yapay zeka tarafından yönetilsin mi? Menajeri odadan çıkar.`, 'Devret'))) return;
    await act('kick_team', { p_game: S.gameId, p_team: id }); renderGame();
  });
  $('#btnLeave2') && ($('#btnLeave2').onclick = async () => {
    if (!(await confirmBox('Odadan ayrılırsan takımını yapay zeka yönetecek. Emin misin?', 'Ayrıl'))) return;
    try { await rpc('leave_game', { p_game: S.gameId }); go(''); } catch (err) { toast(errText(err), 'err'); }
  });
}

// ---------------- kadro + taktik ----------------
function renderKadro() {
  const sub = S.sub.kadro || 'kadro';
  view().innerHTML = `<div class="seg wide" id="kSeg"><button data-s="kadro" class="${sub === 'kadro' ? 'on' : ''}">Kadro</button><button data-s="taktik" class="${sub === 'taktik' ? 'on' : ''}">Taktik</button><button data-s="antrenman" class="${sub === 'antrenman' ? 'on' : ''}">Antrenman</button><button data-s="finans" class="${sub === 'finans' ? 'on' : ''}">Finans</button></div><div id="kBody"></div>`;
  $$('#kSeg button').forEach((b) => (b.onclick = () => { S.sub.kadro = b.dataset.s; renderKadro(); }));
  if (sub === 'taktik') return renderTaktik();
  if (sub === 'finans') return renderFinans();
  if (sub === 'antrenman') return renderAntrenman();
  const t = me();
  const sq = [...S.own.values()].filter((x) => x.team_id === t.id).map((x) => pv(x.player_id)).filter(Boolean);
  const order = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
  const wage = wageBill(t.id);
  sq.sort((a, b) => order[a.grp] - order[b.grp] || b.ovr - a.ovr);
  const val = sq.reduce((a, p) => a + Number(p.sq.value), 0);
  $('#kBody').innerHTML = `
  <section class="card">
    <div class="row between"><h2>${sq.length} oyuncu</h2><div class="seg sm" id="kView"><button data-v="list" class="${S.sub.kview !== 'cards' ? 'on' : ''}">Liste</button><button data-v="cards" class="${S.sub.kview === 'cards' ? 'on' : ''}">Kartlar</button></div></div>
    <small class="muted">Değer ${money(val)} · haftalık maaş ${money(wage)} · sınır ${S.game.settings.min_squad}-${S.game.settings.max_squad}</small>
    ${['GK', 'DEF', 'MID', 'FWD'].map((g) => {
      const ps = sq.filter((p) => p.grp === g);
      if (!ps.length) return '';
      if (S.sub.kview === 'cards') return `<h3>${GROUPS[g]}</h3><div class="cardgrid">${ps.map((p) => `<div class="prow cardcell ${unavailable(p.sq) ? 'unav' : ''}" data-pid="${p.id}">${fcCard(p, t)}<div class="cc-foot">${statusBadges(p.sq)}${fitBar(p.sq.fitness)}${t.lineup.includes(p.id) ? '<span class="tag on">11</span>' : ''}</div></div>`).join('')}</div>`;
      return `<h3>${GROUPS[g]}</h3><div class="list">${ps.map((p) => playerRow(p, `${t.lineup.includes(p.id) ? '<span class="tag on">11</span>' : ''}<span class="vw"><b>${money(p.sq.value)}</b><small>${money(p.sq.wage || 0)}/hf</small></span>`, { mine: true })).join('')}</div>`;
    }).join('')}
  </section>`;
  $$('#kBody .prow').forEach((r) => (r.onclick = () => playerModal(Number(r.dataset.pid))));
  $$('#kView button').forEach((b) => (b.onclick = () => { S.sub.kview = b.dataset.v; renderKadro(); }));
}
// ---------------- antrenman ----------------
const TRAIN_FOCUS = [
  ['genel', 'Genel', 'Herkes biraz gelişir (×1.1).', null],
  ['hucum', 'Hücum', 'Forvetler hızlı gelişir (×1.4), diğerleri yavaş.', 'FWD'],
  ['ortasaha', 'Orta saha', 'Orta sahalar hızlı gelişir (×1.4), diğerleri yavaş.', 'MID'],
  ['savunma', 'Savunma', 'Defans ve kaleciler hızlı gelişir (×1.4), diğerleri yavaş.', 'DEF'],
  ['fizik', 'Fizik', 'Daha çok dinlenme (+4 kondisyon), antrenman sakatlığı yarıya iner; gelişim yavaş.', null],
];
const TRAIN_INT = [
  ['Hafif', 'Kondisyon +26/hafta, sakatlık yok, moral yükselir; gelişim ×0.6.'],
  ['Normal', 'Kondisyon +20/hafta, %4 sakatlık ihtimali; gelişim ×1.'],
  ['Yoğun', 'Kondisyon +14/hafta, %9 sakatlık ihtimali, moral düşer; gelişim ×1.4.'],
];
const trainBase = (age) => (age <= 20 ? 4 : age <= 23 ? 3 : age <= 26 ? 1.5 : 0);
function renderAntrenman() {
  const t = me();
  const has = t && Object.prototype.hasOwnProperty.call(t, 'training');
  const tr = { focus: 'genel', int: 1, ...(t?.training || {}) };
  const fo = TRAIN_FOCUS.find((x) => x[0] === tr.focus) || TRAIN_FOCUS[0];
  const sq = [...S.own.values()].filter((x) => x.team_id === t.id).map((x) => pv(x.player_id)).filter(Boolean);
  const fit = sq.length ? Math.round(sq.reduce((a, p) => a + (p.sq.fitness ?? 100), 0) / sq.length) : 0;
  const weekly = (p) => {
    if (p.ovr >= p.pot || p.sq.injury > 0) return 0;
    const fm = tr.focus === 'genel' ? 1.1 : fo[3] && (p.grp === fo[3] || (fo[3] === 'DEF' && p.grp === 'GK')) ? 1.4 : 0.9;
    return Math.round(trainBase(p.age) * [0.6, 1, 1.4][tr.int] * fm);
  };
  const young = sq.filter((p) => p.ovr < p.pot && trainBase(p.age) > 0).sort((a, b) => (b.sq.xp || 0) - (a.sq.xp || 0) || a.age - b.age);
  $('#kBody').innerHTML = `
  <section class="card">
    <h2>Haftalık program</h2>
    ${has ? '' : '<p class="warn small">Antrenman sunucu güncellemesinden sonra açılacak.</p>'}
    <small class="ihead">Odak</small>
    <div class="seg wide tr" id="trFocus">${TRAIN_FOCUS.map(([k, l]) => `<button type="button" data-v="${k}" class="${tr.focus === k ? 'on' : ''}" ${has ? '' : 'disabled'}>${l}</button>`).join('')}</div>
    <p class="muted small">${esc(fo[2])}</p>
    <small class="ihead">Yoğunluk</small>
    <div class="seg wide tr" id="trInt">${TRAIN_INT.map(([l], i) => `<button type="button" data-v="${i}" class="${tr.int === i ? 'on' : ''}" ${has ? '' : 'disabled'}>${l}</button>`).join('')}</div>
    <p class="muted small">${esc(TRAIN_INT[tr.int][1])}</p>
    <p class="small">Takımın ortalama kondisyonu: <b>%${fit}</b> ${fitBar(fit)}</p>
    <p class="muted small">Antrenman her hafta sonunda işler. 26 yaş ve altı oyuncular gelişim puanı toplar (genç olan daha hızlı); maçta oynayan gençler ek puan alır (23 yaş ve altı +3). 100 puanda <b>+1 güç</b> ve değer %6 artar. Potansiyele ulaşan ya da sakat oyuncu gelişmez. Kadronun en iyi 14'ünden maç bulamayanların morali düşer.</p>
  </section>
  <section class="card"><h2>Gelişim</h2>
    ${young.length ? `<div class="list">${young.map((p) => `<div class="prow" data-pid="${p.id}">${ovrBadge(p.ovr)}<div class="pmain"><b>${esc(p.name)}</b><small>${p.age} yaş · ${GROUPS[p.grp]} · potansiyel ${p.pot}</small>
      <span class="xpbar"><i style="width:${Math.min(100, p.sq.xp || 0)}%"></i></span></div><div class="pside"><b>${p.sq.xp || 0}/100</b><small>+${weekly(p)}/hf</small></div></div>`).join('')}</div>`
      : '<p class="muted">Gelişebilecek genç oyuncun yok.</p>'}
  </section>`;
  const save = async (focus, int) => {
    const r = await act('set_training', { p_game: S.gameId, p_focus: focus, p_intensity: int }, { quiet: true });
    if (r?.ok) { t.training = { focus, int }; renderKadro(); }
  };
  $$('#trFocus button').forEach((b) => (b.onclick = () => save(b.dataset.v, tr.int)));
  $$('#trInt button').forEach((b) => (b.onclick = () => save(tr.focus, Number(b.dataset.v))));
  $$('#kBody .prow').forEach((r) => (r.onclick = () => playerModal(Number(r.dataset.pid))));
}
// ---------------- finans (FM tarzı) ----------------
const wageOf = (v) => Math.max(2000, Math.round((Number(v) * 0.0022) / 1000) * 1000);
function wageBill(teamId) { return [...S.own.values()].filter((x) => x.team_id === teamId).reduce((a, x) => a + Number(x.wage || wageOf(x.value)), 0); }
function renderFinans() {
  const t = me();
  const fin = t.fin || {};
  const bill = wageBill(t.id);
  const wb = Number(t.wage_budget || 0);
  const inc = Number(t.weekly_income || 0);
  const ticket = Number(t.ticket || setting('ticket_income', 1000000));
  const rows = (arr) => arr.map(([k, l, sign]) => `<div class="frow"><span>${l}</span><b class="${sign > 0 ? 'pos' : 'neg'}">${sign > 0 ? '+' : '−'}${money(fin[k] || 0)}</b></div>`).join('');
  const inn = ['bilet', 'sponsor', 'odul', 'satis'].reduce((a, k) => a + Number(fin[k] || 0), 0);
  const out = ['maas', 'transfer', 'imza'].reduce((a, k) => a + Number(fin[k] || 0), 0);
  const sq = [...S.own.values()].filter((x) => x.team_id === t.id).map((x) => pv(x.player_id)).filter(Boolean).sort((a, b) => (b.sq.wage || 0) - (a.sq.wage || 0));
  $('#kBody').innerHTML = `
  <section class="card finhero">
    <div><small>TRANSFER BÜTÇESİ</small><b>${money(t.budget)}</b></div>
    <div><small>KULÜP İTİBARI</small>${starsHTML(t.reputation || (() => { const r = leagueTeams().map((x) => ({ id: x.id, p: teamPower(x.id) })).sort((a, b) => b.p - a.p); return leagueStarsN(r.findIndex((x) => x.id === t.id) + 1, r.length); })())}</div>
  </section>
  <section class="card">
    <h2>Maaşlar</h2>
    <div class="row between small"><span>Haftalık maaş gideri</span><b>${money(bill)}</b></div>
    ${wb ? `<div class="conf"><i style="width:${Math.min(100, (bill / wb) * 100)}%" class="${bill / wb < 0.9 ? 'hi' : bill / wb <= 1 ? 'mid' : 'lo'}"></i></div>
      <div class="row between small"><span class="muted">Maaş bütçesi ${money(wb)}/hafta</span><span class="muted">Boş: <b>${money(Math.max(0, wb - bill))}</b></span></div>
      <p class="muted small">Yeni oyuncu alırken maaşı boş maaş bütçesine sığmalı. Oyuncu satmak yer açar.</p>` : '<p class="muted small">Bu odada maaş bütçesi sınırı yok.</p>'}
  </section>
  <section class="card">
    <h2>Haftalık gelir</h2>
    <div class="frow"><span>Sponsor + yayın geliri</span><b class="pos">+${money(inc)}</b></div>
    <div class="frow"><span>İç saha bilet geliri (maç başı)</span><b class="pos">+${money(ticket)}</b></div>
    <div class="frow"><span>Galibiyet / beraberlik primi</span><b class="pos">+${money(setting('win_bonus', 3000000))} / +${money(setting('draw_bonus', 1500000))}</b></div>
    <div class="frow"><span>Maaşlar</span><b class="neg">−${money(bill)}</b></div>
  </section>
  <section class="card">
    <h2>Bu sezon</h2>
    <h3>Gelir</h3>${rows([['bilet', 'Bilet', 1], ['sponsor', 'Sponsor ve yayın', 1], ['odul', 'Maç ve sezon ödülleri', 1], ['satis', 'Oyuncu satışları', 1]])}
    <h3>Gider</h3>${rows([['maas', 'Maaşlar', -1], ['transfer', 'Transferler', -1], ['imza', 'İmza paraları', -1]])}
    <div class="frow total"><span>Net</span><b class="${inn - out >= 0 ? 'pos' : 'neg'}">${inn - out >= 0 ? '+' : '−'}${money(Math.abs(inn - out))}</b></div>
  </section>
  <section class="card"><h2>En yüksek maaşlar</h2><div class="list">${sq.slice(0, 8).map((p) => playerRow(p, `<span class="vw"><b>${money(p.sq.wage || wageOf(p.sq.value))}</b><small>/hafta</small></span>`, { mine: true })).join('')}</div></section>`;
  $$('#kBody .prow').forEach((r) => (r.onclick = () => playerModal(Number(r.dataset.pid))));
}

function playerRow(p, side = '', { mine } = {}) {
  const d = p.ovr - (p.base ?? p.ovr);
  return `<div class="prow ${mine && unavailable(p.sq) ? 'unav' : ''}" data-pid="${p.id}">${mine && p.sq?.shirt ? `<span class="shno">${p.sq.shirt}</span>` : ''}${ovrBadge(p.ovr)}${d ? `<small class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</small>` : ''}${grpBadge(p.grp)}
    <div class="pmain"><b>${esc(p.name)} ${mine ? statusBadges(p.sq) : ''}</b><small>${mine && p.sq ? `${moraleIcon(p.sq)} ${fitBar(p.sq.fitness)} form ${Number(p.sq.form).toFixed(1)}${p.st ? ` · ${p.st.apps} maç ${p.st.goals} gol ${p.st.rating}` : ''}` : `${esc(p.positions)} · ${p.age} · ${esc(p.club)} (${esc(p.lg)})`}</small></div>
    <div class="pside">${side}</div></div>`;
}
function fcCard(p, owner) {
  const tier = p.ovr >= 85 ? 'elite' : p.ovr >= 75 ? 'gold' : p.ovr >= 65 ? 'silver' : 'bronze';
  const L = p.grp === 'GK' ? ['UÇU', 'TUT', 'VUR', 'REF', 'YER', 'HIZ'] : ['HIZ', 'ŞUT', 'PAS', 'DRİ', 'DEF', 'FİZ'];
  const pos = (p.positions || '').split(',')[0];
  return `<div class="fccard ${tier}">
    <div class="fc-top"><div class="fc-ovr">${p.ovr}</div><div class="fc-pos">${esc(pos)}</div>
      <div class="fc-club">${owner ? crestSVG(owner, 30) : `<span class="fc-ai">${esc((p.club || '').slice(0, 14))}</span>`}</div>
      ${p.sq?.shirt ? `<div class="fc-no">#${p.sq.shirt}</div>` : ''}</div>
    <div class="fc-name">${esc(p.name)}</div>
    <div class="fc-sub">${esc(p.nat)} · ${p.age} yaş</div>
    <div class="fc-stats">${['pac', 'sho', 'pas', 'dri', 'dfn', 'phy'].map((k, i) => `<div><b>${p[k]}</b><span>${L[i]}</span></div>`).join('')}</div>
  </div>`;
}
function attrBars(p) {
  const L = p.grp === 'GK' ? ['Uçuş', 'Top tutma', 'Vuruş', 'Refleks', 'Yer tutma', 'Hız'] : ['Hız', 'Şut', 'Pas', 'Dripling', 'Defans', 'Fizik'];
  return `<div class="attrs">${['pac', 'sho', 'pas', 'dri', 'dfn', 'phy'].map((k, i) =>
    `<div><small>${L[i]}</small><div class="bar"><i style="width:${p[k]}%" class="${p[k] >= 80 ? 'hi' : p[k] >= 65 ? 'mid' : 'lo'}"></i></div><b>${p[k]}</b></div>`).join('')}</div>`;
}

function renderTaktik() {
  const t = me();
  if (!S.draft || S.draft.team !== t.id) S.draft = { team: t.id, formation: t.formation, mentality: t.mentality, lineup: [...t.lineup] };
  const d = S.draft;
  const sl = slots(d.formation);
  const pos = slotPositions(d.formation);
  const sqIds = new Set([...S.own.values()].filter((x) => x.team_id === t.id).map((x) => x.player_id));
  const lu = sl.map((_, i) => (sqIds.has(d.lineup[i]) ? d.lineup[i] : null));
  const avg = Math.round(lu.filter(Boolean).reduce((a, id) => a + pv(id).ovr, 0) / Math.max(1, lu.filter(Boolean).length));
  const bad = lu.filter((id) => id && unavailable(S.own.get(id)));
  const changed = JSON.stringify([d.formation, d.mentality, lu]) !== JSON.stringify([t.formation, t.mentality, t.lineup]);
  $('#kBody').innerHTML = `
  <section class="card taktik"><div class="tak-l">
    <div class="row2">
      <label>Diziliş<select id="tForm">${FORMATIONS.map((f) => `<option ${f === d.formation ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
      <label>Ortalama<b class="big-num">${avg || '-'}</b></label>
    </div>
    <label>Oyun anlayışı: <b id="mLbl">${MENTALITY[d.mentality]}</b>
      <input type="range" id="tMent" min="-2" max="2" step="1" value="${d.mentality}"></label>
    ${instrHTML(t)}
    </div><div class="tak-r">
    <div class="pitch" id="pitch">
      ${sl.map((g, i) => {
        const p = lu[i] ? pv(lu[i]) : null;
        const off = p && p.grp !== g;
        const un = p && unavailable(p.sq);
        return `<button class="slot ${off ? 'off' : ''} ${p ? '' : 'empty'} ${un ? 'unav' : ''}" data-i="${i}" style="left:${pos[i].x * 100}%;top:${pos[i].y * 100}%">
          ${p ? `${dotHTML(i === 0 ? { c1: '#facc15', c2: '#1f2937', pattern: 'plain' } : kitOf(t), p.sq?.shirt ?? i + 1, 36)}<span class="nm">${esc(p.name)}</span><span class="ochip ${off || un ? 'warn' : ''}">${un ? (p.sq.injury > 0 ? '🚑' : '🟥') : p.ovr}</span>${fitBar(p.sq?.fitness ?? 100)}` : `<span class="nm">${g}</span>`}</button>`;
      }).join('')}
    </div>
    ${bad.length ? `<p class="warn small">⚠️ İlk 11'de oynayamayacak oyuncu var (${bad.map((id) => esc(pv(id).name)).join(', ')}). Değiştirmezsen maçta yerine kenardan en iyisi oynar.</p>` : ''}
    <p class="muted small">Oyuncuya dokunup değiştir. Kırmızı: mevkisi dışında (%15 güç kaybı, kalecide %50). Çubuk: kondisyon — yorgun oyuncu daha zayıf oynar; haftalık dinlenme antrenman yoğunluğuna bağlı.</p>
    <div class="row">
      <button class="btn" id="tAuto">En iyi 11</button>
      <button class="btn primary grow" id="tSave" ${changed ? '' : 'disabled'}>${changed ? 'Taktiği kaydet' : 'Kaydedildi'}</button>
    </div>
  </div></section>`;
  $('#tForm').onchange = (e) => { d.formation = e.target.value; renderTaktik(); };
  bindInstr(t);
  $('#tMent').oninput = (e) => { d.mentality = Number(e.target.value); $('#mLbl').textContent = MENTALITY[d.mentality]; $('#tSave').disabled = false; $('#tSave').textContent = 'Taktiği kaydet'; };
  $$('#pitch .slot').forEach((b) => (b.onclick = () => pickForSlot(Number(b.dataset.i), sl, lu)));
  $('#tAuto').onclick = async () => {
    const r = await act('set_tactics', { p_game: S.gameId, p_formation: d.formation, p_mentality: d.mentality, p_lineup: [] }, { quiet: true });
    if (r.ok) { S.draft = null; toast('En iyi 11 dizildi', 'ok'); renderKadro(); }
  };
  $('#tSave').onclick = async () => {
    if (lu.some((x) => !x)) return toast('11 oyuncunun hepsini seç', 'err');
    if (bad.length) return toast('Sakat ya da cezalı oyuncuyu ilk 11\'den çıkar', 'err');
    const r = await act('set_tactics', { p_game: S.gameId, p_formation: d.formation, p_mentality: d.mentality, p_lineup: lu }, { quiet: true });
    if (r.ok) { S.draft = null; toast('Taktik kaydedildi', 'ok'); renderKadro(); }
  };
}
// takım talimatları: pres / tempo / genişlik (0-1-2), değişince hemen kaydedilir
const INSTR = [
  ['press', 'Pres', ['Düşük', 'Normal', 'Yüksek']],
  ['tempo', 'Tempo', ['Yavaş', 'Normal', 'Hızlı']],
  ['width', 'Genişlik', ['Dar', 'Normal', 'Geniş']],
];
const INSTR_HINT = {
  press: ['Geride bekler: savunma sağlam, orta sahada top kazanmak zor.', '', 'Önde basar: orta saha +%3, savunma arkası açık (−%2.5); daha çok kart ve yorgunluk.'],
  tempo: ['Sabırlı oyun: topa daha çok sahip olur, hücum yavaş (−%3).', '', 'Seri pas, direkt oyun: hücum +%3, topa sahip olma azalır.'],
  width: ['Ortadan oynar: savunma derli toplu, kanat ortası az.', '', 'Kanatları kullanır: daha çok orta, hücum +%1.5, savunma −%1.'],
};
function instrHTML(t) {
  const has = t && Object.prototype.hasOwnProperty.call(t, 'instr');
  const ins = { press: 1, tempo: 1, width: 1, ...(t?.instr || {}) };
  const hints = INSTR.map(([k]) => INSTR_HINT[k][ins[k]]).filter(Boolean);
  return `<div class="instr" id="instr">
    <small class="ihead">Takım talimatları</small>
    ${INSTR.map(([k, l, o]) => `<div class="irow"><span>${l}</span><div class="seg sm" data-k="${k}">${o.map((x, i) => `<button type="button" data-v="${i}" class="${ins[k] === i ? 'on' : ''}" ${has ? '' : 'disabled'}>${x}</button>`).join('')}</div></div>`).join('')}
    <p class="muted small">${has ? (hints.length ? hints.map(esc).join(' ') : 'Hepsi normal: dengeli oyun.') : 'Talimatlar sunucu güncellemesinden sonra açılacak.'}</p>
  </div>`;
}
function bindInstr(t) {
  $$('#instr .seg button').forEach((b) => (b.onclick = async () => {
    const ins = { press: 1, tempo: 1, width: 1, ...(t.instr || {}) };
    ins[b.parentElement.dataset.k] = Number(b.dataset.v);
    const r = await act('set_instr', { p_game: S.gameId, p_press: ins.press, p_tempo: ins.tempo, p_width: ins.width }, { quiet: true });
    if (r?.ok) { t.instr = ins; renderKadro(); }
  }));
}
function pickForSlot(i, sl, lu) {
  const t = me();
  const g = sl[i];
  const sq = [...S.own.values()].filter((x) => x.team_id === t.id).map((x) => pv(x.player_id)).filter(Boolean);
  sq.sort((a, b) => unavailable(a.sq) - unavailable(b.sq) || (b.grp === g) - (a.grp === g) || b.ovr - a.ovr);
  modal(`<h2>${GROUPS[g]} seç</h2><div class="list scroll">${sq.map((p) => {
    const at = lu.indexOf(p.id);
    return playerRow(p, at >= 0 ? `<span class="tag on">${at === i ? 'burada' : 'ilk 11'}</span>` : '', { mine: true });
  }).join('')}</div><button class="btn ghost" data-close>Kapat</button>`, {
    onMount: (box, close) => {
      $$('.prow', box).forEach((r) => (r.onclick = () => {
        if (r.classList.contains('unav')) return toast('Bu oyuncu sakat ya da cezalı', 'err');
        const pid = Number(r.dataset.pid);
        const d = S.draft;
        const cur = sl.map((_, k) => lu[k]);
        const from = cur.indexOf(pid);
        if (from >= 0) cur[from] = cur[i]; // yer değiştir
        cur[i] = pid;
        d.lineup = cur;
        close();
        renderTaktik();
      }));
    },
  });
}

// ---------------- oyuncu penceresi + teklif ----------------
function activeOffersFor(pid) { return S.offers.filter((o) => o.player_id === pid && o.status === 'active'); }
function reserved(exceptPid) {
  return S.offers.filter((o) => o.bidder === me()?.id && o.status === 'active' && o.player_id !== exceptPid).reduce((a, o) => a + Number(o.amount), 0);
}
// gözlemci raporu: başka takımın / YZ kulübünün oyuncusu kadroma ne katar
function scoutReport(p) {
  const t = me();
  if (!t || S.game?.status === 'lobby') return '';
  const same = [...S.own.values()].filter((x) => x.team_id === t.id).map((x) => pv(x.player_id)).filter((x) => x && x.grp === p?.grp).sort((a, b) => b.ovr - a.ovr);
  const starters = same.filter((x) => (t.lineup || []).includes(x.id));
  const weakest = starters.length ? starters[starters.length - 1] : null;
  const notes = [];
  let stars;
  if (!same.length || p.ovr > same[0].ovr) { stars = 5; notes.push(same.length ? `${GROUPS[p.grp]} hattının en iyisi olur (şu anki en iyi: ${same[0].name} ${same[0].ovr}).` : `Bu mevkide hiç oyuncun yok.`); }
  else if (weakest && p.ovr > weakest.ovr) { stars = 4; notes.push(`İlk 11'e girer: ${weakest.name} (${weakest.ovr}) yerine.`); }
  else if (weakest && p.ovr >= weakest.ovr - 3) { stars = 3; notes.push('Rotasyon oyuncusu: ilk 11\'e yakın, yorgunluk ve sakatlıkta işe yarar.'); }
  else { stars = 2; notes.push(`Kadrona katkısı az: ${GROUPS[p.grp]} hattında daha iyi ${same.filter((x) => x.ovr >= p.ovr).length} oyuncun var.`); }
  if (p.age <= 23 && p.pot - p.ovr >= 6) { stars = Math.min(5, stars + 1); notes.push(`Gelecek vadediyor: ${p.age} yaşında, potansiyeli ${p.pot}. Antrenman ve maç süresiyle gelişir.`); }
  else if (p.ovr >= p.pot) notes.push('Gelişimi tamamlanmış.');
  if (p.age >= 32) { stars = Math.max(1, stars - 1); notes.push(`${p.age} yaşında: gelecek sezon düşüş ve emeklilik riski, değeri hızla erir.`); }
  if (same.length >= 4 && stars <= 3) notes.push(`Bu mevkide zaten ${same.length} oyuncun var.`);
  return `<div class="scout"><div class="row between"><b>🔎 Gözlemci raporu</b>${starsHTML(stars, 'mini')}</div><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>`;
}
async function playerModal(pid) {
  await fetchPlayers([pid]);
  const p = pv(pid);
  const owned = S.own.get(pid);
  const st = p.st;
  const mine = owned && owned.team_id === me()?.id;
  const offers = activeOffersFor(pid);
  const auction = !owned ? offers.filter((o) => !o.seller).sort((a, b) => b.amount - a.amount)[0] : null;
  const myOffer = offers.find((o) => o.bidder === me()?.id && o.seller);
  const value = owned ? Number(owned.value) : Number(p.val);
  const avail = Number(me()?.budget || 0) - reserved(pid);
  const minNext = auction ? Math.ceil((auction.amount * 1.05) / 100000) * 100000 : value;
  const owner = owned ? S.teamById.get(owned.team_id) : null;
  const active = S.game.status === 'active' && windowOpen();
  modal(`
    ${fcCard(p, owner)}
    <p class="muted small center">${esc(p.full_name || '')}</p>
    <div class="pinfo">
      <span>${grpBadge(p.grp)} ${esc(p.positions)}</span><span>${p.age} yaş · pot. ${p.pot}${p.ovr !== p.base ? ` · FC26: ${p.base}` : ''}</span><span>${esc(p.nat)}</span>
      <span>${owner ? `${teamDot(owner)} ${esc(owner.name)}` : `🤖 ${esc(p.club)} (${LEAGUES[p.lg] || p.lg})`}</span>
      <span>Değer: <b>${money(value)}</b>${owned?.bought_for > 0 ? ` · alış ${money(owned.bought_for)}` : ''}</span>
      <span>Maaş: <b>${money(owned?.wage || wageOf(value))}</b>/hafta${owned ? '' : ' (talep)'}</span>
    </div>
    ${mine ? '' : scoutReport(p)}
    ${owned ? `<div class="pinfo">${statusBadges(owned)}<span>Kondisyon ${fitBar(owned.fitness)} %${owned.fitness}</span><span>Form <b>${Number(owned.form).toFixed(1)}</b></span>${owned.yellows ? `<span>🟨 ${owned.yellows}</span>` : ''}
      ${owned.morale !== undefined ? `<span>Moral ${MORALE(owned.morale)[0]} <b>${MORALE(owned.morale)[1]}</b></span>` : ''}${owned.contract !== undefined ? `<span>Sözleşme: <b>${contractTxt(owned.contract)}</b></span>` : ''}</div>` : ''}
    ${mine && owned.loan_from ? `<p class="small center">🤝 <b>${esc(owned.loan_from)}</b> kulübünden sezon sonuna kadar kiralık. Satılamaz; sezon bitince kulübüne döner.</p>` : ''}
    ${mine && !owned.loan_from && owned.contract !== undefined && S.game.status !== 'lobby' ? `<div class="renew">
      <label>Sözleşme uzat <select id="rnY">${[1, 2, 3, 4].map((y) => `<option value="${y}">${y} yıl</option>`).join('')}</select></label>
      <small class="muted" id="rnCost"></small>
      <button class="btn sm primary" id="rnGo" type="button">Uzat</button></div>` : ''}
    ${st ? `<div class="pstat"><div><b>${st.apps}</b><small>Maç</small></div><div><b>${st.goals}</b><small>Gol</small></div><div><b>${st.assists}</b><small>Asist</small></div><div><b>${st.rating}</b><small>Ort. puan</small></div><div><b>${st.motm}</b><small>Maçın adamı</small></div></div>` : ''}
    ${auction ? `<div class="auction ${auction.bidder === me()?.id ? 'lead' : ''}">🔨 Açık artırma: <b>${money(auction.amount)}</b> · ${esc(tname(auction.bidder))} · <span data-exp="${auction.expires_at}">${timeLeft(auction.expires_at)}</span></div>` : ''}
    ${mine ? `
      ${offers.filter((o) => o.seller === me().id).map((o) => `<div class="offer-in">💌 ${esc(bidderName(o))}: <b>${money(o.amount)}</b>
        <button class="btn sm primary" data-acc="${o.id}">Kabul</button><button class="btn sm ghost" data-rej="${o.id}">Ret</button></div>`).join('')}
      ${active && !owned.loan_from ? `<button class="btn danger ghost" id="pSell">Yapay zekaya sat: ${money(Math.floor(value * (S.game.settings.ai_sell_ratio || 0.75)))}</button>` : ''}`
    : active ? `
      <form id="bidForm" class="form" data-live>
        ${me()?.wage_budget > 0 ? `<p class="small ${wageBill(me().id) + wageOf(value) > me().wage_budget ? 'warn' : 'muted'}">Maaş talebi ~${money(wageOf(value))}/hafta · boş maaş bütçen ${money(Math.max(0, me().wage_budget - wageBill(me().id)))}/hafta</p>` : ''}
        <label>Teklifin <small class="muted">(kullanılabilir bütçe ${money(avail)})</small>
          <input name="amt" inputmode="decimal" value="${money(Math.max(minNext, myOffer ? Number(myOffer.amount) + 100000 : 0)).replace('€', '')}" autocomplete="off"></label>
        <div class="row wrap quick">
          <button type="button" class="btn sm" data-q="${minNext}">${auction ? 'En az' : 'Değeri'} ${money(minNext)}</button>
          <button type="button" class="btn sm" data-q="${Math.ceil((minNext * 1.1) / 100000) * 100000}">+%10</button>
          <button type="button" class="btn sm" data-q="${Math.ceil((minNext * 1.25) / 100000) * 100000}">+%25</button>
        </div>
        <p class="muted small" id="bidHint">${owner?.is_bot ? `${esc(owner.name)} yapay zeka takımı; teklifi hemen kabul ya da reddeder.` : owner ? `Karar ${esc(owner.name)} menajerinde. Değerin altına teklif yapılamaz.` : auction ? 'Geçmek için en az %5 fazlası gerekir. Son dakikadaki teklif süreyi uzatır.' : `${esc(p.club)} istediği fiyatın altını kabul etmez; kabul ederse ${S.game.settings.bid_minutes} dk açık artırma başlar.`}</p>
        ${myOffer ? `<p class="small">Mevcut teklifin: <b>${money(myOffer.amount)}</b></p>` : ''}
        <button class="btn primary big" type="submit">Teklif ver</button>
      </form>
      ${'loan_from' in (S.own.values().next().value || {}) && (!owner || (owner.is_bot && !owned?.loan_from)) && !auction && !myOffer ? (() => {
        const fee = Math.max(100000, Math.round((value * 0.1) / 100000) * 100000);
        const starter = owner && (owner.lineup || []).includes(pid);
        return `<div class="loanbox"><b>🤝 Kiralık al</b><p class="small muted">Sezon sonuna kadar. Bedel ${money(fee)} (değerin %10'u), maaşı ~${money(wageOf(value))}/hafta sen ödersin; sezon bitince kulübüne döner. En fazla 4 kiralık.</p>
          ${starter ? `<p class="small warn">${esc(owner.name)} ilk 11 oyuncusunu kiralık vermez.</p>` : `<button class="btn" type="button" id="pLoan">Kirala: ${money(fee)}</button>`}</div>`;
      })() : ''}` : ''}
    ${S.game.status === 'active' && !windowOpen() ? '<p class="muted small center">🔒 Transfer dönemi kapalı</p>' : ''}
    <button class="btn ghost" data-close>Kapat</button>`, {
    onMount: (box, close) => {
      const rnY = box.querySelector('#rnY');
      if (rnY) {
        const upd = () => { const c = renewCost(owned, Number(rnY.value)); box.querySelector('#rnCost').textContent = `Yeni maaş ${money(c.nw)}/hafta · imza parası ${money(c.bonus)}${owned.morale < 35 ? ' · morali düşük, reddedebilir' : ''}`; };
        rnY.onchange = upd; upd();
        box.querySelector('#rnGo').onclick = async () => { const r = await act('renew_contract', { p_game: S.gameId, p_player: pid, p_years: Number(rnY.value) }, { quiet: true }); if (r?.ok) close(); };
      }
      $$('[data-q]', box).forEach((b) => (b.onclick = () => (box.querySelector('[name=amt]').value = money(Number(b.dataset.q)).replace('€', ''))));
      const form = box.querySelector('#bidForm');
      if (form) form.onsubmit = async (e) => {
        e.preventDefault();
        const amt = parseMoney(form.amt.value);
        if (!amt || amt <= 0) return toast('Tutarı yaz: ör. 25M, 800K', 'err');
        const btn = form.querySelector('[type=submit]');
        btn.disabled = true;
        try {
          const r = await rpc('place_bid', { p_game: S.gameId, p_player: pid, p_amount: amt });
          if (r.ok) { toast(r.msg, 'ok'); close(); await reload(); refresh(); }
          else {
            $('#bidHint', box).innerHTML = `<b class="warn">${esc(r.msg)}</b>`;
            if (r.ask) form.amt.value = money(r.ask).replace('€', '');
          }
        } catch (err) { toast(errText(err), 'err'); } finally { btn.disabled = false; }
      };
      const loan = box.querySelector('#pLoan');
      if (loan) loan.onclick = async () => {
        loan.disabled = true;
        const r = await act('loan_player', { p_game: S.gameId, p_player: pid });
        if (r?.ok) close(); else loan.disabled = false;
      };
      const sell = box.querySelector('#pSell');
      if (sell) sell.onclick = async () => {
        if (!(await confirmBox(`${p.name} yapay zeka kulübüne satılsın mı?`, 'Sat'))) return;
        await act('sell_to_ai', { p_game: S.gameId, p_player: pid });
        renderGame();
      };
      $$('[data-acc]', box).forEach((b) => (b.onclick = async () => { close(); await act('respond_offer', { p_offer: Number(b.dataset.acc), p_accept: true }); renderGame(); }));
      $$('[data-rej]', box).forEach((b) => (b.onclick = async () => { close(); await act('respond_offer', { p_offer: Number(b.dataset.rej), p_accept: false }); renderGame(); }));
    },
  });
}

// ---------------- transfer pazarı ----------------
function renderPazar() {
  const m = S.mk;
  view().innerHTML = `<div class="mk-grid"><div class="mk-side">
  <section class="card">
    <form id="mkForm" class="form mk">
      <input name="q" placeholder="Oyuncu ara…" value="${esc(m.q)}" autocomplete="off">
      <div class="row2">
        <select name="lg"><option value="">Tüm ligler</option>${Object.entries(LEAGUES).map(([k, l]) => `<option value="${k}" ${m.lg === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select name="grp"><option value="">Tüm mevkiler</option>${Object.entries(GROUPS).map(([k, l]) => `<option value="${k}" ${m.grp === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <div class="row2">
        <label class="inl">Rating<input name="min" type="number" min="40" max="99" value="${m.min}"><span>-</span><input name="max" type="number" min="40" max="99" value="${m.max}"></label>
        <label class="inl">En fazla<input name="price" placeholder="ör. 30M" value="${esc(m.price)}"></label>
      </div>
      <div class="row2">
        <select name="owner"><option value="all" ${m.owner === 'all' ? 'selected' : ''}>Herkes</option><option value="ai" ${m.owner === 'ai' ? 'selected' : ''}>Yapay zeka kulüpleri</option><option value="managers" ${m.owner === 'managers' ? 'selected' : ''}>Diğer takımlar</option><option value="auction" ${m.owner === 'auction' ? 'selected' : ''}>Açık artırmada</option></select>
        <select name="sort"><option value="ovr" ${m.sort === 'ovr' ? 'selected' : ''}>Rating ↓</option><option value="val_asc" ${m.sort === 'val_asc' ? 'selected' : ''}>Fiyat ↑</option><option value="val" ${m.sort === 'val' ? 'selected' : ''}>Fiyat ↓</option><option value="age" ${m.sort === 'age' ? 'selected' : ''}>Yaş ↑</option><option value="pot" ${m.sort === 'pot' ? 'selected' : ''}>Potansiyel ↓</option></select>
      </div>
      <button class="btn primary" type="submit">Ara</button>
    </form>
  </section>
  ${!windowOpen() ? '<p class="muted small center">🔒 Transfer dönemi kapalı — oyunculara bakabilirsin ama teklif veremezsin.</p>' : ''}
  </div><section class="card mk-main"><div id="mkList"></div></section></div>`;
  const form = $('#mkForm');
  form.onsubmit = (e) => { e.preventDefault(); readMk(form); searchMarket(true); };
  form.onchange = (e) => { if (e.target.tagName === 'SELECT') { readMk(form); searchMarket(true); } };
  if (!m.rows.length) searchMarket(true); else renderMarketList();
}
function readMk(form) {
  const m = S.mk;
  m.q = form.q.value.trim(); m.lg = form.lg.value; m.grp = form.grp.value;
  m.min = Number(form.min.value) || 40; m.max = Number(form.max.value) || 99;
  m.price = form.price.value.trim(); m.owner = form.owner.value; m.sort = form.sort.value;
}
async function searchMarket(reset) {
  const m = S.mk;
  if (reset) { m.page = 0; m.rows = []; }
  const PAGE = 40;
  let q = sb.from('real_players').select('*').gte('ovr', m.min).lte('ovr', m.max);
  if (m.q) q = q.or(`name.ilike.%${m.q.replace(/[%,()*]/g, '')}%,full_name.ilike.%${m.q.replace(/[%,()*]/g, '')}%`);
  if (m.lg) q = q.eq('lg', m.lg);
  if (m.grp) q = q.eq('grp', m.grp);
  const pr = parseMoney(m.price);
  if (m.price && pr > 0) q = q.lte('val', pr);
  const ownIds = [...S.own.keys()];
  const aucIds = [...new Set(S.offers.filter((o) => o.status === 'active' && !o.seller).map((o) => o.player_id))];
  if (m.owner === 'ai' && ownIds.length) q = q.not('id', 'in', `(${ownIds.join(',')})`);
  if (m.owner === 'managers') q = q.in('id', ownIds.filter((id) => S.own.get(id).team_id !== me()?.id).concat([-1]));
  if (m.owner === 'auction') q = q.in('id', aucIds.concat([-1]));
  q = m.sort === 'val_asc' ? q.order('val') : m.sort === 'val' ? q.order('val', { ascending: false }) : m.sort === 'age' ? q.order('age').order('ovr', { ascending: false }) : m.sort === 'pot' ? q.order('pot', { ascending: false }) : q.order('ovr', { ascending: false }).order('val', { ascending: false });
  q = q.range(m.page * PAGE, m.page * PAGE + PAGE - 1);
  if ($('#mkList') && reset) $('#mkList').innerHTML = '<div class="loading">Aranıyor…</div>';
  const { data, error } = await q;
  if (error) return toast(errText(error), 'err');
  data.forEach((p) => S.players.set(p.id, p));
  m.rows = m.rows.concat(data.map((p) => p.id));
  m.more = data.length === PAGE;
  renderMarketList();
}
function renderMarketList() {
  const el = $('#mkList');
  if (!el) return;
  const m = S.mk;
  el.innerHTML = m.rows.length ? `<div class="list">${m.rows.map((id) => {
    const p = pv(id);
    const o = S.own.get(id);
    const auc = !o && activeOffersFor(id).filter((x) => !x.seller).sort((a, b) => b.amount - a.amount)[0];
    const t = o && S.teamById.get(o.team_id);
    const side = `${auc ? `<span class="tag auc">🔨 <span data-exp="${auc.expires_at}">${timeLeft(auc.expires_at)}</span></span>` : ''}
      ${t ? `<span class="tag own">${teamDot(t)}${esc(t.short)}</span>` : ''}<b>${money(auc ? auc.amount : o ? o.value : p.val)}</b>`;
    return playerRow(p, side);
  }).join('')}</div>${m.more ? '<button class="btn ghost" id="mkMore">Daha fazla</button>' : ''}` : '<p class="muted">Sonuç yok</p>';
  $$('.prow', el).forEach((r) => (r.onclick = () => playerModal(Number(r.dataset.pid))));
  $('#mkMore') && ($('#mkMore').onclick = () => { m.page++; searchMarket(false); });
}

// ---------------- teklifler ----------------
function renderTeklif() {
  const t = me();
  const act_ = S.offers.filter((o) => o.status === 'active');
  const incoming = act_.filter((o) => o.seller === t.id);
  const outgoing = act_.filter((o) => o.bidder === t.id && o.seller);
  const auctions = act_.filter((o) => !o.seller).sort((a, b) => new Date(a.expires_at) - new Date(b.expires_at));
  const hist = S.offers.filter((o) => o.status !== 'active' && (o.bidder === t.id || o.seller === t.id)).slice(0, 25);
  const st = { won: 'Kazandın', lost: 'Kaybettin', accepted: 'Kabul edildi', rejected: 'Reddedildi', cancelled: 'İptal', outbid: 'Geçildi' };
  const pl = (o) => { const p = S.players.get(o.player_id); return p ? `${ovrBadge(p.ovr)} <b>${esc(p.name)}</b>` : `#${o.player_id}`; };
  view().innerHTML = `
  <section class="card"><h2>Gelen teklifler</h2>
    ${incoming.length ? incoming.map((o) => `<div class="offer"><div class="grow">${pl(o)}<small>${esc(bidderName(o))} · ${esc(o.note || '')} · <span data-exp="${o.expires_at}">${timeLeft(o.expires_at)}</span></small></div>
      <b>${money(o.amount)}</b><div class="row"><button class="btn sm primary" data-acc="${o.id}">Kabul</button><button class="btn sm ghost" data-rej="${o.id}">Ret</button></div></div>`).join('') : '<p class="muted">Yok</p>'}
  </section>
  <section class="card"><h2>Açık artırmalar</h2>
    ${auctions.length ? auctions.map((o) => `<div class="offer ${o.bidder === t.id ? 'lead' : ''}" data-pid="${o.player_id}"><div class="grow">${pl(o)}<small>${o.bidder === t.id ? '✅ En yüksek teklif sende' : esc(tname(o.bidder))}</small></div>
      <b>${money(o.amount)}</b><span class="tag auc" data-exp="${o.expires_at}">${timeLeft(o.expires_at)}</span></div>`).join('') : '<p class="muted">Şu an açık artırma yok</p>'}
  </section>
  <section class="card"><h2>Menajerlere tekliflerim</h2>
    ${outgoing.length ? outgoing.map((o) => `<div class="offer"><div class="grow">${pl(o)}<small>${esc(tname(o.seller))} · <span data-exp="${o.expires_at}">${timeLeft(o.expires_at)}</span></small></div>
      <b>${money(o.amount)}</b><button class="btn sm ghost" data-cancel="${o.id}">Geri çek</button></div>`).join('') : '<p class="muted">Yok</p>'}
  </section>
  <section class="card"><h2>Geçmiş</h2>
    ${hist.length ? hist.map((o) => `<div class="offer hist"><div class="grow">${pl(o)}<small>${o.bidder === t.id ? (o.seller ? `→ ${esc(tname(o.seller))}` : 'Açık artırma') : `← ${esc(bidderName(o))}`} · ${esc(o.note || '')}</small></div>
      <b>${money(o.amount)}</b><span class="tag st-${o.status}">${st[o.status] || o.status}</span></div>`).join('') : '<p class="muted">Yok</p>'}
  </section>`;
  $$('[data-acc]').forEach((b) => (b.onclick = async () => { await act('respond_offer', { p_offer: Number(b.dataset.acc), p_accept: true }); renderGame(); }));
  $$('[data-rej]').forEach((b) => (b.onclick = async () => { await act('respond_offer', { p_offer: Number(b.dataset.rej), p_accept: false }); renderGame(); }));
  $$('[data-cancel]').forEach((b) => (b.onclick = async () => { await act('cancel_offer', { p_offer: Number(b.dataset.cancel) }); renderGame(); }));
  $$('.offer[data-pid]').forEach((r) => (r.onclick = () => playerModal(Number(r.dataset.pid))));
}

// ---------------- lig: fikstür / puan / kupa ----------------
function renderLig() {
  const opts = [hasLeague() && ['puan', 'Puan'], ['fikstur', 'Fikstür'], hasCup() && ['kupa', 'Kupa'], hasEuro() && ['avrupa', 'Avrupa'], ['istat', 'İstatistik'], ['gecmis', 'Geçmiş']].filter(Boolean);
  let sub = S.sub.lig || opts[0][0];
  if (!opts.find((o) => o[0] === sub)) sub = opts[0][0];
  view().innerHTML = `<div class="seg wide" id="lSeg">${opts.map(([k, l]) => `<button data-s="${k}" class="${sub === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="lBody"></div>`;
  $$('#lSeg button').forEach((b) => (b.onclick = () => { S.sub.lig = b.dataset.s; renderLig(); }));
  ({ puan: renderPuan, fikstur: renderFikstur, kupa: renderKupa, avrupa: renderAvrupa, istat: renderIstat, gecmis: renderGecmis })[sub]();
}
function renderIstat() {
  const all = [...S.pstats.values()];
  const minApps = Math.max(1, Math.floor((S.game.current_round || 1) / 3));
  const row = (x, val) => { const p = pv(x.player_id); const t = S.teamById.get(x.team_id);
    return `<div class="prow" data-pid="${x.player_id}">${ovrBadge(p?.ovr ?? 0)}<div class="pmain"><b>${esc(p?.name)}</b><small>${teamDot(t)} ${esc(t?.name || 'Yapay zeka kulübü')} · ${x.apps} maç</small></div><div class="pside"><b>${val}</b></div></div>`; };
  const top = (arr, key, fmt, n = 10) => arr.filter((x) => x[key] > 0).sort((a, b) => b[key] - a[key] || b.rating - a.rating).slice(0, n);
  const block = (title, list, fmt) => `<section class="card"><h2>${title}</h2>${list.length ? `<div class="list">${list.map((x) => row(x, fmt(x))).join('')}</div>` : '<p class="muted">Henüz yok</p>'}</section>`;
  $('#lBody').innerHTML = `
    ${block('⚽ Gol krallığı', top(all, 'goals'), (x) => `${x.goals} gol`)}
    ${block('🅰️ Asist', top(all, 'assists'), (x) => `${x.assists} asist`)}
    ${block(`⭐ En yüksek puan <small class="muted">(en az ${minApps} maç)</small>`, all.filter((x) => x.apps >= minApps).sort((a, b) => b.rating - a.rating).slice(0, 10), (x) => x.rating)}
    ${block('🏅 Maçın adamı', top(all, 'motm'), (x) => `${x.motm}×`)}
    ${block('🟨 Kartlar', all.filter((x) => x.yellows + x.reds > 0).sort((a, b) => (b.reds * 3 + b.yellows) - (a.reds * 3 + a.yellows)).slice(0, 10), (x) => `${x.yellows}🟨${x.reds ? ` ${x.reds}🟥` : ''}`)}`;
  $$('#lBody .prow').forEach((r) => (r.onclick = () => playerModal(Number(r.dataset.pid))));
}
function renderGecmis() {
  const h = [...(S.game.history || [])].reverse();
  const trophies = new Map();
  for (const x of S.game.history || []) for (const k of ['league', 'cup', 'euro']) if (x[k]?.name) {
    const e = trophies.get(x[k].name) || { league: 0, cup: 0, euro: 0 }; e[k]++; trophies.set(x[k].name, e);
  }
  $('#lBody').innerHTML = `
  <section class="card"><h2>🏆 Kupa dolabı</h2>${trophies.size ? [...trophies].sort((a, b) => (b[1].euro * 2 + b[1].league + b[1].cup) - (a[1].euro * 2 + a[1].league + a[1].cup))
    .map(([n, e]) => `<div class="lrow"><div class="grow"><b>${esc(n)}</b></div>${e.league ? `<span class="tag on">Lig ×${e.league}</span>` : ''}${e.cup ? `<span class="tag cup">Kupa ×${e.cup}</span>` : ''}${e.euro ? `<span class="tag euro">Avrupa ×${e.euro}</span>` : ''}</div>`).join('')
    : '<p class="muted">İlk sezon bitince burada görünecek.</p>'}</section>
  ${h.map((x) => `<section class="card"><h3>${x.season}. sezon</h3>
    ${x.league ? `<div>🏆 Lig: <b>${esc(x.league.name)}</b></div>` : ''}${x.cup ? `<div>🏆 Kupa: <b>${esc(x.cup.name)}</b></div>` : ''}${x.euro ? `<div>🌍 Avrupa: <b>${esc(x.euro.name)}</b></div>` : ''}
    ${x.top ? `<div>⚽ Gol kralı: <b>${esc(x.top.name)}</b> (${esc(x.top.team || '')}) — ${x.top.goals} gol</div>` : ''}
    ${x.best ? `<div>⭐ Sezonun oyuncusu: <b>${esc(x.best.name)}</b> (${esc(x.best.team || '')}) — ${x.best.rating}</div>` : ''}</section>`).join('')}`;
}
function renderPuan() {
  const rows = S.standings;
  $('#lBody').innerHTML = `<section class="card"><table class="tbl">
    <thead><tr><th>#</th><th class="l">Takım</th><th>O</th><th class="hide-s">G</th><th class="hide-s">B</th><th class="hide-s">M</th><th class="hide-s">A</th><th class="hide-s">Y</th><th>AV</th><th class="hide-s">Form</th><th>P</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr class="${r.team_id === me()?.id ? 'mine' : ''}"><td>${i + 1}</td><td class="l">${teamDot(S.teamById.get(r.team_id) || r)} ${esc(r.name)}${S.teamById.get(r.team_id)?.is_bot ? ' 🤖' : ''}</td><td>${r.o}</td>
      <td class="hide-s">${r.w}</td><td class="hide-s">${r.d}</td><td class="hide-s">${r.l}</td><td class="hide-s">${r.gf}</td><td class="hide-s">${r.ga}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="hide-s">${formHTML(formOf(r.team_id))}</td><td><b>${r.pts}</b></td></tr>`).join('')}</tbody>
  </table></section>`;
}
function renderFikstur() {
  const rounds = [...new Set(S.fixtures.map((f) => f.round))];
  const cur = S.fixtures.find((f) => !f.played)?.round;
  $('#lBody').innerHTML = rounds.map((r) => `<section class="card ${r === cur ? 'cur' : ''}" ${r === cur ? 'id="curRound"' : ''}><h3>${r}. hafta${r === cur ? ' <span class="tag on">sıradaki</span>' : ''}</h3>
    ${S.fixtures.filter((f) => f.round === r).map((f) => fxRow(f)).join('')}</section>`).join('') || '<p class="muted">Fikstür yok</p>';
  $('#curRound')?.scrollIntoView({ block: 'start' });
}
function tieBox(legs) {
  const a = legs[0].home, b = legs[0].away;
  const ga = legs.reduce((s, f) => s + (f.played ? (f.home === a ? f.hg : f.ag) : 0), 0);
  const gb = legs.reduce((s, f) => s + (f.played ? (f.home === b ? f.hg : f.ag) : 0), 0);
  const w = legs.find((f) => f.winner)?.winner;
  const pens = legs.find((f) => f.pens);
  const mine = [a, b].includes(me()?.id);
  return `<div class="tie ${mine ? 'mine' : ''}">
    <div class="${w === a ? 'win' : w ? 'lose' : ''}">${teamDot(S.teamById.get(a))} ${esc(tname(a))}<b>${legs.some((f) => f.played) ? ga : ''}</b></div>
    <div class="${w === b ? 'win' : w ? 'lose' : ''}">${teamDot(S.teamById.get(b))} ${esc(tname(b))}<b>${legs.some((f) => f.played) ? gb : ''}</b></div>
    <small class="muted">${legs.map((f) => f.played ? `<a href="#/oda/${S.gameId}/mac/${f.id}">${legs.length > 1 ? f.leg + '. maç ' : ''}${tshort(f.home)} ${f.hg}-${f.ag} ${tshort(f.away)}</a>` : `${legs.length > 1 ? f.leg + '. maç: ' : ''}${f.round}. hafta`).join(' · ')}${pens ? ` · pen. ${esc(pens.pens)}` : ''}</small>
  </div>`;
}
function renderAvrupa() {
  const e = S.game.euro || {};
  const ef = S.fixtures.filter((f) => f.comp === 'euro');
  const myId = me()?.id;
  const inIt = (e.groups || []).some((g) => g.includes(myId));
  const ko = [3, 2, 1].map((r) => {
    const fx = ef.filter((f) => f.cup_round === r);
    if (!fx.length) return '';
    const ties = [...new Set(fx.map((f) => f.tie))].sort((a, b) => a - b);
    return `<section class="card"><h3>${EURO_ST[r]}</h3>${ties.map((t) => tieBox(fx.filter((f) => f.tie === t).sort((a, b) => a.leg - b.leg))).join('')}</section>`;
  }).join('');
  const groups = (e.groups || []).map((g, gi) => {
    const rows = S.euroTable.filter((x) => x.grp === gi + 1);
    const gfx = ef.filter((f) => f.cup_round === 0 && f.tie === gi + 1);
    const nextFx = gfx.filter((f) => !f.played);
    return `<section class="card ${g.includes(myId) ? 'cur' : ''}"><h3>${String.fromCharCode(65 + gi)} Grubu</h3>
      <table class="tbl"><thead><tr><th>#</th><th class="l">Takım</th><th>O</th><th class="hide-s">G</th><th class="hide-s">B</th><th class="hide-s">M</th><th>AV</th><th>P</th></tr></thead>
      <tbody>${rows.map((r, i) => { const t = S.teamById.get(r.team_id); return `<tr class="${r.team_id === myId ? 'mine' : ''}"><td>${i + 1}${i < 2 && r.o ? '<small class="q">▲</small>' : ''}</td><td class="l">${teamDot(t)} ${esc(t?.name)}${t && !t.guest ? ' <small class="muted">(lig)</small>' : ''}</td><td>${r.o}</td><td class="hide-s">${r.w}</td><td class="hide-s">${r.d}</td><td class="hide-s">${r.l}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td><b>${r.pts}</b></td></tr>`; }).join('')}</tbody></table>
      ${g.includes(myId) || nextFx.length ? `<details ${g.includes(myId) ? 'open' : ''}><summary class="small muted">Grup maçları</summary>${gfx.map((f) => fxRow(f, { showRound: true })).join('')}</details>` : ''}
    </section>`;
  }).join('');
  $('#lBody').innerHTML = `
  ${e.champion ? `<section class="card champ">🌍🏆 Avrupa şampiyonu: <b>${esc(tname(e.champion))}</b></section>` : ''}
  <section class="card"><p class="small muted">16 takım: ligimizin en iyileri ve Avrupa'nın devleri. Gruplarda ilk 2 çeyrek finale çıkar; çeyrek ve yarı final rövanşlı, final tek maç.
    ${inIt ? 'Her tur ek gelir: katılım, çeyrek final, yarı final, final ve şampiyonluk primi; iç saha biletleri 2.5 kat.' : 'Bu sezon Avrupa\'da değilsin — ligi ilk sıralarda bitirirsen gelecek sezon sen de buradasın.'}</p></section>
  ${ko}${groups}`;
}
function renderKupa() {
  const cup = S.game.cup || {};
  const cf = S.fixtures.filter((f) => f.comp === 'cup');
  const rounds = [...new Set(cf.map((f) => f.cup_round))].sort((a, b) => a - b);
  const maxR = rounds.length ? Math.max(...rounds) : 0;
  const rName = (r) => { const n = new Set(cf.filter((f) => f.cup_round === r).flatMap((f) => [f.home, f.away])).size; return n === 2 && cup.champion ? 'Final' : n === 2 && r === maxR && (cup.alive || []).length <= 2 ? 'Final' : n === 4 ? 'Yarı final' : n === 8 ? 'Çeyrek final' : `${r}. tur`; };
  $('#lBody').innerHTML = `
  ${cup.champion ? `<section class="card champ">🏆 Kupa şampiyonu: <b>${esc(tname(cup.champion))}</b></section>` : ''}
  ${rounds.map((r) => {
    const ties = [...new Set(cf.filter((f) => f.cup_round === r).map((f) => f.tie))];
    return `<section class="card"><h3>${rName(r)}</h3>${ties.map((tie) => tieBox(cf.filter((f) => f.cup_round === r && f.tie === tie).sort((a, b) => a.leg - b.leg))).join('')}</section>`;
  }).join('') || '<section class="card"><p class="muted">Kupa maçı yok</p></section>'}
  ${(cup.byes || []).length && !cup.champion ? `<section class="card"><h3>Bu turu bay geçenler</h3>${cup.byes.map((id) => `<div>${teamDot(S.teamById.get(id))} ${esc(tname(id))}</div>`).join('')}</section>` : ''}`;
}

// ---------------- başlangıç ----------------
async function loadProfile() {
  if (!S.user) { S.profile = null; return; }
  const { data } = await sb.from('profiles').select('*').eq('id', S.user.id).maybeSingle();
  S.profile = data;
}
sb.auth.onAuthStateChange((ev, session) => {
  const prev = S.user?.id;
  S.user = session?.user || null;
  if (session && ev === 'TOKEN_REFRESHED') sb.realtime.setAuth(session.access_token);
  if (prev === S.user?.id && ev !== 'SIGNED_IN') return;
  setTimeout(async () => {
    await loadProfile();
    if (!S.user) { leaveGame(); go('giris'); } else route();
  });
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
(async () => {
  const { data } = await sb.auth.getSession();
  S.user = data.session?.user || null;
  await loadProfile();
  route();
})();
