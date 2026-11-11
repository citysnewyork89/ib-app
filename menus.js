const db = require('./db');

// Responde cuando alguien elige una opción del desplegable (las opciones viven en la base de datos)
async function handleSelect(i) {
  const opts = await db.getMenu(i.customId);
  if (!opts) return i.reply({ content: 'Este menú ya no está configurado.', flags: 64 });
  const r = opts[i.values[0]];
  if (!r) return i.reply({ content: 'Opción no encontrada.', flags: 64 });
  const fill = s => s ? s.replaceAll('{user}', `<@${i.user.id}>`).replaceAll('{username}', i.user.username) : s;
  const out = { allowedMentions: { parse: [] } };
  if (r.content) out.content = fill(r.content).slice(0, 2000);
  const e = r.embed;
  if (e && (e.title || e.description || e.image || e.thumbnail || e.footer))
    out.embeds = [{ ...e, title: fill(e.title), description: fill(e.description) }];
  if (!out.content && !out.embeds) out.content = '✅';
  if (r.priv) out.flags = 64;
  return i.reply(out);
}

module.exports = { handleSelect };
