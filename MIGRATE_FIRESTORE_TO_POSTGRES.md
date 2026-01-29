# Firestore → PostgreSQL migration (metadata)

This repo stores **all app metadata** in Firestore, and stores generation media (images/videos/audio) in **Zata** with Firestore documents containing the **URLs/paths**.

This migration copies Firestore documents into Postgres **as JSONB** so you can move off Firestore without first redesigning your whole schema.

## What you get

- Every Firestore document (including subcollections) is copied into Postgres.
- Stored in `wildmind.firestore_documents` with:
  - `path` (primary key, full Firestore path)
  - `collection_path` (collection portion)
  - `doc_id`
  - `parent_path` (doc path that owns this subcollection doc)
  - `data` (JSONB)
  - timestamps (if available)

Zata media stays in Zata; Postgres stores the same URLs/paths you currently keep in Firestore.

## Prereqs

- A Postgres database (local or hosted)
- Firestore Admin access via one of:
  - `FIREBASE_SERVICE_ACCOUNT_JSON` (preferred)
  - `FIREBASE_SERVICE_ACCOUNT_B64`
  - `GOOGLE_APPLICATION_CREDENTIALS`

## Install deps

From `api-gateway-services-wildmind/`:

- `npm install`

## 1) Create the table

- `psql "$env:DATABASE_URL" -f scripts/sql/firestore_schema.sql`

## 2) Run the migration

From `api-gateway-services-wildmind/`:

- `npm run migrate:firestore-to-postgres`

### Optional flags

- Only certain root collections:
  - `npm run migrate:firestore-to-postgres -- --collections=users,generations,generationHistory`
- Increase/decrease page size (default 500):
  - `npm run migrate:firestore-to-postgres -- --batch=1000`
- Dry run (reads Firestore only):
  - `npm run migrate:firestore-to-postgres -- --dry-run`

## Notes / next step

This is the **safe first step**: it proves you can get all metadata into Postgres.

Next, if you want the app to actually *use* Postgres (instead of Firestore), we can:
- Define real relational tables for the hot paths (users, generations, generationHistory items, credits/ledgers, canvas projects)
- Add a DB access layer and switch reads/writes gradually (dual-write → cutover)
