require('dotenv').config();
const crypto = require('crypto');
const express = require('express'), multer = require('multer');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { handleSelect } = require('./menus');
const db = require('./db');
const { DISCORD_TOKEN: T, GUILD_ID: G, ADMIN_PASSWORD: P, PORT = 3000 } = process.env;
const P2 = (P || '').trim();

console.log(P2 ? 'ADMIN_PASSWORD cargada' : '⚠ ADMIN_PASSWORD VACÍA: nadie podrá entrar al panel');
console.log(T ? 'DISCORD_TOKEN cargado' : '⚠ DISCORD_TOKEN vacío', '|', G ? 'GUILD_ID cargado' : '⚠ GUILD_ID vacío');

// Que un error suelto nunca tire el servidor (importante para estar 24/7)
process.on('unhandledRejection', e => console.error('unhandledRejection:', e && e.message || e));
process.on('uncaughtException', e => console.error('uncaughtException:', e && e.message || e));

const app = express();
const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 10 } });
const dc = (path, opt = {}) => fetch('https://discord.com/api/v10' + path, { ...opt, headers: { Authorization: 'Bot ' + T, ...(opt.headers || {}) } });
const wrap = fn => (q, r) => Promise.resolve(fn(q, r)).catch(e => { console.error(e.message); if (!r.headersSent) r.status(500).json({ error: 'Error interno' }); });
const isId = s => /^\d{5,25}$/.test(String(s || ''));

// Render va detrás de un proxy: así req.ip es la IP real
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Cabeceras de seguridad
app.use((q, r, n) => {
  r.setHeader('X-Content-Type-Options', 'nosniff');
  r.setHeader('X-Frame-Options', 'DENY');
  r.setHeader('Referrer-Policy', 'no-referrer');
  r.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  n();
});

// Health check (Render lo usa para saber que el servicio está vivo)
app.get('/health', (q, r) => r.json({ ok: true, bot: bot.isReady(), db: db.kind() }));

app.use(express.static('public'));

// Contraseña con comparación segura + límite de intentos fallidos por IP
const fails = new Map(), MAX_FAILS = 10, WINDOW = 15 * 60 * 1000;
setInterval(() => { const t = Date.now(); for (const [k, v] of fails) if (t - v.t > WINDOW) fails.delete(k); }, 60 * 1000).unref();
const sha = s => crypto.createHash('sha256').update(s).digest();
const passOk = given => crypto.timingSafeEqual(sha(given), sha(P2));

app.use('/api', (q, r, n) => {
  const f = fails.get(q.ip);
  if (f && Date.now() - f.t < WINDOW && f.n >= MAX_FAILS) return r.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
  if (P2 && passOk((q.headers['x-password'] || '').trim())) { fails.delete(q.ip); return n(); }
  const cur = f && Date.now() - f.t < WINDOW ? f : { n: 0 };
  fails.set(q.ip, { n: cur.n + 1, t: Date.now() });
  r.status(401).json({ error: 'Contraseña incorrecta' });
});

app.use('/api', express.json({ limit: '2mb' }));

app.get('/api/channels', wrap(async (q, r) => {
  const x = await dc(`/guilds/${G}/channels`), j = await x.json();
  if (!x.ok) return r.status(x.status).json(j);
  r.json(j.filter(c => [0, 5, 15].includes(c.type)).map(c => ({ id: c.id, name: c.name, type: c.type, tags: c.available_tags || [] })));
}));

app.get('/api/threads/:forum', wrap(async (q, r) => {
  const f = q.params.forum;
  if (!isId(f)) return r.status(400).json({ error: 'ID de foro no válido' });
  const [a, b] = await Promise.all([dc(`/guilds/${G}/threads/active`).then(x => x.json()), dc(`/channels/${f}/threads/archived/public?limit=50`).then(x => x.json())]);
  r.json([...(a.threads || []).filter(t => t.parent_id == f), ...(b.threads || [])].map(t => ({ id: t.id, name: t.name })));
}));

app.get('/api/emojis', wrap(async (q, r) => {
  const j = await (await dc(`/guilds/${G}/emojis`)).json();
  r.json(Array.isArray(j) ? j.map(e => ({ id: e.id, name: e.name, animated: e.animated })) : []);
}));

