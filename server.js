require('dotenv').config();
const crypto = require('crypto'), path = require('path');
const express = require('express'), multer = require('multer');
const { Client, GatewayIntentBits, Events, ActivityType } = require('discord.js');
const { handleSelect } = require('./menus');
const db = require('./db'), auth = require('./auth'), settings = require('./settings'), kb = require('./knowledge'), ai = require('./ai'), tk = require('./tickets');
const D = require('./defaults');
const { DISCORD_TOKEN: T, GUILD_ID: G, PORT = 3000 } = process.env;

console.log(auth.hasRoot ? 'ADMIN_PASSWORD loaded' : '⚠ ADMIN_PASSWORD is empty: the main administrator cannot sign in');
console.log(T ? 'DISCORD_TOKEN loaded' : '⚠ DISCORD_TOKEN is empty', '|', G ? 'GUILD_ID loaded' : '⚠ GUILD_ID is empty');
process.on('unhandledRejection', e => console.error('unhandledRejection:', e && e.message || e));
process.on('uncaughtException', e => console.error('uncaughtException:', e && e.message || e));

const app = express();
const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 10 } });
const dcFail = (m, c = 503) => new Response(JSON.stringify({ message: m }), { status: c, headers: { 'content-type': 'application/json' } });
const dc = async (p, opt = {}) => {
  if (!T || !G) return dcFail('The Discord bot is not configured on the server (DISCORD_TOKEN / GUILD_ID).');
  try { return await fetch('https://discord.com/api/v10' + p, { ...opt, headers: { Authorization: 'Bot ' + T, ...(opt.headers || {}) } }); }
  catch (e) { console.error('Discord request failed:', e.message); return dcFail('Could not reach Discord. Please try again.'); }
};
const wrap = fn => (q, r, n) => Promise.resolve(fn(q, r, n)).catch(e => { console.error(e && e.stack || e); if (!r.headersSent) r.status(500).json({ error: 'Internal error' }); });
const isId = s => /^\d{5,25}$/.test(String(s || ''));
const bad = (r, m, c = 400) => r.status(c).json({ error: m });
const up401 = c => c === 401 ? 502 : c; // a 401 from Discord must not look like an expired panel session
const dcErr = o => ({ ...(o && typeof o === 'object' ? o : {}), error: (o && (o.message || o.error)) || 'Discord request failed' });

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((q, r, n) => {
  r.setHeader('X-Content-Type-Options', 'nosniff'); r.setHeader('X-Frame-Options', 'DENY'); r.setHeader('Referrer-Policy', 'no-referrer');
  r.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  r.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src * data: blob:; media-src * data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  if (q.path.startsWith('/api')) r.setHeader('Cache-Control', 'no-store');
  n();
});
app.get('/health', (q, r) => r.json({ ok: true, bot: bot.isReady(), db: db.kind() }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', express.json({ limit: '15mb' }));

// ---------- Login ----------
const fails = new Map(), MAX_FAILS = 10, WINDOW = 15 * 60 * 1000;
setInterval(() => { const t = Date.now(); for (const [k, v] of fails) if (t - v.t > WINDOW) fails.delete(k); }, 60000).unref();
app.post('/api/login', wrap(async (q, r) => {
  const f = fails.get(q.ip);
  if (f && Date.now() - f.t < WINDOW && f.n >= MAX_FAILS) return bad(r, 'Too many attempts. Please wait 15 minutes.', 429);
  const res = await auth.login(q.body?.username, q.body?.password);
  if (res.error) { const cur = f && Date.now() - f.t < WINDOW ? f : { n: 0 }; fails.set(q.ip, { n: cur.n + 1, t: Date.now() }); return bad(r, 'Invalid username or password.', 401); }
  fails.delete(q.ip);
  r.json({ token: auth.sign(res.user), user: auth.pub(res.user) });
}));
app.use('/api', wrap(async (q, r, n) => {
  const u = await auth.userFromToken((q.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  if (!u) return bad(r, 'Your session has expired or the account is not allowed. Please sign in again.', 401);
  q.user = u; n();
}));
const adminOnly = (q, r, n) => q.user.role === 'admin' ? n() : bad(r, 'Administrator access required.', 403);
app.get('/api/me', (q, r) => r.json(auth.pub(q.user)));
app.post('/api/me/password', wrap(async (q, r) => { try { await auth.changePassword(q.user.id, q.body?.current, q.body?.next); r.json({ ok: true }); } catch (e) { bad(r, e.message); } }));

// ---------- Users (admin) ----------
app.get('/api/users', adminOnly, wrap(async (q, r) => r.json(await auth.listUsers())));
app.post('/api/users', adminOnly, wrap(async (q, r) => { try { r.json(await auth.createUser(q.body || {})); } catch (e) { bad(r, e.message); } }));
app.put('/api/users/:id', adminOnly, wrap(async (q, r) => { try { r.json(await auth.updateUser(q.params.id, q.body || {}, q.user.id)); } catch (e) { bad(r, e.message); } }));
app.delete('/api/users/:id', adminOnly, wrap(async (q, r) => { try { await auth.deleteUser(q.params.id, q.user.id); r.json({ ok: true }); } catch (e) { bad(r, e.message); } }));

// ---------- Publisher (any active user) ----------
app.get('/api/channels', wrap(async (q, r) => {
  const x = await dc(`/guilds/${G}/channels`), j = await x.json();
  if (!x.ok) return r.status(up401(x.status)).json(dcErr(j));
  r.json(j.filter(c => [0, 5, 15].includes(c.type)).map(c => ({ id: c.id, name: c.name, type: c.type, tags: c.available_tags || [] })));
}));
app.get('/api/threads/:forum', wrap(async (q, r) => {
  const f = q.params.forum; if (!isId(f)) return bad(r, 'Invalid forum ID');
  const [a, b] = await Promise.all([dc(`/guilds/${G}/threads/active`).then(x => x.json()), dc(`/channels/${f}/threads/archived/public?limit=50`).then(x => x.json())]);
  r.json([...(a.threads || []).filter(t => t.parent_id == f), ...(b.threads || [])].map(t => ({ id: t.id, name: t.name })));
}));
app.get('/api/emojis', wrap(async (q, r) => { const j = await (await dc(`/guilds/${G}/emojis`)).json().catch(() => null); r.json(Array.isArray(j) ? j.map(e => ({ id: e.id, name: e.name, animated: e.animated })) : []); }));

const nameOf = (b, st) => { const t = st?.mode == 'classic' ? (st.content || st.embeds?.[0]?.title) : st?.blocks?.find(x => x.t == 'text' || x.t == 'sec')?.content; return String(t || '(no text)').replace(/[#*`]/g, '').trim().split('\n')[0].slice(0, 60); };
const atts = m => (m?.attachments || []).map(a => ({ id: a.id, filename: a.filename, url: a.url }));
const mkForm = (json, files) => { const fd = new FormData(); fd.append('payload_json', JSON.stringify(json)); files.forEach((f, i) => fd.append(`files[${i}]`, new Blob([f.buffer]), f.originalname)); return fd; };

app.post('/api/send', up.array('files'), wrap(async (q, r) => {
  const { channelId, forum, threadName, tags, body, menus, state, channelName } = JSON.parse(q.body.payload);
  if (!isId(channelId)) return bad(r, 'Invalid channel ID');
  const msg = { ...body, attachments: q.files.map((f, i) => ({ id: i, filename: f.originalname })) };
  const json = forum ? { name: threadName, applied_tags: tags || [], message: msg } : msg;
  const x = await dc(`/channels/${channelId}/${forum ? 'threads' : 'messages'}`, { method: 'POST', body: mkForm(json, q.files) });
  const out = await x.json();
  if (x.ok) {
    try {
      await db.saveMenus(menus);
      const m = forum ? (out.message || out) : out;
      await db.addSent({ id: db.rid(), channelId: forum ? out.id : channelId, messageId: forum ? (out.message?.id || out.id) : out.id, channelName: channelName || '', label: nameOf(body, state), state, attachments: atts(m), menuIds: (menus || []).map(z => z.id), ts: Date.now() });
    } catch (e) { console.error('Could not save to the database:', e.message); }
  }
  r.status(up401(x.status)).json(x.ok ? out : dcErr(out));
}));
app.post('/api/edit/:id', up.array('files'), wrap(async (q, r) => {
  const rec = await db.getSent(q.params.id);
  if (!rec) return bad(r, 'Message not found in the database', 404);
  const { body, menus, state } = JSON.parse(q.body.payload), js = JSON.stringify(body), names = q.files.map(f => f.originalname);
  const keep = (rec.attachments || []).filter(a => js.includes('attachment://' + a.filename) && !names.includes(a.filename)).map(a => ({ id: a.id }));
  const msg = { ...body, attachments: [...keep, ...q.files.map((f, i) => ({ id: i, filename: f.originalname }))] };
  const x = await dc(`/channels/${rec.channelId}/messages/${rec.messageId}`, { method: 'PATCH', body: mkForm(msg, q.files) });
  const out = await x.json();
  if (x.ok) {
    try {
      await db.saveMenus(menus);
      await db.delMenus((rec.menuIds || []).filter(i => !(menus || []).some(z => z.id === i)));
      await db.updSent(rec.id, { state, label: nameOf(body, state), attachments: atts(out), menuIds: (menus || []).map(z => z.id), edited: Date.now() });
    } catch (e) { console.error('Could not save the edit:', e.message); }
  }
  r.status(up401(x.status)).json(x.ok ? out : dcErr(out));
}));
app.get('/api/sent', wrap(async (q, r) => r.json(await db.listSent())));
app.get('/api/sent/:id', wrap(async (q, r) => {
  const rec = await db.getSent(q.params.id);
  if (!rec) return bad(r, 'Not found', 404);
  let gone = false, att = rec.attachments || [];
  try { const x = await dc(`/channels/${rec.channelId}/messages/${rec.messageId}`); if (x.status == 404) gone = true; else if (x.ok) att = atts(await x.json()); } catch { /* use stored */ }
  r.json({ ...rec, attachments: att, gone });
}));
app.delete('/api/sent/:id', wrap(async (q, r) => { await db.delSent(q.params.id); r.json({ ok: true }); }));

// Templates (state + uploaded images)
app.get('/api/templates', wrap(async (q, r) => r.json(await db.listTpl())));
app.get('/api/templates/:id', wrap(async (q, r) => { const t = await db.getTpl(q.params.id); t ? r.json(t) : bad(r, 'Not found', 404); }));
app.post('/api/templates', wrap(async (q, r) => {
  const name = String(q.body.name || '').trim().slice(0, 80);
  if (!name || !q.body.state || typeof q.body.state !== 'object') return bad(r, 'Invalid data');
  const assets = {}; let total = 0;
  for (const [k, a] of Object.entries(q.body.assets || {})) {
    if (!a || typeof a.data !== 'string' || !/^image\//.test(a.type || '')) continue;
    total += a.data.length; if (total > 11e6) return bad(r, 'Images are too large for a template (about 8 MB maximum in total).');
    assets[k.slice(0, 120)] = { type: a.type, data: a.data };
  }
  r.json({ id: await db.saveTpl(name, q.body.state, assets) });
}));
app.delete('/api/templates/:id', wrap(async (q, r) => { await db.delTpl(q.params.id); r.json({ ok: true }); }));

// ---------- Bot settings (admin) ----------
const STATUSES = ['online', 'idle', 'dnd', 'invisible'], ACTS = ['Playing', 'Watching', 'Listening', 'Competing', 'Custom'];
function applyPresence() {
  if (!bot.isReady()) return;
  const b = settings.get('bot');
  const act = b.activityType === 'Custom' ? { name: 'Custom Status', state: b.activityText, type: ActivityType.Custom } : { name: b.activityText, type: ActivityType[b.activityType] };
  bot.user.setPresence({ status: b.status, activities: b.activityText ? [act] : [] });
}
app.get('/api/config/bot', adminOnly, (q, r) => r.json({ ...settings.get('bot'), botTag: bot.isReady() ? bot.user.tag : null, ready: bot.isReady() }));
app.put('/api/config/bot', adminOnly, wrap(async (q, r) => {
  const b = q.body || {};
  if (!STATUSES.includes(b.status) || !ACTS.includes(b.activityType)) return bad(r, 'Invalid status or activity type');
  await settings.save('bot', { status: b.status, activityType: b.activityType, activityText: String(b.activityText || '').slice(0, 120) });
  applyPresence(); r.json({ ok: true });
}));

// ---------- Helpline settings (admin) ----------
const str = (v, n) => String(v ?? '').slice(0, n);
const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const ids = a => [...new Set((Array.isArray(a) ? a : []).map(x => String(x).trim()).filter(x => /^\d{5,25}$/.test(x)))];
const urls = a => [...new Set((Array.isArray(a) ? a : []).map(x => String(x).trim()).filter(x => /^https?:\/\/\S+$/.test(x)))].slice(0, 100);
const hex = (v, d) => /^#[0-9a-f]{6}$/i.test(v || '') ? v : d;
const publicHelpline = s => { const c = JSON.parse(JSON.stringify(s)); c.ai.providers = c.ai.providers.map(p => { const env = process.env[String(p.id).toUpperCase().replace(/\W/g, '_') + '_API_KEY']; return { ...p, apiKey: '', hasKey: !!(p.apiKey || env), keyHint: p.apiKey ? '…' + p.apiKey.slice(-4) : (env ? 'from server environment' : '') }; }); return c; };
function cleanHelpline(b, old) {
  const d = D.helpline, g = b.general || {}, a = b.ai || {}, k = b.knowledge || {};
  const out = { general: {}, ai: {}, knowledge: {}, embeds: {}, messages: {}, snippets: [] };
  out.general = {
    categoryId: isId(g.categoryId) ? String(g.categoryId) : d.general.categoryId, modmailBotId: isId(g.modmailBotId) ? String(g.modmailBotId) : d.general.modmailBotId,
    allowedUsers: ids(g.allowedUsers), prefix: str(g.prefix, 3).trim() || '?', claimTimeoutMin: num(g.claimTimeoutMin, 1, 1440, 10), reminderHours: num(g.reminderHours, 1, 720, 24),
    warnCooldownSec: num(g.warnCooldownSec, 0, 3600, 30), firstSuggestionDelaySec: num(g.firstSuggestionDelaySec, 0, 60, 8),
    autoSuggest: !!g.autoSuggest, claimWarnings: !!g.claimWarnings, warnWhenUnclaimed: !!g.warnWhenUnclaimed, reminders: !!g.reminders
  };
  const oldP = Object.fromEntries(old.ai.providers.map(p => [p.id, p]));
  out.ai = {
    mode: a.mode === 'ensemble' ? 'ensemble' : 'fallback', temperature: num(a.temperature, 0, 1, 0.3), maxReplyChars: num(a.maxReplyChars, 200, 3000, 1500),
    businessEmail: str(a.businessEmail, 120), recruitmentEmail: str(a.recruitmentEmail, 120), systemRules: str(a.systemRules, 8000) || d.ai.systemRules, extraKnowledge: str(a.extraKnowledge, 20000),
    providers: (Array.isArray(a.providers) ? a.providers : []).slice(0, 12).filter(p => p && /^[a-z0-9_-]{2,30}$/.test(p.id || '')).map(p => ({
      id: p.id, name: str(p.name, 60) || p.id, type: p.type === 'gemini' ? 'gemini' : 'openai', enabled: !!p.enabled, model: str(p.model, 120).trim(),
      baseUrl: /^https?:\/\//.test(p.baseUrl || '') ? str(p.baseUrl, 300).trim() : '', apiKey: p.clearKey ? '' : (str(p.apiKey, 300).trim() || oldP[p.id]?.apiKey || '')
    }))
  };
  out.knowledge = {
    siteUrls: urls(k.siteUrls), jobsUrl: /^https?:\/\//.test(k.jobsUrl || '') ? String(k.jobsUrl).trim() : '', extraUrls: urls(k.extraUrls), maxPages: num(k.maxPages, 1, 300, 60),
    includeDiscord: !!k.includeDiscord, excludeChannelIds: ids(k.excludeChannelIds), maxMessagesPerChannel: num(k.maxMessagesPerChannel, 20, 2000, 300), refreshHours: num(k.refreshHours, 1, 720, 12)
  };
  for (const [key, def] of Object.entries(d.embeds)) {
    const e = (b.embeds || {})[key] || {}, o = {};
    for (const f of Object.keys(def)) o[f] = typeof def[f] === 'boolean' ? !!e[f] : f === 'color' ? hex(e[f], def.color) : str(e[f], f === 'description' || f === 'afterText' || f === 'emptyText' ? 4000 : 500);
    o.buttonStyle && !['Primary', 'Secondary', 'Success', 'Danger'].includes(o.buttonStyle) && (o.buttonStyle = 'Secondary');
    out.embeds[key] = o;
  }
  for (const key of Object.keys(d.messages)) out.messages[key] = str((b.messages || {})[key], 2000) || d.messages[key];
  out.snippets = (Array.isArray(b.snippets) ? b.snippets : []).slice(0, 80).filter(s => s && /^[a-z0-9_]{2,40}$/.test(s.name || '')).map(s => ({ name: s.name, desc: str(s.desc, 500), after: /^[a-z0-9_]{2,40}$/.test(s.after || '') ? s.after : '' }));
  return out;
}
app.get('/api/config/helpline', adminOnly, (q, r) => r.json(publicHelpline(settings.get('helpline'))));
app.put('/api/config/helpline', adminOnly, wrap(async (q, r) => {
  const c = cleanHelpline(q.body || {}, settings.get('helpline'));
  await settings.save('helpline', c); r.json(publicHelpline(c));
}));
app.get('/api/helpline/status', adminOnly, (q, r) => r.json({ bot: bot.isReady(), botTag: bot.isReady() ? bot.user.tag : null, db: db.kind(), knowledge: kb.status() }));
app.post('/api/helpline/rebuild', adminOnly, wrap(async (q, r) => r.json({ started: await kb.rebuild(bot) })));
app.get('/api/helpline/tickets', adminOnly, (q, r) => r.json(tk.list()));
app.post('/api/helpline/test', adminOnly, wrap(async (q, r) => {
  const msg = str(q.body?.message, 2000).trim(); if (!msg) return bad(r, 'Write a customer message to test.');
  try { r.json(await ai.suggest({ transcript: [{ role: 'customer', text: msg }], owner: 'test-user' })); } catch (e) { bad(r, e.message, 502); }
}));

app.use('/api', (q, r) => bad(r, 'Not found', 404));
app.use((e, q, r, n) => { console.error(e.message); if (!r.headersSent) r.status(400).json({ error: e.message }); });

// ---------- Bot ----------
const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
bot.once(Events.ClientReady, async () => {
  console.log('Bot connected as ' + bot.user.tag); applyPresence();
  try { await tk.init(bot); } catch (e) { console.error('Ticket system failed to start:', e.message); }
  const refresh = async () => { const h = settings.get('helpline').knowledge.refreshHours * 3600e3, s = kb.status(); if (!s.running && (!s.docs || Date.now() - s.finishedAt > h)) kb.rebuild(bot); };
  setTimeout(refresh, 8000); setInterval(refresh, 30 * 60 * 1000).unref();
});
bot.on(Events.Error, e => console.error('Bot error:', e.message));
bot.on(Events.InteractionCreate, i => {
  if (i.isStringSelectMenu()) handleSelect(i).catch(e => console.error('Menu error:', e.message));
  else if (i.isButton()) tk.onButton(i).catch(e => console.error('Button error:', e.message));
});

(async () => {
  try { await db.ready; await settings.load(); await kb.load(); } catch (e) { console.error('Startup load failed:', e.message); }
  if (T) bot.login(T).catch(e => console.error('⚠ Could not connect the bot:', e.message));
  const server = app.listen(PORT, '0.0.0.0', () => console.log('Listening on port ' + PORT));
  process.on('SIGTERM', () => { console.log('Shutting down…'); bot.destroy(); server.close(() => process.exit(0)); });
})();
