require('dotenv').config();
const crypto = require('crypto');
const express = require('express'), multer = require('multer');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { saveMenus, handleSelect } = require('./menus');
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
app.get('/health', (q, r) => r.json({ ok: true, bot: bot.isReady() }));

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

app.post('/api/send', up.array('files'), wrap(async (q, r) => {
  const { channelId, forum, threadName, tags, body, menus } = JSON.parse(q.body.payload);
  if (!isId(channelId)) return r.status(400).json({ error: 'ID de canal no válido' });
  const msg = { ...body, attachments: q.files.map((f, i) => ({ id: i, filename: f.originalname })) };
  const json = forum ? { name: threadName, applied_tags: tags || [], message: msg } : msg;
  const fd = new FormData();
  fd.append('payload_json', JSON.stringify(json));
  q.files.forEach((f, i) => fd.append(`files[${i}]`, new Blob([f.buffer]), f.originalname));
  const x = await dc(`/channels/${channelId}/${forum ? 'threads' : 'messages'}`, { method: 'POST', body: fd });
  const out = await x.json();
  if (x.ok && menus?.length) saveMenus(menus);
  r.status(x.status).json(out);
}));

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