const nameOf = (b, st) => { const t = st?.mode == 'classic' ? (st.content || st.embeds?.[0]?.title) : st?.blocks?.find(x => x.t == 'text' || x.t == 'sec')?.content; return String(t || '(sin texto)').replace(/[#*`]/g, '').trim().split('\n')[0].slice(0, 60); };
const atts = m => (m?.attachments || []).map(a => ({ id: a.id, filename: a.filename, url: a.url }));
const mkForm = (json, files) => { const fd = new FormData(); fd.append('payload_json', JSON.stringify(json)); files.forEach((f, i) => fd.append(`files[${i}]`, new Blob([f.buffer]), f.originalname)); return fd; };

app.post('/api/send', up.array('files'), wrap(async (q, r) => {
  const { channelId, forum, threadName, tags, body, menus, state, channelName } = JSON.parse(q.body.payload);
  if (!isId(channelId)) return r.status(400).json({ error: 'ID de canal no válido' });
  const msg = { ...body, attachments: q.files.map((f, i) => ({ id: i, filename: f.originalname })) };
  const json = forum ? { name: threadName, applied_tags: tags || [], message: msg } : msg;
  const x = await dc(`/channels/${channelId}/${forum ? 'threads' : 'messages'}`, { method: 'POST', body: mkForm(json, q.files) });
  const out = await x.json();
  if (x.ok) {
    try {
      await db.saveMenus(menus);
      const m = forum ? (out.message || out) : out;
      await db.addSent({ id: db.rid(), channelId: forum ? out.id : channelId, messageId: forum ? (out.message?.id || out.id) : out.id, channelName: channelName || '', label: nameOf(body, state), state, attachments: atts(m), menuIds: (menus || []).map(z => z.id), ts: Date.now() });
    } catch (e) { console.error('No se pudo guardar en la base de datos:', e.message); }
  }
  r.status(x.status).json(out);
}));

// Editar un mensaje ya enviado por el bot desde este panel
app.post('/api/edit/:id', up.array('files'), wrap(async (q, r) => {
  const rec = await db.getSent(q.params.id);
  if (!rec) return r.status(404).json({ error: 'Mensaje no encontrado en la base de datos' });
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
    } catch (e) { console.error('No se pudo guardar la edición:', e.message); }
  }
  r.status(x.status).json(out);
}));

app.get('/api/sent', wrap(async (q, r) => r.json(await db.listSent())));
app.get('/api/sent/:id', wrap(async (q, r) => {
  const rec = await db.getSent(q.params.id);
  if (!rec) return r.status(404).json({ error: 'No existe' });
  let gone = false, att = rec.attachments || [];
  try { const x = await dc(`/channels/${rec.channelId}/messages/${rec.messageId}`); if (x.status == 404) gone = true; else if (x.ok) att = atts(await x.json()); } catch { /* usa lo guardado */ }
  r.json({ ...rec, attachments: att, gone });
}));
app.delete('/api/sent/:id', wrap(async (q, r) => { await db.delSent(q.params.id); r.json({ ok: true }); }));

// Plantillas de mensajes
app.get('/api/templates', wrap(async (q, r) => r.json(await db.listTpl())));
app.get('/api/templates/:id', wrap(async (q, r) => { const t = await db.getTpl(q.params.id); t ? r.json(t) : r.status(404).json({ error: 'No existe' }); }));
app.post('/api/templates', wrap(async (q, r) => {
  const name = String(q.body.name || '').trim().slice(0, 80);
  if (!name || !q.body.state || typeof q.body.state !== 'object') return r.status(400).json({ error: 'Datos no válidos' });
  r.json({ id: await db.saveTpl(name, q.body.state) });
}));
app.delete('/api/templates/:id', wrap(async (q, r) => { await db.delTpl(q.params.id); r.json({ ok: true }); }));

// Errores de subida (archivo demasiado grande, etc.)
app.use((e, q, r, n) => { console.error(e.message); r.status(400).json({ error: e.message }); });

// Bot conectado (necesario para responder a los desplegables)
const bot = new Client({ intents: [GatewayIntentBits.Guilds] });
bot.once(Events.ClientReady, () => console.log('Bot conectado como ' + bot.user.tag));
bot.on(Events.Error, e => console.error('Error del bot:', e.message));
bot.on(Events.InteractionCreate, i => { if (i.isStringSelectMenu()) handleSelect(i).catch(e => console.error('Error en menú:', e.message)); });
if (T) bot.login(T).catch(e => console.error('⚠ No se pudo conectar el bot:', e.message));

const server = app.listen(PORT, '0.0.0.0', () => console.log('Listo en el puerto ' + PORT));
process.on('SIGTERM', () => { console.log('Apagando…'); bot.destroy(); server.close(() => process.exit(0)); });
