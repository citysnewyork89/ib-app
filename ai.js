// AI suggestions: Gemini (primary) + any OpenAI-compatible provider, with fallback or ensemble mode.
const settings = require('./settings'), kb = require('./knowledge');

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}]/gu;
const keyOf = p => p.apiKey || process.env[String(p.id).toUpperCase().replace(/\W/g, '_') + '_API_KEY'] || '';

async function timed(url, opt, ms = 45000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opt, signal: ac.signal }); } finally { clearTimeout(t); }
}
async function callProvider(p, system, user, temp) {
  const key = keyOf(p); if (!key) throw new Error(p.name + ': no API key');
  if (p.type === 'gemini') {
    const call = model => timed(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: temp, responseMimeType: 'application/json' } })
    });
    let r = await call(p.model), j = await r.json().catch(() => ({}));
    // Retired/unknown model: retry once with Google's always-current alias
    if (!r.ok && p.model !== 'gemini-flash-latest' && (r.status === 404 || /no longer available|not found|deprecated/i.test(j.error?.message || ''))) { r = await call('gemini-flash-latest'); j = await r.json().catch(() => ({})); }
    if (!r.ok) throw new Error(p.name + ': ' + (j.error?.message || 'HTTP ' + r.status));
    const t = (j.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join('');
    if (!t) throw new Error(p.name + ': empty response'); return t;
  }
  const base = (p.baseUrl || '').replace(/\/+$/, ''); if (!base) throw new Error(p.name + ': missing base URL');
  const r = await timed(base + '/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: p.model, temperature: temp, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(p.name + ': ' + (j.error?.message || 'HTTP ' + r.status));
  const t = j.choices?.[0]?.message?.content; if (!t) throw new Error(p.name + ': empty response'); return t;
}
function parseJson(t) {
  const s = String(t).replace(/```json|```/gi, ''), a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('AI did not return JSON');
  return JSON.parse(s.slice(a, b + 1));
}

function sanitize(raw, S) {
  const prefix = S.general.prefix, names = new Set(S.snippets.map(s => s.name));
  let reply = typeof raw.reply === 'string' ? raw.reply : '';
  reply = reply.replace(/<a?:\w+:\d+>/g, '').replace(EMOJI, '').replace(/(^|\s):[a-z0-9_+-]{2,32}:(?=\s|$|[.,!?])/gi, '$1').replace(/(^|\s)[:;]-?[)(DP]+(?=\s|$)/g, '$1');
  reply = reply.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, t, u) => kb.isKnownUrl(u) ? m : t)
    .replace(/(?<!\()https?:\/\/[^\s)>\]]+/g, u => kb.isKnownUrl(u) ? u : '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, e => kb.isKnownEmail(e) ? e : '')
    .replace(/```/g, "'''").replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const max = S.ai.maxReplyChars;
  if (reply.length > max) { const cut = reply.slice(0, max), i = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. ')); reply = (i > max * 0.5 ? cut.slice(0, i + 1) : cut).trim(); }
  const list = (Array.isArray(raw.commands) ? raw.commands : []).map(c => String(c && c.name || c).trim().replace(/^[?!./]/, '').split(/\s+/)[0].toLowerCase()).filter(c => names.has(c));
  const commands = [...new Set(list)].slice(0, 3).map(n => ({ name: n, text: prefix + n, after: (S.snippets.find(s => s.name === n)?.after || '') && prefix + S.snippets.find(s => s.name === n).after }));
  return { reply, commands };
}

async function suggest({ transcript, owner }) {
  const S = settings.get('helpline'), A = S.ai;
  const providers = A.providers.filter(p => p.enabled && keyOf(p));
  if (!providers.length) throw new Error('No AI provider is enabled with an API key.');
  const cust = transcript.filter(m => m.role === 'customer').slice(-4).map(m => m.text).join('\n') || transcript.slice(-3).map(m => m.text).join('\n');
  const jobs = /(job|apply|applic|vacanc|position|career|cadet|pilot|crew|recruit|hiring|technician|trabajo|puesto|vacante|candidatura|empleo)/i.test(cust);
  const [chunks, live] = [kb.search(cust + ' ' + transcript.slice(-2).map(m => m.text).join(' '), 8), jobs ? await kb.liveJobs().catch(() => '') : ''];
  const system = A.systemRules.replaceAll('{businessEmail}', A.businessEmail).replaceAll('{recruitmentEmail}', A.recruitmentEmail).replaceAll('{maxChars}', String(A.maxReplyChars));
  const conv = transcript.slice(-25).map(m => `[${m.role === 'customer' ? 'Customer' : 'Staff'}] ${m.text}`).join('\n');
  const user = `TICKET OPENER: ${owner || 'unknown'}\n\nCONVERSATION (oldest first):\n${conv || '(no messages yet)'}\n\n` +
    `KNOWLEDGE (from the Iberia website, help center, Google Docs, videos and Discord channels):\n${chunks.map(c => `--- ${c.title || ''} <${c.source}>\n${c.text}`).join('\n\n') || '(nothing relevant found)'}\n\n` +
    (live ? `LIVE PAGE ${S.knowledge.jobsUrl} (current job vacancies):\n${live}\n\n` : '') +
    (A.extraKnowledge ? `ADMIN NOTES:\n${A.extraKnowledge}\n\n` : '') +
    `AVAILABLE SNIPPETS (staff run them as ${S.general.prefix}name):\n${S.snippets.map(s => `${S.general.prefix}${s.name} - ${s.desc}${s.after ? ` (afterwards ${S.general.prefix}${s.after} is usually run)` : ''}`).join('\n')}\n\n` +
    `Return ONLY a JSON object: {"reply": "<suggested reply in Discord markdown, or empty string>", "commands": ["<snippet name without prefix>"]}`;
  const errors = []; const run = async p => parseJson(await callProvider(p, system, user, A.temperature));
  if (A.mode === 'ensemble' && providers.length > 1) {
    const res = (await Promise.allSettled(providers.map(run))).map((r, i) => { if (r.status === 'rejected') errors.push(r.reason.message); return r.status === 'fulfilled' ? r.value : null; }).filter(Boolean);
    if (res.length > 1) {
      const merge = user + `\n\nSeveral assistants drafted these candidate answers. Combine the best, most accurate parts into ONE final answer, keep only facts supported by the knowledge above, and return the same JSON format.\n` + res.map((r, i) => `CANDIDATE ${i + 1}: ${JSON.stringify(r)}`).join('\n');
      for (const p of providers) { try { return sanitize(parseJson(await callProvider(p, system, merge, A.temperature)), S); } catch (e) { errors.push(e.message); } }
    }
    if (res.length) return sanitize(res[0], S);
  } else {
    for (const p of providers) { try { return sanitize(await run(p), S); } catch (e) { errors.push(e.message); } }
  }
  throw new Error(errors.join(' | ') || 'AI failed');
}
module.exports = { suggest, sanitize, parseJson };
