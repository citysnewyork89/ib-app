// Knowledge base: website crawler, Google Docs, YouTube, Discord channels + keyword search.
const crypto = require('crypto'), db = require('./db'), settings = require('./settings');
const UA = 'Mozilla/5.0 (compatible; IberiaHelplineBot/2.0)';
const URL_RE = /https?:\/\/[^\s<>)\]"'`]+/g, EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const STOP = new Set('the a an and or of to in on for with is are was were be been it this that these those you your we our i me my at by from as but not if so do does did can could would should will have has had there their they them what which who how when where why please hello hi thanks thank'.split(' '));
let docs = new Map(), chunks = [], df = new Map(), known = new Set(), emails = new Set(), liveCache = { t: 0, text: '' };
const status = { running: false, step: 'idle', startedAt: 0, finishedAt: 0, docs: 0, chunks: 0, errors: [] };
const err = m => { status.errors.push(String(m).slice(0, 200)); if (status.errors.length > 30) status.errors.shift(); };
const id16 = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

const norm = u => { try { const x = new URL(u); const yt = /youtu/.test(x.hostname); return x.hostname.toLowerCase().replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + (yt ? x.search : ''); } catch { return String(u); } };
const cleanUrl = u => u.replace(/[.,;:!?]+$/, '');
const ent = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n));
const tokenize = s => (String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) || []).filter(t => t.length > 1 && !STOP.has(t));

