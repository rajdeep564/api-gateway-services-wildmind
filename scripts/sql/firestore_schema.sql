-- Minimal schema to store Firestore documents in PostgreSQL
-- This preserves full document content as JSONB, including Zata media URLs stored in fields.

CREATE SCHEMA IF NOT EXISTS wildmind;

CREATE TABLE IF NOT EXISTS wildmind.firestore_documents (
  path TEXT PRIMARY KEY,
  collection_path TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  parent_path TEXT,
  data JSONB NOT NULL,
  create_time TIMESTAMPTZ,
  update_time TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS firestore_documents_collection_path_idx
  ON wildmind.firestore_documents (collection_path);

CREATE INDEX IF NOT EXISTS firestore_documents_doc_id_idx
  ON wildmind.firestore_documents (doc_id);

CREATE INDEX IF NOT EXISTS firestore_documents_parent_path_idx
  ON wildmind.firestore_documents (parent_path);

CREATE INDEX IF NOT EXISTS firestore_documents_data_gin_idx
  ON wildmind.firestore_documents USING GIN (data);
