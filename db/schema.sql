-- Jalankan sekali pada Postgres Railway (psql "$DATABASE_URL" -f db/schema.sql). Idempotent.

CREATE TABLE IF NOT EXISTS reports (
    id                 BIGSERIAL PRIMARY KEY,
    source             TEXT NOT NULL CHECK (source IN ('facebook', 'instagram', 'whatsapp')),
    kind               TEXT NOT NULL CHECK (kind IN ('post', 'comment', 'dm')),
    external_id        TEXT NOT NULL,
    parent_external_id TEXT,
    author_hash        TEXT,          -- HMAC stabil, untuk mengelompokkan pelapor tanpa identitas
    author_name        TEXT,          -- hanya untuk post/comment publik; NULL untuk DM/WA
    author_ref_enc     TEXT,          -- AES-256-GCM, hanya DM/WA, untuk tindak lanjut oleh petugas
    text               TEXT NOT NULL DEFAULT '',
    media              JSONB NOT NULL DEFAULT '[]',
    permalink          TEXT,
    status             TEXT NOT NULL DEFAULT 'baru'
                       CHECK (status IN ('baru', 'diproses', 'selesai', 'diabaikan')),
    created_at         TIMESTAMPTZ NOT NULL,
    ingested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, kind, external_id)
);

CREATE INDEX IF NOT EXISTS reports_created_idx ON reports (created_at DESC);
CREATE INDEX IF NOT EXISTS reports_filter_idx  ON reports (source, kind, status);
CREATE INDEX IF NOT EXISTS reports_author_idx  ON reports (author_hash);

-- Untuk dashboard (read-only): buat role terpisah, jangan pakai kredensial n8n.
-- CREATE ROLE dashboard_ro LOGIN PASSWORD '...';
-- GRANT SELECT (id, source, kind, external_id, parent_external_id, author_hash, author_name,
--               text, media, permalink, status, created_at, ingested_at) ON reports TO dashboard_ro;
-- (author_ref_enc sengaja tidak diberikan.)
