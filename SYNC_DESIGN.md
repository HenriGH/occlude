# Synchronization design

## Current boundary

Phase 2 client/RPC code is implemented. PostgreSQL behavior is tested locally with
PGlite, including two independent Dexie databases. Hosted Supabase Auth, Storage,
and live device synchronization remain unverified until the migration is applied
to the chosen project and real test users sign in. These are separate claims.

## Local commit and durable delivery

A connected workspace atomically commits every local mutation together with a UUID
operation in Dexie's `outbox`. `syncMeta` persists the owner, device UUID, monotonically
increasing queue order, optimistic entity versions, and last successful sync. Local
review does not wait for the network. Failure to write the outbox rolls back the
mutation. An unconnected workspace remains usable and has no upload queue yet.

Binding the first account explicitly adopts existing local data and queues it in
parent-first order. An untouched default deck on a second device is replaced by
cloud metadata instead of creating a duplicate default deck. Browser storage stays
bound to that account; switching to another user is blocked. Explicit sign-out
locks the cached UI and retains pending work. Cached data is not encrypted.

The engine runs on connection, startup, foreground activation, reconnect, pending
mutations, and a 15-second foreground timer. Transient failures use durable capped
exponential backoff with jitter (about 1 second to 5 minutes); manual retry resets
the delay. Every HTTP operation uses a token captured for, and verified against,
the workspace owner, preventing account changes in another tab from redirecting
an in-flight write. UUID idempotency also protects concurrent tabs.

## Image publication

Content-addressed bytes upload first to the immutable private path `<user>/<hash>`.
The RPC refuses image metadata until the Storage object exists. One transaction
creates/updates image placement, regions, and cards. Retries reuse IDs. A lost
upload acknowledgment triggers an authenticated download and SHA-256 verification,
not an overwrite. Blob data stays local while pending operations may still need it.
Cloud bytes are verified before caching. Metadata pulls do not download all images;
visible thumbnails, editing, and review fetch required assets lazily.

## Metadata conflicts and deletion

`deck.put/delete`, `image.put/delete`, and `settings.put` carry a base version.
The SQL RPC obtains a per-user transaction lock, validates ownership and graph
constraints, and rejects a mismatched version instead of overwriting newer state.
The operation log and mutation commit together. A repeated operation ID returns
the original acknowledgment; a reused ID with different contents is rejected.

Conflicts remain durable and visible. Settings offers explicit rebasing of the
local version, or adopting cloud metadata after confirmation. Adopting cloud data
never discards review operations and is blocked if they need a card not yet on the
server. Tombstones cannot be resurrected by stale writes. Concurrent structural
conflicts, such as identical content created independently in the same deck, may
need deliberate reconciliation; pending changes and learning events remain retained.

Deck deletion tombstones actual server descendants in one transaction. Image and
mask deletion tombstone cards but retain review events. Even a review arriving
after its card was deleted is accepted into history without restoring the card.

## Canonical scheduling

Review events are append-only, deduplicated by ID, and sorted by `(reviewed_at UTC,
event UUID)`. Equal timestamps use the UUID tie-breaker. Both concurrent answers
survive. Every client replays the same canonical events from the original card
creation time using `ts-fsrs@5.4.2/default/fuzz-off`. Local scheduling fields are
materialized in IndexedDB, including Dates, stability, difficulty, learning steps,
repetitions and lapses. Unknown scheduler versions stop reconciliation.

The server's `card_scheduling` is an RLS-protected **view of replay inputs**, not a
mutable schedule snapshot. No client-provided due date or FSRS state is accepted by
the RPC, eliminating last-write-wins schedule corruption without a second scheduler
implementation in PostgreSQL. Array position supplies canonical order; it is not
stored as a permanently assigned insertion sequence. Clock skew can change order
and intervals; this limitation is inherent to preserving offline client timestamps.

## Pull and recovery

One RPC returns a consistent full metadata/event snapshot, including tombstones.
The personal-library scope favors this simpler protocol over paginated cursors;
large histories will need incremental snapshots later. Image bytes remain lazy.
The client validates schema, ownership, references, coordinates, versions and event
IDs before applying data. Metadata is replaced transactionally only when metadata
operations have drained; otherwise local metadata remains untouched. Reviews always
merge by ID and replay. A crash cannot advance an uncommitted pull checkpoint.

Successful sync means the queue drained and canonical metadata/history was applied.
It does not mean every image is cached offline. The UI never labels a deck fully
offline-ready; verified deck downloads and app-shell restart belong to Phase 3.
