const db = require('./db'), D = require('./defaults');
const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
function merge(base, over) {
  if (!isObj(base)) return over === undefined ? base : over;
  const out = { ...base };
  if (!isObj(over)) return out;
  for (const k of Object.keys(over)) out[k] = isObj(base[k]) ? merge(base[k], over[k]) : over[k];
  return out;
}
let cache = { helpline: merge(D.helpline, {}), bot: merge(D.bot, {}) };
const col = () => db.col('cfg');
async function load() {
  for (const k of ['helpline', 'bot']) {
    const saved = await col().get(k);
    if (saved) { const { id, ...x } = saved; cache[k] = merge(D[k], x); }
  }
}
// Saved settings keep old model names forever; swap retired ones for their current replacements.
const RETIRED = { gemini: { 'gemini-2.5-flash': 'gemini-3.8-flash', 'gemini-2.0-flash': 'gemini-3.8-flash', 'gemini-1.5-flash': 'gemini-3.8-flash', 'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite' },
  groq: { 'llama-3.3-70b-versatile': 'openai/gpt-oss-120b' }, openrouter: { 'meta-llama/llama-3.3-70b-instruct:free': 'meta-llama/llama-3.3-70b-instruct' }, cerebras: { 'llama-3.3-70b': 'gpt-oss-120b' } };
async function migrate() {
  let changed = false;
  for (const p of cache.helpline.ai.providers || []) { const n = RETIRED[p.id]?.[p.model]; if (n) { p.model = n; changed = true; } }
  if (changed) { console.log('Updated retired AI model names in saved settings'); await col().put('helpline', cache.helpline); }
}
const get = k => cache[k];
async function save(k, v) { cache[k] = v; await col().put(k, v); }
module.exports = { migrate, load, get, save, merge, isObj };
