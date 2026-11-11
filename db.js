// Capa de datos: MongoDB si hay MONGODB_URI; si no, archivo JSON local (se pierde en Render Free).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
const rid = () => crypto.randomBytes(8).toString('hex');
const toDoc = r => { const { id, ...x } = r; return { _id: id, ...x }; };
const fromDoc = d => { if (!d) return d; const { _id, ...x } = d; return { id: _id, ...x }; };
const META = { projection: { state: 0, attachments: 0, menuIds: 0 } };

async function mongoImpl(uri) {
  const { MongoClient } = require('mongodb');
  const cl = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await cl.connect();
  const d = cl.db(process.env.MONGODB_DB || 'iberia_publisher');
  const M = d.collection('menus'), T = d.collection('templates'), S = d.collection('sent');
  await T.createIndex({ name: 1 }, { unique: true });
  await S.createIndex({ ts: -1 });
  return {
    kind: 'mongo',
    getMenu: async id => (await M.findOne({ _id: id }))?.options,
    saveMenus: async list => { if (list?.length) await M.bulkWrite(list.map(m => ({ replaceOne: { filter: { _id: m.id }, replacement: { options: m.options }, upsert: true } }))); },
    delMenus: async ids => { if (ids?.length) await M.deleteMany({ _id: { $in: ids } }); },
    listTpl: async () => (await T.find({}, { projection: { name: 1, updated: 1 } }).sort({ name: 1 }).toArray()).map(x => ({ id: x._id, name: x.name, updated: x.updated })),
    getTpl: async id => { const x = await T.findOne({ _id: id }); return x && { id: x._id, name: x.name, state: x.state }; },
    saveTpl: async (name, state) => { const ex = await T.findOne({ name }), id = ex?._id || rid(); await T.updateOne({ _id: id }, { $set: { name, state, updated: Date.now() } }, { upsert: true }); return id; },
    delTpl: async id => { await T.deleteOne({ _id: id }); },
    addSent: async rec => { await S.insertOne(toDoc(rec)); },
    listSent: async () => (await S.find({}, META).sort({ ts: -1 }).limit(60).toArray()).map(fromDoc),
    getSent: async id => fromDoc(await S.findOne({ _id: id })),
    updSent: async (id, set) => { await S.updateOne({ _id: id }, { $set: set }); },
    delSent: async id => { await S.deleteOne({ _id: id }); }
  };
}

function fileImpl() {
  const file = path.join(dir, 'data.json'), old = path.join(dir, 'menus.json');
  let db = { menus: {}, templates: {}, sent: [] };
  try { db = { ...db, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch { try { db.menus = JSON.parse(fs.readFileSync(old, 'utf8')); } catch { /* primera vez */ } }
  const save = () => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(db)); fs.renameSync(file + '.tmp', file); };
  return {
    kind: 'file',
    getMenu: async id => db.menus[id],
    saveMenus: async list => { for (const m of list || []) db.menus[m.id] = m.options; save(); },
    delMenus: async ids => { for (const i of ids || []) delete db.menus[i]; save(); },
    listTpl: async () => Object.entries(db.templates).map(([id, t]) => ({ id, name: t.name, updated: t.updated })).sort((a, b) => a.name.localeCompare(b.name)),
    getTpl: async id => db.templates[id] && { id, ...db.templates[id] },
    saveTpl: async (name, state) => { const id = Object.keys(db.templates).find(k => db.templates[k].name === name) || rid(); db.templates[id] = { name, state, updated: Date.now() }; save(); return id; },
    delTpl: async id => { delete db.templates[id]; save(); },
    addSent: async rec => { db.sent.unshift(rec); db.sent = db.sent.slice(0, 200); save(); },
    listSent: async () => db.sent.slice(0, 60).map(({ state, attachments, menuIds, ...x }) => x),
    getSent: async id => db.sent.find(s => s.id === id),
    updSent: async (id, set) => { const s = db.sent.find(x => x.id === id); if (s) Object.assign(s, set); save(); },
    delSent: async id => { db.sent = db.sent.filter(s => s.id !== id); save(); }
  };
}

let impl;
const ready = (async () => {
  const uri = (process.env.MONGODB_URI || '').trim();
  if (uri) {
    try { impl = await mongoImpl(uri); console.log('Base de datos: MongoDB conectado'); return; }
    catch (e) { console.error('⚠ MongoDB falló, uso archivo local:', e.message); }
  } else console.log('⚠ MONGODB_URI vacío: uso archivo local (en Render Free se borra al reiniciar)');
  impl = fileImpl();
})();

const api = { rid, kind: () => impl?.kind || 'init', ready };
for (const k of ['getMenu', 'saveMenus', 'delMenus', 'listTpl', 'getTpl', 'saveTpl', 'delTpl', 'addSent', 'listSent', 'getSent', 'updSent', 'delSent'])
  api[k] = async (...a) => { await ready; return impl[k](...a); };
module.exports = api;
