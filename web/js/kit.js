// Forma, arma ve numara çizimleri (SVG: arayüz, Canvas: 2D/3D maç)
export const PATTERNS = { plain: 'Düz', stripes: 'Dikey çizgili', hoops: 'Yatay çizgili', halves: 'Yarım', sash: 'Kuşak' };
export const CRESTS = { shield: 'Kalkan', classic: 'Klasik', circle: 'Yuvarlak', diamond: 'Elmas' };
export const SYMBOLS = ['', '★', '⚡', '🦅', '🦁', '🐺', '🔥', '⚓', '👑', '⚔️', '🌙', '☀️', '🐂', '🐉', '🌊', '⛰️', '🍀'];

const HEX = /^#[0-9a-f]{6}$/i;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function kitOf(t) {
  return {
    c1: HEX.test(t?.color1) ? t.color1 : '#c62828',
    c2: HEX.test(t?.color2) ? t.color2 : '#ffffff',
    pattern: PATTERNS[t?.kit?.pattern] ? t.kit.pattern : 'plain',
    crest: CRESTS[t?.kit?.crest] ? t.kit.crest : 'shield',
    symbol: SYMBOLS.includes(t?.kit?.symbol) ? t.kit.symbol : '',
    short: String(t?.short || '').slice(0, 4),
  };
}
export const rgb = (h) => { const n = parseInt(String(h).slice(1), 16) || 0; return [n >> 16, (n >> 8) & 255, n & 255]; };
export const colorDist = (a, b) => { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
export const lum = (h) => { const [r, g, b] = rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
// numara rengi: formanın zemin rengiyle zıt olan
export const numColor = (k) => (colorDist(k.c1, k.c2) > 120 ? k.c2 : lum(k.c1) > 0.55 ? '#111111' : '#ffffff');

// iki takımın forması karışırsa deplasman takımı ters renk giyer; çimle karışan renk de değiştirilir
const GRASS = '#2e7d32';
export function matchKits(home, away) {
  const h = kitOf(home), a = kitOf(away);
  const fix = (k, other) => {
    let r = { ...k };
    if (colorDist(r.c1, GRASS) < 80 || (other && colorDist(r.c1, other.c1) < 100)) r = { ...r, c1: k.c2, c2: k.c1 };
    if (colorDist(r.c1, GRASS) < 80 || (other && colorDist(r.c1, other.c1) < 100)) r = { ...r, c1: lum(other?.c1 || '#000') > 0.5 ? '#111111' : '#f5f5f5', c2: r.c1, pattern: 'plain' };
    return r;
  };
  const H = fix(h);
  const A = fix(a, H);
  return { h: H, a: A, gkH: { c1: '#facc15', c2: '#1f2937', pattern: 'plain' }, gkA: { c1: '#22d3ee', c2: '#0f172a', pattern: 'plain' } };
}

// ---------- SVG ----------
let uid = 0;
const SHIRT = 'M30 10 L42 5 Q50 13 58 5 L70 10 L93 24 L83 42 L73 36 L73 95 L27 95 L27 36 L17 42 L7 24 Z';
function patternRects(k) {
  switch (k.pattern) {
    case 'stripes': return [18, 34, 50, 66, 82].map((x) => `<rect x="${x - 4}" y="0" width="8" height="100" fill="${k.c2}"/>`).join('');
    case 'hoops': return [30, 50, 70, 90].map((y) => `<rect x="0" y="${y - 5}" width="100" height="10" fill="${k.c2}"/>`).join('');
    case 'halves': return `<rect x="50" y="0" width="50" height="100" fill="${k.c2}"/>`;
    case 'sash': return `<path d="M20 10 L36 10 L84 95 L68 95 Z" fill="${k.c2}"/>`;
    default: return '';
  }
}
export function shirtSVG(team, { num = '', size = 40, kit, title = '' } = {}) {
  const k = kit || kitOf(team);
  const id = `sh${++uid}`;
  const nc = numColor(k);
  return `<svg class="shirt" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">${title ? `<title>${esc(title)}</title>` : ''}
    <defs><clipPath id="${id}"><path d="${SHIRT}"/></clipPath></defs>
    <g clip-path="url(#${id})"><rect width="100" height="100" fill="${k.c1}"/>${patternRects(k)}
      <path d="M42 5 Q50 13 58 5 L58 9 Q50 18 42 9 Z" fill="${k.c2}" opacity=".9"/></g>
    <path d="${SHIRT}" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="3"/>
    ${num !== '' ? `<text x="50" y="70" text-anchor="middle" font-family="'Barlow Condensed',Arial Narrow,sans-serif" font-weight="800" font-size="38" fill="${nc}" stroke="${nc === '#111111' ? '#fff' : 'rgba(0,0,0,.55)'}" stroke-width="2" paint-order="stroke">${esc(num)}</text>` : ''}
  </svg>`;
}
const CREST_PATHS = {
  shield: 'M50 4 L92 16 Q92 66 50 96 Q8 66 8 16 Z',
  classic: 'M10 8 L90 8 L90 52 Q90 82 50 96 Q10 82 10 52 Z',
  circle: 'M50 4 A46 46 0 1 1 49.9 4 Z',
  diamond: 'M50 3 L95 50 L50 97 L5 50 Z',
};
export function crestSVG(team, size = 28) {
  const k = kitOf(team);
  const id = `cr${++uid}`;
  const d = CREST_PATHS[k.crest];
  const label = k.symbol || k.short.slice(0, 3);
  const isEmoji = !!k.symbol && k.symbol !== '★';
  const fs = isEmoji ? 40 : label.length >= 3 ? 26 : 34;
  return `<svg class="crest" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
    <defs><clipPath id="${id}"><path d="${d}"/></clipPath></defs>
    <g clip-path="url(#${id})"><rect width="100" height="100" fill="${k.c1}"/>${k.pattern !== 'plain' ? `<g opacity=".35">${patternRects(k)}</g>` : ''}
      ${k.crest === 'classic' ? `<rect x="0" y="0" width="100" height="22" fill="${k.c2}"/>` : ''}</g>
    <path d="${d}" fill="none" stroke="${k.c2}" stroke-width="7"/>
    <text x="50" y="${k.crest === 'classic' ? 70 : 64}" text-anchor="middle" font-family="'Barlow Condensed',Arial Narrow,sans-serif" font-weight="800" font-size="${fs}"
      fill="${numColor(k)}" stroke="rgba(0,0,0,.35)" stroke-width="1.5" paint-order="stroke">${esc(label)}</text>
  </svg>`;
}

// ---------- Canvas ----------
const SHIRT_PATH = typeof Path2D !== 'undefined' ? new Path2D(SHIRT) : null;
export function drawShirt(ctx, x, y, size, k, num, { alpha = 1, highlight = false } = {}) {
  const s = size / 100;
  ctx.save();
  ctx.globalAlpha = alpha;
  // gölge
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath(); ctx.ellipse(x + size * 0.06, y + size * 0.46, size * 0.36, size * 0.12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(s, s);
  ctx.save();
  ctx.clip(SHIRT_PATH);
  ctx.fillStyle = k.c1; ctx.fillRect(0, 0, 100, 100);
  ctx.fillStyle = k.c2;
  if (k.pattern === 'stripes') [18, 34, 50, 66, 82].forEach((sx) => ctx.fillRect(sx - 4, 0, 8, 100));
  else if (k.pattern === 'hoops') [30, 50, 70, 90].forEach((sy) => ctx.fillRect(0, sy - 5, 100, 10));
  else if (k.pattern === 'halves') ctx.fillRect(50, 0, 50, 100);
  else if (k.pattern === 'sash') { ctx.beginPath(); ctx.moveTo(20, 10); ctx.lineTo(36, 10); ctx.lineTo(84, 95); ctx.lineTo(68, 95); ctx.fill(); }
  ctx.restore();
  ctx.lineWidth = highlight ? 7 : 4;
  ctx.strokeStyle = highlight ? '#fff' : 'rgba(0,0,0,.55)';
  ctx.stroke(SHIRT_PATH);
  if (num !== undefined && num !== null && num !== '') {
    const nc = numColor(k);
    ctx.font = `800 44px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 6; ctx.strokeStyle = nc === '#111111' ? 'rgba(255,255,255,.8)' : 'rgba(0,0,0,.6)';
    ctx.strokeText(String(num), 50, 58);
    ctx.fillStyle = nc; ctx.fillText(String(num), 50, 58);
  }
  ctx.restore();
}
