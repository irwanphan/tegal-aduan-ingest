// Logika normalisasi webhook Meta (Facebook Page, Instagram, WhatsApp Business) -> baris tabel `reports`.
// Tanpa import: isi file ini disisipkan apa adanya ke Code node n8n oleh build-workflow.mjs.

function verifySignature(crypto, secret, rawBody, header) {
  if (!secret || !header || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function parseTime(v) {
  if (v === undefined || v === null) return new Date().toISOString();
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    let n = Number(v);
    if (n > 1e11) n /= 1000; // milidetik
    return new Date(n * 1000).toISOString();
  }
  return new Date(String(v).replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).toISOString();
}

function report(source, kind, externalId, o = {}) {
  return {
    source,
    kind,
    external_id: String(externalId),
    parent_external_id: o.parent ? String(o.parent) : null,
    author_id: o.authorId ? String(o.authorId) : null,
    author_name: o.authorName || null,
    text: o.text || '',
    media: o.media || [],
    permalink: o.permalink || null,
    created_at: parseTime(o.created),
  };
}

function messaging(source, entry) {
  const out = [];
  for (const ev of entry.messaging || []) {
    const msg = ev.message;
    if (!msg || msg.is_echo) continue;
    const media = (msg.attachments || []).map((a) => ({ type: a.type, url: (a.payload || {}).url }));
    if (!msg.text && media.length === 0) continue;
    out.push(report(source, 'dm', msg.mid, {
      authorId: (ev.sender || {}).id, text: msg.text, media, created: ev.timestamp,
    }));
  }
  return out;
}

function facebook(entry) {
  const out = messaging('facebook', entry);
  for (const ch of entry.changes || []) {
    if (ch.field !== 'feed') continue;
    const v = ch.value || {};
    if (v.verb !== 'add' && v.verb !== 'edited') continue;
    const from = v.from || {};
    if (v.item === 'comment' && from.id !== entry.id) {
      out.push(report('facebook', 'comment', v.comment_id, {
        parent: v.parent_id || v.post_id, authorId: from.id, authorName: from.name,
        text: v.message, created: v.created_time,
      }));
    } else if (['post', 'status', 'photo', 'video'].includes(v.item) && v.post_id) {
      const link = v.link || v.photo;
      out.push(report('facebook', 'post', v.post_id, {
        authorId: from.id, authorName: from.name, text: v.message,
        media: v.item !== 'status' && link ? [{ type: v.item, url: link }] : [],
        permalink: v.permalink_url, created: v.created_time,
      }));
    }
  }
  return out;
}

function instagram(entry) {
  const out = messaging('instagram', entry);
  for (const ch of entry.changes || []) {
    if (ch.field !== 'comments') continue;
    const v = ch.value || {};
    const from = v.from || {};
    if (from.id === entry.id) continue; // balasan admin sendiri
    out.push(report('instagram', 'comment', v.id, {
      parent: v.parent_id || (v.media || {}).id, authorId: from.id, authorName: from.username,
      text: v.text, created: entry.time,
    }));
  }
  return out;
}

function whatsapp(entry) {
  const out = [];
  for (const ch of entry.changes || []) {
    if (ch.field !== 'messages') continue;
    for (const m of (ch.value || {}).messages || []) {
      const t = m.type;
      const text = t === 'text' ? (m.text || {}).body : (m[t] || {}).caption;
      // Media WA harus diunduh lewat Graph API dengan media id; simpan id saja.
      const media = t && t !== 'text' ? [{ type: t, media_id: (m[t] || {}).id }] : [];
      out.push(report('whatsapp', 'dm', m.id, { authorId: m.from, text, media, created: m.timestamp }));
    }
  }
  return out;
}

const HANDLERS = { page: facebook, instagram, whatsapp_business_account: whatsapp };

function normalizeWebhook(payload) {
  const handler = HANDLERS[payload.object];
  if (!handler) return [];
  return (payload.entry || []).flatMap(handler);
}

// Pseudonimisasi (UU PDP): hash stabil untuk semua; nama hanya untuk konten publik;
// referensi terenkripsi (AES-256-GCM) hanya untuk DM/WA agar petugas bisa menindaklanjuti.
function toRow(crypto, env, r) {
  const priv = r.kind === 'dm';
  const hash = r.author_id && env.HASH_SALT
    ? crypto.createHmac('sha256', env.HASH_SALT).update(`${r.source}:${r.author_id}`).digest('hex')
    : null;
  let enc = null;
  if (priv && r.author_id && env.ENCRYPTION_KEY) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(env.ENCRYPTION_KEY, 'hex'), iv);
    const body = Buffer.concat([c.update(r.author_id, 'utf8'), c.final()]);
    enc = Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
  }
  const { author_id, ...rest } = r;
  return { ...rest, author_name: priv ? null : r.author_name, author_hash: hash, author_ref_enc: enc };
}

if (typeof module !== 'undefined') module.exports = { verifySignature, normalizeWebhook, toRow, parseTime };
