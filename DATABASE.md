# Data model

## Phase 1: Dexie schema version 1

- `decks`: UUID, parentId (nullable), name, createdAt/updatedAt (UTC milliseconds).
  Parent traversal rejects cycles. Deletion explicitly deletes descendants.
- `assets`: SHA-256 content hash, MIME type, width, height, Blob. Content is stored
  once even when referenced by more than one image placement.
- `images`: UUID, deckId, assetHash, createdAt, updatedAt. One placement per hash
  per deck. Moving images moves their cards, which derive deck membership here.
- `regions`: UUID, imageId, normalized x/y/width/height. Every region has one card.
- `cards`: UUID, regionId (unique), imageId, createdAt, full `ts-fsrs` Card state.
- `reviews`: immutable UUID, cardId, rating, reviewedAt, schedulerVersion.
- `preferences`: keyed local settings, selected deck, daily new limit/day boundary.

Atomic Dexie transactions create regions/cards, edit images, and rate cards. Cards
reference regions; schedules are materialized projections of review events. Image
and deck deletions cascade through local records in a transaction. Unreferenced
asset Blobs are collected only after confirming no remaining placement uses them.
Local hard deletion is Phase 1 only; cloud synchronization requires tombstones.

## Phase 2: versioned PostgreSQL migrations (planned)

`profiles(user_id, settings, created_at)`, `decks(id, user_id, parent_id, name, ...)`,
`images(id, user_id, deck_id, storage_path, width, height, mime_type, content_hash,
...)`, `occlusion_regions(id, user_id, image_id, x, y, width, height, ...)`,
`cards(id, user_id, region_id, ...)`, `card_scheduling(card_id, user_id, state,
due_at, last_review_at, stability, difficulty, elapsed_days, scheduled_days,
learning_steps, reps, lapses, review_count, scheduler_version, updated_at)`,
`review_events(id, user_id, card_id, rating, reviewed_at, canonical_order,
scheduler_version, created_at)`, and `sync_operations(id, user_id, device_id,
operation_type, operation_payload, processing_status, created_at, processed_at)`.

Mutable entities gain `version`, timestamps, and `deleted_at`. Ownership FKs must
include user_id so a valid foreign ID cannot cross tenant boundaries. Unique
region/card and operation IDs enforce idempotency. Constrain normalized rectangles
to positive area inside [0,1]; constrain ratings to 1..4 and reject deck cycles.
Index ownership, parent/deck/image references, due dates, and event ordering.

Every table has RLS using auth.uid(); RPCs derive user identity from auth rather
than trusting payload fields. Private Storage keys are `<auth.uid()>/<hash>`.
Storage policies restrict all operations to that prefix. Garbage collection only
removes image objects after tombstone retention and a server transaction verifies
no live image/card references remain. Phase 2 must test two-user isolation before
claiming security or synchronization works.
