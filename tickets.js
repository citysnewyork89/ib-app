// Helpline ticket logic: detects modmail tickets, AI suggestions, claim system, warnings and reminders.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./db'), settings = require('./settings'), ai = require('./ai');
const tickets = new Map(), cooldown = new Map(), suggestCd = new Map();
let client = null;
const cfg = () => settings.get('helpline'), G = () => cfg().general;
const col = () => db.col('tickets');
const save = rec => col().put(rec.channelId, rec).catch(e => console.error('Ticket save failed:', e.message));
const fill = (s, v) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => k in v ? v[k] : m);
const mention = id => `<@${id}>`;
const vars = (rec, x = {}) => ({
  owner: rec.ownerId ? mention(rec.ownerId) : (rec.ownerName || 'the user'), ownerId: rec.ownerId || '', ownerName: rec.ownerName || '',
  channel: `<#${rec.channelId}>`, channel_url: `https://discord.com/channels/${rec.guildId}/${rec.channelId}`,
  timeout: G().claimTimeoutMin, claimers: rec.claimers.map(c => mention(c.id)).join(', '), ...x
});
const say = (ch, text, extra = {}) => ch.send({ content: String(text).slice(0, 2000), allowedMentions: { parse: [] }, ...extra }).catch(e => console.error('Send failed:', e.message));
const colorOf = h => /^#[0-9a-f]{6}$/i.test(h || '') ? parseInt(h.slice(1), 16) : 0x1c1c1c;