async function get(url, ms = 20000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,text/plain,application/json,*/*' }, redirect: 'follow', signal: ac.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return { text: (await r.text()).slice(0, 2_000_000), type: r.headers.get('content-type') || '', url: r.url };
  } finally { clearTimeout(t); }
}

function htmlToText(html, base) {
  const title = ent(((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '').replace(/\s+/g, ' ').trim());
  const links = [];
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)/gi)) { try { links.push(new URL(ent(m[1]), base).href); } catch { /* skip */ } }
  const bits = [];
  for (const m of html.matchAll(/<script[^>]*(?:type=["']application\/(?:ld\+)?json["']|id=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi)) bits.push(m[1]);
  let t = html.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section)[^>]*>/gi, '\n').replace(/<li[^>]*>/gi, '- ').replace(/<[^>]+>/g, ' ');
  t = ent(t).replace(/[ \t\f\r]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length < 400 && bits.length) t += '\n' + [...new Set((bits.join(' ').match(/"([^"\\]{25,400})"/g) || []).map(x => x.slice(1, -1)).filter(x => !/^https?:|^[\w/.-]+$/.test(x)))].join('\n');
  return { title, text: t.slice(0, 80000), links };
}

const rootHost = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const sameSite = (u, host) => { const h = rootHost(u); return h === host || h.endsWith('.' + host); };
const SKIP = /\.(png|jpe?g|gif|svg|webp|css|js|json|pdf|zip|ico|woff2?|ttf|mp4|mp3|xml)(\?|$)/i;

async function crawl(starts, maxPages) {
  const out = [], seen = new Set(), queue = [];
  const host = rootHost(starts[0] || '');
  const add = u => { const k = norm(u); if (!seen.has(k) && !SKIP.test(u) && (!host || sameSite(u, host))) { seen.add(k); queue.push(u); } };
  starts.forEach(add);
  if (host) { try { const sm = await get('https://' + host + '/sitemap.xml', 10000); for (const m of sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)) add(ent(m[1].trim())); } catch { /* no sitemap */ } }
  async function worker() {
    while (queue.length && out.length < maxPages) {
      const u = queue.shift();
      try {
        const r = await get(u); if (!/html|text/.test(r.type) && r.type) continue;
        const d = htmlToText(r.text, r.url);
        if (d.text.length >= 40) out.push({ source: r.url, type: 'web', title: d.title, text: d.text, links: d.links.filter(l => /^https?:/.test(l)).slice(0, 300) });
        d.links.forEach(add);
      } catch (e) { err('Web ' + u + ': ' + e.message); }
    }
  }
  await Promise.all([1, 2, 3, 4].map(worker));
  return out;
}

const gdoc = u => { const m = /docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([\w-]+)/.exec(u); return m && { kind: m[1], id: m[2] }; };
async function fetchGoogle(u) {
  const g = gdoc(u); if (!g) return null;
  const url = g.kind === 'document' ? `https://docs.google.com/document/d/${g.id}/export?format=txt` : g.kind === 'spreadsheets' ? `https://docs.google.com/spreadsheets/d/${g.id}/export?format=csv` : `https://docs.google.com/presentation/d/${g.id}/export/txt`;
  const r = await get(url);
  if (/<html/i.test(r.text.slice(0, 500))) throw new Error('not public');
  return { source: u, type: 'gdoc', title: 'Google ' + g.kind, text: r.text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 80000), links: [] };
}
const ytId = u => { const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/))([\w-]{11})/.exec(u); return m && m[1]; };
async function fetchYoutube(u) {
  const id = ytId(u); if (!id) return null;
  let title = '', author = '', cap = '';
  try { const o = JSON.parse((await get('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id), 10000)).text); title = o.title || ''; author = o.author_name || ''; } catch { /* ignore */ }
  try {
    const page = (await get('https://www.youtube.com/watch?v=' + id, 15000)).text, m = /"captionTracks":\[(.*?)\]/.exec(page);
    const base = m && /"baseUrl":"([^"]+)"/.exec(m[1]);
    if (base) { const x = (await get(JSON.parse('"' + base[1] + '"'), 15000)).text; cap = ent([...x.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(a => a[1]).join(' ')); }
  } catch { /* no captions */ }
  if (!title && !cap) return null;
  return { source: 'https://www.youtube.com/watch?v=' + id, type: 'youtube', title, text: `Video: ${title}\nChannel: ${author}\n${cap}`.slice(0, 60000), links: [] };
}

async function discordDocs(client, S, sink) {
  const out = [], guild = await client.guilds.fetch(process.env.GUILD_ID), chans = await guild.channels.fetch(), me = guild.members.me || await guild.members.fetchMe();
  const skip = new Set([S.general.categoryId, ...S.knowledge.excludeChannelIds].filter(Boolean)), max = S.knowledge.maxMessagesPerChannel;
  const text = m => [m.content, ...m.embeds.map(e => [e.title, e.description, ...(e.fields || []).map(f => f.name + ': ' + f.value)].filter(Boolean).join('\n'))].filter(Boolean).join('\n');
  async function read(ch) {
    const lines = []; let before;
    while (lines.length < max) {
      const b = await ch.messages.fetch({ limit: 100, before }); if (!b.size) break;
      for (const m of b.values()) { const t = text(m); if (t.trim()) { lines.push(t.trim()); (t.match(URL_RE) || []).forEach(u => sink.add(cleanUrl(u))); } }
      before = b.last().id;
    }
    return lines.reverse().join('\n\n');
  }
  for (const ch of chans.values()) {
    try {
      if (!ch || skip.has(ch.id) || skip.has(ch.parentId)) continue;
      const p = ch.permissionsFor(me); if (!p || !p.has(['ViewChannel', 'ReadMessageHistory'])) continue;
      if (ch.type === 0 || ch.type === 5) { const t = await read(ch); if (t) out.push({ source: 'discord://' + ch.id, type: 'discord', title: '#' + ch.name, text: t.slice(0, 100000), links: [] }); }
      else if (ch.type === 15) {
        const th = [...(await ch.threads.fetchActive()).threads.values(), ...(await ch.threads.fetchArchived({ limit: 30 })).threads.values()].slice(0, 40);
        let all = '';
        for (const t of th) { try { const x = await read(t); if (x) all += `## ${t.name}\n${x}\n\n`; } catch { /* skip */ } }
        if (all) out.push({ source: 'discord://' + ch.id, type: 'discord', title: '#' + ch.name + ' (forum)', text: all.slice(0, 100000), links: [] });
      }
    } catch (e) { err('Discord #' + (ch && ch.name) + ': ' + e.message); }
  }
  return out;
}

function chunkText(t, size = 1200, over = 150) {
  const out = []; let i = 0;
  while (i < t.length) { let e = Math.min(i + size, t.length); if (e < t.length) { const n = t.lastIndexOf('\n', e); if (n > i + size * 0.5) e = n; } out.push(t.slice(i, e).trim()); if (e >= t.length) break; i = e - over; }
  return out.filter(Boolean);
}
function buildIndex() {
  chunks = []; df = new Map(); known = new Set(); emails = new Set();
  for (const d of docs.values()) {
    for (const part of chunkText(d.text)) {
      const tf = new Map(); for (const t of tokenize(part + ' ' + d.title + ' ' + d.source)) tf.set(t, (tf.get(t) || 0) + 1);
      chunks.push({ d, text: part, tf }); for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    }
    known.add(norm(d.source)); (d.links || []).forEach(l => known.add(norm(l)));
    (d.text.match(URL_RE) || []).forEach(u => known.add(norm(cleanUrl(u)))); (d.text.match(EMAIL_RE) || []).forEach(e => emails.add(e.toLowerCase()));
  }
  status.docs = docs.size; status.chunks = chunks.length;
}
const W = { web: 1.25, gdoc: 1.15, youtube: 1, discord: 1 };
function search(query, k = 8) {
  const q = [...new Set(tokenize(query))]; if (!q.length || !chunks.length) return [];
  const N = chunks.length;
  const scored = chunks.map(c => { let s = 0; for (const t of q) { const f = c.tf.get(t); if (f) s += (f / (f + 1.2)) * Math.log(1 + N / (df.get(t) || 1)); } return { c, s: s * (W[c.d.type] || 1) }; }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  const per = new Map(), out = [];
  for (const x of scored) { const n = per.get(x.c.d.id) || 0; if (n >= 3) continue; per.set(x.c.d.id, n + 1); out.push({ source: x.c.d.source, title: x.c.d.title, text: x.c.text }); if (out.length >= k) break; }
  return out;
}
function isKnownUrl(u) {
  const S = settings.get('helpline').knowledge, k = norm(cleanUrl(u));
  if (known.has(k)) return true;
  return [...S.siteUrls, S.jobsUrl, ...S.extraUrls].filter(Boolean).some(x => norm(x) === k);
}
const isKnownEmail = e => { const a = settings.get('helpline').ai; return emails.has(e.toLowerCase()) || [a.businessEmail, a.recruitmentEmail].some(x => (x || '').toLowerCase() === e.toLowerCase()); };

async function liveJobs() {
  const u = settings.get('helpline').knowledge.jobsUrl; if (!u) return '';
  if (Date.now() - liveCache.t < 600000 && liveCache.u === u) return liveCache.text;
  const r = await get(u, 15000), t = htmlToText(r.text, r.url).text.slice(0, 7000);
  liveCache = { t: Date.now(), text: t, u }; return t;
}

async function load() {
  docs = new Map((await db.col('knowledge').all()).map(d => [d.id, d]));
  buildIndex();
  const m = await db.col('cfg').get('kbmeta'); if (m) status.finishedAt = m.finishedAt || 0;
}
async function rebuild(client) {
  if (status.running) return false;
  Object.assign(status, { running: true, step: 'Starting', startedAt: Date.now(), errors: [] });
  (async () => {
    try {
      const S = settings.get('helpline'), K = S.knowledge, found = [], links = new Set();
      status.step = 'Reading website'; found.push(...await crawl(K.siteUrls.filter(Boolean), K.maxPages));
      if (K.includeDiscord && client && client.isReady()) { status.step = 'Reading Discord channels'; found.push(...await discordDocs(client, S, links)); }
      status.step = 'Reading linked documents and videos';
      const have = new Set(found.map(d => norm(d.source))), extra = [...K.extraUrls, ...links];
      let nWeb = 0, nG = 0, nY = 0;
      for (const u of [...new Set(extra)]) {
        const k = norm(u); if (have.has(k)) continue; have.add(k);
        try {
          let d = null;
          if (gdoc(u) && nG < 40) { nG++; d = await fetchGoogle(u); }
          else if (ytId(u) && nY < 15) { nY++; d = await fetchYoutube(u); }
          else if (K.extraUrls.includes(u) || (/^https?:/.test(u) && sameSite(u, 'iberiaroblox.com') && nWeb < 40)) { nWeb++; const r = await get(u); const h = htmlToText(r.text, r.url); if (h.text.length >= 40) d = { source: r.url, type: 'web', title: h.title, text: h.text, links: h.links.slice(0, 200) }; }
          if (d) found.push(d);
        } catch (e) { err(u.slice(0, 70) + ': ' + e.message); }
      }
      status.step = 'Indexing';
      const next = new Map(); for (const d of found) { d.id = id16(d.source); d.updated = Date.now(); next.set(d.id, d); }
      if (next.size) { docs = next; await db.col('knowledge').clear(); await db.col('knowledge').putMany([...docs.values()].map(d => [d.id, d])); }
      else err('No content was found; the previous knowledge base was kept.');
      buildIndex(); status.finishedAt = Date.now(); await db.col('cfg').put('kbmeta', { finishedAt: status.finishedAt });
      status.step = 'Done';
    } catch (e) { err(e.message); status.step = 'Failed'; console.error('Knowledge rebuild failed:', e.message); }
    status.running = false;
  })();
  return true;
}
module.exports = { load, rebuild, search, liveJobs, isKnownUrl, isKnownEmail, status: () => ({ ...status }), htmlToText, tokenize, chunkText, _set: d => { docs = new Map(d.map(x => [x.id, x])); buildIndex(); } };
