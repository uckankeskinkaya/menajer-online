// Küçük arayüz yardımcıları (framework yok)
import { GROUP_SHORT } from './config.js';
import { crestSVG } from './kit.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Kullanıcıdan gelen her metin (takım/oda/kullanıcı adı, haber) HTML'e girmeden önce kaçırılır.
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function money(v) {
  v = Number(v || 0);
  const sign = v < 0 ? '-' : '';
  v = Math.abs(v);
  if (v >= 1e6) return `${sign}€${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)}M`;
  if (v >= 1e3) return `${sign}€${Math.round(v / 1e3)}K`;
  return `${sign}€${v}`;
}

// "25M", "25,5m", "800k", "25000000" -> sayı
export function parseMoney(s) {
  s = String(s || '').trim().toLowerCase().replace(/[€\s]/g, '').replace(',', '.');
  const m = s.match(/^(\d+(?:\.\d+)?)([mk]?)$/);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  return Math.round(m[2] === 'm' ? n * 1e6 : m[2] === 'k' ? n * 1e3 : n);
}

export function ovrClass(o) {
  return o >= 85 ? 'r-s' : o >= 80 ? 'r-a' : o >= 75 ? 'r-b' : o >= 70 ? 'r-c' : 'r-d';
}
export const ovrBadge = (o) => `<span class="ovr ${ovrClass(o)}">${o}</span>`;
export const grpBadge = (g) => `<span class="grp g-${esc(g)}">${GROUP_SHORT[g] || esc(g)}</span>`;

export function teamDot(t, size = 18) {
  if (!t) return '';
  return `<span class="tcrest">${crestSVG(t, size)}</span>`;
}

let toastTimer;
export function toast(msg, kind = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), kind === 'err' ? 5000 : 3200);
}

// Sunucu hatasını oyuncunun anlayacağı Türkçeye çevir
export function errText(e) {
  const m = e?.message || String(e);
  if (/teams_name_check/.test(m)) return 'Takım adı 3-30 karakter olmalı';
  if (/teams_short_check/.test(m)) return 'Kısaltma 2-4 karakter olmalı';
  if (/games_name_check/.test(m)) return 'Oda adı 3-40 karakter olmalı';
  if (/teams_game_id_name_key/.test(m)) return 'Bu takım adı odada alınmış';
  if (/Invalid login credentials/i.test(m)) return 'E-posta veya şifre hatalı';
  if (/User already registered/i.test(m)) return 'Bu e-posta ile zaten kayıt olunmuş';
  if (/Password should be at least/i.test(m)) return 'Şifre en az 6 karakter olmalı';
  if (/Email not confirmed/i.test(m)) return 'E-posta doğrulanmamış (oda sahibine Supabase ayarını sor)';
  if (/Email signups are disabled|email.*disabled/i.test(m)) return 'E-posta ile kayıt kapalı (Supabase ayarı)';
  if (/rate limit/i.test(m)) return 'Çok fazla deneme, biraz bekle';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Bağlantı hatası, interneti kontrol et';
  return m;
}

export function modal(html, { onMount, wide } = {}) {
  const root = $('#modal');
  root.innerHTML = `<div class="modal-back" data-close></div><div class="modal-box ${wide ? 'wide' : ''}" role="dialog">${html}</div>`;
  root.classList.add('show');
  const close = () => { root.classList.remove('show'); root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  onMount?.(root.querySelector('.modal-box'), close);
  return close;
}

export function confirmBox(text, okLabel = 'Evet') {
  return new Promise((res) => {
    modal(`<p class="confirm-text">${esc(text)}</p>
      <div class="row end"><button class="btn ghost" data-close>Vazgeç</button><button class="btn primary" id="cfOk">${esc(okLabel)}</button></div>`, {
      onMount: (box, close) => {
        box.querySelector('#cfOk').onclick = () => { close(); res(true); };
        box.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => res(false)));
      },
    });
  });
}

export function timeLeft(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return 'bitti';
  const s = Math.floor(ms / 1000);
  if (s >= 3600) return `${Math.floor(s / 3600)} sa ${Math.floor((s % 3600) / 60)} dk`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ago(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'az önce';
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
  if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
  return `${Math.floor(s / 86400)} gün önce`;
}

// formasyon -> slot grupları (sunucudaki _slots ile aynı)
export function slots(form) {
  const p = form.split('-').map(Number);
  const r = ['GK'];
  for (let i = 0; i < p[0]; i++) r.push('DEF');
  for (let k = 1; k < p.length - 1; k++) for (let i = 0; i < p[k]; i++) r.push('MID');
  for (let i = 0; i < p[p.length - 1]; i++) r.push('FWD');
  return r;
}

// formasyondaki her slotun saha konumu (0-1 arası; y=1 kendi kalesi)
export function slotPositions(form) {
  const p = form.split('-').map(Number);
  const pos = [{ x: 0.5, y: 0.94 }];
  const lines = p.length;
  p.forEach((n, li) => {
    const y = 0.78 - (li * 0.58) / Math.max(1, lines - 1);
    for (let i = 0; i < n; i++) pos.push({ x: (i + 1) / (n + 1), y });
  });
  return pos;
}
