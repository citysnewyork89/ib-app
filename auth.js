// Users, password hashing (scrypt) and signed session tokens.
const crypto = require('crypto'), { promisify } = require('util'), db = require('./db');
const scrypt = promisify(crypto.scrypt);
const P = (process.env.ADMIN_PASSWORD || '').trim();
const ROOT = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('ib|' + P + '|' + (process.env.DISCORD_TOKEN || '')).digest('hex');
const TTL = 12 * 3600e3;
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const eq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const b64 = b => Buffer.from(b).toString('base64url');
const col = () => db.col('users');
const rootUser = () => ({ id: 'root', username: ROOT, role: 'admin', status: 'active', root: true });

async function hash(pw) { const salt = crypto.randomBytes(16); return 'scrypt$' + salt.toString('hex') + '$' + (await scrypt(pw, salt, 64)).toString('hex'); }
async function verify(pw, stored) {
  const [t, s, h] = String(stored || '').split('$');
  if (t !== 'scrypt' || !s || !h) return false;
  const a = await scrypt(pw, Buffer.from(s, 'hex'), 64), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sign = u => { const p = b64(JSON.stringify({ id: u.id, exp: Date.now() + TTL })); return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); };
function readToken(t) {
  const [p, s] = String(t || '').split('.');
  if (!p || !s) return null;
  const good = crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
  if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
  try { const j = JSON.parse(Buffer.from(p, 'base64url').toString()); return j.exp > Date.now() ? j : null; } catch { return null; }
}

const cache = new Map();
const invalidate = id => { id ? cache.delete(id) : cache.clear(); };
async function byId(id) {
  if (id === 'root') return P ? rootUser() : null;
  const c = cache.get(id);
  if (c && Date.now() - c.t < 5000) return c.u;
  const u = await col().get(id);
  cache.set(id, { u, t: Date.now() });
  return u;
}
async function userFromToken(t) {
  const j = readToken(t); if (!j) return null;
  const u = await byId(j.id);
  return u && u.status !== 'suspended' ? u : null;
}
async function byName(name) { const n = String(name || '').trim().toLowerCase(); return (await col().all()).find(u => u.username === n); }

// Returns { user } or { error } ('invalid' | 'suspended')
async function login(username, password) {
  const n = String(username || '').trim().toLowerCase(), pw = String(password || '');
  if (!n || !pw || pw.length > 256) return { error: 'invalid' };
  if (P && n === ROOT) return eq(pw, P) ? { user: rootUser() } : { error: 'invalid' };
  const u = await byName(n);
  if (!u || !(await verify(pw, u.hash))) return { error: 'invalid' };
  if (u.status === 'suspended') return { error: 'suspended' };
  await col().put(u.id, { ...u, lastLogin: Date.now() }); invalidate(u.id);
  return { user: u };
}

const pub = u => ({ id: u.id, username: u.username, role: u.role, status: u.status, createdAt: u.createdAt || null, lastLogin: u.lastLogin || null, root: !!u.root });
async function listUsers() { return [pub(rootUser()), ...(await col().all()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map(pub)]; }

const okName = n => /^[a-z0-9._-]{3,32}$/.test(n);
async function createUser({ username, password, role, status }) {
  const n = String(username || '').trim().toLowerCase();
  if (!okName(n)) throw new Error('Username must be 3-32 characters: letters, numbers, dots, dashes or underscores.');
  if (n === ROOT || await byName(n)) throw new Error('That username already exists.');
  if (String(password || '').length < 8 || password.length > 128) throw new Error('Password must be between 8 and 128 characters.');
  const u = { username: n, hash: await hash(password), role: role === 'admin' ? 'admin' : 'editor', status: status === 'suspended' ? 'suspended' : 'active', createdAt: Date.now(), lastLogin: null };
  const id = db.rid(); await col().put(id, u); return pub({ id, ...u });
}
async function updateUser(id, patch, actorId) {
  if (id === 'root') throw new Error('The main administrator is configured on the server and cannot be changed here.');
  const u = await col().get(id); if (!u) throw new Error('User not found.');
  const n = { ...u };
  if (patch.username !== undefined) {
    const name = String(patch.username).trim().toLowerCase();
    if (!okName(name)) throw new Error('Invalid username.');
    if (name !== u.username && (name === ROOT || await byName(name))) throw new Error('That username already exists.');
    n.username = name;
  }
  if (patch.role !== undefined) { if (id === actorId && patch.role !== u.role) throw new Error('You cannot change your own role.'); n.role = patch.role === 'admin' ? 'admin' : 'editor'; }
  if (patch.status !== undefined) { if (id === actorId && patch.status === 'suspended') throw new Error('You cannot suspend your own account.'); n.status = patch.status === 'suspended' ? 'suspended' : 'active'; }
  if (patch.password) { if (patch.password.length < 8 || patch.password.length > 128) throw new Error('Password must be between 8 and 128 characters.'); n.hash = await hash(patch.password); }
  await col().put(id, n); invalidate(id); return pub(n && { id, ...n });
}
async function deleteUser(id, actorId) {
  if (id === 'root') throw new Error('The main administrator cannot be deleted.');
  if (id === actorId) throw new Error('You cannot delete your own account.');
  await col().del(id); invalidate(id);
}
async function changePassword(id, current, next) {
  if (id === 'root') throw new Error('The main administrator password is set on the server (ADMIN_PASSWORD).');
  const u = await col().get(id); if (!u || !(await verify(current || '', u.hash))) throw new Error('Current password is incorrect.');
  if (String(next || '').length < 8 || next.length > 128) throw new Error('New password must be between 8 and 128 characters.');
  await col().put(id, { ...u, hash: await hash(next) }); invalidate(id);
}
module.exports = { login, sign, userFromToken, listUsers, createUser, updateUser, deleteUser, changePassword, pub, invalidate, ROOT, hasRoot: !!P };
