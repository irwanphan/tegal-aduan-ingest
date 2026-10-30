// Menghasilkan n8n/meta-ingest.workflow.json dengan menyisipkan lib.js ke Code node.
// Jalankan: node n8n/build-workflow.mjs   (lalu Import from File di n8n)
import { readFileSync, writeFileSync } from 'node:fs';

const lib = readFileSync(new URL('./lib.js', import.meta.url), 'utf8');

const verifyCode = `const q = $input.first().json.query || {};
if (q['hub.mode'] === 'subscribe' && $env.META_VERIFY_TOKEN && q['hub.verify_token'] === $env.META_VERIFY_TOKEN) {
  return [{ json: { challenge: q['hub.challenge'] } }];
}
throw new Error('Verify token Meta tidak cocok');`;

const normalizeCode = `${lib}
const crypto = require('crypto');
const first = $input.first();
const raw = await this.helpers.getBinaryDataBuffer(0, 'data');
const sig = (first.json.headers || {})['x-hub-signature-256'];
if (!verifySignature(crypto, $env.META_APP_SECRET, raw, sig)) {
  throw new Error('Tanda tangan webhook tidak valid');
}
const rows = normalizeWebhook(JSON.parse(raw.toString('utf8')));
return rows.map((r) => ({ json: toRow(crypto, $env, r) }));`;

const insertSql = `INSERT INTO reports (source, kind, external_id, parent_external_id, author_hash,
                     author_name, author_ref_enc, text, media, permalink, created_at)
SELECT x.source, x.kind, x.external_id, x.parent_external_id, x.author_hash,
       x.author_name, x.author_ref_enc, x.text, x.media, x.permalink, x.created_at
FROM jsonb_to_record($1::jsonb) AS x(source text, kind text, external_id text, parent_external_id text,
     author_hash text, author_name text, author_ref_enc text, text text, media jsonb,
     permalink text, created_at timestamptz)
ON CONFLICT (source, kind, external_id) DO UPDATE SET text = EXCLUDED.text, media = EXCLUDED.media;`;

const workflow = {
  name: 'Meta ingest (FB / IG / WhatsApp) -> Postgres',
  nodes: [
    {
      parameters: { httpMethod: 'GET', path: 'meta', responseMode: 'responseNode', options: {} },
      id: 'n1', name: 'Meta Verify (GET)', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0],
      webhookId: 'meta-verify',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: verifyCode },
      id: 'n2', name: 'Cek Verify Token', type: 'n8n-nodes-base.code', typeVersion: 2, position: [240, 0],
    },
    {
      parameters: { respondWith: 'text', responseBody: '={{ $json.challenge }}', options: {} },
      id: 'n3', name: 'Balas Challenge', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [480, 0],
    },
    {
      parameters: { httpMethod: 'POST', path: 'meta', responseMode: 'onReceived', options: { rawBody: true } },
      id: 'n4', name: 'Meta Events (POST)', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 240],
      webhookId: 'meta-events',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: normalizeCode },
      id: 'n5', name: 'Verifikasi & Normalisasi', type: 'n8n-nodes-base.code', typeVersion: 2, position: [240, 240],
    },
    {
      parameters: {
        operation: 'executeQuery',
        query: insertSql,
        options: { queryReplacement: '={{ [JSON.stringify($json)] }}' },
      },
      id: 'n6', name: 'Simpan ke Postgres', type: 'n8n-nodes-base.postgres', typeVersion: 2.5, position: [480, 240],
      credentials: { postgres: { id: '', name: 'Postgres Tegal' } },
    },
  ],
  connections: {
    'Meta Verify (GET)': { main: [[{ node: 'Cek Verify Token', type: 'main', index: 0 }]] },
    'Cek Verify Token': { main: [[{ node: 'Balas Challenge', type: 'main', index: 0 }]] },
    'Meta Events (POST)': { main: [[{ node: 'Verifikasi & Normalisasi', type: 'main', index: 0 }]] },
    'Verifikasi & Normalisasi': { main: [[{ node: 'Simpan ke Postgres', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
};

writeFileSync(new URL('./meta-ingest.workflow.json', import.meta.url), JSON.stringify(workflow, null, 2));
console.log('ditulis: n8n/meta-ingest.workflow.json');
