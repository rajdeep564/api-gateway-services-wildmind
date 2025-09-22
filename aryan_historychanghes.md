## Generation History + Mirror Changes

### What was added
- Types (`src/types/generate.ts`)
  - Enums: `GenerationType`, `GenerationStatus`, `Visibility`
  - Media: `ImageMedia`, `VideoMedia`
  - Shapes: `GenerationHistoryItem`, `CreateGenerationPayload`, `CompleteGenerationPayload`, `FailGenerationPayload`

- Express typings (`src/types/express.d.ts`)
  - Augments `Express.Request` with: `uid: string`, `email?: string`, `username?: string`

- Validators (`src/middlewares/validateGenerations.ts`)
  - `validateCreateGeneration` — validates creation payload
  - `validateUpdateGenerationStatus` — validates completed/failed updates + optional media
  - `validateListGenerations` — validates paging and filters
  - `handleValidationErrors` — consistent 400 error response with `formatApiResponse`

- Repositories
  - History (`src/repository/generationHistoryRepository.ts`)
    - `create(uid, data)` — writes `generationHistory/{uid}/items` with defaults and status `generating`
    - `update(uid, historyId, updates)` — updates doc with `updatedAt`
    - `get(uid, historyId)` — fetch one
    - `list(uid, { limit, cursor?, status?, generationType? })` — paginated list (desc by `createdAt`)
  - Mirror (`src/repository/generationsMirrorRepository.ts`)
    - `upsertFromHistory(uid, historyId, historyDoc, createdBy)` — mirrors doc into `generations/{historyId}` including `createdBy: { uid, username, displayName?, photoURL? }`
    - `updateFromHistory(uid, historyId, updates)` — partial update from history

- Service (`src/services/generationHistoryService.ts`)
  - `startGeneration(uid, payload)` — writes to history first; mirrors as private generating card (with `createdBy`)
  - `markGenerationCompleted(uid, historyId, updates)` — guards transition, attaches media, updates history, mirrors with creator info
  - `markGenerationFailed(uid, historyId, error)` — guards transition, records error, mirrors failure (private)
  - `getUserGeneration`, `listUserGenerations` — read helpers

- Controller (`src/controllers/generationHistoryController.ts`)
  - `create`, `updateStatus`, `get`, `listMine` — thin layer calling the service and formatting responses

- Routes
  - `src/routes/generations.ts` — secure endpoints behind `requireAuth`
  - Mounted in `src/routes/index.ts` under `/api/generations`

### Data model
- Source of truth: `generationHistory/{uid}/items/{historyId}`
  - Includes prompt, model, `generationType`, `status`, `visibility`, optional `tags/nsfw` and `images/videos`, timestamps
- Mirror (browse-optimized): `generations/{historyId}`
  - Mirrors fields from history
  - Adds `createdBy: { uid, username, displayName?, photoURL? }`
  - Intended for public/private gallery querying

### Validation and transitions
- Allowed transitions: `generating -> completed` or `generating -> failed`
- Completed updates can include validated media arrays
- Failed updates require an `error` string
- All validation errors return `formatApiResponse('error', 'Validation failed', { errors })`

### Indexing guidance
- Use `FieldValue.serverTimestamp()` for `createdAt/updatedAt`
- History list: order by `createdAt desc`; add composite index only if filtering by `status + createdAt`
- Mirror list: consider composite index for `visibility + isPublicReady + createdAt desc`

### Next steps (optional)
- Wire provider services (BFL/FAL/MiniMax/Runway) to call `startGeneration` at task creation and `markGenerationCompleted/Failed` upon completion
- Add moderation step to flip `isPublicReady` after review


