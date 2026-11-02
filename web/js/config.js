// Supabase bağlantısı. Publishable key istemcide kullanılmak üzere tasarlanmıştır;
// veritabanı RLS ve security definer RPC'lerle korunur. service_role key ASLA buraya konmaz.
export const SUPABASE_URL = 'https://idpfttetphmjcmnodpdw.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_vY0fA-KsME4MU6bw9o8Enw_LEAsjLkC';

export const LEAGUES = {
  ENG: 'İngiltere', ESP: 'İspanya', GER: 'Almanya', FRA: 'Fransa', ITA: 'İtalya',
  NED: 'Hollanda', POR: 'Portekiz', TUR: 'Türkiye', BEL: 'Belçika',
};
export const GROUPS = { GK: 'Kaleci', DEF: 'Defans', MID: 'Orta saha', FWD: 'Forvet' };
export const GROUP_SHORT = { GK: 'KL', DEF: 'DF', MID: 'OS', FWD: 'FV' };
export const FORMATIONS = ['4-4-2', '4-3-3', '4-2-3-1', '4-1-4-1', '4-5-1', '3-5-2', '3-4-3', '5-3-2', '5-4-1', '4-4-1-1'];
export const MENTALITY = { '-2': 'Otobüs', '-1': 'Savunma', '0': 'Dengeli', '1': 'Hücum', '2': 'Tam hücum' };