function embedFrom(c, v, over = {}) {
  const e = new EmbedBuilder().setColor(colorOf(c.color));
  const title = fill(c.title, v).slice(0, 256), desc = fill(over.description ?? c.description, v).slice(0, 4096);
  if (title) e.setTitle(title); if (desc) e.setDescription(desc);
  if (c.footer) e.setFooter({ text: fill(c.footer, v).slice(0, 2048) });
  if (/^https?:\/\//.test(c.thumbnail || '')) e.setThumbnail(c.thumbnail);
  if (/^https?:\/\//.test(c.image || '')) e.setImage(c.image);
  if (c.timestamp) e.setTimestamp();
  return e;
}
function suggestionEmbed(res, rec) {
  const c = cfg().embeds.suggestion, v = vars(rec), note = fill(c.description, v);
  const body = res.reply ? '```\n' + res.reply.slice(0, Math.max(200, 3800 - note.length)) + '\n```' : fill(c.emptyText, v);
  const e = embedFrom(c, v, { description: note + '\n\n' + body });
  if (res.commands.length) {
    let val = ''; const extra = [];
    for (const m of res.commands) {
      val += '```\n' + m.text + '\n```';
      if (m.after) extra.push(fill(c.afterText, { ...v, snippet: m.text, after: m.after }));
    }
    e.addFields({ name: fill(c.commandsTitle, v).slice(0, 256) || 'Suggested commands', value: (val + (extra.length ? '\n' + extra.join('\n') : '')).slice(0, 1024) });
  }
  return e;
}

// ---- modmail message parsing ----
function parseInfo(msg) {
  for (const e of msg.embeds || []) {
    const blob = [e.title, e.description, e.footer?.text, ...(e.fields || []).map(f => f.name + ' ' + f.value)].filter(Boolean).join('\n');
    const m = /User ID:\s*(\d{15,25})/i.exec(blob); if (!m) continue;
    const name = (/@?([^\s@]+)\s+was created/i.exec(e.description || '') || [])[1] || e.author?.name || '';
    return { userId: m[1], name: String(name).replace(/#0$/, '') };
  }
  return null;
}
// 'customer' | 'staff' | 'info' | 'system'
function classify(msg, rec) {
  const e = msg.embeds && msg.embeds[0];
  if (!e) {
    const t = msg.content || ''; if (!t) return 'system';
    return rec && rec.ownerName && t.toLowerCase().startsWith('**' + rec.ownerName.toLowerCase()) ? 'customer' : 'system';
  }
  const foot = (e.footer?.text || '').toLowerCase(), author = (e.author?.name || '').toLowerCase();
  if (/user id:\s*\d+/.test(foot) || parseInfo(msg)) return 'info';
  if (/staff|response|note|anonymous/.test(foot)) return 'staff';
  if (/message id/.test(foot)) return 'customer';
  if (rec && rec.ownerName && author.includes(rec.ownerName.toLowerCase())) return 'customer';
  return 'system';
}
const textOf = msg => (msg.embeds?.[0]?.description || msg.content || '').trim();

// ---- records ----
function create(ch, info, at) {
  const rec = { channelId: ch.id, guildId: ch.guildId, ownerId: info.userId, ownerName: info.name, openedAt: at || Date.now(), claimers: [], hadStaffReply: false, lastCustomerAt: 0, lastStaffAt: 0, nextReminderAt: 0, introSent: false };
  tickets.set(ch.id, rec); save(rec); return rec;
}
async function recover(ch) {
  try {
    const ms = await ch.messages.fetch({ limit: 100, after: '0' });
    for (const m of [...ms.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp))
      if (m.author.id === G().modmailBotId) { const i = parseInfo(m); if (i) { const r = create(ch, i, m.createdTimestamp); r.introSent = true; return r; } }
  } catch (e) { console.error('Ticket recovery failed:', e.message); }
  return null;
}
async function getRec(ch) { return tickets.get(ch.id) || recover(ch); }

async function transcript(ch, rec) {
  const ms = [...(await ch.messages.fetch({ limit: 60 })).values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp), out = [], p = G().prefix;
  for (const m of ms) {
    if (m.author.id === client.user.id) continue;
    if (m.author.id === G().modmailBotId) { const k = classify(m, rec); if (k === 'customer' || k === 'staff') { const t = textOf(m); if (t) out.push({ role: k, text: t.slice(0, 1500) }); } continue; }
    if (m.author.bot) continue;
    const t = (m.content || '').trim(); if (!t) continue;
    if (t.startsWith(p)) { const c = t.slice(p.length).split(/\s+/)[0].toLowerCase(); if (['claim', 'addmeclaim', 'suggestion'].includes(c)) continue; out.push({ role: 'staff', text: `(ran snippet/command ${p}${c}) ${t.slice(p.length + c.length).trim()}`.trim() }); }
    else out.push({ role: 'staff', text: t.slice(0, 1500) });
  }
  return out.slice(-30);
}

// ---- intro flow ----
async function intro(ch, rec) {
  if (rec.introSent) return; rec.introSent = true; save(rec);
  const E = cfg().embeds, g = G(), v = vars(rec);
  try {
    const content = fill(E.ticketAlert.content, v).trim();
    await ch.send({ content: content || undefined, embeds: [embedFrom(E.ticketAlert, v)], allowedMentions: { parse: /@(here|everyone)/.test(content) ? ['everyone'] : [] } });
  } catch (e) { console.error('Alert failed:', e.message); }
  if (g.autoSuggest) {
    for (let i = 0; i < g.firstSuggestionDelaySec && !rec.lastCustomerAt; i++) await new Promise(r => setTimeout(r, 1000));
    if (rec.lastCustomerAt) await new Promise(r => setTimeout(r, 1500));
    try { await ch.sendTyping(); const res = await ai.suggest({ transcript: await transcript(ch, rec), owner: rec.ownerName }); await ch.send({ embeds: [suggestionEmbed(res, rec)], allowedMentions: { parse: [] } }); }
    catch (e) { console.error('Auto suggestion failed:', e.message); await say(ch, cfg().messages.suggestionError); }
  }
  const c = E.claim, v2 = vars(rec);
  const style = ButtonStyle[c.buttonStyle] || ButtonStyle.Secondary;
  await ch.send({ embeds: [embedFrom(c, v2)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('tk_claim').setLabel((c.buttonLabel || 'Claim ticket').slice(0, 80)).setStyle(style))], allowedMentions: { parse: [] } })
    .catch(e => console.error('Claim embed failed:', e.message));
}

// ---- claim logic ----
function doClaim(rec, uid, add) {
  if (!rec.claimers.length) { rec.claimers.push({ id: uid, at: Date.now(), responded: false }); save(rec); return 'claimed'; }
  if (rec.claimers.some(c => c.id === uid)) return 'mine';
  if (add) { rec.claimers.push({ id: uid, at: Date.now(), responded: false }); save(rec); return 'added'; }
  return 'taken';
}
function claimText(status, rec, uid) {
  const M = cfg().messages, v = vars(rec, { claimer: mention(uid) });
  return fill({ claimed: M.claimSuccess, added: M.addClaimSuccess, mine: M.alreadyClaimedByYou, taken: M.alreadyClaimed }[status], v);
}

async function onMessage(msg) {
  const g = G(), ch = msg.channel;
  if (!msg.guild || msg.author.id === client.user.id || ch.parentId !== g.categoryId || ch.isThread?.()) return;
  let rec = tickets.get(ch.id);
  if (msg.author.id === g.modmailBotId) {
    const info = parseInfo(msg);
    if (info && !rec) { rec = create(ch, info, msg.createdTimestamp); intro(ch, rec).catch(e => console.error('Intro failed:', e.message)); return; }
    if (!rec) return;
    const k = classify(msg, rec);
    if (k === 'customer') { const was = rec.lastCustomerAt > rec.lastStaffAt; rec.lastCustomerAt = Date.now(); if (!was) rec.nextReminderAt = Date.now() + g.reminderHours * 3600e3; save(rec); }
    return;
  }
  if (msg.author.bot) return;
  rec = rec || await recover(ch); if (!rec) return;
  const text = (msg.content || '').trim(), p = g.prefix, cmd = text.toLowerCase().startsWith(p) ? text.slice(p.length).split(/\s+/)[0].toLowerCase() : '';
  if (cmd === 'claim' || cmd === 'addmeclaim') { const s = doClaim(rec, msg.author.id, cmd === 'addmeclaim'); return say(ch, claimText(s, rec, msg.author.id)); }
  if (cmd === 'suggestion') return manualSuggestion(msg, rec);
  const mine = rec.claimers.find(c => c.id === msg.author.id);
  if (mine) { mine.responded = true; rec.hadStaffReply = true; rec.lastStaffAt = Date.now(); rec.nextReminderAt = 0; save(rec); return; }
  if (!g.claimWarnings || g.allowedUsers.includes(msg.author.id)) return;
  if (!rec.claimers.length && !g.warnWhenUnclaimed) return;
  const k = ch.id + ':' + msg.author.id; if (Date.now() - (cooldown.get(k) || 0) < g.warnCooldownSec * 1000) return;
  cooldown.set(k, Date.now());
  say(ch, fill(cfg().messages.notClaimedWarning, vars(rec, { claimer: mention(msg.author.id) })));
}
async function manualSuggestion(msg, rec) {
  const ch = msg.channel;
  if (Date.now() - (suggestCd.get(ch.id) || 0) < 8000) return; suggestCd.set(ch.id, Date.now());
  try { await ch.sendTyping(); const res = await ai.suggest({ transcript: await transcript(ch, rec), owner: rec.ownerName }); await ch.send({ embeds: [suggestionEmbed(res, rec)], allowedMentions: { parse: [] } }); }
  catch (e) { console.error('Suggestion failed:', e.message); await say(ch, cfg().messages.suggestionError); }
}
async function onButton(i) {
  if (i.customId !== 'tk_claim') return;
  const rec = await getRec(i.channel);
  if (!rec) return i.reply({ content: cfg().messages.notATicket, flags: 64 });
  const s = doClaim(rec, i.user.id, false);
  return i.reply({ content: claimText(s, rec, i.user.id).slice(0, 2000), allowedMentions: { parse: [] }, ...(s === 'claimed' ? {} : { flags: 64 }) });
}

// ---- timers ----
async function tick() {
  const g = G(), now = Date.now();
  for (const rec of tickets.values()) {
    try {
      for (const c of [...rec.claimers]) {
        if (c.responded || now - c.at < g.claimTimeoutMin * 60000) continue;
        rec.claimers = rec.claimers.filter(x => x.id !== c.id); save(rec);
        const ch = client.channels.cache.get(rec.channelId) || await client.channels.fetch(rec.channelId).catch(() => null);
        if (ch) await say(ch, fill(cfg().messages.autoUnclaim, vars(rec, { claimer: mention(c.id) })));
      }
      if (g.reminders && rec.claimers.length && rec.hadStaffReply && rec.lastCustomerAt > rec.lastStaffAt && rec.nextReminderAt && now >= rec.nextReminderAt) {
        rec.nextReminderAt = now + g.reminderHours * 3600e3; save(rec);
        for (const c of rec.claimers) { try { const u = await client.users.fetch(c.id); await u.send({ content: fill(cfg().messages.dmReminder, vars(rec)).slice(0, 2000), allowedMentions: { parse: [] } }); } catch (e) { console.error('DM reminder failed:', e.message); } }
      }
    } catch (e) { console.error('Tick error:', e.message); }
  }
}
async function init(c) {
  client = c;
  for (const r of await col().all()) { const { id, ...x } = r; tickets.set(id, { ...x, channelId: id, claimers: x.claimers || [] }); }
  client.on('messageCreate', m => onMessage(m).catch(e => console.error('Message handler:', e.message)));
  client.on('channelDelete', ch => { if (tickets.delete(ch.id)) col().del(ch.id).catch(() => {}); });
  setInterval(() => tick().catch(() => {}), 20000).unref();
}
const list = () => [...tickets.values()].sort((a, b) => b.openedAt - a.openedAt).map(r => ({ channelId: r.channelId, ownerId: r.ownerId, ownerName: r.ownerName, openedAt: r.openedAt, claimers: r.claimers.map(c => c.id), hadStaffReply: r.hadStaffReply, lastCustomerAt: r.lastCustomerAt, lastStaffAt: r.lastStaffAt }));
module.exports = { init, onButton, list, parseInfo, classify, suggestionEmbed, _fill: fill };
