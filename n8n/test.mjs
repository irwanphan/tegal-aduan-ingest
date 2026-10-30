import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const { verifySignature, normalizeWebhook, toRow, parseTime } = createRequire(import.meta.url)('./lib.js');

// --- tanda tangan
const body = Buffer.from('{"a":1}');
const good = 'sha256=' + crypto.createHmac('sha256', 's3cret').update(body).digest('hex');
assert.equal(verifySignature(crypto, 's3cret', body, good), true);
assert.equal(verifySignature(crypto, 's3cret', body, good.replace(/.$/, '0')), false);
assert.equal(verifySignature(crypto, 's3cret', body, undefined), false);
assert.equal(verifySignature(crypto, '', body, good), false);

// --- waktu
assert.equal(parseTime('2026-10-30T10:00:00+0000'), '2026-10-30T10:00:00.000Z');
assert.equal(parseTime(1793354400), '2026-10-30T10:00:00.000Z');
assert.equal(parseTime(1793354400000), '2026-10-30T10:00:00.000Z');

// --- Facebook: komentar warga, komentar admin (diabaikan), DM, echo (diabaikan)
const fb = normalizeWebhook({
  object: 'page',
  entry: [{
    id: 'PAGE1',
    messaging: [
      { sender: { id: 'U1' }, timestamp: 1793354400000, message: { mid: 'm1', text: 'jalan rusak' } },
      { sender: { id: 'PAGE1' }, message: { mid: 'm2', text: 'balasan', is_echo: true } },
    ],
    changes: [
      { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c1', post_id: 'p1', from: { id: 'U2', name: 'Budi' }, message: 'lampu mati', created_time: 1793354400 } },
      { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c2', post_id: 'p1', from: { id: 'PAGE1', name: 'Admin' }, message: 'terima kasih', created_time: 1793354400 } },
      { field: 'feed', value: { item: 'comment', verb: 'remove', comment_id: 'c3', from: { id: 'U2' } } },
    ],
  }],
});
assert.deepEqual(fb.map((r) => [r.kind, r.external_id]), [['dm', 'm1'], ['comment', 'c1']]);
assert.equal(fb[1].parent_external_id, 'p1');

// --- Instagram
const ig = normalizeWebhook({
  object: 'instagram',
  entry: [{ id: 'IG1', time: 1793354400, changes: [
    { field: 'comments', value: { id: 'ic1', text: 'sampah numpuk', from: { id: 'X1', username: 'warga1' }, media: { id: 'media9' } } },
    { field: 'comments', value: { id: 'ic2', text: 'siap', from: { id: 'IG1', username: 'pemkab' }, media: { id: 'media9' } } },
  ] }],
});
assert.deepEqual(ig.map((r) => r.external_id), ['ic1']);
assert.equal(ig[0].author_name, 'warga1');

// --- WhatsApp: teks + gambar
const wa = normalizeWebhook({
  object: 'whatsapp_business_account',
  entry: [{ id: 'W1', changes: [{ field: 'messages', value: { messages: [
    { from: '6285600000000', id: 'wamid.1', timestamp: '1793354400', type: 'text', text: { body: 'ada banjir' } },
    { from: '6285600000000', id: 'wamid.2', timestamp: '1761818401', type: 'image', image: { id: 'MEDIA1', caption: 'foto lokasi' } },
  ] } }] }],
});
assert.equal(wa.length, 2);
assert.deepEqual(wa[1].media, [{ type: 'image', media_id: 'MEDIA1' }]);
assert.equal(wa[1].text, 'foto lokasi');

// --- pseudonimisasi
const env = { HASH_SALT: 'salt', ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') };
const dm = toRow(crypto, env, wa[0]);
assert.equal('author_id' in dm, false);
assert.equal(dm.author_name, null);
assert.match(dm.author_hash, /^[0-9a-f]{64}$/);
assert.ok(dm.author_ref_enc);
// dekripsi balik harus menghasilkan nomor asli
const buf = Buffer.from(dm.author_ref_enc, 'base64');
const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(env.ENCRYPTION_KEY, 'hex'), buf.subarray(0, 12));
d.setAuthTag(buf.subarray(12, 28));
assert.equal(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString(), '6285600000000');
const pub = toRow(crypto, env, fb[1]);
assert.equal(pub.author_name, 'Budi');
assert.equal(pub.author_ref_enc, null);
assert.equal(toRow(crypto, env, wa[0]).author_hash, dm.author_hash); // hash stabil

assert.deepEqual(normalizeWebhook({ object: 'unknown' }), []);
console.log('semua test lolos');
