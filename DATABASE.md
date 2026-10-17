# Data model

## Local Dexie schema, version 2 (backward-compatible upgrade from 1)

- `decks`: UUID, parentId (nullable), name, createdAt/updatedAt (UTC milliseconds).
  Parent traversal rejects cycles. Deletion explicitly deletes descendants.
- `assets`: SHA-256 content hash, MIME type, width, height, Blob. Content is stored
  once even when referenced by more than one image placement.
- `images`: UUID, deckId, assetHash, createdAt, updatedAt. One placement per hash
  per deck. Moving images moves their cards, which derive deck membership here.
- `regions`: UUID, imageId, normalized x/y/width/height, optional `label` (question,
  up to 200 characters). Every region has one card. The non-indexed optional field
  needs no IndexedDB version upgrade; existing masks remain valid without it.
- `cards`: UUID, regionId (unique), imageId, createdAt, full `ts-fsrs` Card state.
- `reviews`: immutable UUID, cardId, rating, reviewedAt, schedulerVersion.
- `preferences`: keyed local settings, selected deck, daily new limit/day boundary.
- `outbox`: immutable wire operation ID/payload, device, base version, queue order,
  retry attempt/deadline, conflict state and last error.
- `syncMeta`: workspace owner/lock, persistent device ID, monotonic queue sequence,
  entity versions and last successful sync/error. Tokens stay in Supabase Auth's
  supported browser storage; elevated secret keys are never stored by this app.

Atomic Dexie transactions create regions/cards, edit images, and rate cards. Cards
reference regions; schedules are materialized projections of review events. Image
and deck deletions cascade through visible local records in a transaction. A
connected mutation and its outbox entry always commit atomically. Connected
workspaces retain deleted-target events and Blobs that earlier queued operations
may still need. Unconnected workspaces collect Blobs only when unreferenced.
Cloud tombstones keep stale clients from resurrecting deleted data.

## PostgreSQL migration (implemented, hosted application pending)

`profiles(user_id, settings, version, created_at)`, `decks(id, user_id, parent_id, name, ...)`,
`images(id, user_id, deck_id, storage_path, width, height, mime_type, content_hash,
...)`, `occlusion_regions(id, user_id, image_id, x, y, width, height, label, ...)`,
`cards(id, user_id, region_id, image_id, ...)`,
`review_events(id, user_id, card_id, rating, reviewed_at,
scheduler_version, created_at)`, and `sync_operations(id, user_id, device_id,
operation_type, operation_payload, processing_status, result, created_at, processed_at)`.

`202610170002_mask_labels.sql` adds a non-null text label with an empty default
and a 200-character limit. Apply it after the initial migration; existing rows
and review events are retained. `image.put` validates label types, updates text
with the same version/conflict rules as mask geometry, preserves omitted labels
from old clients and clears only explicitly supplied empty strings.

Schema refinement: `card_scheduling` is a security-invoker view containing original
creation time, canonical ordered events, count, last review, and scheduler version.
Full FSRS state/due dates are derived and stored in IndexedDB, not accepted as
cloud writes. This avoids a second scheduler implementation or an untrusted
last-write-wins projection. Canonical order is computed by timestamp and UUID,
not assigned permanently at event insertion. See SYNC_DESIGN.md.

Mutable entities have `version`, timestamps, and `deleted_at`. Ownership FKs
include user_id so a valid foreign ID cannot cross tenant boundaries. Unique
region/card and operation IDs enforce idempotency. Constrain normalized rectangles
to positive area inside [0,1]; constrain ratings to 1..4 and reject deck cycles.
Indexes cover ownership, parent/deck/image references and canonical event ordering.
Numeric UTC millisecond timestamps are checked for finite integral values in the
1970–2100 range before conversion. Storage enforces allowed MIME types and 15 MB;
SQL constrains dimensions and geometry. The client decodes/re-encodes actual image
bytes and verifies SHA-256 downloads. The database does not decode image pixels.

Every table has RLS using auth.uid(); RPCs derive user identity from auth rather
than trusting payload fields. Private Storage keys are `<auth.uid()>/<hash>`.
Storage policies restrict reads/inserts to that prefix and disallow client object
overwrite/deletion. Authenticated users have read-only RLS table access; mutations
must pass the validated security-definer RPC. Its owner is derived from auth.uid(),
and client-supplied ownership fields are rejected. Per-user transaction locking
protects idempotency, version checks, and hierarchy validation. Events cannot be
edited or deleted by the client. Referenced tombstoned images are retained;
administrative orphan-upload collection is described in supabase/SETUP.md.

The migration and ownership rules pass local PostgreSQL tests. Live Supabase
Auth/Storage service behavior remains unverified until the setup steps complete.
