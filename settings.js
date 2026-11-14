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
const get = k => cache[k];
async function save(k, v) { cache[k] = v; await col().put(k, v); }
module.exports = { load, get, save, merge, isObj };
