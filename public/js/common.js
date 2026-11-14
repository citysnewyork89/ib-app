// Shared helpers: session, API calls, top bar, toasts.
const $ = i => document.getElementById(i);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const IB = {
  token: () => localStorage.getItem('ib_token') || '',
  user: () => { try { return JSON.parse(localStorage.getItem('ib_user') || 'null'); } catch { return null; } },
  logout() { localStorage.removeItem('ib_token'); localStorage.removeItem('ib_user'); location.href = '/'; },
  guard(role) {
    const u = IB.user();
    if (!IB.token() || !u) { IB.logout(); return false; }
    if (role === 'admin' && u.role !== 'admin') { location.href = '/menu.html'; return false; }
    return true;
  },
  topbar(title, back = true) {
    const u = IB.user() || {};
    $('topbar').innerHTML = `<div class=ttl>Iberia Panel${title ? ' / ' + esc(title) : ''}</div><small>${esc(u.username || '')}</small>${back ? '<a href="/menu.html"><button>Menu</button></a>' : ''}<button onclick="IB.logout()">Sign out</button>`;
  }
};
function toast(m, ms = 6000) {
  let t = $('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = m; t.style.display = 'block'; clearTimeout(t._t); t._t = setTimeout(() => t.style.display = 'none', ms);
}
async function api(url, opt = {}) {
  const r = await fetch(url, { ...opt, headers: { authorization: 'Bearer ' + IB.token(), ...(opt.headers || {}) } });
  if (r.status === 401) { IB.logout(); throw new Error('Session expired'); }
  return r;
}
async function apiJson(url, method = 'GET', body) {
  const r = await api(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || j.message || 'Request failed');
  return j;
}
